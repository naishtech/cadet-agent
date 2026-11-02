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

    }
}
