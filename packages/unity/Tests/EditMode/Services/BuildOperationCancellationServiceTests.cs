using System;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.ViewModels;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOperationCancellationServiceTests
    {
        [Test]
        public void CancelConfirmed_WithActiveJob_CancelsJobWithoutRestartingProcessorState()
        {
            var queueManager = new BuildQueueManager();

            var job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunUnityBuild = true
            };
            queueManager.TrackActiveJob(job);

            var executionState = new BuildExecutionStateViewModel { IsRunning = true };
            var actionButtons = new ActionButtonsViewModel { IsRunning = true };
            var consoleOutput = new ConsoleOutputViewModel { UnityConsoleMirroringEnabled = true };
            var progressBar = new ProgressBarViewModel();

            int cleanupCalls = 0;

            BuildOperationCancellationService.CancelConfirmed(new BuildOperationCancellationService.Request
            {
                ExecutionState = executionState,
                ActionButtons = actionButtons,
                ConsoleOutput = consoleOutput,
                ProgressBar = progressBar,
                GetTrackedJob = guid => queueManager.GetJobByGuid(guid),
                CancelTrackedJob = guid => queueManager.CancelJob(guid),
                ActiveTrackedJobGuid = job.JobGuid,
                KeepConsoleMirroringAfterCompletion = false,
                CleanupActiveBuildProcess = () => cleanupCalls++
            });

            BuildJobDefinition cancelledJob = queueManager.GetJobByGuid(job.JobGuid);

            Assert.AreEqual(1, cleanupCalls);
            Assert.IsNotNull(cancelledJob);
            Assert.AreEqual(BuildJobStatus.Cancelled, cancelledJob.Status);
            Assert.AreEqual("Cancelled by user.", cancelledJob.StatusDetail);
            Assert.IsFalse(executionState.IsRunning);
            Assert.IsFalse(actionButtons.IsRunning);
            Assert.IsFalse(consoleOutput.UnityConsoleMirroringEnabled);
        }

        [Test]
        public void CancelConfirmed_WithoutActiveJob_StopsOperationWithoutProcessorRestart()
        {
            var executionState = new BuildExecutionStateViewModel { IsRunning = true };
            var actionButtons = new ActionButtonsViewModel { IsRunning = true };
            var consoleOutput = new ConsoleOutputViewModel { UnityConsoleMirroringEnabled = true };
            var progressBar = new ProgressBarViewModel();

            int cleanupCalls = 0;

            BuildOperationCancellationService.CancelConfirmed(new BuildOperationCancellationService.Request
            {
                ExecutionState = executionState,
                ActionButtons = actionButtons,
                ConsoleOutput = consoleOutput,
                ProgressBar = progressBar,
                GetTrackedJob = null,
                CancelTrackedJob = null,
                ActiveTrackedJobGuid = null,
                KeepConsoleMirroringAfterCompletion = true,
                CleanupActiveBuildProcess = () => cleanupCalls++
            });

            Assert.AreEqual(1, cleanupCalls);
            Assert.IsFalse(executionState.IsRunning);
            Assert.IsFalse(actionButtons.IsRunning);
            Assert.IsTrue(consoleOutput.UnityConsoleMirroringEnabled);
        }
    }
}
