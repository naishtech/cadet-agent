using System;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Publishes active build-operation status updates while keeping the job model and runtime tracking in sync.
    /// </summary>
    public sealed class BuildOperationStatusPublisherService
    {
        public BuildOperationStatusPublisherService(BuildJobDefinition activeJob)
        {
            ActiveJob = activeJob;
        }

        public BuildJobDefinition ActiveJob { get; }

        public string LastPublishedStatus { get; private set; }

        public static void RegisterActiveJobTracking(BuildJobDefinition activeJob)
        {
            if (activeJob == null)
            {
                return;
            }

            BuildStatusEventBus.RegisterJobEvent(
                activeJob.JobGuid,
                activeJob.OnStatusChanged,
                status =>
                {
                    activeJob.StatusDetail = status;

                    BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
                    if (runtimeState.ActiveJobGuid == activeJob.JobGuid)
                    {
                        runtimeState.ActiveStatusText = status;
                    }
                });
        }

        public void PublishIfChanged(string statusText)
        {
            if (ActiveJob == null || string.IsNullOrWhiteSpace(statusText))
            {
                return;
            }

#if CADET_LITE
            statusText = NormalizeLiteQueueStatus(statusText);
#endif

            if (string.Equals(LastPublishedStatus, statusText, StringComparison.Ordinal))
            {
                return;
            }

            LastPublishedStatus = statusText;
            ActiveJob.StatusDetail = statusText;

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            if (runtimeState.ActiveJobGuid == ActiveJob.JobGuid)
            {
                runtimeState.ActiveStatusText = statusText;
            }

            BuildStatusEventBus.PublishStatusChange(ActiveJob.JobGuid, statusText);
            WorkspaceOperationStateService.UpdateStatusDetail(ActiveJob.JobGuid, statusText);
        }

#if CADET_LITE
        private static string NormalizeLiteQueueStatus(string statusText)
        {
            if (string.IsNullOrWhiteSpace(statusText))
            {
                return statusText;
            }

            string lower = statusText.ToLowerInvariant();

            if (lower.Contains("checking workspace sync status") ||
                lower.Contains("preparing workspace synchronization"))
            {
                return "Pre-sync";
            }

            if (lower.Contains("synchronizing workspace files") ||
                lower.Contains("workspace out of sync") ||
                lower.Contains("target workspace missing") ||
                lower.Contains("workspace already synchronized") ||
                lower.Contains("workspace sync complete"))
            {
                return "Sync";
            }

            if (lower.Contains("executing unity build process") ||
                lower.Contains("unity batch mode build"))
            {
                return "Unity Build";
            }

            return statusText;
        }
#endif
    }
}
