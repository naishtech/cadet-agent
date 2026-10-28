using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueActionServiceTests
    {
        [Test]
        public void EvaluateDeleteAllCandidates_FiltersToDeletableJobs()
        {
            var jobs = new List<BuildJobDefinition>
            {
                new BuildJobDefinition("p") { JobGuid = "job-1" },
                new BuildJobDefinition("p") { JobGuid = "job-2" }
            };

            BuildQueueActionService.DeleteAllEvaluation evaluation = BuildQueueActionService.EvaluateDeleteAllCandidates(
                jobs,
                job => job.JobGuid == "job-1",
                job => new WorkspaceInfo { WorkspacePath = "F:/ws" },
                _ => true);

            Assert.AreEqual(1, evaluation.DeletableJobs.Count);
            Assert.AreEqual("job-1", evaluation.DeletableJobs[0].JobGuid);
            Assert.AreEqual(1, evaluation.JobsWithFolderDeleteAvailable);
        }

        [Test]
        public void ExecuteDeleteAll_DeletesAndCountsFolderDeletes()
        {
            var jobs = new List<BuildJobDefinition>
            {
                new BuildJobDefinition("p") { JobGuid = "job-1" },
                new BuildJobDefinition("p") { JobGuid = "job-2" }
            };

            BuildQueueActionService.DeleteAllExecutionResult result = BuildQueueActionService.ExecuteDeleteAll(
                jobs,
                deleteFoldersWhenAllowed: true,
                resolveDeleteTarget: job => new WorkspaceInfo { JobGuid = job.JobGuid, WorkspacePath = "F:/ws", ProfileGuid = "profile" },
                canDeleteProjectFolder: workspace => workspace.JobGuid == "job-1",
                deleteJobEntry: (jobGuid, deleteFolder, workspacePath, profileGuid) => true);

            Assert.AreEqual(2, result.RemovedCount);
            Assert.AreEqual(1, result.RemovedWithFolderCount);
        }

        [Test]
        public void TryOpenBuildOutputDirectory_EmptyDirectory_ReturnsFalseWithError()
        {
            bool result = BuildQueueActionService.TryOpenBuildOutputDirectory(
                "",
                openDirectoryDirectly: true,
                openPath: _ => { },
                revealPath: _ => { },
                out string error);

            Assert.IsFalse(result);
            StringAssert.Contains("Could not resolve a valid build output directory", error);
        }

        [Test]
        public void TryOpenBuildOutputDirectory_DirectOpen_UsesOpenPath()
        {
            string openedPath = null;
            string revealedPath = null;

            bool result = BuildQueueActionService.TryOpenBuildOutputDirectory(
                "F:/builds/job-1",
                openDirectoryDirectly: true,
                openPath: path => openedPath = path,
                revealPath: path => revealedPath = path,
                out string error);

            Assert.IsTrue(result);
            Assert.IsNull(error);
            Assert.AreEqual("F:/builds/job-1", openedPath);
            Assert.IsNull(revealedPath);
        }

        [Test]
        public void TryOpenBuildOutputDirectory_RevealOnly_UsesRevealPath()
        {
            string openedPath = null;
            string revealedPath = null;

            bool result = BuildQueueActionService.TryOpenBuildOutputDirectory(
                "F:/builds/job-2",
                openDirectoryDirectly: false,
                openPath: path => openedPath = path,
                revealPath: path => revealedPath = path,
                out string error);

            Assert.IsTrue(result);
            Assert.IsNull(error);
            Assert.IsNull(openedPath);
            Assert.AreEqual("F:/builds/job-2", revealedPath);
        }

        [Test]
        public void TryCancelDetachedActiveJob_SuccessfulDetachedCancel_CancelsQueueWhenPresent()
        {
            BuildJobDefinition job = new BuildJobDefinition("p") { JobGuid = "job-1" };
            int queueCancelCalls = 0;

            bool result = BuildQueueActionService.TryCancelDetachedActiveJob(
                job,
                _ => true,
                _ => true,
                _ =>
                {
                    queueCancelCalls++;
                    return true;
                });

            Assert.IsTrue(result);
            Assert.AreEqual(1, queueCancelCalls);
        }

        [Test]
        public void TryResolveStaleActiveJobAsCancelled_InactiveWorkspace_MarksTerminal()
        {
            BuildJobDefinition job = new BuildJobDefinition("p") { JobGuid = "job-1" };
            WorkspaceInfo workspace = new WorkspaceInfo
            {
                JobGuid = "job-1",
                IsOperationActive = false,
                LastBuildStatus = BuildJobStatus.Completed
            };

            BuildQueueActionService.StaleCancelResolution result = BuildQueueActionService.TryResolveStaleActiveJobAsCancelled(
                job,
                _ => workspace,
                w => w.LastBuildStatus,
                BuildQueueJobStateService.IsTerminalStatus,
                _ => "All operations completed successfully",
                (guid, status, detail) => status == BuildJobStatus.Completed,
                _ => false);

            Assert.IsTrue(result.IsResolved);
            Assert.AreEqual(BuildJobStatus.Completed, result.FinalStatus);
            Assert.AreEqual("Resolve stale active job", result.RepaintReason);
        }

        [Test]
        public void TryResolveStaleActiveJobAsCancelled_FallbackCancelQueue_ReturnsCancelledResolution()
        {
            BuildJobDefinition job = new BuildJobDefinition("p") { JobGuid = "job-2" };

            BuildQueueActionService.StaleCancelResolution result = BuildQueueActionService.TryResolveStaleActiveJobAsCancelled(
                job,
                _ => null,
                _ => BuildJobStatus.Building,
                BuildQueueJobStateService.IsTerminalStatus,
                _ => string.Empty,
                (guid, status, detail) => false,
                _ => true);

            Assert.IsTrue(result.IsResolved);
            Assert.AreEqual(BuildJobStatus.Cancelled, result.FinalStatus);
            Assert.AreEqual("Cancel stale queue job", result.RepaintReason);
        }

        [Test]
        public void BuildDeleteJobPrompt_WhenFolderDeleteAvailable_UsesFolderWarningMessage()
        {
            BuildJobDefinition job = new BuildJobDefinition("p") { JobGuid = "job-100" };
            WorkspaceInfo workspace = new WorkspaceInfo { WorkspacePath = "F:/ws/path" };

            BuildQueueActionService.DeleteJobPrompt prompt = BuildQueueActionService.BuildDeleteJobPrompt(job, workspace, true);

            Assert.IsTrue(prompt.CanDeleteProjectFolder);
            StringAssert.Contains("Target project folder", prompt.Message);
            StringAssert.Contains("F:/ws/path", prompt.Message);
        }

        [Test]
        public void TryResolveDeleteJobSelection_DeleteJobOnlyChoice_ReturnsTrueWithoutFolderDelete()
        {
            // Button 0 is "Delete Job Only" (the default/first button)
            bool resolved = BuildQueueActionService.TryResolveDeleteJobSelection(
                canDeleteProjectFolder: false,
                complexChoice: 0,
                simpleConfirmed: null,
                out bool deleteProjectFolder);

            Assert.IsTrue(resolved);
            Assert.IsFalse(deleteProjectFolder);
        }

        [Test]
        public void TryResolveDeleteJobSelection_DeleteJobAndFolderChoice_ReturnsTrueAndDeletesFolder()
        {
            // Button 1 is "Delete Job + Folder" (the second button)
            bool resolved = BuildQueueActionService.TryResolveDeleteJobSelection(
                canDeleteProjectFolder: false,
                complexChoice: 1,
                simpleConfirmed: null,
                out bool deleteProjectFolder);

            Assert.IsTrue(resolved);
            Assert.IsTrue(deleteProjectFolder);
        }

        [Test]
        public void TryResolveDeleteJobSelection_CancelChoice_ReturnsFalse()
        {
            // Button 2 is "Cancel"
            bool resolved = BuildQueueActionService.TryResolveDeleteJobSelection(
                canDeleteProjectFolder: false,
                complexChoice: 2,
                simpleConfirmed: null,
                out bool deleteProjectFolder);

            Assert.IsFalse(resolved);
            Assert.IsFalse(deleteProjectFolder);
        }

        [Test]
        public void ExecuteDeleteJob_ValidInput_InvokesDeleteDelegate()
        {
            BuildJobDefinition job = new BuildJobDefinition("p") { JobGuid = "job-x" };
            WorkspaceInfo workspace = new WorkspaceInfo { WorkspacePath = "F:/ws", ProfileGuid = "profile" };
            int calls = 0;

            bool result = BuildQueueActionService.ExecuteDeleteJob(
                job,
                deleteProjectFolder: false,
                workspace,
                (jobGuid, deleteFolder, workspacePath, profileGuid) =>
                {
                    calls++;
                    return jobGuid == "job-x" && workspacePath == "F:/ws";
                });

            Assert.IsTrue(result);
            Assert.AreEqual(1, calls);
        }

        [Test]
        public void BuildDeleteJobPrompt_WhenFolderDeleteUnavailable_StillMentionsDeleteJobAndFolderOption()
        {
            BuildJobDefinition job = new BuildJobDefinition("p") { JobGuid = "job-101" };
            WorkspaceInfo workspace = new WorkspaceInfo { WorkspacePath = "F:/ws/path" };

            BuildQueueActionService.DeleteJobPrompt prompt = BuildQueueActionService.BuildDeleteJobPrompt(job, workspace, false);

            Assert.IsFalse(prompt.CanDeleteProjectFolder);
            StringAssert.Contains("Delete Job + Folder", prompt.Message);
            StringAssert.Contains("workspace safety checks", prompt.Message);
        }
    }
}
