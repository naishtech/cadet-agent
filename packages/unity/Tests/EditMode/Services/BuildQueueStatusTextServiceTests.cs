using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueStatusTextServiceTests
    {
        [Test]
        public void GetJobActivityText_TerminalJobWithStaleRunningDetail_UsesTerminalText()
        {
            var job = new BuildJobDefinition("profile-guid")
            {
                Status = BuildJobStatus.Completed,
                RunUnityBuild = true,
                StatusDetail = "Running: Publish Epic"
            };

            string text = BuildQueueStatusTextService.GetJobActivityText(job);

            Assert.AreEqual("Operations: Unity Build", text);
        }

        [Test]
        public void GetRowStatusLabel_FailedJob_ReturnsFailed()
        {
            var job = new BuildJobDefinition("profile-guid")
            {
                Status = BuildJobStatus.Failed,
                StatusDetail = "Build failed."
            };

            string text = BuildQueueStatusTextService.GetRowStatusLabel(job);

            Assert.AreEqual("Failed", text);
        }

        [Test]
        public void GetOperationsText_WithWorkspaceSummary_PrefersObservedOperations()
        {
            var job = new BuildJobDefinition("profile-guid")
            {
                RunUnityBuild = true
            };

            var workspace = new WorkspaceInfo
            {
                LastCompletedOperationsSummary = "Completed: Unity Build, Publish Steam"
            };

            string text = BuildQueueStatusTextService.GetOperationsText(job, workspace);

            Assert.AreEqual("Operations: Unity Build, Publish Steam", text);
        }

        [Test]
        public void GetOperationsText_WithoutHistory_UsesNeutralPendingFallback()
        {
            var job = new BuildJobDefinition("profile-guid");

            string text = BuildQueueStatusTextService.GetOperationsText(job);

            Assert.AreEqual(BuildQueueStatusTextService.PendingOperationsText, text);
        }

        [Test]
        public void GetOperationsText_CompletedWorkspaceWithBuildEvidence_InfersUnityBuild()
        {
            var job = new BuildJobDefinition("profile-guid");
            var workspace = new WorkspaceInfo
            {
                LastBuildStatus = BuildJobStatus.Completed,
                LastTerminalMessage = "Unity build completed successfully.",
                LastLogPath = "F:/ws/Logs/unity_build_windows.log"
            };

            string text = BuildQueueStatusTextService.GetOperationsText(job, workspace);

            Assert.AreEqual("Operations: Unity Build", text);
        }

        [Test]
        public void GetWorkspaceStatusDetail_CompletedWorkspace_PrefersCompletedSummary()
        {
            var workspace = new WorkspaceInfo
            {
                LastBuildStatus = BuildJobStatus.Completed,
                LastCompletedOperationsSummary = "Git Sync, Unity Build, Publish Steam"
            };

            string detail = BuildQueueStatusTextService.GetWorkspaceStatusDetail(workspace);

            Assert.AreEqual("Git Sync, Unity Build, Publish Steam", detail);
        }

#if !CADET_LITE
        [Test]
        public void NormalizeWorkspaceStatus_PublishingInactiveWithSuccessEvidence_ReturnsCompleted()
        {
            var workspace = new WorkspaceInfo
            {
                LastBuildStatus = BuildJobStatus.Publishing,
                IsOperationActive = false,
                LastOperationSummary = "All operations completed successfully"
            };

            BuildJobStatus status = BuildQueueStatusTextService.NormalizeWorkspaceStatus(workspace);

            Assert.AreEqual(BuildJobStatus.Completed, status);
        }
#endif
    }
}
