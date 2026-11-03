using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Utilities;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;
using System;
using System.IO;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class UnityBuildServiceTests
    {
        [Test]
        public void SanitizeFileName_NullOrEmpty_ReturnsDefault()
        {
            Assert.AreEqual("profile", UnityBuildService.SanitizeFileName(null));
            Assert.AreEqual("profile", UnityBuildService.SanitizeFileName(""));
            Assert.AreEqual("profile", UnityBuildService.SanitizeFileName("   "));
        }

        [Test]
        public void SanitizeFileName_ValidName_ReturnsUnchanged()
        {
            string result = UnityBuildService.SanitizeFileName("MyProfile");
            Assert.AreEqual("MyProfile", result);
        }

        [Test]
        public void SanitizeFileName_InvalidChars_AreReplacedWithUnderscores()
        {
            // Colon and forward-slash are invalid on Windows file names
            string result = UnityBuildService.SanitizeFileName("My:Profile/Test");
            StringAssert.DoesNotContain(":", result);
            StringAssert.DoesNotContain("/", result);
            StringAssert.StartsWith("My", result);
        }

        [Test]
        public void ResolveProfileGuid_ExplicitResolvedGuid_WinsWithoutAssetLookup()
        {
            string result = UnityBuildService.ResolveProfileGuid(
                profile: new BuildProfile { profileName = "Ignored" },
                activeJob: null,
                resolvedProfileGuid: " explicit-guid ");

            Assert.AreEqual("explicit-guid", result);
        }

        [Test]
        public void IsBuildInProgressForProfile_EmptyGuid_ReturnsFalse()
        {
            // An empty GUID should never report a build as in-progress
            bool result = UnityBuildService.IsBuildInProgressForProfile(string.Empty);
            Assert.IsFalse(result);
        }

        [Test]
        public void IsBuildInProgressForProfile_NullGuid_ReturnsFalse()
        {
            bool result = UnityBuildService.IsBuildInProgressForProfile(null);
            Assert.IsFalse(result);
        }

        [Test]
        public void IsBuildInProgressForProfile_MatchesProfileGuid_CaseInsensitively_WhenWorkspaceHasVerifiedActiveEvidence()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);
                workspaceManager.CreateWorkspace("job-guid", "PROFILE-GUID", "profile.json");
                workspaceManager.UpdateBuildStatus("job-guid", Covyne.CADET.Editor.Lite.Models.BuildJobStatus.Building);
                workspaceManager.UpdateOperationState(
                    "job-guid",
                    isActive: true,
                    processId: 123,
                    processStartUtc: DateTime.UtcNow,
                    statusDetail: "Detached build starting.",
                    logPath: Path.Combine(tempRoot, "dist.log"));

                bool result = UnityBuildService.IsBuildInProgressForProfile(" profile-guid ");

                Assert.IsTrue(result);
            }
            finally
            {
                Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void IsBuildInProgressForProfile_StaleNonTerminalWorkspace_DoesNotBlockRequeue()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);
                workspaceManager.CreateWorkspace("job-guid-stale", "PROFILE-GUID-STALE", "profile.json");
                workspaceManager.UpdateBuildStatus("job-guid-stale", Covyne.CADET.Editor.Lite.Models.BuildJobStatus.Building);
                workspaceManager.UpdateOperationState(
                    "job-guid-stale",
                    isActive: false,
                    processId: 0,
                    processStartUtc: null,
                    statusDetail: "Build in progress.",
                    logPath: Path.Combine(tempRoot, "dist.log"));

                bool result = UnityBuildService.IsBuildInProgressForProfile(" profile-guid-stale ");

                Assert.IsFalse(result);
            }
            finally
            {
                Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void Execute_WithMissingEditorPath_DoesNotCallTracker()
        {
            // Arrange: profile with empty editorPath triggers early-exit before process.Start
            var tracker = new ActiveBuildProcessTracker();
            var profile = new BuildProfile(); // unity.editorPath defaults to ""

            // Act
            BuildResult result = UnityBuildService.Execute(profile, processTracker: tracker);

            // Assert: process never started, so tracker should still be empty
            Assert.IsFalse(result.Success);
            Assert.IsNull(tracker.ActiveProcess);
        }
    }
}
