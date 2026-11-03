using System;
using System.IO;
using System.Text;
using System.Threading;
using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Executes Unity builds via Unity CLI in batch mode.
    /// Available in both CADET Lite and CADET Full builds.
    /// Handles workspace syncing, process launch, and build status tracking.
    /// </summary>
    public static class UnityBuildService
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";
        /// <summary>
        /// Resolves the profile GUID either from the active job or by looking up the profile
        /// by name in the asset database.
        /// </summary>
        public static string ResolveProfileGuid(BuildProfile profile, BuildJobDefinition activeJob, string resolvedProfileGuid = null)
        {
            string profileGuid = !string.IsNullOrWhiteSpace(resolvedProfileGuid)
                ? resolvedProfileGuid.Trim()
                : activeJob?.ProfileGuid;

            if (string.IsNullOrWhiteSpace(profileGuid) && !string.IsNullOrWhiteSpace(profile?.profileName))
            {
                string[] guids = AssetDatabase.FindAssets($"t:BuildProfileAsset {profile.profileName}");
                foreach (string guid in guids)
                {
                    string assetPath = AssetDatabase.GUIDToAssetPath(guid);
                    BuildProfileAsset candidate = AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(assetPath);
                    if (candidate != null && candidate.Profile?.profileName == profile.profileName)
                    {
                        profileGuid = guid;
                        break;
                    }
                }
            }

            return profileGuid;
        }

        /// <summary>
        /// Creates a WorkspaceManager rooted at the given path.
        /// </summary>
        public static WorkspaceManager CreateWorkspaceManager(string workspaceRootPath)
        {
            string registryPath = Path.Combine(workspaceRootPath, "workspaces.json");
            return new WorkspaceManager(workspaceRootPath, registryPath);
        }

        /// <summary>
        /// Resolves the source project path for syncing. Uses workspace-configured source if
        /// available; falls back to the currently open Unity project.
        /// </summary>
        public static string ResolveSourceProjectPath(BuildProfile profile, BuildJobDefinition activeJob, WorkspaceManager workspaceManager, string resolvedProfileGuid = null)
        {
            string defaultSourcePath = Path.GetDirectoryName(Path.GetFullPath(Application.dataPath));
            string profileGuid = ResolveProfileGuid(profile, activeJob, resolvedProfileGuid);

            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return defaultSourcePath;
            }

            ProfileWorkspaceConfig config = workspaceManager.GetProfileConfig(profileGuid);
            string configuredSourcePath = config?.SourceProjectPath;
            if (string.IsNullOrWhiteSpace(configuredSourcePath))
            {
                return defaultSourcePath;
            }

            return Path.GetFullPath(configuredSourcePath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        /// <summary>
        /// Checks whether a build or sync is already in progress for the given profile GUID.
        /// </summary>
        public static bool IsBuildInProgressForProfile(string profileGuid)
        {
            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return false;
            }

            string normalizedProfileGuid = profileGuid.Trim();

            string workspaceRootPath = Path.GetFullPath(CadetConfigService.GetWorkspacesRoot())
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            WorkspaceManager workspaceManager = CreateWorkspaceManager(workspaceRootPath);
            WorkspaceRegistry registry = workspaceManager.LoadRegistry();

            DateTime nowUtc = DateTime.UtcNow;

            for (int i = 0; i < registry.Workspaces.Count; i++)
            {
                WorkspaceInfo workspace = registry.Workspaces[i];
                if (workspace == null ||
                    !string.Equals(workspace.ProfileGuid?.Trim(), normalizedProfileGuid, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Persists a profile snapshot to the profiles root directory so it can be passed to
        /// an external Unity process that does not have asset database access.
        /// </summary>
        public static string PersistProfileSnapshot(BuildProfile profile, BuildJobDefinition activeJob, string resolvedProfileGuid = null)
        {
            string profilesRoot = Path.GetFullPath(CadetConfigService.GetProfilesRoot())
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            Directory.CreateDirectory(profilesRoot);

            string profileGuid = ResolveProfileGuid(profile, activeJob, resolvedProfileGuid);
            string profileFileName = string.IsNullOrWhiteSpace(profileGuid)
                ? $"{SanitizeFileName(profile?.profileName ?? "profile")}.json"
                : $"{profileGuid}.json";
            string profilePath = Path.Combine(profilesRoot, profileFileName);

            string json = ProfileJsonService.SerializeToJson(profile);
            File.WriteAllText(profilePath, json);

            return profilePath.Replace('\\', '/');
        }

        /// <summary>
        /// Sanitizes a string for use as a file name by replacing invalid characters with underscores.
        /// </summary>
        public static string SanitizeFileName(string fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName))
            {
                return "profile";
            }

            char[] invalidChars = Path.GetInvalidFileNameChars();
            string sanitized = fileName;
            foreach (char c in invalidChars)
            {
                sanitized = sanitized.Replace(c, '_');
            }

            return sanitized;
        }

        /// <summary>
        /// Executes a Unity build via Unity CLI in batch mode.
        /// Automatically syncs source project to target path (creating target directory if needed),
        /// reports progress via activeJob.StatusDetail, then launches Unity with -batchmode.
        /// Note: This method runs on a background thread, so all UI updates must be marshalled via EditorApplication.delayCall.
        /// </summary>
        public static BuildResult Execute(
            BuildProfile profile,
            BuildJobDefinition activeJob = null,
            string resolvedProfileGuid = null,
            string profileJsonPath = null,
            Func<bool> isCancellationRequested = null,
            Action<BuildSyncStatus, string> onStatusChange = null,
            Action<float> onSyncProgress = null,
            Action<string, CadetConsoleMessageType> liveOutput = null,
            ActiveBuildProcessTracker processTracker = null,
            Action repaint = null)
        {
            StringBuilder output = new StringBuilder();
            WorkspaceManager workspaceManager = null;
            string jobGuid = activeJob?.JobGuid ?? $"local-{Guid.NewGuid():N}";

            try
            {
                if (string.IsNullOrEmpty(profile.unity.editorPath))
                {
                    string errorMsg = "Unity editor path is not configured";
                    output.AppendLine($"[ERROR] {errorMsg}");
                    return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                string resolvedUnityEditorPath = ResolveUnityEditorExecutablePath(profile.unity.editorPath);
                if (string.IsNullOrWhiteSpace(resolvedUnityEditorPath) || !File.Exists(resolvedUnityEditorPath))
                {
                    string errorMsg = $"Unity editor not found at: {profile.unity.editorPath}";
                    output.AppendLine($"[ERROR] {errorMsg}");
                    return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                if (string.IsNullOrEmpty(profile.unity.projectPath))
                {
                    string errorMsg = "Unity project path is not configured";
                    output.AppendLine($"[ERROR] {errorMsg}");
                    return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                if (string.IsNullOrEmpty(profile.unity.buildOutputPath))
                {
                    string errorMsg = "Build output path is not configured";
                    output.AppendLine($"[ERROR] {errorMsg}");
                    return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                if (string.IsNullOrEmpty(profile.unity.projectName))
                {
                    string errorMsg = "Project name is not configured";
                    output.AppendLine($"[ERROR] {errorMsg}");
                    return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                string workspaceRootPath = Path.GetFullPath(CadetConfigService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                workspaceManager = CreateWorkspaceManager(workspaceRootPath);

                string sourceProjectPath = ResolveSourceProjectPath(profile, activeJob, workspaceManager, resolvedProfileGuid);
                string targetProjectPath = Path.GetFullPath(profile.unity.projectPath)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string projectName = profile.unity.projectName;
                string profileGuid = ResolveProfileGuid(profile, activeJob, resolvedProfileGuid) ?? string.Empty;
                workspaceManager.UpsertWorkspaceRecord(jobGuid, profileGuid, profileJsonPath ?? string.Empty, targetProjectPath, BuildJobStatus.Syncing, profile?.profileName);

                liveOutput?.Invoke("Syncing workspace files to target project...", CadetConsoleMessageType.Progress);

                var syncRequest = new BuildSyncRequest
                {
                    SourcePath = sourceProjectPath,
                    TargetPath = targetProjectPath,
                    Profile = profile,
                    UseGitSync = profile.useGit,
                    ActiveJob = activeJob,
                    ProfileGuid = profileGuid,
                    IsCancellationRequested = isCancellationRequested,
                    OnStatusChange = onStatusChange,
                    OnProgress = onSyncProgress,
                    OnOutputLine = line => liveOutput?.Invoke(line, CadetConsoleMessageType.Progress)
                };

                BuildSyncOutcome syncOutcome = BuildSyncOrchestratorService.Execute(syncRequest);
                if (!syncOutcome.Success)
                {
                    if (syncOutcome.Cancelled)
                    {
                        WorkspaceOperationStateService.MarkTerminal(jobGuid, BuildJobStatus.Cancelled, syncOutcome.ErrorMessage);
                    }
                    else
                    {
                        WorkspaceOperationStateService.MarkTerminal(jobGuid, BuildJobStatus.Failed, syncOutcome.ErrorMessage);
                    }
                    string failurePrefix = syncOutcome.Cancelled ? "[WARN]" : "[ERROR]";
                    output.AppendLine($"{failurePrefix} {syncOutcome.ErrorMessage}");
                    return new BuildResult(output.ToString(), false, -1, syncOutcome.ErrorMessage);
                }

                workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Building);

                string workspaceProjectPath = targetProjectPath;
                string resolvedBuildOutputPath = Path.GetFullPath(profile.unity.buildOutputPath)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string buildArtifactsRoot = Path.GetFileName(resolvedBuildOutputPath)
                        .Equals("Bin", StringComparison.OrdinalIgnoreCase)
                    ? resolvedBuildOutputPath
                    : Path.Combine(resolvedBuildOutputPath, "Bin");

                string buildTarget;
                string outputPath;
                string logFileName;

                switch (profile.os.ToLower())
                {
                    case "windows":
                        buildTarget = "Win64";
                        outputPath = Path.Combine(buildArtifactsRoot, "windows", $"{projectName}.exe");
                        logFileName = "unity_build_windows.log";
                        break;
                    case "mac":
                    case "macos":
                        buildTarget = "OSXUniversal";
                        outputPath = Path.Combine(buildArtifactsRoot, "macos", $"{projectName}.app");
                        logFileName = "unity_build_macos.log";
                        break;
                    default:
                        string errorMsg = $"Unsupported OS for Unity build: {profile.os}. Supported values: windows, macos";
                        output.AppendLine($"[ERROR] {errorMsg}");
                        return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                string outputDirectory = Path.GetDirectoryName(outputPath);
                if (!Directory.Exists(outputDirectory))
                {
                    Directory.CreateDirectory(outputDirectory);
                }

                string logDirectory = Path.Combine(workspaceProjectPath, "Logs");
                if (!Directory.Exists(logDirectory))
                {
                    Directory.CreateDirectory(logDirectory);
                }
                string logPath = Path.Combine(logDirectory, logFileName);

                // Ensure log file exists as soon as we reach the build phase so
                // "Open Unity Build Log" can open it immediately.
                try
                {
                    if (!File.Exists(logPath))
                    {
                        File.WriteAllText(logPath, string.Empty);
                    }
                }
                catch { }

                if (activeJob != null)
                {
                    const string buildExecutingStatus = "Executing Unity build process.";
                    activeJob.StatusDetail = buildExecutingStatus;
                    BuildStatusEventBus.PublishStatusChange(activeJob.JobGuid, buildExecutingStatus);
                }
                onStatusChange?.Invoke(BuildSyncStatus.BUILD_EXECUTING, "Executing Unity build process.");
                liveOutput?.Invoke("Executing Unity build process...", CadetConsoleMessageType.Progress);

                // Give UI-delivered log callbacks a brief window to flush before process launch.
                Thread.Sleep(150);

                string arguments = $"-quit -batchmode -nographics -silent-crashes " +
                                   $"-projectPath \"{workspaceProjectPath}\" " +
                                   $"-buildTarget {buildTarget} " +
                                   $"-logFile \"{logPath}\"";

                if (buildTarget == "Win64")
                {
                    arguments += $" -buildWindows64Player \"{outputPath}\"";
                }
                else if (buildTarget == "OSXUniversal")
                {
                    arguments += $" -buildOSXUniversalPlayer \"{outputPath}\"";
                }

                string fullCommand = $"\"{resolvedUnityEditorPath}\" {arguments}";

                output.AppendLine($"[LOG] Executing Unity build:");
                output.AppendLine($"[LOG]   Editor (configured): {profile.unity.editorPath}");
                output.AppendLine($"[LOG]   Editor (resolved):   {resolvedUnityEditorPath}");
                output.AppendLine($"[LOG]   Source Project: {sourceProjectPath}");
                output.AppendLine($"[LOG]   Target Project: {workspaceProjectPath}");
                output.AppendLine($"[LOG]   Target: {buildTarget}");
                output.AppendLine($"[LOG]   Output: {outputPath}");
                output.AppendLine($"[LOG]   Log: {logPath}");
                output.AppendLine($"[LOG]   Build Output Path (profile):    {profile.unity.buildOutputPath}");
                output.AppendLine($"[LOG]   Build Output Path (resolved):   {resolvedBuildOutputPath}");
                output.AppendLine($"[LOG]   Build Artifacts Root:           {buildArtifactsRoot}");
                output.AppendLine($"[LOG]   Log Directory:                  {logDirectory}");
                output.AppendLine($"[LOG]   Output Directory:               {outputDirectory}");
                output.AppendLine($"[LOG]   Full Command: {fullCommand}");

                System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = resolvedUnityEditorPath,
                    Arguments = arguments,
                    UseShellExecute = false,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false,
                    CreateNoWindow = true
                };

                string processStartDiagnostics = BuildUnityProcessStartDiagnostics(psi, outputPath, logPath);
                output.AppendLine("[LOG] Unity process start info:");
                output.AppendLine(processStartDiagnostics);

                bool enableDetachedManifestTracking =
                    Application.platform == RuntimePlatform.WindowsEditor &&
                    activeJob != null &&
                    !string.IsNullOrWhiteSpace(activeJob.JobGuid);

                string detachedLaunchToken = null;
                string detachedStatusManifestPath = null;
                if (enableDetachedManifestTracking)
                {
                    detachedLaunchToken = Guid.NewGuid().ToString("N");
                    detachedStatusManifestPath = BuildDetachedStatusManifestPath(logDirectory, detachedLaunchToken);
                    output.AppendLine($"[LOG] Detached status manifest: {detachedStatusManifestPath}");
                }

                int detachedPid;
                DateTime detachedStartUtc;
                if (!ProcessLaunchService.TryStartDetached(
                    resolvedUnityEditorPath,
                    arguments,
                    workspaceProjectPath,
                    detachedStatusManifestPath,
                    activeJob?.JobGuid,
                    detachedLaunchToken,
                    out detachedPid,
                    out detachedStartUtc,
                    out string launchError))
                {
                    string errorMsg = string.IsNullOrWhiteSpace(launchError)
                        ? "Failed to start detached Unity process."
                        : launchError;
                    output.AppendLine($"[ERROR] {errorMsg}");
                    WorkspaceOperationStateService.MarkTerminal(jobGuid, BuildJobStatus.Failed, errorMsg);
                    return new BuildResult(output.ToString(), false, -1, errorMsg);
                }

                liveOutput?.Invoke($"Unity process started detached (PID: {detachedPid}).", CadetConsoleMessageType.Log);

                if (activeJob != null)
                {
                    activeJob.ProcessId = detachedPid;
                    activeJob.Status = BuildJobStatus.Building;
                    activeJob.StatusDetail = "Unity Build";
                }

                workspaceManager?.UpdateOperationState(
                    jobGuid,
                    isActive: true,
                    processId: detachedPid,
                    processStartUtc: detachedStartUtc,
                    statusDetail: activeJob?.StatusDetail,
                    logPath: logPath,
                    cancelRequested: false,
                    manifestPath: detachedStatusManifestPath,
                    launchToken: detachedLaunchToken);

                output.AppendLine($"[LOG] Detached Unity process launched with PID {detachedPid}.");
                output.AppendLine("[LOG] Build will continue independently of the editor domain lifecycle.");

                var detachedResult = new BuildResult(output.ToString(), true, 0, null)
                {
                    DetachedOperationActive = true
                };

                return detachedResult;
            }
            catch (Exception ex)
            {
                WorkspaceOperationStateService.MarkTerminal(
                    jobGuid,
                    BuildJobStatus.Failed,
                    BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonInternalException));
                output.AppendLine($"[ERROR] Unity build execution failed: {ex.Message}");
                output.AppendLine(ex.StackTrace);
                return new BuildResult(output.ToString(), false, -1, ex.Message);
            }
        }

        private static string ResolveUnityEditorExecutablePath(string configuredPath)
        {
            if (string.IsNullOrWhiteSpace(configuredPath))
            {
                return string.Empty;
            }

            string normalizedPath = configuredPath.Trim().Trim('"');
            string trimmedDirectoryPath = normalizedPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            if (File.Exists(trimmedDirectoryPath))
            {
                return trimmedDirectoryPath;
            }

            if (File.Exists(normalizedPath))
            {
                return normalizedPath;
            }

            string existingDirectoryPath = Directory.Exists(trimmedDirectoryPath)
                ? trimmedDirectoryPath
                : normalizedPath;

            if (!Directory.Exists(existingDirectoryPath))
            {
                return normalizedPath;
            }

            // On macOS, a Unity editor selection commonly points at Unity.app (a directory).
            // Resolve it to the executable expected by ProcessStartInfo.
            if (existingDirectoryPath.EndsWith(".app", StringComparison.OrdinalIgnoreCase))
            {
                string appExecutablePath = Path.Combine(existingDirectoryPath, "Contents", "MacOS", "Unity");
                if (File.Exists(appExecutablePath))
                {
                    return appExecutablePath;
                }
            }

            return existingDirectoryPath;
        }

        private static string BuildUnityProcessStartDiagnostics(System.Diagnostics.ProcessStartInfo psi, string outputPath, string logPath)
        {
            string parsedLogFile = ExtractArgumentValue(psi.Arguments, "-logFile");
            string parsedProjectPath = ExtractArgumentValue(psi.Arguments, "-projectPath");
            string parsedWindowsPlayer = ExtractArgumentValue(psi.Arguments, "-buildWindows64Player");
            string parsedMacPlayer = ExtractArgumentValue(psi.Arguments, "-buildOSXUniversalPlayer");
            string parsedBuildOutput = !string.IsNullOrEmpty(parsedWindowsPlayer) ? parsedWindowsPlayer : parsedMacPlayer;
            string logDirectory = Path.GetDirectoryName(logPath);
            string outputDirectory = Path.GetDirectoryName(outputPath);

            StringBuilder diagnostics = new StringBuilder();
            diagnostics.AppendLine($"[LOG]   FileName: {psi.FileName}");
            diagnostics.AppendLine($"[LOG]   Arguments: {psi.Arguments}");
            diagnostics.AppendLine($"[LOG]   Working Directory: {(string.IsNullOrWhiteSpace(psi.WorkingDirectory) ? "<not set>" : psi.WorkingDirectory)}");
            diagnostics.AppendLine($"[LOG]   Current Directory: {Environment.CurrentDirectory}");
            diagnostics.AppendLine($"[LOG]   UseShellExecute: {psi.UseShellExecute}");
            diagnostics.AppendLine($"[LOG]   RedirectStdOut: {psi.RedirectStandardOutput}");
            diagnostics.AppendLine($"[LOG]   RedirectStdErr: {psi.RedirectStandardError}");
            diagnostics.AppendLine($"[LOG]   CreateNoWindow: {psi.CreateNoWindow}");
            diagnostics.AppendLine($"[LOG]   Parsed -projectPath: {parsedProjectPath}");
            diagnostics.AppendLine($"[LOG]   Parsed -logFile: {parsedLogFile}");
            diagnostics.AppendLine($"[LOG]   Parsed Build Output: {parsedBuildOutput}");
            diagnostics.AppendLine($"[LOG]   Expected Output Path: {outputPath}");
            diagnostics.AppendLine($"[LOG]   Expected Log Path: {logPath}");
            diagnostics.AppendLine($"[LOG]   Output Directory Exists: {Directory.Exists(outputDirectory)} ({outputDirectory})");
            diagnostics.AppendLine($"[LOG]   Log Directory Exists: {Directory.Exists(logDirectory)} ({logDirectory})");
            return diagnostics.ToString().TrimEnd();
        }

        private static string ExtractArgumentValue(string arguments, string optionName)
        {
            if (string.IsNullOrWhiteSpace(arguments) || string.IsNullOrWhiteSpace(optionName))
            {
                return string.Empty;
            }

            string searchToken = optionName + " ";
            int optionIndex = arguments.IndexOf(searchToken, StringComparison.OrdinalIgnoreCase);
            if (optionIndex < 0)
            {
                return string.Empty;
            }

            int valueStart = optionIndex + searchToken.Length;
            if (valueStart >= arguments.Length)
            {
                return string.Empty;
            }

            if (arguments[valueStart] == '"')
            {
                int quotedValueStart = valueStart + 1;
                int quotedValueEnd = arguments.IndexOf('"', quotedValueStart);
                return quotedValueEnd >= 0
                    ? arguments.Substring(quotedValueStart, quotedValueEnd - quotedValueStart)
                    : arguments.Substring(quotedValueStart);
            }

            int valueEnd = arguments.IndexOf(' ', valueStart);
            return valueEnd >= 0
                ? arguments.Substring(valueStart, valueEnd - valueStart)
                : arguments.Substring(valueStart);
        }

        private static string BuildDetachedStatusManifestPath(string logDirectory, string launchToken)
        {
            if (string.IsNullOrWhiteSpace(logDirectory) || string.IsNullOrWhiteSpace(launchToken))
            {
                return null;
            }

            string timestamp = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff") + "Z";
            return Path.Combine(logDirectory, $"{timestamp}-{launchToken}-unity.status.json");
        }

    }
}
