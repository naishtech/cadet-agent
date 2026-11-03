using System.IO;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildPathResolverTests
    {
        [Test]
        public void ToUnixPath_WindowsDrivePath_ConvertsToUnixStyle()
        {
            string result = BuildPathResolver.ToUnixPath("F:\\unity\\projects\\cadet");

            Assert.AreEqual("/f/unity/projects/cadet", result);
        }

        [Test]
        public void MakeRelativeToProject_PathUnderProject_ReturnsRelativePath()
        {
            string absolute = "F:/unity/projects/cadet/cadet-unity/Assets/Covyne/Cadet";
            string projectRoot = "F:/unity/projects/cadet/cadet-unity";

            string result = BuildPathResolver.MakeRelativeToProject(absolute, projectRoot);

            Assert.AreEqual("Assets/Covyne/Cadet", result);
        }

        [Test]
        public void MakeRelativeToProject_PathOutsideProject_ReturnsUnixAbsolutePath()
        {
            string absolute = "E:/tools/custom/file.txt";
            string projectRoot = "F:/unity/projects/cadet/cadet-unity";

            string result = BuildPathResolver.MakeRelativeToProject(absolute, projectRoot);

            Assert.AreEqual("/e/tools/custom/file.txt", result);
        }

        [Test]
        public void GetUnityLogFilePaths_BothOs_ReturnsWindowsAndMacPaths()
        {
            var profile = new BuildProfile();
            profile.os = "both";
            profile.unity.projectPath = Path.Combine("F:", "unity", "projects", "cadet-sync");

            var paths = BuildPathResolver.GetUnityLogFilePaths(profile);

            Assert.AreEqual(2, paths.Count);
            StringAssert.StartsWith(profile.unity.projectPath, paths[0]);
            StringAssert.StartsWith(profile.unity.projectPath, paths[1]);
            StringAssert.EndsWith(Path.Combine("Logs", "unity_build_windows.log"), paths[0]);
            StringAssert.EndsWith(Path.Combine("Logs", "unity_build_macos.log"), paths[1]);
        }

        [Test]
        public void GetUnityLogFilePaths_MissingProjectPath_ReturnsEmptyList()
        {
            var profile = new BuildProfile();
            profile.unity.projectPath = string.Empty;

            var paths = BuildPathResolver.GetUnityLogFilePaths(profile);

            Assert.AreEqual(0, paths.Count);
        }
    }
}
