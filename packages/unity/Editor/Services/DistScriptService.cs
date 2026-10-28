#if !CADET_LITE
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;
using UnityEngine;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Executes the dist.sh script for Full (non-Lite) CADET builds and publishing.
    /// </summary>
    public static class DistScriptService
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";

        /// <summary>
        /// Starts dist.sh with the supplied options in detached mode.
        /// </summary>
        public static BuildResult Execute(
            string projectPath,
            string profileJsonPath,
            bool buildOnly,
            bool publishOnly,
            bool notarizeOnly = false,
            Action<string> onOutputLine = null,
            Action<BuildSyncStatus, string> onStatusChange = null,
            Action<float> onSyncProgress = null,
            BuildJobDefinition activeJob = null,
            ActiveBuildProcessTracker processTracker = null)
        {
            return Execute(
                projectPath,
                profileJsonPath,
                string.Empty,
                buildOnly,
                publishOnly,
                notarizeOnly,
                onOutputLine,
                onStatusChange,
                onSyncProgress,
                activeJob,
                processTracker);
        }

        public static BuildResult Execute(
            string projectPath,
            string profileJsonPath,
            string resolvedProfileGuid,
            bool buildOnly,
            bool publishOnly,
            bool notarizeOnly = false,
            Action<string> onOutputLine = null,
            Action<BuildSyncStatus, string> onStatusChange = null,
            Action<float> onSyncProgress = null,
            BuildJobDefinition activeJob = null,
            ActiveBuildProcessTracker processTracker = null)
        {
            StringBuilder output = new StringBuilder();
            Stopwatch stopwatch = Stopwatch.StartNew();
            long previousElapsedMs = 0;

            void LogTiming(string message)
            {
                long elapsedMs = stopwatch.ElapsedMilliseconds;
                long deltaMs = elapsedMs - previousElapsedMs;
                previousElapsedMs = elapsedMs;
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Timing DistScript job='{activeJob?.JobGuid ?? string.Empty}' profileGuid='{resolvedProfileGuid ?? string.Empty}' " +
                    $"{message} +{deltaMs}ms total={elapsedMs}ms.");
            }

            try
            {
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} DistScript.Execute start job='{activeJob?.JobGuid ?? string.Empty}' projectPath='{projectPath}' profileJsonPath='{profileJsonPath}' " +
                    $"buildOnly={buildOnly} publishOnly={publishOnly} notarizeOnly={notarizeOnly}.");
                LogTiming("entered DistScript.Execute");

                if (string.IsNullOrWhiteSpace(projectPath) || !Directory.Exists(projectPath))
                {
                    string invalidProjectPath = $"Invalid source project path: {projectPath}";
                    output.AppendLine($"[ERROR] {invalidProjectPath}");
                    return new BuildResult(output.ToString(), false, -1, invalidProjectPath);
                }

                if (string.IsNullOrWhiteSpace(profileJsonPath) || !File.Exists(profileJsonPath))
                {
                    string invalidProfileJsonPath = $"Profile JSON not found: {profileJsonPath}";
                    output.AppendLine($"[ERROR] {invalidProfileJsonPath}");
                    return new BuildResult(output.ToString(), false, -1, invalidProfileJsonPath);
                }

                string distScript = Path.Combine(projectPath, "Assets", "Covyne", "Cadet", "CLI", "dist.sh");

                if (!File.Exists(distScript))
                {
                    string errorMsg = "dist.sh not found!";
                    output.AppendLine($"[ERROR] {errorMsg}");
                    output.AppendLine($"Expected at: {distScript}");
                    output.AppendLine(CadetLocalization.GetString("Window.Cadet.Messages.DistScriptMissing"));
                    return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                string profileJson = File.ReadAllText(profileJsonPath);
                BuildProfile profile = JsonUtility.FromJson<BuildProfile>(profileJson);
                LogTiming("Profile JSON loaded and deserialized");
                string operationJobGuid = !string.IsNullOrWhiteSpace(activeJob?.JobGuid)
                    ? activeJob.JobGuid
                    : $"local-{Guid.NewGuid():N}";
                // Do not call UnityBuildService.ResolveProfileGuid here: AssetDatabase APIs
                // (FindAssets, GUIDToAssetPath, LoadAssetAtPath) are main-thread-only and this
                // method runs inside Task.Run. For direct-execute paths (activeJob == null),
                // resolvedProfileGuid is left empty; workspace tracking still functions via
                // operationJobGuid.
                resolvedProfileGuid = !string.IsNullOrWhiteSpace(resolvedProfileGuid)
                    ? resolvedProfileGuid.Trim()
                    : (activeJob?.ProfileGuid ?? string.Empty);

                string targetProjectPath = profile?.unity?.projectPath;
                string normalizedSourcePath = Path.GetFullPath(projectPath)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

                if (!string.IsNullOrWhiteSpace(targetProjectPath))
                {
                    targetProjectPath = Path.GetFullPath(targetProjectPath)
                        .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                }

                bool hasTargetProject = !string.IsNullOrWhiteSpace(targetProjectPath);
                bool useGitSync = profile?.useGit ?? false;
                bool requiresDirectorySync = hasTargetProject &&
                    !string.Equals(normalizedSourcePath, targetProjectPath, StringComparison.OrdinalIgnoreCase);
                bool operationIncludesBuild = buildOnly || (!publishOnly && !notarizeOnly);
                bool requiresSync = operationIncludesBuild && (useGitSync || requiresDirectorySync);

                // Persist operation identity for both queued and direct execute paths.
                // Without this, direct detached dist launches can appear to complete immediately
                // because no durable active workspace evidence exists for recovery/liveness.
                string workspaceRootPath = Path.GetFullPath(CadetConfigService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(workspaceRootPath);
                WorkspaceInfo workspaceRecord = workspaceManager.UpsertWorkspaceRecord(
                    operationJobGuid,
                    resolvedProfileGuid,
                    profileJsonPath,
                    targetProjectPath ?? string.Empty,
                    BuildJobStatus.Building,
                    profile?.profileName);
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} DistScript workspace upsert job='{operationJobGuid}' workspacePath='{workspaceRecord?.WorkspacePath ?? string.Empty}' " +
                    $"status='{workspaceRecord?.LastBuildStatus}' isActive={workspaceRecord?.IsOperationActive ?? false} pid={workspaceRecord?.ActiveProcessId ?? 0}.");
                LogTiming($"Workspace record upserted useGit={useGitSync} requiresDirectorySync={requiresDirectorySync} requiresSync={requiresSync}");

                if (requiresSync)
                {
                    var syncRequest = new BuildSyncRequest
                    {
                        SourcePath = normalizedSourcePath,
                        TargetPath = targetProjectPath ?? string.Empty,
                        Profile = profile ?? new BuildProfile(),
                        UseGitSync = useGitSync,
                        ActiveJob = activeJob,
                        ProfileGuid = resolvedProfileGuid,
                        OnStatusChange = (code, text) => onStatusChange?.Invoke(code, text),
                        OnProgress = onSyncProgress,
                        OnOutputLine = onOutputLine
                    };

                    BuildSyncOutcome syncOutcome = BuildSyncOrchestratorService.Execute(syncRequest);
                    if (!syncOutcome.Success)
                    {
                        output.AppendLine($"[ERROR] {syncOutcome.ErrorMessage}");
                        CadetFilteredLogger.Error(
                            $"{DiagnosticsPrefix} DistScript sync failed job='{operationJobGuid}' targetProjectPath='{targetProjectPath ?? string.Empty}' error='{syncOutcome.ErrorMessage}'.");
                        return new BuildResult(output.ToString(), false, -1, syncOutcome.ErrorMessage);
                    }

                    CadetFilteredLogger.Debug(
                        $"{DiagnosticsPrefix} DistScript sync complete job='{operationJobGuid}' targetProjectPath='{targetProjectPath ?? string.Empty}' useGit={useGitSync} requiresDirectorySync={requiresDirectorySync}.");
                    LogTiming("Pre-launch sync orchestration completed");
                }
                else
                {
                    LogTiming("Pre-launch sync orchestration skipped");
                }

                // Copy profile JSON to stable profiles directory so the detached process
                // can still read it after Unity cleans up the temp file.
                string stableProfileJsonPath = profileJsonPath;
                try
                {
                    string profilesRoot = Path.GetFullPath(CadetConfigService.GetProfilesRoot());
                    Directory.CreateDirectory(profilesRoot);
                    string stableFileName = Path.GetFileName(profileJsonPath);
                    File.Copy(profileJsonPath, Path.Combine(profilesRoot, stableFileName), overwrite: true);
                    stableProfileJsonPath = Path.Combine(profilesRoot, stableFileName);
                }
                catch (Exception ex)
                {
                    output.AppendLine($"[WARN] Could not copy profile JSON to profiles root: {ex.Message}");
                }
                LogTiming("Stable profile JSON prepared");

                string unixProfileJsonPath = BuildPathResolver.ToUnixPath(stableProfileJsonPath);
                string vdfDirectory = Path.Combine(projectPath, "Assets", "Config", "Covyne", "Cadet", "VDF");
                string unixVdfDirectory = BuildPathResolver.ToUnixPath(vdfDirectory);
                string logsDir = !string.IsNullOrWhiteSpace(targetProjectPath)
                    ? Path.Combine(targetProjectPath, "Logs")
                    : Path.Combine(projectPath, "Logs");
                string detachedLogPath = Path.Combine(logsDir, "dist.log");
                string launchToken = null;
                string detachedStatusManifestPath = null;

                string buildOnlyArg = buildOnly ? " --build-only" : "";
                string publishOnlyArg = publishOnly ? " --publish-only" : "";
                string notarizeOnlyArg = notarizeOnly ? " --notarize-only" : "";
                string arguments = $"--mode=plugin --profile-json \"{unixProfileJsonPath}\" --generated-vdfs-directory \"{unixVdfDirectory}\"{buildOnlyArg}{publishOnlyArg}{notarizeOnlyArg}";
                launchToken = Guid.NewGuid().ToString("N");
                string launchTimestamp = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff") + "Z";
                detachedStatusManifestPath = BuildDetachedStatusManifestPath(logsDir, launchTimestamp, launchToken);
                string unixStatusFilePath = BuildPathResolver.ToUnixPath(detachedStatusManifestPath);
                arguments += $" --job-guid \"{operationJobGuid}\" --launch-token \"{launchToken}\" --status-file \"{unixStatusFilePath}\"";
                LogTiming("Detached launch arguments prepared");

                string statusDetail = operationIncludesBuild
                    ? "Executing Unity build process."
                    : "Executing dist script process.";
                onStatusChange?.Invoke(BuildSyncStatus.BUILD_EXECUTING, statusDetail);
                LogTiming("BUILD_EXECUTING status published");

                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} DistScript launching detached job='{operationJobGuid}' distScript='{distScript}' logsDir='{logsDir}' detachedLog='{detachedLogPath}' " +
                    $"manifest='{detachedStatusManifestPath}' token='{launchToken}' args='{arguments}'.");
                LogTiming("About to call ProcessExecutor.TryStartDetachedScript");

                if (!ProcessExecutor.TryStartDetachedScript(
                    scriptPath: distScript,
                    arguments: arguments,
                    workingDirectory: projectPath,
                    out int detachedPid,
                    out DateTime detachedStartUtc,
                    out string launchError,
                    logDirectory: logsDir))
                {
                    string errorMessage = string.IsNullOrWhiteSpace(launchError)
                        ? "Failed to start detached dist.sh process."
                        : launchError;
                    LogTiming($"ProcessExecutor.TryStartDetachedScript failed error='{errorMessage}'");

                    if (!string.IsNullOrWhiteSpace(activeJob?.JobGuid))
                    {
                        WorkspaceOperationStateService.MarkTerminal(activeJob.JobGuid, BuildJobStatus.Failed, errorMessage);
                    }
                    else
                    {
                        WorkspaceOperationStateService.MarkTerminal(operationJobGuid, BuildJobStatus.Failed, errorMessage);
                    }

                    WorkspaceInfo failedWorkspace = WorkspaceOperationStateService.GetWorkspace(operationJobGuid);
                    CadetFilteredLogger.Error(
                        $"{DiagnosticsPrefix} DistScript detached launch failed job='{operationJobGuid}' error='{errorMessage}' " +
                        $"workspaceActive={failedWorkspace?.IsOperationActive ?? false} pid={failedWorkspace?.ActiveProcessId ?? 0} " +
                        $"status='{failedWorkspace?.LastBuildStatus.ToString() ?? "<missing>"}' detail='{failedWorkspace?.ActiveStatusDetail ?? string.Empty}'.");

                    output.AppendLine($"[ERROR] {errorMessage}");
                    return new BuildResult(output.ToString(), false, -1, errorMessage);
                }

                LogTiming($"ProcessExecutor.TryStartDetachedScript returned pid={detachedPid}");
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} DistScript detached launch returned job='{operationJobGuid}' detachedPid={detachedPid} startUtc={detachedStartUtc:O}.");

                output.AppendLine($"[LOG] Detached dist.sh process launched with PID {detachedPid}.");
                output.AppendLine("[LOG] Operation will continue independently of the editor domain lifecycle.");

                if (!string.IsNullOrWhiteSpace(activeJob?.JobGuid))
                {
                    activeJob.ProcessId = detachedPid;
                    activeJob.Status = BuildJobStatus.Building;
                    activeJob.StatusDetail = "Detached dist operation running. Use Build Queue refresh to reconcile status.";
                }

                string runtimeStatusDetail = !string.IsNullOrWhiteSpace(activeJob?.StatusDetail)
                    ? activeJob.StatusDetail
                    : "Detached dist operation running. Use Build Queue refresh to reconcile status.";

                WorkspaceOperationStateService.MarkOperationActive(
                    operationJobGuid,
                    detachedPid,
                    detachedStartUtc,
                    runtimeStatusDetail,
                    logPath: detachedLogPath,
                    manifestPath: detachedStatusManifestPath,
                    launchToken: launchToken);

                WorkspaceInfo activeWorkspace = WorkspaceOperationStateService.GetWorkspace(operationJobGuid);
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} DistScript marked workspace active job='{operationJobGuid}' workspaceActive={activeWorkspace?.IsOperationActive ?? false} " +
                    $"pid={activeWorkspace?.ActiveProcessId ?? 0} startUtc={activeWorkspace?.ActiveProcessStartedAtUtc?.ToString("O") ?? "<null>"} " +
                    $"manifest='{activeWorkspace?.ActiveStatusManifestPath ?? string.Empty}' token='{activeWorkspace?.ActiveStatusLaunchToken ?? string.Empty}' " +
                    $"detail='{activeWorkspace?.ActiveStatusDetail ?? string.Empty}'.");

                var detachedResult = new BuildResult(output.ToString(), true, 0, null)
                {
                    DetachedOperationActive = true
                };

                LogTiming("DistScript.Execute returning detached result");

                return detachedResult;
            }
            catch (Exception ex)
            {
                CadetFilteredLogger.Error($"{DiagnosticsPrefix} DistScript.Execute exception job='{activeJob?.JobGuid ?? string.Empty}': {ex}");
                output.AppendLine($"[ERROR] Failed to execute dist.sh: {ex.Message}");
                output.AppendLine(ex.StackTrace);
                return new BuildResult(output.ToString(), false, -1, ex.Message);
            }
        }

        internal static string BuildDetachedStatusManifestPath(string logsDirectory, string launchTimestamp, string launchToken)
        {
            if (string.IsNullOrWhiteSpace(logsDirectory) || string.IsNullOrWhiteSpace(launchTimestamp) || string.IsNullOrWhiteSpace(launchToken))
            {
                return null;
            }

            return Path.Combine(logsDirectory, $"{launchTimestamp}-cadet.status.json");
        }
    }
}
#endif
