using System;
using System.Threading.Tasks;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.ViewModels;
using UnityEditor;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Owns compatibility runtime state outside of any specific window for tracked retry execution flows.
    /// </summary>
    [InitializeOnLoad]
    public static class BuildQueueBackgroundService
    {
        private static readonly object SyncRoot = new object();

        private static bool isInitialized;
        private static BuildExecutionStateViewModel buildExecutionStateViewModel;
        private static ConsoleOutputViewModel consoleOutputViewModel;
        private static ActionButtonsViewModel actionButtonsViewModel;
        private static ProgressBarViewModel progressBarViewModel;

        static BuildQueueBackgroundService()
        {
            EnsureInitialized();
        }

        public static void EnsureInitialized()
        {
            lock (SyncRoot)
            {
                if (isInitialized)
                {
                    return;
                }

                buildExecutionStateViewModel = new BuildExecutionStateViewModel();
                consoleOutputViewModel = new ConsoleOutputViewModel();
                actionButtonsViewModel = new ActionButtonsViewModel();
                progressBarViewModel = new ProgressBarViewModel();

                BuildOperationReloadRecoveryService.RegisterDetachedOperationTerminalCallback(OnDetachedOperationTerminal);
                BuildQueueRuntimeState.Instance.CancelActiveOperation = CancelTrackedRetryOperation;
                BuildQueueInteropService.EnsureInitializedAction = EnsureInitialized;
                BuildQueueInteropService.RetryJobFunc = RetryJob;

                isInitialized = true;
            }
        }

        public static bool RetryJob(BuildJobDefinition job)
        {
            EnsureInitialized();
            BuildJobDefinition retriedJob = BuildQueueManager.Instance.RetryJobDirect(job);
            if (retriedJob == null)
            {
                return false;
            }

            ExecuteRetriedJobAsync(retriedJob);
            return true;
        }

        private static void OnDetachedOperationTerminal()
        {
            // Detached completion should only update history; no orchestration loop remains here.
        }

        private static async void ExecuteRetriedJobAsync(BuildJobDefinition job)
        {
            if (job == null)
            {
                return;
            }

            try
            {
                BuildQueueRuntimeState.Instance.ActiveJobGuid = job.JobGuid;
                BuildQueueRuntimeState.Instance.IsOperationRunning = true;
                BuildQueueRuntimeState.Instance.ActiveStatusText = $"Running operations: {BuildJobOperationsSummaryService.GetSummary(job)}";

                BuildQueueJobExecutionService.ExecutionResult executionResult = await ExecuteTrackedJobAsync(job);
                bool success = executionResult.Success;
                bool managerStillTracksJob = BuildQueueManager.Instance.IsJobActive(job.JobGuid);
                WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(job.JobGuid);
                bool detachedOperationStillActive = IsDetachedOperationStillActive(workspace);
                bool detachedLaunchPending = executionResult.DetachedOperationActive ||
                                             (!detachedOperationStillActive &&
                                              success &&
                                              managerStillTracksJob &&
                                              job.ProcessId > 0 &&
                                              !IsTerminalStatus(job.Status));

                if (detachedOperationStillActive || detachedLaunchPending)
                {
                    BuildQueueRuntimeState.Instance.ActiveJobGuid = null;
                    return;
                }

                if (managerStillTracksJob)
                {
                    string finalStatusDetail = success
                        ? "Completed successfully"
                        : (!string.IsNullOrWhiteSpace(job.StatusDetail) && job.StatusDetail.StartsWith("Error Detected:"))
                            ? job.StatusDetail
                            : BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonLogFailureMarker);

                    job.StatusDetail = finalStatusDetail;
                    BuildJobStatus terminalStatus = success ? BuildJobStatus.Completed : BuildJobStatus.Failed;
                    BuildQueueManager.Instance.CompleteJob(job.JobGuid, terminalStatus);
                }
            }
            catch (Exception ex)
            {
                consoleOutputViewModel.AppendLine($"[ERROR] Retry execution failed: {ex.Message}", CadetConsoleMessageType.Error);
            }
            finally
            {
                BuildQueueRuntimeState.Instance.ActiveJobGuid = null;
                BuildQueueRuntimeState.Instance.IsOperationRunning = false;
                consoleOutputViewModel.UnityConsoleMirroringEnabled = false;
            }
        }

        private static async Task<BuildQueueJobExecutionService.ExecutionResult> ExecuteTrackedJobAsync(BuildJobDefinition job)
        {
            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => BuildQueueManager.Instance.IsJobActive(guid),
                GetJobOperationsSummary = BuildJobOperationsSummaryService.GetSummary,
                ExecuteBuildOperation = ExecuteBuildProfileWithResult,
                OnBuildSucceeded = () => { },
                Repaint = () => { },
                AppendOutput = (line, type) => consoleOutputViewModel.AppendLine(line, type)
            };

            return await BuildQueueJobExecutionService.ExecuteAsync(request, job);
        }

        private static async Task<BuildOperationExecutionService.ExecutionResult> ExecuteBuildProfileWithResult(BuildProfile profile, bool buildOnly, bool publishOnly, bool notarizeOnly, string platform = null, BuildJobDefinition activeJob = null)
        {
            string operationName = notarizeOnly
                ? "Notarize macOS Build"
                : (buildOnly ? "Build Only" : (publishOnly ? "Publish Only" : "Build & Publish"));
            var request = new BuildOperationExecutionService.Request
            {
                Profile = profile,
                ProfileGuid = activeJob?.ProfileGuid,
                ActiveJob = activeJob,
                OperationName = operationName,
                PlatformOverride = platform,
                BuildOnly = buildOnly,
                PublishOnly = publishOnly,
                NotarizeOnly = notarizeOnly,
                ClearUnityLogsBeforeExecute = buildOnly || !publishOnly,
                ExecutionState = buildExecutionStateViewModel,
                ActionButtons = actionButtonsViewModel,
                ConsoleOutput = consoleOutputViewModel,
                ProgressBar = progressBarViewModel,
                KeepConsoleMirroringAfterCompletion = false,
                ShowBlockingSyncDialog = activeJob == null || activeJob.ShowBlockingSyncDialog,
                Repaint = () => { },
#if !CADET_LITE
                ExecuteDistScript = ExecuteDistScript
#endif
            };

            return await BuildOperationExecutionService.ExecuteWithResultAsync(request);
        }

