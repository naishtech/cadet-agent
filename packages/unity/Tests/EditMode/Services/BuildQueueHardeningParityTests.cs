using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueHardeningParityTests
    {
        [Test]
        public void StatusText_TerminalJobWithRunningDetail_IgnoresStaleDetail()
        {
            var job = new BuildJobDefinition("profile")
            {
                Status = BuildJobStatus.Completed,
                RunUnityBuild = true,
                StatusDetail = "Running: Publish Epic"
            };

            string text = BuildQueueStatusTextService.GetJobActivityText(job);

            Assert.AreEqual("Operations: Unity Build", text);
        }

        [Test]
        public void ActionService_StaleCancelUnresolvable_ReturnsUnresolved()
        {
            var job = new BuildJobDefinition("profile")
            {
                JobGuid = "job-1"
            };

            BuildQueueActionService.StaleCancelResolution result = BuildQueueActionService.TryResolveStaleActiveJobAsCancelled(
                job,
                _ => new WorkspaceInfo { IsOperationActive = true, LastBuildStatus = BuildJobStatus.Building },
                workspace => workspace.LastBuildStatus,
                BuildQueueJobStateService.IsTerminalStatus,
                _ => string.Empty,
                (guid, status, detail) => false,
                _ => false);

            Assert.IsFalse(result.IsResolved);
        }

        [Test]
        public void WorkspaceHistoryCache_RefreshesAfterExpiry()
        {
            var cacheState = new BuildQueueWorkspaceContextService.WorkspaceHistoryCacheState();
            int loadCount = 0;

            List<BuildJobDefinition> first = BuildQueueWorkspaceContextService.GetCachedWorkspaceHistoryJobs(
                cacheState,
                now: 1d,
                refreshIntervalSeconds: 1d,
                loadWorkspaceHistoryJobs: () =>
                {
                    loadCount++;
                    return new List<BuildJobDefinition>
                    {
                        new BuildJobDefinition("profile") { JobGuid = "job-first" }
                    };
                });

            List<BuildJobDefinition> second = BuildQueueWorkspaceContextService.GetCachedWorkspaceHistoryJobs(
                cacheState,
                now: 2.1d,
                refreshIntervalSeconds: 1d,
                loadWorkspaceHistoryJobs: () =>
                {
                    loadCount++;
                    return new List<BuildJobDefinition>
                    {
                        new BuildJobDefinition("profile") { JobGuid = "job-second" }
                    };
                });

            Assert.AreEqual(2, loadCount);
            Assert.AreEqual("job-first", first[0].JobGuid);
            Assert.AreEqual("job-second", second[0].JobGuid);
        }
    }
}
