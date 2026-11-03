using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueLogRoutingServiceTests
    {
        [Test]
        public void ResolveLogRootPath_UsesActivePathWhenWorkspacePathMissing()
        {
            var workspace = new WorkspaceInfo
            {
                ActiveLogPath = "F:/logs/active/Logs/dist.log"
            };

            string root = BuildQueueLogRoutingService.ResolveLogRootPath(null, null, workspace);

            Assert.AreEqual("F:/logs/active", root.Replace('\\', '/'));
        }

        [Test]
        public void ResolveBuildLogPath_BuildLogTarget_ReturnsBuildLogPath()
        {
            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = "F:/logs/root"
            };

            string path = BuildQueueLogRoutingService.ResolveBuildLogPath(job, null, null);

            Assert.AreEqual("F:/logs/root/Logs/dist.log", path.Replace('\\', '/'));
        }

        [Test]
        public void GetUnityLogTargets_WithWindowsProfile_ReturnsWindowsTarget()
        {
            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = "F:/logs/root"
            };
            var profile = new BuildProfile
            {
                os = "windows"
            };

            var targets = BuildQueueLogRoutingService.GetUnityLogTargets(job, profile, null);

            Assert.AreEqual(1, targets.Count);
            Assert.AreEqual("Windows", targets[0].Label);
            Assert.AreEqual("F:/logs/root/Logs/unity_build_windows.log", targets[0].Path.Replace('\\', '/'));
        }
    }
}