#if !CADET_LITE
        private static BuildResult ExecuteDistScript(
            string projectPath,
            string profileJsonPath,
            string profileName,
            string profileGuid,
            bool buildOnly,
            bool publishOnly,
            bool notarizeOnly = false,
            Action<string> onOutputLine = null,
            Action<BuildSyncStatus, string> onStatusChange = null,
            Action<float> onSyncProgress = null,
            BuildJobDefinition activeJob = null)
        {
            return DistScriptService.Execute(
                projectPath,
                profileJsonPath,
                profileGuid,
                buildOnly,
                publishOnly,
                notarizeOnly,
                onOutputLine,
                onStatusChange,
                onSyncProgress,
                activeJob,
                processTracker: buildExecutionStateViewModel.ProcessTracker);
        }
#endif

        private static void CancelTrackedRetryOperation()
        {
            string activeJobGuid = BuildQueueRuntimeState.Instance.ActiveJobGuid;
            if (string.IsNullOrWhiteSpace(activeJobGuid))
            {
                return;
            }

            buildExecutionStateViewModel?.CleanupActiveBuildProcess();
            BuildQueueManager.Instance.MarkJobTerminal(activeJobGuid, BuildJobStatus.Cancelled, "Cancelled by user.");

            BuildQueueRuntimeState.Instance.ActiveJobGuid = null;
            BuildQueueRuntimeState.Instance.ActiveStatusText = "Cancelled by user.";
            BuildQueueRuntimeState.Instance.IsOperationRunning = false;
            BuildQueueRuntimeState.Instance.CancelActiveOperation = null;
        }

        private static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }

        private static bool IsDetachedOperationStillActive(WorkspaceInfo workspace)
        {
            if (workspace == null || !workspace.IsOperationActive)
            {
                return false;
            }

            bool hasDetachedEvidence = workspace.ActiveProcessId > 0 ||
                                       DetachedStatusManifestReader.ExpectsTrackedManifest(workspace);
            if (!hasDetachedEvidence)
            {
                return false;
            }

            return BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, DateTime.UtcNow);
        }
    }
}