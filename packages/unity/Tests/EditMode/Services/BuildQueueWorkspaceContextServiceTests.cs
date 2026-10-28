using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueWorkspaceContextServiceTests
    {
        [Test]
        public void ResolveDeleteTarget_UsesWorkspaceRecordAndBackfillsProfileGuid()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-1",
                ProfileGuid = "profile-guid"
            };

            WorkspaceInfo workspace = new WorkspaceInfo
            {
                JobGuid = "job-1",
                WorkspacePath = "F:/ws/path",
                ProfileGuid = ""
            };

            WorkspaceInfo result = BuildQueueWorkspaceContextService.ResolveDeleteTarget(
                job,
                _ => workspace,
                _ => null);

            Assert.AreEqual("F:/ws/path", result.WorkspacePath);
            Assert.AreEqual("profile-guid", result.ProfileGuid);
        }

        [Test]
        public void ResolveDeleteTarget_FallsBackToProfileProjectPath()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-2",
                ProfileGuid = "profile-guid",
                WorkspacePath = ""
            };

            BuildProfile profile = new BuildProfile
            {
                unity = new UnitySettings
                {
                    projectPath = "F:/fallback/project"
                }
            };

            WorkspaceInfo result = BuildQueueWorkspaceContextService.ResolveDeleteTarget(
                job,
                _ => null,
                _ => profile);

            Assert.IsNotNull(result);
            Assert.AreEqual("F:/fallback/project", result.WorkspacePath);
            Assert.AreEqual("job-2", result.JobGuid);
        }

        [Test]
        public void GetCachedWorkspaceHistoryJobs_UsesCacheBeforeExpiry()
        {
            var cacheState = new BuildQueueWorkspaceContextService.WorkspaceHistoryCacheState();
            int loads = 0;

            List<BuildJobDefinition> first = BuildQueueWorkspaceContextService.GetCachedWorkspaceHistoryJobs(
                cacheState,
                now: 1d,
                refreshIntervalSeconds: 10d,
                loadWorkspaceHistoryJobs: () =>
                {
                    loads++;
                    return new List<BuildJobDefinition>
                    {
                        new BuildJobDefinition("profile") { JobGuid = "job-1" }
                    };
                });

            List<BuildJobDefinition> second = BuildQueueWorkspaceContextService.GetCachedWorkspaceHistoryJobs(
                cacheState,
                now: 2d,
                refreshIntervalSeconds: 10d,
                loadWorkspaceHistoryJobs: () =>
                {
                    loads++;
                    return new List<BuildJobDefinition>();
                });

            Assert.AreEqual(1, loads);
            Assert.AreEqual(1, first.Count);
            Assert.AreEqual(1, second.Count);
        }

        [Test]
        public void LoadWorkspaceHistoryJobs_MapsWorkspaceToBuildJob()
        {
            WorkspaceRegistry registry = new WorkspaceRegistry
            {
                Workspaces = new List<WorkspaceInfo>
                {
                    new WorkspaceInfo
                    {
                        JobGuid = "job-10",
                        ProfileGuid = "profile-10",
                        ProfileName = "Release Profile",
                        WorkspacePath = "F:/ws",
                        LastBuildStatus = BuildJobStatus.Completed,
                        ActiveProcessId = 42,
                        LastOperationSummary = "summary"
                    }
                }
            };

            List<BuildJobDefinition> jobs = BuildQueueWorkspaceContextService.LoadWorkspaceHistoryJobs(
                () => registry,
                workspace => workspace.LastBuildStatus,
                workspace => workspace.LastOperationSummary);

            Assert.AreEqual(1, jobs.Count);
            Assert.AreEqual("job-10", jobs[0].JobGuid);
            Assert.AreEqual("Release Profile", jobs[0].ProfileName);
            Assert.AreEqual(BuildJobStatus.Completed, jobs[0].Status);
            Assert.AreEqual("summary", jobs[0].StatusDetail);
        }

        [Test]
        public void ExtractExecutedOperationsSummary_IgnoresSkippedOperations()
        {
            string result = BuildQueueWorkspaceContextService.ExtractExecutedOperationsSummary(
                "Running: Unity Build | Skipped: Git Sync, macOS Sign + Notarize, Publish Epic");

            Assert.AreEqual("Unity Build", result);
        }

        [Test]
        public void LoadWorkspaceHistoryJobs_ApplyOperationFlags_IgnoresSkippedOperations()
        {
            WorkspaceRegistry registry = new WorkspaceRegistry
            {
                Workspaces = new List<WorkspaceInfo>
                {
                    new WorkspaceInfo
                    {
                        JobGuid = "job-11",
                        ProfileGuid = "profile-11",
                        LastBuildStatus = BuildJobStatus.Completed,
                        LastOperationSummary = "Running: Unity Build | Skipped: Git Sync, macOS Sign + Notarize, Publish Epic"
                    }
                }
            };

            List<BuildJobDefinition> jobs = BuildQueueWorkspaceContextService.LoadWorkspaceHistoryJobs(
                () => registry,
                workspace => workspace.LastBuildStatus,
                workspace => workspace.LastOperationSummary);

            Assert.AreEqual(1, jobs.Count);
            Assert.IsTrue(jobs[0].RunUnityBuild);
            Assert.IsFalse(jobs[0].RunNotarizeMac);
            Assert.IsFalse(jobs[0].RunPublishEpic);
        }

        [Test]
        public void LoadWorkspaceHistoryJobs_CancelledWorkspaceWithSuccessEvidence_LoadsCompletedStatus()
        {
            WorkspaceRegistry registry = new WorkspaceRegistry
            {
                Workspaces = new List<WorkspaceInfo>
                {
                    new WorkspaceInfo
                    {
                        JobGuid = "job-12",
                        ProfileGuid = "profile-12",
                        LastBuildStatus = BuildJobStatus.Cancelled,
                        LastCompletedOperationsSummary = "Unity Build",
                        LastTerminalMessage = "Unity build completed successfully.",
                        LastExitCode = 0
                    }
                }
            };

            List<BuildJobDefinition> jobs = BuildQueueWorkspaceContextService.LoadWorkspaceHistoryJobs(
                () => registry,
                BuildQueueStatusTextService.NormalizeWorkspaceStatus,
                BuildQueueStatusTextService.GetWorkspaceStatusDetail);

            Assert.AreEqual(1, jobs.Count);
            Assert.AreEqual(BuildJobStatus.Completed, jobs[0].Status);
        }

        [Test]
        public void LoadWorkspaceHistoryJobs_CancelledWorkspaceWithInferredExitUnavailableAndBuildLog_LoadsCompletedStatus()
        {
            WorkspaceRegistry registry = new WorkspaceRegistry
            {
                Workspaces = new List<WorkspaceInfo>
                {
                    new WorkspaceInfo
                    {
                        JobGuid = "job-13",
                        ProfileGuid = "profile-13",
                        LastBuildStatus = BuildJobStatus.Cancelled,
                        CancelRequested = false,
                        LastTerminalMessage = BuildTerminalOutcomePolicy.BuildInferredDetail(BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable),
                        LastLogPath = "F:/unity/projects/test-cadet-lite/Logs/unity_build_windows.log"
                    }
                }
            };

            List<BuildJobDefinition> jobs = BuildQueueWorkspaceContextService.LoadWorkspaceHistoryJobs(
                () => registry,
                BuildQueueStatusTextService.NormalizeWorkspaceStatus,
                BuildQueueStatusTextService.GetWorkspaceStatusDetail);

            Assert.AreEqual(1, jobs.Count);
            Assert.AreEqual(BuildJobStatus.Completed, jobs[0].Status);
        }

        [Test]
        public void IsFolderInUseByActiveOperation_NullWorkspaceInfo_ReturnsFalse()
        {
            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(null);
            Assert.IsFalse(result);
        }

        [Test]
        public void IsFolderInUseByActiveOperation_EmptyWorkspacePath_ReturnsFalse()
        {
            WorkspaceInfo workspace = new WorkspaceInfo { JobGuid = "job-x", WorkspacePath = "" };
            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(workspace);
            Assert.IsFalse(result);
        }
    }
}
