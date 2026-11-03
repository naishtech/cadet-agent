using System;
using System.Collections.Generic;
using NUnit.Framework;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Tests.Utilities;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// TDD Phase A tests for BuildSyncOrchestratorService.
    /// Tests are written red-first against the contract defined in Phase 2.
    /// They will pass once Phase 3 (implementation) is complete.
    ///
    /// Exit criteria covered:
    /// - Canonical status codes are emitted in order for directory sync.
    /// - Canonical status codes are emitted in order for git sync.
    /// - Sync failure stops build launch and reports SYNC_FAILED.
    /// - Same-project-path guard hard-fails before any sync runs.
    /// - Corrupted profile with both modes enabled fails fast (n/a: single flag
    ///   model means this path cannot arise; test documents the invariant).
    /// - Null request and missing profile throw ArgumentNullException.
    /// </summary>
    [TestFixture]
    public class BuildSyncOrchestratorServiceTests
    {
        private BuildProfile _profile;

        [SetUp]
        public void Setup()
        {
            BuildStatusEventBus.SetUseDelayCall(false);

            _profile = new BuildProfile
            {
                profileName = "test-profile",
                useGit = false,
                unity = new UnitySettings
                {
                    projectPath = "F:/CADET/workspaces/test-job",
                    buildOutputPath = "F:/CADET/workspaces/test-job/Bin"
                }
            };
        }

        [TearDown]
        public void Teardown()
        {
            BuildStatusEventBus.SetUseDelayCall(false);
        }

        // ────────────────────────────────────────────────────────────────────────
        // Null / invalid input contracts
        // ────────────────────────────────────────────────────────────────────────

        /// <summary>Test ORC-01: Null request throws ArgumentNullException.</summary>
        [Test]
        public void Execute_NullRequest_ThrowsArgumentNullException()
        {
            Assert.Throws<ArgumentNullException>(() => BuildSyncOrchestratorService.Execute(null));
        }

        /// <summary>Test ORC-02: Null profile inside request throws ArgumentNullException.</summary>
        [Test]
        public void Execute_NullProfile_ThrowsArgumentNullException()
        {
            var request = new BuildSyncRequest
            {
                SourcePath = "F:/source",
                TargetPath = "F:/CADET/workspaces/test-job",
                Profile = null,
                UseGitSync = false
            };

            Assert.Throws<ArgumentNullException>(() => BuildSyncOrchestratorService.Execute(request));
        }

        // ────────────────────────────────────────────────────────────────────────
        // Same-project-path guard
        // ────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Test ORC-03: IsCurrentProjectPath correctly identifies the current open project.
        /// This is a unit test of the internal helper, verified separately from Execute
        /// because Execute requires actual disk paths in Unity context.
        /// </summary>
        [Test]
        public void IsCurrentProjectPath_WithCurrentProject_ReturnsTrue()
        {
            // Application.dataPath returns the actual Unity project Assets path.
            // GetDirectoryName gives the project root.
            string currentProject = System.IO.Path.GetDirectoryName(
                System.IO.Path.GetFullPath(UnityEngine.Application.dataPath));

            bool result = BuildSyncOrchestratorService.IsCurrentProjectPath(currentProject);

            Assert.IsTrue(result, "IsCurrentProjectPath should return true for the currently open project root");
        }

        /// <summary>
        /// Test ORC-04: IsCurrentProjectPath returns false for a different path.
        /// </summary>
        [Test]
        public void IsCurrentProjectPath_WithDifferentPath_ReturnsFalse()
        {
            bool result = BuildSyncOrchestratorService.IsCurrentProjectPath("F:/some/other/project");

            Assert.IsFalse(result, "IsCurrentProjectPath should return false for a path that is not the open project");
        }

        // ────────────────────────────────────────────────────────────────────────
        // Directory sync — status emission order
        // ────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Test ORC-05: Directory sync emits SYNC_STARTING as first status.
        /// Requires source and target to be real accessible temp directories.
        /// Skipped when running outside of a real disk context.
        /// </summary>
        [Test]
        public void Execute_DirectorySync_EmitsSyncStartingFirst()
        {
            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            string target = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_tgt_" + System.Guid.NewGuid().ToString("N"));

            System.IO.Directory.CreateDirectory(source);
            System.IO.Directory.CreateDirectory(target);

            try
            {
                var emitted = new List<BuildSyncStatus>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = target,
                    Profile = _profile,
                    UseGitSync = false,
                    OnStatusChange = (code, _) => emitted.Add(code)
                };

                var outcome = BuildSyncOrchestratorService.Execute(request);

                Assert.IsTrue(emitted.Count > 0, "At least one status must be emitted");
                Assert.AreEqual(BuildSyncStatus.SYNC_STARTING, emitted[0],
                    "First emitted status must be SYNC_STARTING");
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
                if (System.IO.Directory.Exists(target)) System.IO.Directory.Delete(target, true);
            }
        }

        /// <summary>
        /// Test ORC-06: Directory sync ends with SYNC_COMPLETE on success.
        /// </summary>
        [Test]
        public void Execute_DirectorySync_EmitsSyncCompleteOnSuccess()
        {
            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            string target = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_tgt_" + System.Guid.NewGuid().ToString("N"));

            System.IO.Directory.CreateDirectory(source);
            System.IO.Directory.CreateDirectory(target);

            try
            {
                var emitted = new List<BuildSyncStatus>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = target,
                    Profile = _profile,
                    UseGitSync = false,
                    OnStatusChange = (code, _) => emitted.Add(code)
                };

                var outcome = BuildSyncOrchestratorService.Execute(request);

                Assert.IsTrue(outcome.Success, "Outcome should be successful");
                Assert.AreEqual(BuildSyncStatus.SYNC_COMPLETE, outcome.FinalStatus);
                CollectionAssert.Contains(emitted, BuildSyncStatus.SYNC_COMPLETE,
                    "SYNC_COMPLETE must be emitted on success");
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
                if (System.IO.Directory.Exists(target)) System.IO.Directory.Delete(target, true);
            }
        }

        /// <summary>
        /// Test ORC-07: Status ordering — SYNC_STARTING precedes SYNC_COMPLETE in emitted sequence.
        /// </summary>
        [Test]
        public void Execute_DirectorySync_EmitsStartingBeforeComplete()
        {
            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            string target = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_tgt_" + System.Guid.NewGuid().ToString("N"));

            System.IO.Directory.CreateDirectory(source);
            System.IO.Directory.CreateDirectory(target);

            try
            {
                var emitted = new List<BuildSyncStatus>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = target,
                    Profile = _profile,
                    UseGitSync = false,
                    OnStatusChange = (code, _) => emitted.Add(code)
                };

                BuildSyncOrchestratorService.Execute(request);

                int startingIdx = emitted.IndexOf(BuildSyncStatus.SYNC_STARTING);
                int completeIdx = emitted.IndexOf(BuildSyncStatus.SYNC_COMPLETE);

                Assert.GreaterOrEqual(startingIdx, 0, "SYNC_STARTING must be emitted");
                Assert.GreaterOrEqual(completeIdx, 0, "SYNC_COMPLETE must be emitted");
                Assert.Less(startingIdx, completeIdx, "SYNC_STARTING must precede SYNC_COMPLETE");
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
                if (System.IO.Directory.Exists(target)) System.IO.Directory.Delete(target, true);
            }
        }

        // ────────────────────────────────────────────────────────────────────────
        // Failure contract
        // ────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Test ORC-08: When TargetPath is the current project path, Execute returns a failure
        /// outcome with SYNC_FAILED and does not throw (hard fail returned, not thrown).
        /// </summary>
        [Test]
        public void Execute_TargetIsCurrentProject_ReturnsSyncFailed()
        {
            string currentProject = System.IO.Path.GetDirectoryName(
                System.IO.Path.GetFullPath(UnityEngine.Application.dataPath));

            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(source);

            try
            {
                var emitted = new List<BuildSyncStatus>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = currentProject,
                    Profile = _profile,
                    UseGitSync = false,
                    OnStatusChange = (code, _) => emitted.Add(code)
                };

                var outcome = BuildSyncOrchestratorService.Execute(request);

                Assert.IsFalse(outcome.Success, "Outcome must be failure when target is current project");
                Assert.AreEqual(BuildSyncStatus.SYNC_FAILED, outcome.FinalStatus);
                CollectionAssert.Contains(emitted, BuildSyncStatus.SYNC_FAILED,
                    "SYNC_FAILED must be emitted via callback");
                Assert.IsNotEmpty(outcome.ErrorMessage, "ErrorMessage must describe the failure");
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
            }
        }

        /// <summary>
        /// Test ORC-09: When source path is missing, Execute returns a failure outcome with SYNC_FAILED.
        /// </summary>
        [Test]
        public void Execute_MissingSourcePath_ReturnsSyncFailed()
        {
            var emitted = new List<BuildSyncStatus>();

            var request = new BuildSyncRequest
            {
                SourcePath = "F:/nonexistent/source/that/does/not/exist",
                TargetPath = "F:/CADET/workspaces/test-job",
                Profile = _profile,
                UseGitSync = false,
                OnStatusChange = (code, _) => emitted.Add(code)
            };

            var outcome = BuildSyncOrchestratorService.Execute(request);

            Assert.IsFalse(outcome.Success);
            Assert.AreEqual(BuildSyncStatus.SYNC_FAILED, outcome.FinalStatus);
            Assert.IsNotEmpty(outcome.ErrorMessage);
        }

        // ────────────────────────────────────────────────────────────────────────
        // BuildSyncOutcome factory helpers
        // ────────────────────────────────────────────────────────────────────────

        /// <summary>Test ORC-10: BuildSyncOutcome.Succeeded factory sets correct state.</summary>
        [Test]
        public void BuildSyncOutcome_Succeeded_SetsCorrectState()
        {
            var outcome = BuildSyncOutcome.Succeeded(filesCopied: 5, filesDeleted: 2);

            Assert.IsTrue(outcome.Success);
            Assert.AreEqual(BuildSyncStatus.SYNC_COMPLETE, outcome.FinalStatus);
            Assert.AreEqual(5, outcome.FilesCopied);
            Assert.AreEqual(2, outcome.FilesDeleted);
            Assert.IsEmpty(outcome.ErrorMessage);
        }

        /// <summary>Test ORC-11: BuildSyncOutcome.Failed factory sets correct state.</summary>
        [Test]
        public void BuildSyncOutcome_Failed_SetsCorrectState()
        {
            var outcome = BuildSyncOutcome.Failed("Something went wrong");

            Assert.IsFalse(outcome.Success);
            Assert.AreEqual(BuildSyncStatus.SYNC_FAILED, outcome.FinalStatus);
            Assert.AreEqual("Something went wrong", outcome.ErrorMessage);
        }

        // ────────────────────────────────────────────────────────────────────────
        // Git sync — status emission (placeholder assertions, full impl in Phase 3)
        // ────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Test ORC-12: Git sync path emits SYNC_STARTING before any other status.
        /// Full git sync logic is Phase 3; this asserts the start signal at minimum.
        /// </summary>
        [Test]
        public void Execute_GitSync_EmitsSyncStartingFirst()
        {
            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            string target = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_tgt_" + System.Guid.NewGuid().ToString("N"));

            System.IO.Directory.CreateDirectory(source);
            System.IO.Directory.CreateDirectory(target);

            try
            {
                var emitted = new List<BuildSyncStatus>();
                var texts = new List<string>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = target,
                    Profile = _profile,
                    UseGitSync = true,
                    OnStatusChange = (code, text) =>
                    {
                        emitted.Add(code);
                        texts.Add(text);
                    }
                };

                BuildSyncOrchestratorService.Execute(request);

                Assert.IsTrue(emitted.Count > 0, "At least one status must be emitted");
                Assert.AreEqual(BuildSyncStatus.SYNC_STARTING, emitted[0],
                    "First emitted status must be SYNC_STARTING");
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
                if (System.IO.Directory.Exists(target)) System.IO.Directory.Delete(target, true);
            }
        }

        /// <summary>
        /// Test ORC-13: Git sync in-progress status text contains "Git Syncing".
        /// </summary>
        [Test]
        public void Execute_GitSync_EmitsGitSyncingProgressText()
        {
            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            string target = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_tgt_" + System.Guid.NewGuid().ToString("N"));

            System.IO.Directory.CreateDirectory(source);
            System.IO.Directory.CreateDirectory(target);

            try
            {
                var texts = new List<string>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = target,
                    Profile = _profile,
                    UseGitSync = true,
                    OnStatusChange = (_, text) => texts.Add(text)
                };

                BuildSyncOrchestratorService.Execute(request);

                bool hasGitSyncingText = texts.Exists(t =>
                    t != null && t.IndexOf("Git Syncing", StringComparison.OrdinalIgnoreCase) >= 0);

                Assert.IsTrue(hasGitSyncingText,
                    "At least one status text must contain 'Git Syncing' during git sync");
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
                if (System.IO.Directory.Exists(target)) System.IO.Directory.Delete(target, true);
            }
        }

        [Test]
        public void Execute_DirectorySync_ReportsPresyncStatusBeforeSyncing()
        {
            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            string target = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_tgt_" + System.Guid.NewGuid().ToString("N"));

            System.IO.Directory.CreateDirectory(source);
            System.IO.Directory.CreateDirectory(target);
            System.IO.Directory.CreateDirectory(System.IO.Path.Combine(source, "Assets"));
            System.IO.File.WriteAllText(System.IO.Path.Combine(source, "Assets", "file.txt"), "new");

            try
            {
                var texts = new List<string>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = target,
                    Profile = _profile,
                    UseGitSync = false,
                    OnStatusChange = (_, text) => texts.Add(text)
                };

                BuildSyncOrchestratorService.Execute(request);

                Assert.IsTrue(texts.Count > 0, "Status text should be emitted.");
                StringAssert.Contains("Checking workspace sync status", texts[0]);
                Assert.IsTrue(texts.Exists(text => text != null && text.IndexOf("Synchronizing workspace files", StringComparison.OrdinalIgnoreCase) >= 0),
                    "Directory sync should report a sync phase after the presync check.");
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
                if (System.IO.Directory.Exists(target)) System.IO.Directory.Delete(target, true);
            }
        }

        [Test]
        public void Execute_DirectorySync_ReportsFullPreparationProgress()
        {
            string source = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_src_" + System.Guid.NewGuid().ToString("N"));
            string target = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "cadet_test_tgt_" + System.Guid.NewGuid().ToString("N"));

            System.IO.Directory.CreateDirectory(source);
            System.IO.Directory.CreateDirectory(target);
            System.IO.Directory.CreateDirectory(System.IO.Path.Combine(source, "Assets"));
            System.IO.File.WriteAllText(System.IO.Path.Combine(source, "Assets", "file.txt"), "new");

            try
            {
                var progress = new List<float>();

                var request = new BuildSyncRequest
                {
                    SourcePath = source,
                    TargetPath = target,
                    Profile = _profile,
                    UseGitSync = false,
                    OnProgress = value => progress.Add(value)
                };

                BuildSyncOrchestratorService.Execute(request);

                Assert.Greater(progress.Count, 0, "Progress callbacks should be emitted for preparation work.");
                Assert.Less(progress[0], 1f, "Preparation progress should start before completion.");
                Assert.AreEqual(1f, progress[progress.Count - 1]);
            }
            finally
            {
                if (System.IO.Directory.Exists(source)) System.IO.Directory.Delete(source, true);
                if (System.IO.Directory.Exists(target)) System.IO.Directory.Delete(target, true);
            }
        }
    }
}
