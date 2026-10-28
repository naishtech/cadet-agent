using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueWorkspaceLookupCacheTests
    {
        [Test]
        public void GetWorkspaceInfo_UsesCachedEntryBeforeExpiry()
        {
            const string jobGuid = "job-1";
            var cache = new Dictionary<string, BuildQueueWorkspaceContextService.WorkspaceInfoCacheEntry>
            {
                [jobGuid] = new BuildQueueWorkspaceContextService.WorkspaceInfoCacheEntry(
                    new WorkspaceInfo { JobGuid = jobGuid, WorkspacePath = "F:/ws/a" },
                    expiresAt: 10d)
            };

            WorkspaceInfo result = BuildQueueWorkspaceContextService.GetWorkspaceInfo(
                jobGuid,
                cache,
                now: 5d,
                cacheSeconds: 1d);

            Assert.IsNotNull(result);
            Assert.AreEqual("F:/ws/a", result.WorkspacePath);
        }
    }
}
