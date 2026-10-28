using System;
using System.IO;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.ViewModels;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.ViewModels
{
    [TestFixture]
    public class PlatformAvailabilityViewModelTests
    {
        private const string SteamExeKey = "CADET_SteamCmdExe";
        private const string SteamShKey = "CADET_SteamCmdSh";
        private const string BuildPatchToolKey = "CADET_BuildPatchToolPath";

        private string originalSteamExe;
        private string originalSteamSh;
        private string originalBuildPatchToolPath;

        private bool hadSteamExe;
        private bool hadSteamSh;
        private bool hadBuildPatchTool;

        private string tempRoot;

        [SetUp]
        public void SetUp()
        {
            hadSteamExe = EditorPrefs.HasKey(SteamExeKey);
            hadSteamSh = EditorPrefs.HasKey(SteamShKey);
            hadBuildPatchTool = EditorPrefs.HasKey(BuildPatchToolKey);

            originalSteamExe = EditorPrefs.GetString(SteamExeKey, string.Empty);
            originalSteamSh = EditorPrefs.GetString(SteamShKey, string.Empty);
            originalBuildPatchToolPath = EditorPrefs.GetString(BuildPatchToolKey, string.Empty);

            tempRoot = Path.Combine(Path.GetTempPath(), "cadet-platform-vm-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);
        }

        [TearDown]
        public void TearDown()
        {
            if (hadSteamExe)
            {
                EditorPrefs.SetString(SteamExeKey, originalSteamExe);
            }
            else
            {
                EditorPrefs.DeleteKey(SteamExeKey);
            }

            if (hadSteamSh)
            {
                EditorPrefs.SetString(SteamShKey, originalSteamSh);
            }
            else
            {
                EditorPrefs.DeleteKey(SteamShKey);
            }

            if (hadBuildPatchTool)
            {
                EditorPrefs.SetString(BuildPatchToolKey, originalBuildPatchToolPath);
            }
            else
            {
                EditorPrefs.DeleteKey(BuildPatchToolKey);
            }

            if (!string.IsNullOrEmpty(tempRoot) && Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, true);
            }
        }

        [Test]
        public void Evaluate_NullProfile_ReturnsSafeDefaults()
        {
            var vm = new PlatformAvailabilityViewModel();

            var state = vm.Evaluate(null);

            Assert.IsFalse(state.SteamPlatformSelected);
            Assert.IsFalse(state.EpicPlatformSelected);
            Assert.IsFalse(state.SteamToolsConfigured);
            Assert.IsFalse(state.EpicToolsConfigured);
            Assert.IsFalse(state.WindowsBuildExists);
            Assert.IsFalse(state.MacosBuildExists);
            Assert.AreEqual(string.Empty, state.MissingBuildsMessage);
            Assert.IsFalse(state.AllRequiredBuildsExist);
        }

        [Test]
        public void Evaluate_SteamProfile_MarksSteamPlatformSelected()
        {
            var vm = new PlatformAvailabilityViewModel();
            var profile = new BuildProfile
            {
                platform = "steam",
                os = "windows"
            };

            var state = vm.Evaluate(profile);

            Assert.IsTrue(state.SteamPlatformSelected);
            Assert.IsFalse(state.EpicPlatformSelected);
        }

        [Test]
        public void Evaluate_EpicProfile_MarksEpicPlatformSelected()
        {
            var vm = new PlatformAvailabilityViewModel();
            var profile = new BuildProfile
            {
                platform = "epic",
                os = "windows"
            };

            var state = vm.Evaluate(profile);

            Assert.IsFalse(state.SteamPlatformSelected);
            Assert.IsTrue(state.EpicPlatformSelected);
        }

        [Test]
        public void Evaluate_SteamBothOs_WithEditorPrefsTools_MarksSteamToolsConfigured()
        {
            string steamExe = Path.Combine(tempRoot, "steamcmd.exe");
            string steamSh = Path.Combine(tempRoot, "steamcmd.sh");
            File.WriteAllText(steamExe, string.Empty);
            File.WriteAllText(steamSh, string.Empty);

            EditorPrefs.SetString(SteamExeKey, steamExe);
            EditorPrefs.SetString(SteamShKey, steamSh);

            var vm = new PlatformAvailabilityViewModel();
            var profile = new BuildProfile
            {
                platform = "steam",
                os = "both"
            };

            var state = vm.Evaluate(profile);

            Assert.IsTrue(state.SteamToolsConfigured);
        }

        [Test]
        public void Evaluate_EpicProfile_WithEditorPrefsBuildPatchTool_MarksEpicToolsConfigured()
        {
            string binaryPath;
            var profile = new BuildProfile
            {
                platform = "epic"
            };

            switch (Application.platform)
            {
                case RuntimePlatform.WindowsEditor:
                    profile.os = "windows";
                    binaryPath = Path.Combine(tempRoot, "Engine", "Binaries", "Win64", "BuildPatchTool.exe");
                    break;
                case RuntimePlatform.OSXEditor:
                    profile.os = "mac";
                    binaryPath = Path.Combine(tempRoot, "Engine", "Binaries", "Mac", "BuildPatchTool");
                    break;
                default:
                    profile.os = "linux";
                    binaryPath = Path.Combine(tempRoot, "Engine", "Binaries", "Linux", "BuildPatchTool");
                    break;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(binaryPath));
            File.WriteAllText(binaryPath, string.Empty);
            EditorPrefs.SetString(BuildPatchToolKey, tempRoot);

            var vm = new PlatformAvailabilityViewModel();
            var state = vm.Evaluate(profile);

            Assert.IsTrue(state.EpicToolsConfigured);
        }
    }
}
