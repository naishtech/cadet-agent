using System;
using System.Collections.Generic;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class BuildQueueWorkspaceContextService
    {
        public readonly struct WorkspaceInfoCacheEntry
        {
            public WorkspaceInfoCacheEntry(WorkspaceInfo workspaceInfo, double expiresAt)
            {
                WorkspaceInfo = workspaceInfo;
                ExpiresAt = expiresAt;
            }

            public WorkspaceInfo WorkspaceInfo { get; }
            public double ExpiresAt { get; }
        }

        public readonly struct ProfileCacheEntry
        {
            public ProfileCacheEntry(BuildProfile profile, double expiresAt)
            {
                Profile = profile;
                ExpiresAt = expiresAt;
            }

            public BuildProfile Profile { get; }
            public double ExpiresAt { get; }
        }

        public sealed class WorkspaceHistoryCacheState
        {
            public bool IsDirty = true;
            public double NextRefreshAt;
            public readonly List<BuildJobDefinition> CachedJobs = new List<BuildJobDefinition>();
        }

        public static BuildProfile GetProfileForJob(
            BuildJobDefinition job,
            IDictionary<string, ProfileCacheEntry> profileCache,
            double now,
            double cacheSeconds)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.ProfileGuid))
            {
                return null;
            }

            if (profileCache != null &&
                profileCache.TryGetValue(job.ProfileGuid, out ProfileCacheEntry cached) &&
                now < cached.ExpiresAt)
            {
                return cached.Profile;
            }

            string assetPath = AssetDatabase.GUIDToAssetPath(job.ProfileGuid);
            if (string.IsNullOrWhiteSpace(assetPath))
            {
                if (profileCache != null)
                {
                    profileCache[job.ProfileGuid] = new ProfileCacheEntry(null, now + cacheSeconds);
                }

                return null;
            }

            BuildProfileAsset asset = AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(assetPath);
            BuildProfile profile = asset?.Profile;

            if (profileCache != null)
            {
                profileCache[job.ProfileGuid] = new ProfileCacheEntry(profile, now + cacheSeconds);
            }

            return profile;
        }

        public static WorkspaceInfo GetWorkspaceInfo(string jobGuid)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return null;
            }

            try
            {
                string workspacesRoot = Path.GetFullPath(CadetLitePathService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
                WorkspaceManager workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);
                return workspaceManager.GetWorkspaceByJobGuid(jobGuid);
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to resolve workspace info for job {jobGuid}: {ex.Message}");
                return null;
            }
        }

        public static WorkspaceInfo GetWorkspaceInfo(
            string jobGuid,
            IDictionary<string, WorkspaceInfoCacheEntry> workspaceInfoCache,
            double now,
            double cacheSeconds)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return null;
            }

            if (workspaceInfoCache != null &&
                workspaceInfoCache.TryGetValue(jobGuid, out WorkspaceInfoCacheEntry cached) &&
                now < cached.ExpiresAt)
            {
                return cached.WorkspaceInfo;
            }

            WorkspaceInfo workspaceInfo = GetWorkspaceInfo(jobGuid);

            if (workspaceInfoCache != null)
            {
                workspaceInfoCache[jobGuid] = new WorkspaceInfoCacheEntry(workspaceInfo, now + cacheSeconds);
            }

            return workspaceInfo;
        }

        public static bool CanDeleteProjectFolder(WorkspaceInfo workspaceInfo)
        {
            if (workspaceInfo == null)
            {
                return false;
            }

            try
            {
                string workspacesRoot = Path.GetFullPath(CadetLitePathService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
                WorkspaceManager workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);
                return workspaceManager.CanDeleteWorkspaceProjectFolder(workspaceInfo);
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to evaluate project folder deletion safety for job {workspaceInfo.JobGuid}: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Returns true if the workspace folder is currently used by an active operation belonging
        /// to a different job than <paramref name="excludeJobGuid"/>.
        /// Falls back to ProfileGuid matching when an active operation has no WorkspacePath recorded
        /// (e.g. full dist.sh builds that do not store a workspace path in the registry).
        /// </summary>
        public static bool IsFolderInUseByActiveOperation(WorkspaceInfo workspaceInfo, string excludeJobGuid = null)
        {
            if (workspaceInfo == null)
            {
                return false;
            }

            try
            {
                string workspacesRoot = Path.GetFullPath(CadetLitePathService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
                WorkspaceManager workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);

                string targetPath = !string.IsNullOrWhiteSpace(workspaceInfo.WorkspacePath)
                    ? Path.GetFullPath(workspaceInfo.WorkspacePath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
                    : null;

                List<WorkspaceInfo> activeOps = workspaceManager.GetActiveOperations();
                foreach (WorkspaceInfo activeOp in activeOps)
                {
                    if (!string.IsNullOrWhiteSpace(excludeJobGuid) &&
                        string.Equals(activeOp.JobGuid, excludeJobGuid, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    // Path comparison: both sides have a path.
                    if (targetPath != null && !string.IsNullOrWhiteSpace(activeOp.WorkspacePath))
                    {
                        string activePath = Path.GetFullPath(
                            activeOp.WorkspacePath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                        if (string.Equals(targetPath, activePath, StringComparison.OrdinalIgnoreCase))
                        {
                            return true;
                        }
                        continue;
                    }

                    // Fallback: active op has no WorkspacePath (e.g. dist.sh builds).
                    // Match by ProfileGuid — same profile shares the same output location.
                    if (!string.IsNullOrWhiteSpace(workspaceInfo.ProfileGuid) &&
                        string.Equals(activeOp.ProfileGuid, workspaceInfo.ProfileGuid, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }

                return false;
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to check folder in-use state for job {workspaceInfo.JobGuid}: {ex.Message}");
                return false;
            }
        }

        public static WorkspaceInfo ResolveDeleteTarget(
            BuildJobDefinition job,
            Func<string, WorkspaceInfo> getWorkspaceInfo,
            Func<BuildJobDefinition, BuildProfile> getProfileForJob)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return null;
            }

            WorkspaceInfo workspaceInfo = getWorkspaceInfo?.Invoke(job.JobGuid);
            if (workspaceInfo != null && !string.IsNullOrWhiteSpace(workspaceInfo.WorkspacePath))
            {
                if (string.IsNullOrWhiteSpace(workspaceInfo.ProfileGuid))
                {
                    workspaceInfo.ProfileGuid = job.ProfileGuid;
                }

                return workspaceInfo;
            }

            string targetProjectPath = job.WorkspacePath;
            if (string.IsNullOrWhiteSpace(targetProjectPath))
            {
                BuildProfile profile = getProfileForJob?.Invoke(job);
                targetProjectPath = profile?.unity?.projectPath;
            }

            if (string.IsNullOrWhiteSpace(targetProjectPath))
            {
                return workspaceInfo;
            }

            return new WorkspaceInfo
            {
                JobGuid = job.JobGuid,
                ProfileGuid = !string.IsNullOrWhiteSpace(job.ProfileGuid) ? job.ProfileGuid : workspaceInfo?.ProfileGuid,
                WorkspacePath = targetProjectPath,
                LastBuildStatus = job.Status,
                CreatedAtUtc = job.CompletionTime ?? job.StartTime ?? DateTime.UtcNow
            };
        }

        public static List<BuildJobDefinition> GetCachedWorkspaceHistoryJobs(
            WorkspaceHistoryCacheState cacheState,
            double now,
            double refreshIntervalSeconds,
            Func<List<BuildJobDefinition>> loadWorkspaceHistoryJobs)
        {
            if (cacheState == null)
            {
                return new List<BuildJobDefinition>();
            }

            if (!cacheState.IsDirty && now < cacheState.NextRefreshAt)
            {
                return new List<BuildJobDefinition>(cacheState.CachedJobs);
            }

            cacheState.CachedJobs.Clear();
            cacheState.CachedJobs.AddRange(loadWorkspaceHistoryJobs?.Invoke() ?? new List<BuildJobDefinition>());
            cacheState.IsDirty = false;
            cacheState.NextRefreshAt = now + refreshIntervalSeconds;
            return new List<BuildJobDefinition>(cacheState.CachedJobs);
        }

        public static List<BuildJobDefinition> LoadWorkspaceHistoryJobs(
            Func<WorkspaceRegistry> loadRegistry,
            Func<WorkspaceInfo, BuildJobStatus> normalizeWorkspaceStatus,
            Func<WorkspaceInfo, string> getWorkspaceStatusDetail)
        {
            var jobs = new List<BuildJobDefinition>();

            try
            {
                WorkspaceRegistry registry = loadRegistry?.Invoke();
                if (registry?.Workspaces == null)
                {
                    return jobs;
                }

                for (int i = 0; i < registry.Workspaces.Count; i++)
                {
                    WorkspaceInfo workspace = registry.Workspaces[i];
                    if (workspace == null || string.IsNullOrWhiteSpace(workspace.JobGuid))
                    {
                        continue;
                    }

                    var job = new BuildJobDefinition
                    {
                        JobGuid = workspace.JobGuid,
                        ProfileGuid = workspace.ProfileGuid,
                        ProfileName = ResolveProfileName(workspace),
                        WorkspacePath = workspace.WorkspacePath,
                        Status = normalizeWorkspaceStatus != null
                            ? normalizeWorkspaceStatus(workspace)
                            : workspace.LastBuildStatus,
                        ProcessId = workspace.ActiveProcessId,
                        StartTime = workspace.ActiveProcessStartedAtUtc ?? workspace.CreatedAtUtc,
                        CompletionTime = workspace.CreatedAtUtc,
                        StatusDetail = getWorkspaceStatusDetail != null
                            ? getWorkspaceStatusDetail(workspace)
                            : workspace.LastOperationSummary
                    };

                    ApplyOperationFlags(workspace, job);

                    DateTime? completedAtUtc = workspace.LastUpdatedAtUtc;
                    if (completedAtUtc.HasValue)
                    {
                        job.CompletionTime = completedAtUtc.Value;
                    }

                    jobs.Add(job);
                }
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to load workspace history into queue window: {ex.Message}");
            }

            return jobs;
        }

        private static void ApplyOperationFlags(WorkspaceInfo workspace, BuildJobDefinition job)
        {
            if (workspace == null || job == null)
            {
                return;
            }

            string summary = !string.IsNullOrWhiteSpace(workspace.LastCompletedOperationsSummary)
                ? workspace.LastCompletedOperationsSummary
                : workspace.LastOperationSummary;

            summary = ExtractExecutedOperationsSummary(summary);

            if (string.IsNullOrWhiteSpace(summary))
            {
                return;
            }

            string normalized = summary.ToLowerInvariant();
            job.RunUnityBuild = normalized.Contains("unity build");
            job.RunNotarizeMac = normalized.Contains("notarize") || normalized.Contains("macos sign") || normalized.Contains("macos build");
            job.RunPublishSteam = normalized.Contains("steam");
            job.RunPublishEpic = normalized.Contains("epic");
        }

        public static string ExtractExecutedOperationsSummary(string summary)
        {
            if (string.IsNullOrWhiteSpace(summary))
            {
                return string.Empty;
            }

            string[] segments = summary.Split('|');
            string completed = string.Empty;
            string running = string.Empty;
            string fallback = string.Empty;

            for (int i = 0; i < segments.Length; i++)
            {
                string segment = (segments[i] ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(segment))
                {
                    continue;
                }

                if (segment.StartsWith("Skipped:", StringComparison.OrdinalIgnoreCase) ||
                    segment.StartsWith("Pending:", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (segment.StartsWith("Completed:", StringComparison.OrdinalIgnoreCase))
                {
                    completed = NormalizeExecutedSegment(segment, "Completed:");
                    continue;
                }

                if (segment.StartsWith("Running:", StringComparison.OrdinalIgnoreCase) ||
                    segment.StartsWith("Running ", StringComparison.OrdinalIgnoreCase) ||
                    segment.StartsWith("Starting:", StringComparison.OrdinalIgnoreCase) ||
                    segment.StartsWith("Starting ", StringComparison.OrdinalIgnoreCase) ||
                    segment.StartsWith("Executing:", StringComparison.OrdinalIgnoreCase) ||
                    segment.StartsWith("Executing ", StringComparison.OrdinalIgnoreCase))
                {
                    running = NormalizeExecutedSegment(segment);
                    continue;
                }

                fallback = NormalizeExecutedSegment(segment);
            }

            if (!string.IsNullOrWhiteSpace(completed))
            {
                return completed;
            }

            if (!string.IsNullOrWhiteSpace(running))
            {
                return running;
            }

            return fallback;
        }

        private static string NormalizeExecutedSegment(string segment, string explicitPrefix = null)
        {
            if (string.IsNullOrWhiteSpace(segment))
            {
                return string.Empty;
            }

            string normalized = segment.Trim();
            if (!string.IsNullOrWhiteSpace(explicitPrefix) &&
                normalized.StartsWith(explicitPrefix, StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized.Substring(explicitPrefix.Length).Trim();
            }
            else
            {
                string[] prefixes =
                {
                    "Running:",
                    "Running ",
                    "Starting:",
                    "Starting ",
                    "Executing:",
                    "Executing ",
                    "Completed:"
                };

                for (int i = 0; i < prefixes.Length; i++)
                {
                    if (normalized.StartsWith(prefixes[i], StringComparison.OrdinalIgnoreCase))
                    {
                        normalized = normalized.Substring(prefixes[i].Length).Trim();
                        break;
                    }
                }
            }

            return normalized.TrimEnd('.').Trim();
        }

        private static string ResolveProfileName(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return string.Empty;
            }

            if (!string.IsNullOrWhiteSpace(workspace.ProfileName))
            {
                return workspace.ProfileName.Trim();
            }

            if (!string.IsNullOrWhiteSpace(workspace.ProfileGuid))
            {
                string assetPath = AssetDatabase.GUIDToAssetPath(workspace.ProfileGuid);
                if (!string.IsNullOrWhiteSpace(assetPath))
                {
                    BuildProfileAsset asset = AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(assetPath);
                    if (!string.IsNullOrWhiteSpace(asset?.Profile?.profileName))
                    {
                        return asset.Profile.profileName.Trim();
                    }
                }
            }

            if (!string.IsNullOrWhiteSpace(workspace.ProfileJsonPath) && File.Exists(workspace.ProfileJsonPath))
            {
                try
                {
                    string json = File.ReadAllText(workspace.ProfileJsonPath);
                    if (!string.IsNullOrWhiteSpace(json))
                    {
                        BuildProfile profile = JsonUtility.FromJson<BuildProfile>(json);
                        if (!string.IsNullOrWhiteSpace(profile?.profileName))
                        {
                            return profile.profileName.Trim();
                        }
                    }
                }
                catch
                {
                }

                string fileName = Path.GetFileNameWithoutExtension(workspace.ProfileJsonPath)?.Trim();
                if (!LooksLikeGuid(fileName))
                {
                    return fileName ?? string.Empty;
                }
            }

            return string.Empty;
        }

        private static bool LooksLikeGuid(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return false;
            }

            return Guid.TryParse(value, out _) ||
                   (value.Length == 32 && System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-fA-F0-9]{32}$"));
        }
    }
}
