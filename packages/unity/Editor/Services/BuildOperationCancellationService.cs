using System;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.ViewModels;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Handles confirmed cancellation flow for active build and tracked execution operations.
    /// </summary>
    public static class BuildOperationCancellationService
    {
        public sealed class Request
        {
            public BuildExecutionStateViewModel ExecutionState { get; set; }
            public ActionButtonsViewModel ActionButtons { get; set; }
            public ConsoleOutputViewModel ConsoleOutput { get; set; }
            public ProgressBarViewModel ProgressBar { get; set; }
            public Func<string, BuildJobDefinition> GetTrackedJob { get; set; }
            public Func<string, bool> CancelTrackedJob { get; set; }
            public string ActiveTrackedJobGuid { get; set; }
            public bool KeepConsoleMirroringAfterCompletion { get; set; }
            public Action CleanupActiveBuildProcess { get; set; }
        }

        public static void CancelConfirmed(Request request)
        {
            ValidateRequest(request);

            BuildOperationExecutionService.RequestCancellation();

            request.CleanupActiveBuildProcess();

            if (!string.IsNullOrWhiteSpace(request.ActiveTrackedJobGuid))
            {
                BuildJobDefinition activeJob = request.GetTrackedJob?.Invoke(request.ActiveTrackedJobGuid);
                if (activeJob != null)
                {
                    activeJob.StatusDetail = "Cancelled by user.";
                }

                bool cancelledTrackedJob = request.CancelTrackedJob?.Invoke(request.ActiveTrackedJobGuid) ?? false;
                if (!cancelledTrackedJob)
                {
                    WorkspaceOperationStateService.MarkTerminal(request.ActiveTrackedJobGuid, BuildJobStatus.Cancelled, "Cancelled by user.");
                }
            }

            request.ProgressBar.Stop();
            request.ConsoleOutput.AppendLine("[WARN] Operation cancelled by user", CadetConsoleMessageType.Warning);
            request.ExecutionState.CompleteOperation(
                request.ActionButtons,
                request.ConsoleOutput,
                keepConsoleMirroring: request.KeepConsoleMirroringAfterCompletion);
        }

        private static void ValidateRequest(Request request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.ExecutionState == null) throw new ArgumentNullException(nameof(request.ExecutionState));
            if (request.ActionButtons == null) throw new ArgumentNullException(nameof(request.ActionButtons));
            if (request.ConsoleOutput == null) throw new ArgumentNullException(nameof(request.ConsoleOutput));
            if (request.ProgressBar == null) throw new ArgumentNullException(nameof(request.ProgressBar));
            if (request.CleanupActiveBuildProcess == null) throw new ArgumentNullException(nameof(request.CleanupActiveBuildProcess));
        }
    }
}
