using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using UnityEditor;
using UnityEngine;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public class WorkspaceManager
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";
        private const string MinimumLevelEditorPrefsKey = "CADET_UnityConsoleMinimumLevel";
        private const int DebugLevel = 0;
        private const int WarnLevel = 2;
        private const int ErrorLevel = 3;
        private static int _cachedMinimumLevel = ErrorLevel;
        private static readonly object RegistrySyncRoot = new object();
        private static readonly object ProfileConfigSyncRoot = new object();

        // Resilient file I/O: retry on transient sharing violations from antivirus, Windows Search, recovery services, etc.
        private const int FileOperationRetryCount = 3;
        private const int FileOperationRetryDelayMs = 50;

        private readonly string _workspacesRoot;
        private readonly string _registryPath;
        private readonly string _profileConfigPath;

        [Serializable]
        private class ProfileWorkspaceConfigRegistry
        {
            public List<ProfileWorkspaceConfig> Profiles = new List<ProfileWorkspaceConfig>();
        }

        public WorkspaceManager(string workspacesRoot, string registryPath)
        {
            _workspacesRoot = workspacesRoot ?? throw new ArgumentNullException(nameof(workspacesRoot));
            _registryPath = registryPath ?? throw new ArgumentNullException(nameof(registryPath));
            _profileConfigPath = Path.Combine(_workspacesRoot, "profile-workspace-config.json");
        }

        public WorkspaceInfo CreateWorkspace(string jobGuid, string profileGuid, string profileJsonPath, string workspaceRootOverride = null, string profileName = null)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                throw new ArgumentException("Job GUID is required", nameof(jobGuid));
            }

            Directory.CreateDirectory(_workspacesRoot);

            WorkspaceRegistry registry = LoadRegistry();
            if (registry.Workspaces.Any(w => w.JobGuid == jobGuid))
            {
                throw new InvalidOperationException($"Workspace already exists for jobGuid '{jobGuid}'");
            }

            string effectiveWorkspaceRoot = string.IsNullOrWhiteSpace(workspaceRootOverride)
                ? _workspacesRoot
                : workspaceRootOverride;
            Directory.CreateDirectory(effectiveWorkspaceRoot);

            string workspacePath = Path.Combine(effectiveWorkspaceRoot, jobGuid);
            Directory.CreateDirectory(workspacePath);

            var info = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ProfileGuid = profileGuid,
                ProfileName = string.IsNullOrWhiteSpace(profileName) ? string.Empty : profileName.Trim(),
                ProfileJsonPath = NormalizePath(profileJsonPath),
                WorkspacePath = NormalizePath(workspacePath),
                CreatedAtUtc = DateTime.UtcNow,
                LastBuildStatus = BuildJobStatus.Queued,
                DiskUsageMB = GetDirectorySizeMB(workspacePath)
            };

            registry.Workspaces.Add(info);
            SaveRegistry(registry);

            return info;
        }

        public bool DeleteWorkspace(string jobGuid)
        {
            WorkspaceRegistry registry = LoadRegistry();
            WorkspaceInfo info = registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
            if (info == null)
            {
                return false;
            }

            if (Directory.Exists(info.WorkspacePath))
            {
                Directory.Delete(info.WorkspacePath, true);
            }

            registry.Workspaces.Remove(info);
            SaveRegistry(registry);
            return true;
        }

        public bool RemoveWorkspaceRecord(string jobGuid)
        {
            return RemoveWorkspaceRecord(jobGuid, deleteProjectFolder: false);
        }

        public bool RemoveWorkspaceRecord(string jobGuid, bool deleteProjectFolder)
        {
            return RemoveWorkspaceRecord(jobGuid, deleteProjectFolder, workspacePathOverride: null, profileGuidOverride: null);
        }

        public bool RemoveWorkspaceRecord(string jobGuid, bool deleteProjectFolder, string workspacePathOverride, string profileGuidOverride)
        {
            WorkspaceRegistry registry = LoadRegistry();
            string normalizedOverrideWorkspacePath = NormalizePath(workspacePathOverride);
            WorkspaceInfo[] matches = registry.Workspaces
                .Where(w => MatchesJobGuid(w, jobGuid))
                .ToArray();

            // Fallback for legacy/mismatched records where GUID lookup misses but workspace path is known.
            if (matches.Length == 0 && !string.IsNullOrWhiteSpace(normalizedOverrideWorkspacePath))
            {
                matches = registry.Workspaces
                    .Where(w => MatchesWorkspacePath(w, normalizedOverrideWorkspacePath))
                    .ToArray();

                if (matches.Length > 0)
                {
                    Debug.LogWarning($"[C.A.D.E.T] Workspace removal fallback matched {matches.Length} record(s) by workspace path for job '{jobGuid}'.");
                }
            }

            WorkspaceInfo primaryMatch = matches.FirstOrDefault();
            WorkspaceInfo deleteTarget = primaryMatch ?? new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ProfileGuid = profileGuidOverride,
                WorkspacePath = normalizedOverrideWorkspacePath,
                CreatedAtUtc = DateTime.UtcNow
            };

            if (primaryMatch != null)
            {
                if (string.IsNullOrWhiteSpace(deleteTarget.ProfileGuid))
                {
                    deleteTarget.ProfileGuid = profileGuidOverride;
                }

                if (string.IsNullOrWhiteSpace(deleteTarget.WorkspacePath))
                {
                    deleteTarget.WorkspacePath = normalizedOverrideWorkspacePath;
                }
            }

            bool deletedProjectFolder = false;
            if (deleteProjectFolder && CanDeleteWorkspaceProjectFolder(deleteTarget))
            {
                try
                {
                    Directory.Delete(deleteTarget.WorkspacePath, true);
                    deletedProjectFolder = true;
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[C.A.D.E.T] Failed to delete workspace project folder '{deleteTarget.WorkspacePath}': {ex.Message}");
                }
            }

            if (matches.Length == 0)
            {
                return deletedProjectFolder;
            }

            for (int i = 0; i < matches.Length; i++)
            {
                registry.Workspaces.Remove(matches[i]);
            }

            SaveRegistry(registry);
            return true;
        }

        private static bool MatchesJobGuid(WorkspaceInfo workspace, string jobGuid)
        {
            if (workspace == null || string.IsNullOrWhiteSpace(workspace.JobGuid) || string.IsNullOrWhiteSpace(jobGuid))
            {
                return false;
            }

            return string.Equals(workspace.JobGuid.Trim(), jobGuid.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        private static bool MatchesWorkspacePath(WorkspaceInfo workspace, string workspacePath)
        {
            if (workspace == null || string.IsNullOrWhiteSpace(workspace.WorkspacePath) || string.IsNullOrWhiteSpace(workspacePath))
            {
                return false;
            }

            string left = NormalizePath(workspace.WorkspacePath)?.TrimEnd('/');
            string right = NormalizePath(workspacePath)?.TrimEnd('/');
            return string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
        }

        public bool CanDeleteWorkspaceProjectFolder(WorkspaceInfo info)
        {
            if (info == null || string.IsNullOrWhiteSpace(info.WorkspacePath))
            {
                return false;
            }

            if (!Directory.Exists(info.WorkspacePath))
            {
                return false;
            }

            string workspacePath = NormalizeFullPath(info.WorkspacePath);
            if (string.IsNullOrWhiteSpace(workspacePath))
            {
                return false;
            }

            string currentOpenProjectPath = NormalizeFullPath(Path.GetDirectoryName(Application.dataPath));
            if (PathsEqual(workspacePath, currentOpenProjectPath))
            {
                return false;
            }

            ProfileWorkspaceConfig profileConfig = GetProfileConfig(info.ProfileGuid);
            string sourceProjectPath = NormalizeFullPath(profileConfig?.SourceProjectPath);
            if (!string.IsNullOrWhiteSpace(sourceProjectPath) && PathsEqual(workspacePath, sourceProjectPath))
            {
                return false;
            }

            return true;
        }

        public WorkspaceInfo GetWorkspaceByJobGuid(string jobGuid)
        {
            WorkspaceRegistry registry = LoadRegistry();
            return registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
        }

        /// <summary>
        /// Resilient file read with retry logic for transient sharing violations (antivirus, Windows Search, OneDrive, recovery services, etc).
        /// </summary>
        private static string ResilientReadAllText(string path)
        {
            IOException lastException = null;
            
            for (int attempt = 0; attempt < FileOperationRetryCount; attempt++)
            {
                try
                {
                    return File.ReadAllText(path);
                }
                catch (IOException ex) when (IsTransientSharingViolation(ex))
                {
                    lastException = ex;
                    if (attempt < FileOperationRetryCount - 1)
                    {
                        Thread.Sleep(FileOperationRetryDelayMs);
                    }
                }
            }
            
            throw lastException ?? new IOException($"Failed to read {path}");
        }

        /// <summary>
        /// Resilient file write with retry logic for transient sharing violations.
        /// </summary>
        private static void ResilientWriteAllText(string path, string content)
        {
            IOException lastException = null;
            
            for (int attempt = 0; attempt < FileOperationRetryCount; attempt++)
            {
                try
                {
                    File.WriteAllText(path, content);
                    return;
                }
                catch (IOException ex) when (IsTransientSharingViolation(ex))
                {
                    lastException = ex;
                    if (attempt < FileOperationRetryCount - 1)
                    {
                        Thread.Sleep(FileOperationRetryDelayMs);
                    }
                }
            }
            
            throw lastException ?? new IOException($"Failed to write {path}");
        }

        private static bool IsTransientSharingViolation(IOException ex)
        {
            if (ex == null) return false;
            string message = ex.Message ?? string.Empty;
            return message.IndexOf("sharing violation", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   message.IndexOf("being used by another process", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public WorkspaceRegistry LoadRegistry()
        {
            lock (RegistrySyncRoot)
            {
                if (!File.Exists(_registryPath))
                {
                    return new WorkspaceRegistry();
                }

                string json = ResilientReadAllText(_registryPath);
                if (string.IsNullOrWhiteSpace(json))
                {
                    return new WorkspaceRegistry();
                }

                WorkspaceRegistry registry = WorkspaceRegistry.FromJson(json);
                registry.Workspaces ??= new List<WorkspaceInfo>();
                return registry;
            }
        }

        public void SaveRegistry(WorkspaceRegistry registry)
        {
            if (registry == null)
            {
                throw new ArgumentNullException(nameof(registry));
            }

            lock (RegistrySyncRoot)
            {
                Directory.CreateDirectory(_workspacesRoot);
                string json = registry.ToJson();
                ResilientWriteAllText(_registryPath, json);
            }
        }

        public void UpdateBuildStatus(string jobGuid, BuildJobStatus status)
        {
            WorkspaceRegistry registry = LoadRegistry();
            WorkspaceInfo info = registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
            if (info == null)
            {
                LogDiagnosticWarning($"WorkspaceManager.UpdateBuildStatus ignored missing job '{jobGuid}' for status '{status}'.");
                return;
            }

            LogDiagnostic($"WorkspaceManager.UpdateBuildStatus job='{jobGuid}' from '{info.LastBuildStatus}' to '{status}'. isActive={info.IsOperationActive} pid={info.ActiveProcessId} detail='{info.ActiveStatusDetail}'.");

            info.LastBuildStatus = status;
            if (IsTerminalStatus(status))
            {
                if (!string.IsNullOrWhiteSpace(info.ActiveStatusDetail))
                {
                    info.LastOperationSummary = info.ActiveStatusDetail;
                    if (string.IsNullOrWhiteSpace(info.LastTerminalMessage))
                    {
                        info.LastTerminalMessage = info.ActiveStatusDetail;
                    }
                }

                if (status == BuildJobStatus.Completed)
                {
                    string completionSummary = !string.IsNullOrWhiteSpace(info.LastCompletedOperationsSummary)
                        ? info.LastCompletedOperationsSummary
                        : info.LastOperationSummary;

                    if (string.IsNullOrWhiteSpace(info.LastTerminalMessage) || LooksLikeFailureTerminalMessage(info.LastTerminalMessage))
                    {
                        info.LastTerminalMessage = completionSummary;
                    }
                }

                info.LastUpdatedAtUtc = DateTime.UtcNow;
                ClearOperationFields(info);
            }
            SaveRegistry(registry);
        }

        public void UpdateOperationState(
            string jobGuid,
            bool isActive,
            int processId,
            DateTime? processStartUtc,
            string statusDetail,
            string logPath,
            bool? cancelRequested = null,
            string manifestPath = null,
            string launchToken = null)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                throw new ArgumentException("Job GUID is required", nameof(jobGuid));
            }

            WorkspaceRegistry registry = LoadRegistry();
            WorkspaceInfo info = registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
            if (info == null)
            {
                LogDiagnosticWarning($"WorkspaceManager.UpdateOperationState ignored missing job '{jobGuid}'.");
                return;
            }

            LogDiagnostic($"WorkspaceManager.UpdateOperationState job='{jobGuid}' isActive={isActive} pid={processId} startUtc={processStartUtc?.ToString("O") ?? "<null>"} detail='{statusDetail}' logPath='{logPath}' manifest='{manifestPath}' token='{launchToken}' cancelRequested={(cancelRequested.HasValue ? cancelRequested.Value.ToString() : "<unchanged>")}.");

            info.IsOperationActive = isActive;
            info.ActiveProcessId = isActive ? Math.Max(0, processId) : 0;
            info.ActiveProcessStartedAtUtc = isActive ? processStartUtc : null;

            if (!string.IsNullOrWhiteSpace(statusDetail))
            {
                info.ActiveStatusDetail = statusDetail;
            }

            if (!string.IsNullOrWhiteSpace(logPath))
            {
                info.ActiveLogPath = NormalizePath(logPath);
            }

            if (!string.IsNullOrWhiteSpace(manifestPath))
            {
                info.ActiveStatusManifestPath = NormalizePath(manifestPath);
            }

            if (!string.IsNullOrWhiteSpace(launchToken))
            {
                info.ActiveStatusLaunchToken = launchToken;
            }

            if (cancelRequested.HasValue)
            {
                info.CancelRequested = cancelRequested.Value;
                info.CancelRequestedAtUtc = cancelRequested.Value ? DateTime.UtcNow : null;
            }

            SaveRegistry(registry);
        }

        public void UpdateOperationStatusDetail(string jobGuid, string statusDetail)
        {
            if (string.IsNullOrWhiteSpace(jobGuid) || string.IsNullOrWhiteSpace(statusDetail))
            {
                return;
            }

            WorkspaceRegistry registry = LoadRegistry();
            WorkspaceInfo info = registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
            if (info == null)
            {
                return;
            }

            info.ActiveStatusDetail = statusDetail;
            info.LastOperationSummary = statusDetail;
            info.LastUpdatedAtUtc = DateTime.UtcNow;
            SaveRegistry(registry);
        }

        public void UpdateTrackedStatusSnapshot(
            string jobGuid,
            string activeStatusDetail,
            string completedOperationsSummary,
            string terminalMessage,
            int? exitCode,
            DateTime? updatedAtUtc)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return;
            }

            WorkspaceRegistry registry = LoadRegistry();
            WorkspaceInfo info = registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
            if (info == null)
            {
                return;
            }

            if (activeStatusDetail != null)
            {
                info.ActiveStatusDetail = activeStatusDetail;
                info.LastOperationSummary = activeStatusDetail;
            }

            if (completedOperationsSummary != null)
            {
                info.LastCompletedOperationsSummary = completedOperationsSummary;
            }

            if (terminalMessage != null)
            {
                info.LastTerminalMessage = terminalMessage;
            }

            if (exitCode.HasValue)
            {
                info.LastExitCode = exitCode.Value;
            }

            if (updatedAtUtc.HasValue)
            {
                info.LastUpdatedAtUtc = updatedAtUtc.Value;
            }

            SaveRegistry(registry);
        }

        public void ClearOperationState(string jobGuid)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return;
            }

            WorkspaceRegistry registry = LoadRegistry();
            WorkspaceInfo info = registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
            if (info == null)
            {
                return;
            }

            ClearOperationFields(info);
            SaveRegistry(registry);
        }

        public List<WorkspaceInfo> GetActiveOperations()
        {
            WorkspaceRegistry registry = LoadRegistry();
            bool changed = false;
            DateTime nowUtc = DateTime.UtcNow;
            List<WorkspaceInfo> activeOperations = new List<WorkspaceInfo>();

            for (int i = 0; i < registry.Workspaces.Count; i++)
            {
                WorkspaceInfo workspace = registry.Workspaces[i];
                if (workspace == null || !workspace.IsOperationActive)
                {
                    continue;
                }

                if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
                {
                    activeOperations.Add(workspace);
                    continue;
                }

                // Stale active flags are cleared here so callers do not keep rehydrating phantom active jobs.
                ClearOperationFields(workspace);
                workspace.LastUpdatedAtUtc = nowUtc;
                changed = true;
            }

            if (changed)
            {
                SaveRegistry(registry);
            }

            return activeOperations;
        }

        public WorkspaceInfo UpsertWorkspaceRecord(string jobGuid, string profileGuid, string profileJsonPath, string workspacePath, BuildJobStatus status, string profileName = null)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                throw new ArgumentException("Job GUID is required", nameof(jobGuid));
            }

            WorkspaceRegistry registry = LoadRegistry();
            WorkspaceInfo info = registry.Workspaces.FirstOrDefault(w => w.JobGuid == jobGuid);
            if (info == null)
            {
                info = new WorkspaceInfo
                {
                    JobGuid = jobGuid,
                    CreatedAtUtc = DateTime.UtcNow
                };
                registry.Workspaces.Add(info);
            }

            info.ProfileGuid = profileGuid;
            if (!string.IsNullOrWhiteSpace(profileName))
            {
                info.ProfileName = profileName.Trim();
            }
            else
            {
                info.ProfileName ??= string.Empty;
            }

            info.ProfileJsonPath = NormalizePath(profileJsonPath);
            info.WorkspacePath = NormalizePath(workspacePath);
            info.LastBuildStatus = status;
            // Do not walk the entire workspace tree during execute/startup paths.
            // Existing workspaces can be very large, and recursive size scans delay launch.
            info.DiskUsageMB = Math.Max(0, info.DiskUsageMB);
            if (IsTerminalStatus(status))
            {
                ClearOperationFields(info);
            }

            SaveRegistry(registry);
            return info;
        }

        private static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }

        private static bool LooksLikeFailureTerminalMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return false;
            }

            string lower = message.ToLowerInvariant();
            return lower.Contains("process not found") ||
                   lower.Contains("crash") ||
                   lower.Contains("failed") ||
                   lower.Contains("error");
        }

        private static void LogDiagnostic(string message)
        {
            EmitFiltered(DebugLevel, $"{DiagnosticsPrefix} {message}");
        }

        private static void LogDiagnosticWarning(string message)
        {
            EmitFiltered(WarnLevel, $"{DiagnosticsPrefix} {message}");
        }

        private static void EmitFiltered(int level, string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return;
            }

            int minimum = GetMinimumLevel();
            if (level < minimum)
            {
                return;
            }

            if (level >= WarnLevel)
            {
                Debug.LogWarning(message);
                return;
            }

            Debug.Log(message);
        }

        private static int GetMinimumLevel()
        {
            try
            {
                _cachedMinimumLevel = EditorPrefs.GetInt(MinimumLevelEditorPrefsKey, _cachedMinimumLevel);
            }
            catch (Exception)
            {
                return _cachedMinimumLevel;
            }

            return _cachedMinimumLevel;
        }

        private static void ClearOperationFields(WorkspaceInfo info)
        {
            if (info == null)
            {
                return;
            }

            // Preserve log path for post-completion "Open Build Log" button before clearing active fields.
            if (!string.IsNullOrWhiteSpace(info.ActiveLogPath))
            {
                info.LastLogPath = info.ActiveLogPath;
            }

            info.IsOperationActive = false;
            info.ActiveProcessId = 0;
            info.ActiveProcessStartedAtUtc = null;
            info.ActiveStatusDetail = string.Empty;
            info.ActiveLogPath = string.Empty;
            info.ActiveStatusManifestPath = string.Empty;
            info.ActiveStatusLaunchToken = string.Empty;
            info.CancelRequested = false;
            info.CancelRequestedAtUtc = null;
        }

        public ProfileWorkspaceConfig GetProfileConfig(string profileGuid)
        {
            ProfileWorkspaceConfigRegistry registry = LoadProfileConfigRegistry();
            ProfileWorkspaceConfig existing = registry.Profiles.FirstOrDefault(p => p.ProfileGuid == profileGuid);
            if (existing != null)
            {
                return existing;
            }

            return new ProfileWorkspaceConfig
            {
                ProfileGuid = profileGuid,
                SourceProjectPath = string.Empty
            };
        }

        public void SaveProfileConfig(ProfileWorkspaceConfig config)
        {
            if (config == null)
            {
                throw new ArgumentNullException(nameof(config));
            }

            ProfileWorkspaceConfigRegistry registry = LoadProfileConfigRegistry();
            ProfileWorkspaceConfig existing = registry.Profiles.FirstOrDefault(p => p.ProfileGuid == config.ProfileGuid);
            if (existing == null)
            {
                config.SourceProjectPath = NormalizePath(config.SourceProjectPath);
                registry.Profiles.Add(config);
            }
            else
            {
                existing.SourceProjectPath = NormalizePath(config.SourceProjectPath);
            }

            SaveProfileConfigRegistry(registry);
        }

        public void CleanupOldWorkspaces(string profileGuid, int keepCount)
        {
            WorkspaceRegistry registry = LoadRegistry();

            var matching = registry.Workspaces
                .Where(w => w.ProfileGuid == profileGuid)
                .ToList();

            var failed = matching.Where(w => w.LastBuildStatus == BuildJobStatus.Failed).ToList();
            var nonFailed = matching
                .Where(w => w.LastBuildStatus != BuildJobStatus.Failed)
                .ToList();

            // Preserve creation order from registry; keep the most recently appended N.
            int skipCount = Math.Max(0, nonFailed.Count - Math.Max(0, keepCount));
            var toKeepNonFailed = nonFailed.Skip(skipCount).ToHashSet();
            var toDelete = nonFailed.Where(w => !toKeepNonFailed.Contains(w)).ToList();

            foreach (WorkspaceInfo workspace in toDelete)
            {
                if (Directory.Exists(workspace.WorkspacePath))
                {
                    Directory.Delete(workspace.WorkspacePath, true);
                }
                registry.Workspaces.Remove(workspace);
            }

            // Failed workspaces are intentionally preserved.
            _ = failed;

            SaveRegistry(registry);
        }

        public bool ValidateWorkspaceRoot()
        {
            try
            {
                Directory.CreateDirectory(_workspacesRoot);
                string probePath = Path.Combine(_workspacesRoot, ".write-test.tmp");
                File.WriteAllText(probePath, "ok");
                File.Delete(probePath);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static long GetDirectorySizeMB(string path)
        {
            if (!Directory.Exists(path))
            {
                return 0;
            }

            long bytes = Directory.GetFiles(path, "*", SearchOption.AllDirectories)
                .Select(f => new FileInfo(f).Length)
                .Sum();
            return bytes / (1024 * 1024);
        }

        private static string NormalizePath(string path)
        {
            return string.IsNullOrWhiteSpace(path) ? path : path.Replace('\\', '/');
        }

        private static string NormalizeFullPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return string.Empty;
            }

            try
            {
                return Path.GetFullPath(path)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            }
            catch
            {
                return string.Empty;
            }
        }

        private static bool PathsEqual(string left, string right)
        {
            return string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
        }

        private ProfileWorkspaceConfigRegistry LoadProfileConfigRegistry()
        {
            lock (ProfileConfigSyncRoot)
            {
                if (!File.Exists(_profileConfigPath))
                {
                    return new ProfileWorkspaceConfigRegistry();
                }

                string json = ResilientReadAllText(_profileConfigPath);
                if (string.IsNullOrWhiteSpace(json))
                {
                    return new ProfileWorkspaceConfigRegistry();
                }

                ProfileWorkspaceConfigRegistry registry = JsonUtility.FromJson<ProfileWorkspaceConfigRegistry>(json)
                    ?? new ProfileWorkspaceConfigRegistry();
                registry.Profiles ??= new List<ProfileWorkspaceConfig>();
                return registry;
            }
        }

        private void SaveProfileConfigRegistry(ProfileWorkspaceConfigRegistry registry)
        {
            lock (ProfileConfigSyncRoot)
            {
                Directory.CreateDirectory(_workspacesRoot);
                ResilientWriteAllText(_profileConfigPath, JsonUtility.ToJson(registry, true));
            }
        }
    }
}
