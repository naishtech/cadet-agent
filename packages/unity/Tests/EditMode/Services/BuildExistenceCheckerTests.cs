using System;
using System.IO;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildExistenceCheckerTests
    {
        private string tempRoot;

        [SetUp]
        public void SetUp()
        {
            tempRoot = Path.Combine(Path.GetTempPath(), "cadet-build-existence-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);
        }

        [TearDown]
        public void TearDown()
        {
            if (!string.IsNullOrEmpty(tempRoot) && Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, true);
            }
        }

        [Test]
        public void CheckBuildsExist_WindowsBuildInBinFolder_ReturnsWindowsExists()
        {
            var profile = CreateWindowsProfile(tempRoot, "MyGame");
            string windowsDir = Path.Combine(tempRoot, "Bin", "windows");
            Directory.CreateDirectory(windowsDir);
            File.WriteAllText(Path.Combine(windowsDir, "MyGame.exe"), string.Empty);

            (bool windowsExists, bool macosExists) = BuildExistenceChecker.CheckBuildsExist(profile);

            Assert.IsTrue(windowsExists);
            Assert.IsFalse(macosExists);
        }

        [Test]
        public void CheckBuildsExist_WindowsBuildInRootFolder_ReturnsWindowsExists()
        {
            var profile = CreateWindowsProfile(tempRoot, "MyGame");
            string windowsDir = Path.Combine(tempRoot, "windows");
            Directory.CreateDirectory(windowsDir);
            File.WriteAllText(Path.Combine(windowsDir, "MyGame.exe"), string.Empty);

            (bool windowsExists, bool macosExists) = BuildExistenceChecker.CheckBuildsExist(profile);

            Assert.IsTrue(windowsExists);
            Assert.IsFalse(macosExists);
        }

        [Test]
        public void CheckBuildsExist_MacosBuildInRootFolder_ReturnsMacosExists()
        {
            var profile = new BuildProfile
            {
                os = "macos",
                unity = new UnitySettings
                {
                    buildOutputPath = tempRoot,
                    projectName = "MyGame"
                }
            };

            string appDir = Path.Combine(tempRoot, "macos", "MyGame.app");
            Directory.CreateDirectory(appDir);

            (bool windowsExists, bool macosExists) = BuildExistenceChecker.CheckBuildsExist(profile);

            Assert.IsFalse(windowsExists);
            Assert.IsTrue(macosExists);
        }

        private static BuildProfile CreateWindowsProfile(string buildOutputPath, string projectName)
        {
            return new BuildProfile
            {
                os = "windows",
                unity = new UnitySettings
                {
                    buildOutputPath = buildOutputPath,
                    projectName = projectName
                }
            };
        }
    }
}
