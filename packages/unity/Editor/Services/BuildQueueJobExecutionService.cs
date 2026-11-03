using System;
using System.Threading.Tasks;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using UnityEditor;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Executes a single tracked job and coordinates its operation sequencing.
    /// </summary>
    public static class BuildQueueJobExecutionService
    {
        private const string RepaintLogPrefix = "[C.A.D.E.T][BuildQueueJobExecutionService] Repaint requested.";
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";

        public readonly struct ExecutionResult
        {
            public ExecutionResult(bool success, bool detachedOperationActive)
            {
                Success = success;
                DetachedOperationActive = detachedOperationActive;
            }

            public bool Success { get; }
            public bool DetachedOperationActive { get; }
        }

        public class Request
        {
            public Func<string, bool> IsTrackedJobActive { get; set; }
            public Func<BuildJobDefinition, string> GetJobOperationsSummary { get; set; }
            public Func<BuildProfile, bool, bool, bool, string, BuildJobDefinition, Task<BuildOperationExecutionService.ExecutionResult>> ExecuteBuildOperation { get; set; }
            public Action OnBuildSucceeded { get; set; }
            public Action Repaint { get; set; }
            public Action<string, CadetConsoleMessageType> AppendOutput { get; set; }
        }

        public static async Task<ExecutionResult> ExecuteAsync(Request request, BuildJobDefinition job)
        {
            ValidateRequest(request, job);

            string assetPath = AssetDatabase.GUIDToAssetPath(job.ProfileGuid);
            if (string.IsNullOrWhiteSpace(assetPath))
            {
                job.StatusDetail = "Failed: profile asset path not found.";
                request.AppendOutput($"[ERROR] Tracked job {job.JobGuid}: profile GUID could not be resolved.", CadetConsoleMessageType.Error);
                return new ExecutionResult(false, false);
            }

            BuildProfileAsset profileAsset = AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(assetPath);
            if (profileAsset == null || profileAsset.Profile == null)
            {
                job.StatusDetail = "Failed: profile asset is missing.";
                request.AppendOutput($"[ERROR] Tracked job {job.JobGuid}: profile asset missing at {assetPath}", CadetConsoleMessageType.Error);
                return new ExecutionResult(false, false);
            }

            BuildProfile profile = profileAsset.Profile;
            job.ProfileName = profile.profileName;

            request.AppendOutput($"[LOG] Tracked job start: {job.JobGuid} ({job.ProfileName})", CadetConsoleMessageType.Log);
            request.AppendOutput($"[LOG] Tracked job operations: {request.GetJobOperationsSummary(job)}", CadetConsoleMessageType.Log);

            bool success = true;
            bool hasDistPlan = DistExecutionPlanService.TryCreatePlan(
                job.RunUnityBuild,
                job.RunNotarizeMac,
                job.RunPublishSteam,
                job.RunPublishEpic,
                out DistExecutionPlanService.Plan plan);
            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} Tracked plan job='{job.JobGuid}' profile='{job.ProfileName}' hasPlan={hasDistPlan} " +
                $"build={job.RunUnityBuild} notarize={job.RunNotarizeMac} steam={job.RunPublishSteam} epic={job.RunPublishEpic}.");

            if (job.RunPublishEpic && string.IsNullOrEmpty(profile.epic?.buildPatchToolPath))
            {
                request.AppendOutput("[ERROR] Tracked job cannot publish to Epic: BuildPatchTool Path is required.", CadetConsoleMessageType.Error);
                return new ExecutionResult(false, false);
            }

            if (hasDistPlan)
            {
                job.StatusDetail = plan.StatusText;
                InvokeRepaint(request, job, "Tracked job entered dist execution phase");
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Tracked job launching dist operation job='{job.JobGuid}' " +
                    $"buildOnly={plan.BuildOnly} publishOnly={plan.PublishOnly} notarizeOnly={plan.NotarizeOnly} platform='{plan.Platform ?? "<none>"}'.");
                BuildOperationExecutionService.ExecutionResult operationResult = await request.ExecuteBuildOperation(profile, plan.BuildOnly, plan.PublishOnly, plan.NotarizeOnly, plan.Platform, job);
                success = operationResult.Success;
                WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(job.JobGuid);

                if (!success)
                {
                    HandleOperationFailure(request, job, plan, operationResult);
                }

                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Tracked dist result job='{job.JobGuid}' success={success} detached={operationResult.DetachedOperationActive} " +
                    $"exitCode={operationResult.ExitCode} error='{operationResult.ErrorMessage ?? string.Empty}' jobProcessId={job.ProcessId} jobStatus='{job.Status}' " +
                    $"workspaceActive={workspace?.IsOperationActive ?? false} workspacePid={workspace?.ActiveProcessId ?? 0} " +
                    $"workspaceStatus='{workspace?.LastBuildStatus.ToString() ?? "<missing>"}' detail='{workspace?.ActiveStatusDetail ?? string.Empty}'.");
                if (success && job.RunUnityBuild && !operationResult.DetachedOperationActive)
                {
                    request.OnBuildSucceeded();
                }

                if (operationResult.DetachedOperationActive)
                {
                    CadetFilteredLogger.Debug(
                        $"{DiagnosticsPrefix} Tracked job='{job.JobGuid}' returning after detached handoff with success={success}. " +
                        $"statusDetail='{job.StatusDetail ?? string.Empty}'.");
                    return new ExecutionResult(success, true);
                }
            }

            WorkspaceInfo activeWorkspace = WorkspaceOperationStateService.GetWorkspace(job.JobGuid);
            bool isJobStillActive = IsJobStillActive(request.IsTrackedJobActive, job.JobGuid, activeWorkspace);
            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} Tracked final active-check job='{job.JobGuid}' active={isJobStillActive} success={success} " +
                $"statusDetail='{job.StatusDetail ?? string.Empty}'.");

            if (!isJobStillActive)
            {
                if (success && ShouldTreatInactiveWorkspaceAsCompleted(activeWorkspace))
                {
                    CadetFilteredLogger.Debug(
                        $"{DiagnosticsPrefix} Tracked job='{job.JobGuid}' accepted completed inactive workspace state instead of treating it as cancellation.");
                    return new ExecutionResult(true, false);
                }

                job.StatusDetail = "Cancelled by user.";
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Tracked job='{job.JobGuid}' marked cancelled because active-check returned false.");
                return new ExecutionResult(false, false);
            }

            return new ExecutionResult(success, false);
        }

        private static void HandleOperationFailure(
            Request request,
            BuildJobDefinition job,
            DistExecutionPlanService.Plan plan,
            BuildOperationExecutionService.ExecutionResult operationResult)
        {
            if (operationResult.DetachedOperationActive)
            {
                return;
            }

            string operationLabel = GetOperationLabel(plan);
            string failureReason = $"{operationLabel} failed";
            if (operationResult.ExitCode != 0)
            {
                failureReason += $" with exit code {operationResult.ExitCode}";
            }

            if (!string.IsNullOrWhiteSpace(operationResult.ErrorMessage))
            {
                failureReason += $" - {operationResult.ErrorMessage}";
            }

            // Use generic failure reason so it normalizes to Completed with error, not Failed
            job.StatusDetail = BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(
                BuildTerminalOutcomePolicy.ReasonLogFailureMarker);
            request.AppendOutput($"[ERR] {failureReason}", CadetConsoleMessageType.Error);
            CadetFilteredLogger.Debug($"{DiagnosticsPrefix} {failureReason}");
        }

        private static string GetOperationLabel(DistExecutionPlanService.Plan plan)
        {
            if (plan == null)
            {
                return "Dist operation";
            }

            if (plan.NotarizeOnly)
            {
                return "Notarize operation";
            }

            if (plan.BuildOnly)
            {
                return "Build operation";
            }

            if (plan.PublishOnly)
            {
                return plan.Platform switch
                {
                    "steam" => "Steam publish operation",
                    "epic" => "Epic publish operation",
                    "both" => "Steam + Epic publish operation",
                    _ => "Publish operation"
                };
            }

            return "Build/publish operation";
        }

        private static bool IsJobStillActive(Func<string, bool> isTrackedJobActive, string jobGuid, WorkspaceInfo workspace)
        {
            bool managerStillTracksJob = isTrackedJobActive(jobGuid);
            if (workspace == null)
            {
                return managerStillTracksJob;
            }

            if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, DateTime.UtcNow))
            {
                return true;
            }

            if (WorkspaceShowsInactiveOrTerminalState(workspace))
            {
                return false;
            }

            return managerStillTracksJob;
        }

        private static bool WorkspaceShowsInactiveOrTerminalState(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return false;
            }

            if (IsTerminalStatus(workspace.LastBuildStatus))
            {
                return true;
            }

            if (workspace.IsOperationActive)
            {
                return false;
            }

            return workspace.ActiveProcessId > 0 ||
                   workspace.ActiveProcessStartedAtUtc.HasValue ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveStatusDetail) ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveLogPath) ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveStatusManifestPath) ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveStatusLaunchToken);
        }

        private static bool ShouldTreatInactiveWorkspaceAsCompleted(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return false;
            }

            if (workspace.LastBuildStatus == BuildJobStatus.Completed)
            {
                return true;
            }

            if (workspace.LastBuildStatus == BuildJobStatus.Cancelled || workspace.LastBuildStatus == BuildJobStatus.Failed)
            {
                return false;
            }

            if (workspace.LastExitCode.HasValue)
            {
                return workspace.LastExitCode.Value == 0;
            }

            return !string.IsNullOrWhiteSpace(workspace.LastCompletedOperationsSummary) ||
                   LooksLikeCompletedMessage(workspace.LastTerminalMessage) ||
                   LooksLikeCompletedMessage(workspace.LastOperationSummary);
        }

        private static bool LooksLikeCompletedMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return false;
            }

            string lower = message.ToLowerInvariant();
            return lower.Contains("completed successfully") ||
                   lower.Contains("build completed") ||
                   lower.Contains("all operations completed") ||
                   lower.Contains("completed:");
        }

        private static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }

        private static void ValidateRequest(Request request, BuildJobDefinition job)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (job == null) throw new ArgumentNullException(nameof(job));
            if (request.IsTrackedJobActive == null) throw new ArgumentNullException(nameof(request.IsTrackedJobActive));
            if (request.GetJobOperationsSummary == null) throw new ArgumentNullException(nameof(request.GetJobOperationsSummary));
            if (request.ExecuteBuildOperation == null) throw new ArgumentNullException(nameof(request.ExecuteBuildOperation));
            if (request.AppendOutput == null) throw new ArgumentNullException(nameof(request.AppendOutput));
            if (request.Repaint == null) throw new ArgumentNullException(nameof(request.Repaint));
            if (request.OnBuildSucceeded == null) throw new ArgumentNullException(nameof(request.OnBuildSucceeded));
        }

        private static void InvokeRepaint(Request request, BuildJobDefinition job, string reason)
        {
            // Debug log removed per request
            request.Repaint();
        }
    }
}
