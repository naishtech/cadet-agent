using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Lite.Models;
using UnityEngine;
using UnityEditor;
using System.IO;

namespace Covyne.CADET.Editor.Lite.Services
{
    /// <summary>
    /// Rehydrates detached build operation runtime state after domain reload.
    /// </summary>
    [InitializeOnLoad]
    public static class BuildOperationReloadRecoveryService
    {
        private const double DetachedActivationGraceSeconds = 5.0;
        private const double MissingProcessGraceSeconds = 10.0;
        private const double PollIntervalSeconds = 1.0;
        // Number of *meaningful* (non-noise) lines to scan from the tail of the Unity log.
        // Noise lines (see DetachedLogNoiseLinePrefixes) are skipped without counting against this limit,
        // so Unity's variable-length [Performance] dump at the end of the log never obscures the real result.
        private const int DetachedLogTailMeaningfulLineCount = 80;
        private const string MinimumLevelEditorPrefsKey = "CADET_UnityConsoleMinimumLevel";
        private const int InfoLevel = 1;
        private const int WarnLevel = 2;
        private const int ErrorLevel = 3;
        private static int cachedMinimumLevel = ErrorLevel;

        private static readonly string[] DetachedLogSuccessMarkers =
        {
            "All operations completed successfully",
            "Unity builds completed successfully.",
            "Unity Windows build completed successfully.",
            "Unity MacOS build completed successfully.",
            "Build Finished, Result: Success.",
            "DisplayProgressNotification: Build Successful"
        };

        private static readonly string[] DetachedLogFailureMarkers =
        {
            "[ERR]",
            " build/publish failed",
            "Build Finished, Result: Failure.",
            "Aborting batchmode due to failure:"
        };

        // Lines whose content can never contain build result markers.
        // These are skipped without decrementing the meaningful-line budget so that a large
        // Unity [Performance] dump at the end of the log never pushes success/failure lines
        // outside the scan window.
        private static readonly string[] DetachedLogNoiseLinePrefixes =
        {
            "[Performance]",
            "abort_threads:"
        };

        private static readonly Dictionary<string, DateTime> missingProcessSinceByJobGuid =
            new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<string, DateTime> inactiveWorkspaceGraceSinceByJobGuid =
            new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);

        private static Action detachedOperationTerminalCallback;
        private static double nextRefreshTime;
        private static string lastReportedActiveJobGuid;
        private static bool lastReportedNoActive;

        static BuildOperationReloadRecoveryService()
        {
            LogInfo("[C.A.D.E.T][Recovery] Build operation reload recovery initialized.");
            EditorApplication.update += OnEditorUpdate;
        }

        public static void RegisterDetachedOperationTerminalCallback(Action callback)
        {
            detachedOperationTerminalCallback = callback;
        }

