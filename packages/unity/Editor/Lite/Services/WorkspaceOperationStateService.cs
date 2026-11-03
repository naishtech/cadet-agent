using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using Covyne.CADET.Editor.Lite.Models;
using UnityEditor;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace Covyne.CADET.Editor.Lite.Services
{
    /// <summary>
    /// Helpers for durable operation state stored in workspaces.json.
    /// </summary>
    public static class WorkspaceOperationStateService
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";
        private const double ProcessStartMatchToleranceSeconds = 2.0;
        private const string MinimumLevelEditorPrefsKey = "CADET_UnityConsoleMinimumLevel";
        private const int DebugLevel = 0;
        private const int InfoLevel = 1;
        private const int WarnLevel = 2;
        private const int ErrorLevel = 3;
        private static readonly string[] FailureLogMarkers =
        {
            "build finished, result: failure",
            "aborting batchmode due to failure",
            "[err]"
        };
        private static int _cachedMinimumLevel = ErrorLevel;

        public static bool TryGetWorkspaceManager(out WorkspaceManager workspaceManager)
        {
            workspaceManager = null;
            try
            {
                string workspacesRoot = Path.GetFullPath(CadetLitePathService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
                workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);
                return true;
            }
            catch (Exception ex)
            {
                LogWarn($"[C.A.D.E.T][WorkspaceOps] Failed to create workspace manager: {ex.Message}");
                return false;
            }
        }

        public static WorkspaceInfo GetWorkspace(string jobGuid)
        {
            if (string.IsNullOrWhiteSpace(jobGuid) || !TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return null;
            }

            return workspaceManager.GetWorkspaceByJobGuid(jobGuid);
        }

        public static List<WorkspaceInfo> GetActiveOperations()
        {
            if (!TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return new List<WorkspaceInfo>();
            }

            return workspaceManager.GetActiveOperations();
        }

        public static void UpdateStatusDetail(string jobGuid, string statusDetail)
        {
            if (string.IsNullOrWhiteSpace(jobGuid) || string.IsNullOrWhiteSpace(statusDetail) ||
                !TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return;
            }

            workspaceManager.UpdateOperationStatusDetail(jobGuid, statusDetail);
        }

        public static void MarkOperationActive(
            string jobGuid,
            int processId,
            DateTime? processStartUtc,
            string statusDetail,
            string logPath,
            string manifestPath = null,
            string launchToken = null)
        {
            if (string.IsNullOrWhiteSpace(jobGuid) || !TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return;
            }

            workspaceManager.UpdateOperationState(
                jobGuid,
                true,
                processId,
                processStartUtc,
                statusDetail,
                logPath,
                cancelRequested: false,
                manifestPath: manifestPath,
                launchToken: launchToken);

            WorkspaceInfo workspace = workspaceManager.GetWorkspaceByJobGuid(jobGuid);
            LogInfo(
                $"{DiagnosticsPrefix} WorkspaceOperationStateService.MarkOperationActive job='{jobGuid}' pid={processId} startUtc={processStartUtc?.ToString("O") ?? "<null>"} " +
                $"storedActive={workspace?.IsOperationActive ?? false} storedPid={workspace?.ActiveProcessId ?? 0} storedManifest='{workspace?.ActiveStatusManifestPath ?? string.Empty}' " +
                $"storedToken='{workspace?.ActiveStatusLaunchToken ?? string.Empty}' detail='{workspace?.ActiveStatusDetail ?? string.Empty}'.");
        }

        public static void MarkTerminal(string jobGuid, BuildJobStatus status, string statusDetail = null)
        {
            if (string.IsNullOrWhiteSpace(jobGuid) || !TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return;
            }

            BuildTerminalOutcomePolicy.NormalizeTerminalOutcome(
                status,
                statusDetail,
                out BuildJobStatus normalizedStatus,
                out string normalizedDetail);

            if (!string.IsNullOrWhiteSpace(normalizedDetail))
            {
                workspaceManager.UpdateOperationStatusDetail(jobGuid, normalizedDetail);
            }

            workspaceManager.UpdateBuildStatus(jobGuid, normalizedStatus);
            WorkspaceInfo workspace = workspaceManager.GetWorkspaceByJobGuid(jobGuid);
            LogInfo(
                $"{DiagnosticsPrefix} WorkspaceOperationStateService.MarkTerminal job='{jobGuid}' requestedStatus='{status}' normalizedStatus='{normalizedStatus}' " +
                $"detail='{normalizedDetail ?? string.Empty}' storedStatus='{workspace?.LastBuildStatus.ToString() ?? "<missing>"}' " +
                $"storedActive={workspace?.IsOperationActive ?? false} storedPid={workspace?.ActiveProcessId ?? 0}.");
        }

        public static void UpdateTrackedStatusSnapshot(
            string jobGuid,
            string activeStatusDetail,
            string completedOperationsSummary,
            string terminalMessage,
            int? exitCode,
            DateTime? updatedAtUtc)
        {
            if (string.IsNullOrWhiteSpace(jobGuid) || !TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return;
            }

            try
            {
                workspaceManager.UpdateTrackedStatusSnapshot(
                    jobGuid,
                    activeStatusDetail,
                    completedOperationsSummary,
                    terminalMessage,
                    exitCode,
                    updatedAtUtc);
            }
            catch (IOException ex) when (IsWorkspacesRegistrySharingViolation(ex))
            {
                LogWarn($"[C.A.D.E.T][WorkspaceOps] Failed to update workspaces.json due to a sharing violation. Multiple editor jobs are not supported yet. {ex.Message}");
            }
        }

        public static bool IsOperationActive(string jobGuid)
        {
            WorkspaceInfo workspace = GetWorkspace(jobGuid);
            return workspace != null && workspace.IsOperationActive;
        }

        public static bool IsProcessAlive(WorkspaceInfo workspace)
        {
            if (workspace == null || !workspace.IsOperationActive || workspace.ActiveProcessId <= 0)
            {
                return false;
            }

            try
            {
                Process process = Process.GetProcessById(workspace.ActiveProcessId);
                if (process.HasExited)
                {
                    return false;
                }

                if (!workspace.ActiveProcessStartedAtUtc.HasValue)
                {
                    return true;
                }

                DateTime processStartUtc = process.StartTime.ToUniversalTime();
                double deltaSeconds = Math.Abs((processStartUtc - workspace.ActiveProcessStartedAtUtc.Value).TotalSeconds);
                return deltaSeconds <= ProcessStartMatchToleranceSeconds;
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static bool CancelDetachedOperation(string jobGuid)
        {
            WorkspaceInfo workspace = GetWorkspace(jobGuid);
            if (workspace == null)
            {
                return false;
            }

            if (!TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return false;
            }

            workspaceManager.UpdateOperationState(
                jobGuid,
                workspace.IsOperationActive,
                workspace.ActiveProcessId,
                workspace.ActiveProcessStartedAtUtc,
                workspace.ActiveStatusDetail,
                workspace.ActiveLogPath,
                cancelRequested: true,
                manifestPath: workspace.ActiveStatusManifestPath,
                launchToken: workspace.ActiveStatusLaunchToken);

            LogWarn($"[C.A.D.E.T][WorkspaceOps] Cancel requested for job {jobGuid} (PID {workspace.ActiveProcessId}).");

            bool trackedProcessStopped = TryStopTrackedProcess(workspace, out string stopDetail, out bool stoppedLiveProcess);
            if (trackedProcessStopped && stoppedLiveProcess)
            {
                workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Cancelled);
                LogInfo($"[C.A.D.E.T][WorkspaceOps] Job {jobGuid} marked Cancelled via detached operation path.");
                return true;
            }

            if (trackedProcessStopped)
            {
                if (TryResolveTerminalStatusForInactiveProcess(workspace, out BuildJobStatus resolvedStatus, out string resolvedDetail))
                {
                    BuildTerminalOutcomePolicy.NormalizeTerminalOutcome(
                        resolvedStatus,
                        resolvedDetail,
                        out BuildJobStatus normalizedStatus,
                        out string normalizedDetail);

                    if (!string.IsNullOrWhiteSpace(normalizedDetail))
                    {
                        workspaceManager.UpdateTrackedStatusSnapshot(
                            jobGuid,
                            activeStatusDetail: null,
                            completedOperationsSummary: null,
                            terminalMessage: normalizedDetail,
                            exitCode: null,
                            updatedAtUtc: DateTime.UtcNow);
                        workspaceManager.UpdateOperationStatusDetail(jobGuid, normalizedDetail);
                    }

                    workspaceManager.UpdateBuildStatus(jobGuid, normalizedStatus);
                    LogInfo($"[C.A.D.E.T][WorkspaceOps] Job {jobGuid} resolved to '{normalizedStatus}' during cancel with inactive tracked PID.");
                    return true;
                }

                workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Cancelled);
                LogInfo($"[C.A.D.E.T][WorkspaceOps] Job {jobGuid} marked Cancelled (fallback) after inactive tracked PID with no terminal evidence.");
                return true;
            }

            workspaceManager.UpdateOperationStatusDetail(jobGuid, "Cancellation requested. Waiting for detached process to exit.");
            LogWarn($"[C.A.D.E.T][WorkspaceOps] Cancellation requested for job {jobGuid}, but the tracked process is still running. {stopDetail}");

            return true;
        }

        private static bool TryStopTrackedProcess(WorkspaceInfo workspace, out string detail, out bool stoppedLiveProcess)
        {
            detail = string.Empty;
            stoppedLiveProcess = false;
            if (workspace == null || workspace.ActiveProcessId <= 0)
            {
                detail = "No tracked PID was recorded.";
                return true;
            }

            try
            {
                using Process process = Process.GetProcessById(workspace.ActiveProcessId);
                if (process.HasExited)
                {
                    detail = $"Tracked PID {workspace.ActiveProcessId} had already exited.";
                    return true;
                }

                if (!IsMatchingTrackedProcess(process, workspace.ActiveProcessStartedAtUtc))
                {
                    detail = $"Tracked PID {workspace.ActiveProcessId} now belongs to a different process instance; skipping kill.";
                    return true;
                }

                KillTrackedProcessTree(workspace.ActiveProcessId);
                if (WaitForProcessExit(workspace.ActiveProcessId, workspace.ActiveProcessStartedAtUtc, 5000))
                {
                    detail = $"Tracked process tree for PID {workspace.ActiveProcessId} terminated.";
                    stoppedLiveProcess = true;
                    return true;
                }

                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill();
                    }
                }
                catch (Exception ex)
                {
                    detail = $"Process tree kill fallback failed: {ex.Message}";
                }

                if (WaitForProcessExit(workspace.ActiveProcessId, workspace.ActiveProcessStartedAtUtc, 2000))
                {
                    detail = $"Tracked process tree for PID {workspace.ActiveProcessId} terminated after direct kill fallback.";
                    stoppedLiveProcess = true;
                    return true;
                }

                if (string.IsNullOrWhiteSpace(detail))
                {
                    detail = $"PID {workspace.ActiveProcessId} remained alive after kill attempts.";
                }

                return false;
            }
            catch (ArgumentException)
            {
                detail = $"Tracked PID {workspace.ActiveProcessId} was no longer present.";
                return true;
            }
            catch (InvalidOperationException)
            {
                detail = $"Tracked PID {workspace.ActiveProcessId} was no longer available.";
                return true;
            }
            catch (Exception ex)
            {
                detail = $"Error while stopping PID {workspace.ActiveProcessId}: {ex.Message}";
                return false;
            }
        }

        private static bool TryResolveTerminalStatusForInactiveProcess(
            WorkspaceInfo workspace,
            out BuildJobStatus resolvedStatus,
            out string resolvedDetail)
        {
            resolvedStatus = BuildJobStatus.Cancelled;
            resolvedDetail = string.Empty;

            if (workspace == null)
            {
                return false;
            }

            if (workspace.LastExitCode.HasValue)
            {
                if (workspace.LastExitCode.Value == 0)
                {
                    resolvedStatus = BuildJobStatus.Completed;
                    resolvedDetail = !string.IsNullOrWhiteSpace(workspace.LastTerminalMessage)
                        ? workspace.LastTerminalMessage
                        : workspace.LastOperationSummary;
                    return true;
                }

                resolvedStatus = BuildJobStatus.Failed;
                resolvedDetail = BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonNonZeroExitCode);
                return true;
            }

            if (DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out _))
            {
                BuildJobStatus? manifestStatus = DetachedStatusManifestReader.TryMapOverallStatus(manifest?.OverallStatus);
                if (manifestStatus.HasValue)
                {
                    resolvedStatus = manifestStatus.Value;
                    resolvedDetail = DetachedStatusManifestReader.BuildTerminalMessage(manifest);
                    return true;
                }
            }

            if (HasFailureLogMarkers(workspace.ActiveLogPath))
            {
                resolvedStatus = BuildJobStatus.Failed;
                resolvedDetail = BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonLogFailureMarker);
                return true;
            }

            return false;
        }

        private static bool HasFailureLogMarkers(string logPath)
        {
            if (string.IsNullOrWhiteSpace(logPath) || !File.Exists(logPath))
            {
                return false;
            }

            try
            {
                string[] lines = File.ReadLines(logPath).TakeLast(2000).ToArray();
                for (int i = 0; i < lines.Length; i++)
                {
                    string line = lines[i];
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        continue;
                    }

                    string lower = line.ToLowerInvariant();
                    for (int markerIndex = 0; markerIndex < FailureLogMarkers.Length; markerIndex++)
                    {
                        if (lower.Contains(FailureLogMarkers[markerIndex]))
                        {
                            return true;
                        }
                    }
                }
            }
            catch (Exception)
            {
                return false;
            }

            return false;
        }

        private static bool IsMatchingTrackedProcess(Process process, DateTime? trackedStartUtc)
        {
            if (process == null)
            {
                return false;
            }

            if (!trackedStartUtc.HasValue)
            {
                return true;
            }

            try
            {
                DateTime processStartUtc = process.StartTime.ToUniversalTime();
                double deltaSeconds = Math.Abs((processStartUtc - trackedStartUtc.Value).TotalSeconds);
                return deltaSeconds <= ProcessStartMatchToleranceSeconds;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static bool WaitForProcessExit(int processId, DateTime? trackedStartUtc, int timeoutMs)
        {
            Stopwatch stopwatch = Stopwatch.StartNew();
            while (stopwatch.ElapsedMilliseconds < timeoutMs)
            {
                if (!IsTrackedProcessStillRunning(processId, trackedStartUtc))
                {
                    return true;
                }

                Thread.Sleep(100);
            }

            return !IsTrackedProcessStillRunning(processId, trackedStartUtc);
        }

        private static void KillTrackedProcessTree(int processId)
        {
            if (processId <= 0)
            {
                return;
            }

            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                ExecuteKillCommand("taskkill", $"/T /F /PID {processId}", 5000);
                return;
            }

            ExecuteKillCommand("pkill", $"-P {processId}", 2000);
            ExecuteKillCommand("kill", $"-9 {processId}", 2000);
        }

        private static void ExecuteKillCommand(string fileName, string arguments, int timeoutMs)
        {
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = fileName,
                    Arguments = arguments,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };

                using Process killProcess = Process.Start(startInfo);
                if (killProcess == null)
                {
                    return;
                }

                killProcess.WaitForExit(timeoutMs);
            }
            catch (Exception ex)
            {
                LogWarn($"[C.A.D.E.T][WorkspaceOps] Failed to execute process kill command '{fileName} {arguments}': {ex.Message}");
            }
        }

        private static bool IsTrackedProcessStillRunning(int processId, DateTime? trackedStartUtc)
        {
            if (processId <= 0)
            {
                return false;
            }

            try
            {
                using Process process = Process.GetProcessById(processId);
                if (process.HasExited)
                {
                    return false;
                }

                return IsMatchingTrackedProcess(process, trackedStartUtc);
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static void LogInfo(string message)
        {
            EmitFiltered(InfoLevel, message);
        }

        private static void LogWarn(string message)
        {
            EmitFiltered(WarnLevel, message);
        }

        private static bool IsWorkspacesRegistrySharingViolation(IOException ex)
        {
            if (ex == null)
            {
                return false;
            }

            string message = ex.Message ?? string.Empty;
            return message.IndexOf("sharing violation", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   message.IndexOf("being used by another process", StringComparison.OrdinalIgnoreCase) >= 0;
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
                UnityEngine.Debug.LogWarning(message);
                return;
            }

            UnityEngine.Debug.Log(message);
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

    }
}
