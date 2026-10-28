using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;
using System;
using System.IO;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueArtifactResolverServiceTests
    {
        [Test]
        public void IsNonUnityOutputRun_DownstreamOnlyJob_ReturnsTrue()
        {
            var job = new BuildJobDefinition("profile-guid")
            {
                RunUnityBuild = false,
                RunPublishSteam = true,
                RunPublishEpic = false,
                RunNotarizeMac = false
            };

            Assert.IsTrue(BuildQueueArtifactResolverService.IsNonUnityOutputRun(job));
        }

        [Test]
        public void ResolveExpectedBuildArtifactPath_WindowsProfile_ReturnsExpectedArtifactPath()
        {
            var profile = new BuildProfile
            {
                os = "windows",
                unity = new UnitySettings
                {
                    buildOutputPath = "Builds",
                    projectName = "TestGame"
                }
            };

            string path = BuildQueueArtifactResolverService.ResolveExpectedBuildArtifactPath(profile);

            StringAssert.EndsWith("Builds/Bin/windows/TestGame.exe", path.Replace('\\', '/'));
        }

        [Test]
        public void TryResolveOpenableBuildOutputDirectory_UsesWorkspacePathForRelativeOutput()
        {
            string tempRoot = Path.Combine(Path.GetTempPath(), $"cadet-build-folder-{Guid.NewGuid():N}");
            string workspacePath = Path.Combine(tempRoot, "WorkspaceProject");
            string outputRoot = Path.Combine(workspacePath, "Builds");
            string artifactDirectory = Path.Combine(outputRoot, "Bin", "windows");
            Directory.CreateDirectory(artifactDirectory);
            File.WriteAllText(Path.Combine(artifactDirectory, "TestGame.exe"), string.Empty);

            try
            {
                var job = new BuildJobDefinition("profile-guid")
                {
                    WorkspacePath = workspacePath,
                    RunUnityBuild = true,
                    Status = BuildJobStatus.Completed
                };

                var profile = new BuildProfile
                {
                    os = "windows",
                    unity = new UnitySettings
                    {
                        buildOutputPath = "Builds",
                        projectName = "TestGame"
                    }
                };

                bool resolved = BuildQueueArtifactResolverService.TryResolveOpenableBuildOutputDirectory(job, profile, out string directory);

                Assert.IsTrue(resolved);
                Assert.AreEqual(Path.GetFullPath(outputRoot), directory);
            }
            finally
            {
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }
    }
}