        public static void RefreshNow()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                return;
            }

            TickRecovery(DateTime.UtcNow);
            NormalizeOrphanedWorkspaceRecords(DateTime.UtcNow);
        }

        private static void OnEditorUpdate()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                return;
            }

            double now = EditorApplication.timeSinceStartup;
            if (now < nextRefreshTime)
            {
                return;
            }

            nextRefreshTime = now + PollIntervalSeconds;
            RefreshNow();
        }

        private static void TickRecovery(DateTime nowUtc)
        {
            List<WorkspaceInfo> activeOperations = WorkspaceOperationStateService.GetActiveOperations();
            if (activeOperations.Count == 0)
            {
                if (!lastReportedNoActive)
                {
                    LogInfo("[C.A.D.E.T][Recovery] No detached active operations found.");
                    lastReportedNoActive = true;
                    lastReportedActiveJobGuid = null;
                }

                // Even with no workspace-active operations, the queue may still have jobs marked
                // Building/Syncing whose workspace already cleared IsOperationActive (e.g. process
                // ended cleanly before the recovery cycle ran). Reconcile those now.
                if (ReconcileStaleQueueActiveJobs(nowUtc))
                {
                    detachedOperationTerminalCallback?.Invoke();
                }

                ResetRuntimeWhenNoActiveOperation();
                return;
            }

            lastReportedNoActive = false;

            bool hasAnyRunning = false;
            bool detachedTerminalTransitionOccurred = false;
            WorkspaceInfo preferredActive = null;

            for (int i = 0; i < activeOperations.Count; i++)
            {
                WorkspaceInfo operation = activeOperations[i];
                TryRefreshTrackedManifestState(operation);
                if (BuildOperationLivenessService.IsVerifiedActiveOperation(operation, nowUtc))
                {
                    missingProcessSinceByJobGuid.Remove(operation.JobGuid);
                    inactiveWorkspaceGraceSinceByJobGuid.Remove(operation.JobGuid);
                    hasAnyRunning = true;
                    if (preferredActive == null || operation.CreatedAtUtc > preferredActive.CreatedAtUtc)
                    {
                        preferredActive = operation;
                    }
                    continue;
                }

                BuildJobStatus immediateFinalStatus = DetermineDetachedFinalStatus(operation);
                if (immediateFinalStatus != BuildJobStatus.Failed)
                {
                    missingProcessSinceByJobGuid.Remove(operation.JobGuid);
                    string immediateDetail = GetDetachedCompletionDetail(immediateFinalStatus);
                    LogTerminalRecovery(operation.JobGuid, immediateFinalStatus, recoveredAfterGraceWindow: false);

                    bool updatedQueueImmediately = BuildQueueManager.Instance.MarkJobTerminal(operation.JobGuid, immediateFinalStatus, immediateDetail);
                    WorkspaceOperationStateService.MarkTerminal(operation.JobGuid, immediateFinalStatus, immediateDetail);
                    detachedTerminalTransitionOccurred = updatedQueueImmediately || detachedTerminalTransitionOccurred;
                    continue;
                }

                if (!missingProcessSinceByJobGuid.TryGetValue(operation.JobGuid, out DateTime firstMissingUtc))
                {
                    missingProcessSinceByJobGuid[operation.JobGuid] = nowUtc;
                    LogWarn($"[C.A.D.E.T][Recovery] Active operation process missing for job {operation.JobGuid}. Starting {MissingProcessGraceSeconds:0}s grace window.");
                    continue;
                }

                if ((nowUtc - firstMissingUtc).TotalSeconds < MissingProcessGraceSeconds)
                {
                    continue;
                }

                missingProcessSinceByJobGuid.Remove(operation.JobGuid);
                BuildJobStatus finalStatus = DetermineDetachedFinalStatus(operation);
                string detail = GetDetachedCompletionDetail(finalStatus);
                LogTerminalRecovery(operation.JobGuid, finalStatus, recoveredAfterGraceWindow: true);

                bool updatedQueue = BuildQueueManager.Instance.MarkJobTerminal(operation.JobGuid, finalStatus, detail);
                WorkspaceOperationStateService.MarkTerminal(operation.JobGuid, finalStatus, detail);
                detachedTerminalTransitionOccurred = updatedQueue || detachedTerminalTransitionOccurred;
            }

            if (!hasAnyRunning)
            {
                bool reconciledStaleQueueEntries = ReconcileStaleQueueActiveJobs(nowUtc);
                detachedTerminalTransitionOccurred = detachedTerminalTransitionOccurred || reconciledStaleQueueEntries;

                if (detachedTerminalTransitionOccurred)
                {
                    detachedOperationTerminalCallback?.Invoke();
                }

                ResetRuntimeWhenNoActiveOperation();
                return;
            }

            if (preferredActive != null)
            {
                if (!string.Equals(lastReportedActiveJobGuid, preferredActive.JobGuid, StringComparison.OrdinalIgnoreCase))
                {
                    LogInfo($"[C.A.D.E.T][Recovery] Rehydrated detached operation for job {preferredActive.JobGuid} (PID {preferredActive.ActiveProcessId}).");
                    lastReportedActiveJobGuid = preferredActive.JobGuid;
                }

                var runtimeState = BuildQueueRuntimeState.Instance;
                runtimeState.ActiveJobGuid = preferredActive.JobGuid;
                runtimeState.ActiveStatusText = string.IsNullOrWhiteSpace(preferredActive.ActiveStatusDetail)
                    ? "Build in progress (recovered after reload)."
                    : preferredActive.ActiveStatusDetail;
                runtimeState.IsOperationRunning = true;
                runtimeState.HasError = false;
                runtimeState.HasSuccess = false;
                runtimeState.CancelActiveOperation = () =>
                {
                    LogWarn($"[C.A.D.E.T][Recovery] Cancel requested for detached job {preferredActive.JobGuid}.");
                    bool cancelled = WorkspaceOperationStateService.CancelDetachedOperation(preferredActive.JobGuid);
                    if (!cancelled)
                    {
                        LogWarn($"[C.A.D.E.T][Recovery] Detached cancel did not find an active process for job {preferredActive.JobGuid}.");
                        return;
                    }

                    runtimeState.ActiveStatusText = "Cancelled by user.";
                    runtimeState.IsOperationRunning = false;
                    LogInfo($"[C.A.D.E.T][Recovery] Detached job {preferredActive.JobGuid} marked cancelled.");
                };
            }

            if (detachedTerminalTransitionOccurred)
            {
                detachedOperationTerminalCallback?.Invoke();
            }
        }

        private static bool ReconcileStaleQueueActiveJobs(DateTime nowUtc)
        {
            bool reconciled = false;
            BuildQueueManager queueManager = BuildQueueManager.Instance;
            List<string> activeJobGuids = queueManager.GetActiveJobGuids();

            if (activeJobGuids.Count > 0)
            {
                LogInfo($"[C.A.D.E.T][Recovery] Reconciling stale active tracked jobs. Count={activeJobGuids.Count}.");
            }

            for (int i = 0; i < activeJobGuids.Count; i++)
            {
                string jobGuid = activeJobGuids[i];
                if (string.IsNullOrWhiteSpace(jobGuid))
                {
                    continue;
                }

                WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(jobGuid);
                if (workspace == null)
                {
                    string missingWorkspaceDetail = BuildTerminalOutcomePolicy.BuildInferredDetail(
                        BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable);
                    bool updatedMissingWorkspaceJob = queueManager.MarkJobTerminal(jobGuid, BuildJobStatus.Completed, missingWorkspaceDetail);
                    LogInfo(
                        $"[C.A.D.E.T][Recovery] Stale reconcile terminalized job {jobGuid}: " +
                        $"workspace record missing. managerUpdated={updatedMissingWorkspaceJob} detail='{missingWorkspaceDetail}'.");
                    inactiveWorkspaceGraceSinceByJobGuid.Remove(jobGuid);
                    reconciled = updatedMissingWorkspaceJob || reconciled;
                    continue;
                }

                LogInfo(
                    $"[C.A.D.E.T][Recovery] Stale reconcile inspect job {jobGuid}: " +
                    $"workspaceStatus={workspace.LastBuildStatus} isActive={workspace.IsOperationActive} " +
                    $"pid={workspace.ActiveProcessId} runtimeActiveGuid={BuildQueueRuntimeState.Instance.ActiveJobGuid ?? "<null>"}.");

                if (ShouldDelayInactiveWorkspaceReconciliation(jobGuid, workspace, nowUtc))
                {
                    LogInfo($"[C.A.D.E.T][Recovery] Stale reconcile deferred for job {jobGuid}.");
                    continue;
                }

                if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
                {
                    LogInfo($"[C.A.D.E.T][Recovery] Stale reconcile skipped for job {jobGuid}: operation still verified active.");
                    inactiveWorkspaceGraceSinceByJobGuid.Remove(jobGuid);
                    continue;
                }

                BuildJobStatus finalStatus = IsTerminalStatus(workspace.LastBuildStatus)
                    ? workspace.LastBuildStatus
                    : DetermineDetachedFinalStatus(workspace);

                string detail = GetDetachedCompletionDetail(finalStatus);

                bool updatedTrackedJob = queueManager.MarkJobTerminal(jobGuid, finalStatus, detail);
                WorkspaceOperationStateService.MarkTerminal(jobGuid, finalStatus, detail);

                LogInfo(
                    $"[C.A.D.E.T][Recovery] Stale reconcile terminalized job {jobGuid}: " +
                    $"finalStatus={finalStatus} managerUpdated={updatedTrackedJob} detail='{detail ?? string.Empty}'.");

                if (updatedTrackedJob)
                {
                    reconciled = true;
                    LogInfo($"[C.A.D.E.T][Recovery] Reconciled stale active tracked entry for job {jobGuid}. Marking {finalStatus}.");
                }
            }

            return reconciled;
        }

        private static bool ShouldDelayInactiveWorkspaceReconciliation(string jobGuid, WorkspaceInfo workspace, DateTime nowUtc)
        {
            if (string.IsNullOrWhiteSpace(jobGuid) || workspace == null)
            {
                return false;
            }

            // While the current domain still points at this active job,
            // defer stale reconciliation. Detached launch evidence may be persisted moments later.
            if (string.Equals(BuildQueueRuntimeState.Instance.ActiveJobGuid, jobGuid, StringComparison.OrdinalIgnoreCase))
            {
                if (!inactiveWorkspaceGraceSinceByJobGuid.ContainsKey(jobGuid))
                {
                    inactiveWorkspaceGraceSinceByJobGuid[jobGuid] = nowUtc;
                }

                LogInfo($"[C.A.D.E.T][Recovery] Delay stale reconcile for job {jobGuid}: runtime still points at this active job.");

                return true;
            }

            if (workspace.IsOperationActive || IsTerminalStatus(workspace.LastBuildStatus))
            {
                inactiveWorkspaceGraceSinceByJobGuid.Remove(jobGuid);
                LogInfo($"[C.A.D.E.T][Recovery] No delay for job {jobGuid}: workspace is active={workspace.IsOperationActive} or terminal={IsTerminalStatus(workspace.LastBuildStatus)}.");
                return false;
            }

            if (workspace.LastBuildStatus == BuildJobStatus.Building)
            {
                DateTime referenceUtc = workspace.LastUpdatedAtUtc ?? workspace.CreatedAtUtc;
                if ((nowUtc - referenceUtc).TotalSeconds < DetachedActivationGraceSeconds)
                {
                    LogInfo($"[C.A.D.E.T][Recovery] Delay stale reconcile for job {jobGuid}: building grace window not elapsed.");
                    return true;
                }

                inactiveWorkspaceGraceSinceByJobGuid.Remove(jobGuid);
                LogInfo($"[C.A.D.E.T][Recovery] No delay for job {jobGuid}: building grace window elapsed.");
                return false;
            }

            if (!inactiveWorkspaceGraceSinceByJobGuid.TryGetValue(jobGuid, out DateTime firstObservedUtc))
            {
                inactiveWorkspaceGraceSinceByJobGuid[jobGuid] = nowUtc;
                LogInfo($"[C.A.D.E.T][Recovery] Deferring stale queue reconciliation for job {jobGuid} while waiting for detached activation to persist. Status={workspace.LastBuildStatus}.");
                return true;
            }

            if ((nowUtc - firstObservedUtc).TotalSeconds < DetachedActivationGraceSeconds)
            {
                LogInfo($"[C.A.D.E.T][Recovery] Delay stale reconcile for job {jobGuid}: non-building grace window not elapsed.");
                return true;
            }

            inactiveWorkspaceGraceSinceByJobGuid.Remove(jobGuid);
            LogInfo($"[C.A.D.E.T][Recovery] No delay for job {jobGuid}: non-building grace window elapsed.");
            return false;
        }

        private static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }

        private static BuildJobStatus DetermineDetachedFinalStatus(WorkspaceInfo workspace)
        {
            lastDetachedRecoveryDetail = null;

            if (workspace == null)
            {
                lastDetachedRecoveryDetail = BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(
                    BuildTerminalOutcomePolicy.ReasonStateCorruption);
                return BuildJobStatus.Failed;
            }

            if (string.IsNullOrWhiteSpace(workspace.JobGuid) || string.IsNullOrWhiteSpace(workspace.ProfileGuid))
            {
                lastDetachedRecoveryDetail = BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(
                    BuildTerminalOutcomePolicy.ReasonStateCorruption);
                return BuildJobStatus.Failed;
            }

            if (workspace.CancelRequested)
            {
                lastDetachedRecoveryDetail = "Detached build was cancelled by the user.";
                return BuildJobStatus.Cancelled;
            }

            // When manifest tracking is configured but the manifest file hasn't been written yet,
            // we cannot make a reliable final determination. Return Failed as a conservative
            // "not ready" sentinel so callers defer finalization to the grace window rather than
            // immediately marking the job Completed. This covers pure C# detached builds on reload
            // where the watcher may not have written the manifest yet (early startup phase).
            if (DetachedStatusManifestReader.ExpectsTrackedManifest(workspace) &&
                !DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out _, out _))
            {
                lastDetachedRecoveryDetail = BuildTerminalOutcomePolicy.BuildInferredDetail(
                    BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable);
                return BuildJobStatus.Failed;
            }

            if (TryDetermineHardFailureReason(workspace, out string failureReason))
            {
                if (BuildTerminalOutcomePolicy.IsCatastrophicReason(failureReason))
                {
                    lastDetachedRecoveryDetail = BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(failureReason);
                    return BuildJobStatus.Failed;
                }

                lastDetachedRecoveryDetail = string.Equals(failureReason, BuildTerminalOutcomePolicy.ReasonManifestFailure, StringComparison.OrdinalIgnoreCase)
                    ? BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(failureReason)
                    : BuildTerminalOutcomePolicy.BuildInferredDetail(failureReason);
                return BuildJobStatus.Completed;
            }

            if (RequiredBuildArtifactsExist(workspace))
            {
                return BuildJobStatus.Completed;
            }

            // Optimistic model: process ended with no explicit hard-failure signal.
            return BuildJobStatus.Completed;
        }

        private static string GetDetachedCompletionDetail(BuildJobStatus finalStatus)
        {
            string retainedDetail = GetLastDetachedRecoveryDetail();
            if (!string.IsNullOrWhiteSpace(retainedDetail))
            {
                return retainedDetail;
            }

            return finalStatus switch
            {
                BuildJobStatus.Completed => "Complete",
                BuildJobStatus.Cancelled => "Detached build was cancelled by the user.",
                _ => BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonInternalException)
            };
        }

        private static bool TryDetermineHardFailureReason(WorkspaceInfo workspace, out string reason)
        {
            reason = null;

            if (workspace == null)
            {
                reason = BuildTerminalOutcomePolicy.ReasonStateCorruption;
                return true;
            }

            // Priority 1: Exit code.
            int? exitCode = ResolveExitCode(workspace);
            if (!exitCode.HasValue)
            {
                reason = BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable;
                return true;
            }

            if (exitCode.Value != 0)
            {
                reason = BuildTerminalOutcomePolicy.ReasonNonZeroExitCode;
                return true;
            }

            // Priority 2: Manifest-level terminal status.
            if (TryMapTrackedManifestTerminalStatus(workspace, out BuildJobStatus manifestStatus) &&
                manifestStatus == BuildJobStatus.Failed)
            {
                reason = BuildTerminalOutcomePolicy.ReasonManifestFailure;
                return true;
            }

            // Priority 3: Detached log markers.
            if (TryReadDetachedLogStatus(workspace, out BuildJobStatus logStatus) &&
                logStatus == BuildJobStatus.Failed)
            {
                reason = IsPublishFailureEvidence(lastDetachedRecoveryDetail)
                    ? BuildTerminalOutcomePolicy.ReasonPublishStepFailed
                    : BuildTerminalOutcomePolicy.ReasonLogFailureMarker;
                return true;
            }

            // Exit code 0 wins over lower-priority signals.
            return false;
        }

        private static bool IsPublishFailureEvidence(string detail)
        {
            if (string.IsNullOrWhiteSpace(detail))
            {
                return false;
            }

            string lower = detail.ToLowerInvariant();
            bool looksLikePublishOperation = lower.Contains("publish") ||
                                            lower.Contains("steam") ||
                                            lower.Contains("epic") ||
                                            lower.Contains("notariz");
            bool looksLikeFailure = lower.Contains("failed") ||
                                    lower.Contains("failure") ||
                                    lower.Contains("error") ||
                                    lower.Contains("[err]");

            return looksLikePublishOperation && looksLikeFailure;
        }

        private static int? ResolveExitCode(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return null;
            }

            if (workspace.LastExitCode.HasValue)
            {
                return workspace.LastExitCode.Value;
            }

            if (DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out _) &&
                DetachedStatusManifestReader.IsTerminal(manifest?.OverallStatus))
            {
                return manifest.ExitCode;
            }

            return null;
        }

        private static bool TryMapTrackedManifestTerminalStatus(WorkspaceInfo workspace, out BuildJobStatus status)
        {
            status = BuildJobStatus.Failed;

            if (!DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out _))
            {
                return false;
            }

            BuildJobStatus? mapped = DetachedStatusManifestReader.TryMapOverallStatus(manifest.OverallStatus);
            if (!mapped.HasValue)
            {
                return false;
            }

            status = mapped.Value;
            return true;
        }

        [ThreadStatic]
        private static string lastDetachedRecoveryDetail;

        private static string GetLastDetachedRecoveryDetail()
        {
            return lastDetachedRecoveryDetail;
        }

        private static bool TryReadDetachedLogStatus(WorkspaceInfo workspace, out BuildJobStatus finalStatus)
        {
            finalStatus = BuildJobStatus.Failed;
            lastDetachedRecoveryDetail = null;

            if (workspace == null || string.IsNullOrWhiteSpace(workspace.ActiveLogPath))
            {
                return false;
            }

            string logPath = workspace.ActiveLogPath;
            if (!File.Exists(logPath))
            {
                return false;
            }

            try
            {
                DateTime logWriteUtc = File.GetLastWriteTimeUtc(logPath);
                DateTime? minimumWriteUtc = workspace.ActiveProcessStartedAtUtc?.AddSeconds(-2d);
                if (minimumWriteUtc.HasValue && logWriteUtc < minimumWriteUtc.Value)
                {
                    return false;
                }

                string[] lines = File.ReadAllLines(logPath);
                if (lines == null || lines.Length == 0)
                {
                    return false;
                }

                int meaningfulLinesScanned = 0;
                for (int i = lines.Length - 1; i >= 0 && meaningfulLinesScanned < DetachedLogTailMeaningfulLineCount; i--)
                {
                    string line = lines[i]?.Trim();
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        continue;
                    }

                    bool isNoise = false;
                    for (int noiseIndex = 0; noiseIndex < DetachedLogNoiseLinePrefixes.Length; noiseIndex++)
                    {
                        if (line.StartsWith(DetachedLogNoiseLinePrefixes[noiseIndex], StringComparison.OrdinalIgnoreCase))
                        {
                            isNoise = true;
                            break;
                        }
                    }

                    if (isNoise)
                    {
                        continue;
                    }

                    meaningfulLinesScanned++;

                    for (int successIndex = 0; successIndex < DetachedLogSuccessMarkers.Length; successIndex++)
                    {
                        if (line.IndexOf(DetachedLogSuccessMarkers[successIndex], StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            lastDetachedRecoveryDetail = $"Detached build finished successfully. Log marker: {line}";
                            finalStatus = BuildJobStatus.Completed;
                            return true;
                        }
                    }

                    for (int failureIndex = 0; failureIndex < DetachedLogFailureMarkers.Length; failureIndex++)
                    {
                        if (line.IndexOf(DetachedLogFailureMarkers[failureIndex], StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            lastDetachedRecoveryDetail = $"Detached build failed. Log marker: {line}";
                            finalStatus = BuildJobStatus.Failed;
                            return true;
                        }
                    }
                }
            }
            catch
            {
                // Ignore log probe failures and fall back to artifact detection.
            }

            return false;
        }

        private static bool RequiredBuildArtifactsExist(WorkspaceInfo workspace)
        {
            if (workspace == null || string.IsNullOrWhiteSpace(workspace.ProfileGuid))
            {
                return false;
            }

            string assetPath = AssetDatabase.GUIDToAssetPath(workspace.ProfileGuid);
            if (string.IsNullOrWhiteSpace(assetPath))
            {
                return false;
            }

            BuildProfileAsset profileAsset = AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(assetPath);
            BuildProfile profile = profileAsset?.Profile;
            if (profile?.unity == null || string.IsNullOrWhiteSpace(profile.unity.buildOutputPath))
            {
                return false;
            }

            string projectName = string.IsNullOrWhiteSpace(profile.unity.projectName) ? "Build" : profile.unity.projectName;
            string outputRoot = profile.unity.buildOutputPath.Trim().Trim('"');
            if (!Path.IsPathRooted(outputRoot))
            {
                string projectRoot = Path.GetDirectoryName(Application.dataPath) ?? string.Empty;
                outputRoot = Path.GetFullPath(Path.Combine(projectRoot, outputRoot));
            }

            string os = profile.os?.ToLowerInvariant() ?? "windows";
            bool needsWindows = os == "windows" || os == "both";
            bool needsMacos = os == "mac" || os == "macos" || os == "both";
            DateTime? minimumArtifactWriteUtc = workspace.ActiveProcessStartedAtUtc?.AddSeconds(-2d);

            if (needsWindows && !ArtifactExists(minimumArtifactWriteUtc, Path.Combine(outputRoot, "Bin", "windows", $"{projectName}.exe"), Path.Combine(outputRoot, "windows", $"{projectName}.exe")))
            {
                return false;
            }

            if (needsMacos && !ArtifactExists(minimumArtifactWriteUtc, Path.Combine(outputRoot, "Bin", "macos", $"{projectName}.app"), Path.Combine(outputRoot, "macos", $"{projectName}.app")))
            {
                return false;
            }

            return needsWindows || needsMacos;
        }

        private static bool ArtifactExists(DateTime? minimumWriteUtc, params string[] candidatePaths)
        {
            if (candidatePaths == null)
            {
                return false;
            }

            for (int i = 0; i < candidatePaths.Length; i++)
            {
                string candidatePath = candidatePaths[i];
                if (string.IsNullOrWhiteSpace(candidatePath))
                {
                    continue;
                }

                if (!File.Exists(candidatePath) && !Directory.Exists(candidatePath))
                {
                    continue;
                }

                if (!minimumWriteUtc.HasValue)
                {
                    return true;
                }

                DateTime artifactWriteUtc = GetArtifactLastWriteUtc(candidatePath);
                if (artifactWriteUtc >= minimumWriteUtc.Value)
                {
                    return true;
                }
            }

            return false;
        }

        private static DateTime GetArtifactLastWriteUtc(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    return File.GetLastWriteTimeUtc(path);
                }

                if (Directory.Exists(path))
                {
                    return Directory.GetLastWriteTimeUtc(path);
                }
            }
            catch
            {
                // Ignore timestamp probe failures and treat as stale.
            }

            return DateTime.MinValue;
        }

        private static void LogTerminalRecovery(string jobGuid, BuildJobStatus finalStatus, bool recoveredAfterGraceWindow)
        {
            string timing = recoveredAfterGraceWindow ? "after grace window" : "immediately";
            string message = $"[C.A.D.E.T][Recovery] Process not found {timing} for job {jobGuid}. Marking {finalStatus}.";

            if (finalStatus == BuildJobStatus.Failed)
            {
                LogError(message);
                return;
            }

            LogInfo(message);
        }

        private static void NormalizeOrphanedWorkspaceRecords(DateTime nowUtc)
        {
            if (!WorkspaceOperationStateService.TryGetWorkspaceManager(out WorkspaceManager workspaceManager))
            {
                return;
            }

            BuildQueueManager queueManager = BuildQueueManager.Instance;
            HashSet<string> trackedJobGuids = new HashSet<string>(
                queueManager.GetAllJobs().ConvertAll(job => job?.JobGuid).FindAll(jobGuid => !string.IsNullOrWhiteSpace(jobGuid)),
                StringComparer.OrdinalIgnoreCase);

            WorkspaceRegistry registry = workspaceManager.LoadRegistry();
            bool changed = false;
            for (int i = 0; i < registry.Workspaces.Count; i++)
            {
                WorkspaceInfo workspace = registry.Workspaces[i];
                if (workspace == null || string.IsNullOrWhiteSpace(workspace.JobGuid))
                {
                    continue;
                }

                if (trackedJobGuids.Contains(workspace.JobGuid))
                {
                    continue;
                }

                if (workspace.LastBuildStatus == BuildJobStatus.Queued)
                {
                    workspace.LastBuildStatus = BuildJobStatus.Completed;
                    workspace.IsOperationActive = false;
                    workspace.ActiveProcessId = 0;
                    workspace.ActiveProcessStartedAtUtc = null;
                    workspace.ActiveStatusDetail = string.Empty;
                    workspace.ActiveLogPath = string.Empty;
                    workspace.ActiveStatusManifestPath = string.Empty;
                    workspace.ActiveStatusLaunchToken = string.Empty;
                    workspace.CancelRequested = false;
                    workspace.CancelRequestedAtUtc = null;
                    workspace.LastTerminalMessage = BuildTerminalOutcomePolicy.BuildInferredDetail(
                        BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable);
                    workspace.LastUpdatedAtUtc = DateTime.UtcNow;
                    changed = true;
                    continue;
                }

                bool hasRecoverableActiveStatus =
                    workspace.LastBuildStatus == BuildJobStatus.Building ||
                    workspace.LastBuildStatus == BuildJobStatus.Syncing;

#if !CADET_LITE
                hasRecoverableActiveStatus = hasRecoverableActiveStatus ||
                    workspace.LastBuildStatus == BuildJobStatus.Publishing ||
                    workspace.LastBuildStatus == BuildJobStatus.Notarizing;
#endif

                if (hasRecoverableActiveStatus && !workspace.IsOperationActive)
                {
                    if (ShouldDelayOrphanedWorkspaceNormalization(workspace, nowUtc))
                    {
                        continue;
                    }

                    workspace.LastBuildStatus = BuildJobStatus.Completed;
                    workspace.ActiveProcessId = 0;
                    workspace.ActiveProcessStartedAtUtc = null;
                    workspace.ActiveStatusDetail = string.Empty;
                    workspace.ActiveLogPath = string.Empty;
                    workspace.ActiveStatusManifestPath = string.Empty;
                    workspace.ActiveStatusLaunchToken = string.Empty;
                    workspace.CancelRequested = false;
                    workspace.CancelRequestedAtUtc = null;
                    workspace.LastTerminalMessage = BuildTerminalOutcomePolicy.BuildInferredDetail(
                        BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable);
                    workspace.LastUpdatedAtUtc = DateTime.UtcNow;
                    changed = true;
                }
            }

            if (changed)
            {
                workspaceManager.SaveRegistry(registry);
            }
        }

        private static bool ShouldDelayOrphanedWorkspaceNormalization(WorkspaceInfo workspace, DateTime nowUtc)
        {
            if (workspace == null)
            {
                return false;
            }

            if (workspace.IsOperationActive || IsTerminalStatus(workspace.LastBuildStatus))
            {
                return false;
            }

            if (workspace.ActiveProcessId > 0)
            {
                LogInfo($"[C.A.D.E.T][Recovery] Deferring orphan normalization for job {workspace.JobGuid} because a detached PID is already recorded ({workspace.ActiveProcessId}). Status={workspace.LastBuildStatus}.");
                return true;
            }

            DateTime referenceUtc = workspace.LastUpdatedAtUtc ??
                                    workspace.ActiveProcessStartedAtUtc ??
                                    workspace.CreatedAtUtc;

            if ((nowUtc - referenceUtc).TotalSeconds < DetachedActivationGraceSeconds)
            {
                LogInfo($"[C.A.D.E.T][Recovery] Deferring orphan normalization for job {workspace.JobGuid} while workspace state is still fresh. Status={workspace.LastBuildStatus} UpdatedAt={workspace.LastUpdatedAtUtc?.ToString("O") ?? "<null>"}.");
                return true;
            }

            return false;
        }

        private static void LogInfo(string message)
        {
            EmitFiltered(InfoLevel, message);
        }

        private static void LogWarn(string message)
        {
            EmitFiltered(WarnLevel, message);
        }

        private static void LogError(string message)
        {
            EmitFiltered(ErrorLevel, message);
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

            if (level >= ErrorLevel)
            {
                Debug.LogError(message);
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
                cachedMinimumLevel = EditorPrefs.GetInt(MinimumLevelEditorPrefsKey, cachedMinimumLevel);
            }
            catch (Exception)
            {
                return cachedMinimumLevel;
            }

            return cachedMinimumLevel;
        }

        private static void ResetRuntimeWhenNoActiveOperation()
        {
            var runtimeState = BuildQueueRuntimeState.Instance;

            if (HasTrackedActiveQueueRuntimeJob(runtimeState))
            {
                return;
            }

            runtimeState.IsOperationRunning = false;
            runtimeState.CancelActiveOperation = null;

            // Clear stale active job identity when no detached operation is active.
            // Keeping this value causes stale queue reconciliation to defer forever.
            runtimeState.ActiveJobGuid = null;
            runtimeState.ActiveStatusText = string.Empty;
        }

        private static bool HasTrackedActiveQueueRuntimeJob(BuildQueueRuntimeState runtimeState)
        {
            if (runtimeState == null ||
                !runtimeState.IsOperationRunning ||
                string.IsNullOrWhiteSpace(runtimeState.ActiveJobGuid))
            {
                return false;
            }

            return BuildQueueManager.Instance.IsJobActive(runtimeState.ActiveJobGuid);
        }

        private static void TryRefreshTrackedManifestState(WorkspaceInfo workspace)
        {
            if (!DetachedStatusManifestReader.ExpectsTrackedManifest(workspace))
            {
                return;
            }

            if (!DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out _))
            {
                return;
            }

            ApplyTrackedManifestState(workspace, manifest);
        }

        private static void ApplyTrackedManifestState(WorkspaceInfo workspace, DetachedStatusManifest manifest)
        {
            if (workspace == null || manifest == null)
            {
                return;
            }

            string summary = DetachedStatusManifestReader.BuildSummaryText(manifest);
            string completedOperations = DetachedStatusManifestReader.BuildCompletedOperationsText(manifest);
            string terminalMessage = DetachedStatusManifestReader.BuildTerminalMessage(manifest);
            int? exitCode = DetachedStatusManifestReader.IsTerminal(manifest.OverallStatus)
                ? manifest.ExitCode
                : (int?)null;

            if (!string.IsNullOrWhiteSpace(summary))
            {
                workspace.ActiveStatusDetail = summary;
                workspace.LastOperationSummary = summary;
            }

            if (!string.IsNullOrWhiteSpace(completedOperations))
            {
                workspace.LastCompletedOperationsSummary = completedOperations;
            }

            if (!string.IsNullOrWhiteSpace(terminalMessage))
            {
                workspace.LastTerminalMessage = terminalMessage;
            }

            if (manifest.UpdatedAtUtc.HasValue)
            {
                workspace.LastUpdatedAtUtc = manifest.UpdatedAtUtc;
            }

            if (exitCode.HasValue)
            {
                workspace.LastExitCode = exitCode;
            }

            WorkspaceOperationStateService.UpdateTrackedStatusSnapshot(
                workspace.JobGuid,
                summary,
                completedOperations,
                terminalMessage,
                exitCode,
                manifest.UpdatedAtUtc);
        }
    }
}
