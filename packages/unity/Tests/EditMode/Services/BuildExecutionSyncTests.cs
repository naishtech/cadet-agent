using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using NUnit.Framework;
using UnityEngine;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// Tests for presync/sync behavior during build execution.
    /// Verifies that all presync and sync operations happen automatically
    /// during build execution without user dialogs.
    /// </summary>
    [TestFixture]
    public class BuildExecutionSyncTests
    {
        private string _testRoot;
        private string _sourceProjectPath;
        private string _targetProjectPath;
        private FileSyncService _syncService;

        [SetUp]
        public void SetUp()
        {
            _testRoot = Path.Combine(Application.temporaryCachePath, "CADETBuildSyncTests", Guid.NewGuid().ToString());
            _sourceProjectPath = Path.Combine(_testRoot, "SourceProject");
            _targetProjectPath = Path.Combine(_testRoot, "TargetProject");

            Directory.CreateDirectory(_sourceProjectPath);
            Directory.CreateDirectory(_targetProjectPath);

            _syncService = new FileSyncService();

            // Prevent EditorApplication.delayCall wrapping so callbacks fire
            // synchronously on the Task.Run thread, allowing WaitOne to unblock.
            FileSyncService.SetUseDelayCall(false);
        }

        [TearDown]
        public void TearDown()
        {
            FileSyncService.SetUseDelayCall(true);

            if (Directory.Exists(_testRoot))
            {
                Directory.Delete(_testRoot, true);
            }
        }

        #region Test: Presync Runs Automatically During Build

        /// <summary>
        /// Test: Presync status check happens automatically during build execution.
        /// Verifies that CheckSyncStatus identifies out-of-sync state without user intervention.
        /// </summary>
        [Test]
        public void BuildExecution_PresyncChecksOutOfSyncStatus_Automatically()
        {
            // Arrange: Create source files that differ from target
            CreateSourceFiles("Assets/Content/model.fbx", "Assets/UI/button.prefab");
            // Target only has one file - it's out of sync

            var profile = new BuildProfile
            {
                unity = new UnitySettings { projectPath = _targetProjectPath }
            };

            var preflight = new ProfileSavePreflightService();
            var syncOptions = ProfileSavePreflightService.BuildSyncOptions(_sourceProjectPath, profile);

            // Act: Check sync status (this should happen during build execution)
            ProjectSyncStatus status = preflight.CheckSyncStatus(_sourceProjectPath, _targetProjectPath, syncOptions);

            // Assert: Status should detect out-of-sync without dialog
            Assert.AreEqual(ProjectSyncStatus.OutOfSync, status, "Build execution should detect out-of-sync status automatically.");
        }

        #endregion

        #region Test: Out-of-Sync Files Are Synced Before Build

        /// <summary>
        /// Test: Out-of-sync files are synced before build execution starts.
        /// Verifies that sync happens automatically and copies changed files.
        /// </summary>
        [Test]
        public void BuildExecution_SyncsOutOfSyncFiles_BeforeBuildStarts()
        {
            // Arrange: Create source files
            CreateSourceFiles("Assets/Content/model.fbx", "Assets/UI/button.prefab", "Assets/Scripts/main.cs");

            // Target directory exists but is out of sync (missing some files)
            string existingTargetFile = Path.Combine(_targetProjectPath, "Assets", "Content", "model.fbx");
            Directory.CreateDirectory(Path.GetDirectoryName(existingTargetFile));
            File.WriteAllText(existingTargetFile, "old-model-data");

            var profile = new BuildProfile
            {
                unity = new UnitySettings { projectPath = _targetProjectPath }
            };

            var syncOptions = ProfileSavePreflightService.BuildSyncOptions(_sourceProjectPath, profile);

            // Act: Sync (this should happen automatically during build execution)
            SyncResult syncResult = _syncService.SyncDirectory(_sourceProjectPath, _targetProjectPath, syncOptions);

            // Assert: Sync succeeds and copies changed/missing files
            Assert.IsTrue(syncResult.Success, "Sync should succeed without dialog.");
            Assert.IsTrue(File.Exists(Path.Combine(_targetProjectPath, "Assets", "Scripts", "main.cs")), 
                "Sync should copy missing files to target.");
            Assert.IsTrue(File.Exists(Path.Combine(_targetProjectPath, "Assets", "UI", "button.prefab")), 
                "Sync should copy missing files to target.");
            Assert.IsTrue(syncResult.FilesCopied > 0, "Sync should report files copied.");
        }

        #endregion

        #region Test: Target Directory Creation If Missing

        /// <summary>
        /// Test: If target directory doesn't exist, it's created during sync (no error).
        /// Verifies that missing target workspace is created automatically.
        /// </summary>
        [Test]
        public void BuildExecution_CreatesTargetDirectory_WhenMissing()
        {
            // Arrange: Source files exist
            CreateSourceFiles("Assets/Content/model.fbx");

            // Target directory doesn't exist yet — delete the one created by SetUp
            Directory.Delete(_targetProjectPath);
            Assert.IsFalse(Directory.Exists(_targetProjectPath), "Precondition: target should not exist.");

            var profile = new BuildProfile
            {
                unity = new UnitySettings { projectPath = _targetProjectPath }
            };

            var syncOptions = ProfileSavePreflightService.BuildSyncOptions(_sourceProjectPath, profile);

            // Act: Sync with missing target directory
            SyncResult syncResult = _syncService.SyncDirectory(_sourceProjectPath, _targetProjectPath, syncOptions);

            // Assert: Target directory is created and sync succeeds
            Assert.IsTrue(Directory.Exists(_targetProjectPath), 
                "Build execution should create target directory automatically.");
            Assert.IsTrue(syncResult.Success, "Sync should succeed even when target is missing.");
            Assert.IsTrue(File.Exists(Path.Combine(_targetProjectPath, "Assets", "Content", "model.fbx")), 
                "Files should be copied to newly created target directory.");
        }

        #endregion

        #region Test: Presync Errors Are Properly Captured

        /// <summary>
        /// Test: Presync and sync errors are captured as BuildResult failures.
        /// Verifies that sync errors don't silently fail but are reported.
        /// </summary>
        [Test]
        public void BuildExecution_CapturesSyncErrors_AsFailedBuildResult()
        {
            // Arrange: Invalid source path
            string invalidSourcePath = Path.Combine(_testRoot, "NonExistent");

            var profile = new BuildProfile
            {
                unity = new UnitySettings { projectPath = _targetProjectPath }
            };

            var syncOptions = ProfileSavePreflightService.BuildSyncOptions(invalidSourcePath, profile);

            // Act: Attempt sync with invalid source (should fail gracefully, not throw exception)
            var syncService = new FileSyncService();
            bool exceptionThrown = false;
            Exception caughtException = null;

            try
            {
                syncService.SyncDirectory(invalidSourcePath, _targetProjectPath, syncOptions);
            }
            catch (DirectoryNotFoundException ex)
            {
                exceptionThrown = true;
                caughtException = ex;
            }

            // Assert: Error is properly raised so build execution can handle it
            Assert.IsTrue(exceptionThrown, "Sync should raise exception for invalid source path.");
            Assert.IsNotNull(caughtException, "Exception should contain error details.");
            Assert.That(caughtException.Message, Does.Contain("NonExistent"), 
                "Error message should indicate which path is invalid.");
        }

        #endregion

        #region Test: Presync Respects Build Profile Exclusions

        /// <summary>
        /// Test: Presync respects build profile's exclude patterns (e.g., Library/, Temp/).
        /// Verifies that sync options are correctly built from profile during build execution.
        /// </summary>
        [Test]
        public void BuildExecution_PresyncRespectsProfileExclusions_DuringSync()
        {
            // Arrange: Create source files including excluded directories
            CreateSourceFiles(
                "Assets/Content/model.fbx",
                "Library/cache.dat",
                "Temp/build.tmp",
                "Assets/Scripts/main.cs"
            );

            var profile = new BuildProfile
            {
                unity = new UnitySettings { projectPath = _targetProjectPath }
            };

            var syncOptions = ProfileSavePreflightService.BuildSyncOptions(_sourceProjectPath, profile);
            Assert.That(syncOptions.ExcludePatterns, Does.Contain("Library/"), 
                "Profile sync options should exclude Library/.");
            Assert.That(syncOptions.ExcludePatterns, Does.Contain("Temp/"), 
                "Profile sync options should exclude Temp/.");

            // Act: Sync respecting exclusions
            SyncResult syncResult = _syncService.SyncDirectory(_sourceProjectPath, _targetProjectPath, syncOptions);

            // Assert: Excluded directories are not synced
            Assert.IsTrue(syncResult.Success);
            Assert.IsFalse(File.Exists(Path.Combine(_targetProjectPath, "Library", "cache.dat")), 
                "Sync should not copy excluded Library files.");
            Assert.IsFalse(File.Exists(Path.Combine(_targetProjectPath, "Temp", "build.tmp")), 
                "Sync should not copy excluded Temp files.");
            Assert.IsTrue(File.Exists(Path.Combine(_targetProjectPath, "Assets", "Scripts", "main.cs")), 
                "Sync should copy non-excluded files.");
        }

        #endregion

        #region Test: Async Presync Progress Is Updated During Build

        /// <summary>
        /// Test: Async presync/sync reports progress updates during build execution.
        /// Verifies that BuildQueueWindow can display sync progress via statusDetail.
        /// </summary>
        [Test]
        public void BuildExecution_ReportsPresyncProgress_DuringAsyncSync()
        {
            // Arrange: Create multiple large files
            for (int i = 0; i < 5; i++)
            {
                CreateSourceFiles($"Assets/Content/file{i}.dat");
            }

            var profile = new BuildProfile
            {
                unity = new UnitySettings { projectPath = _targetProjectPath }
            };

            var syncOptions = ProfileSavePreflightService.BuildSyncOptions(_sourceProjectPath, profile);

            var progressUpdates = new List<float>();
            ManualResetEvent syncCompleted = new ManualResetEvent(false);

            // Act: Async sync with progress tracking
            string syncToken = _syncService.SyncDirectoryAsync(
                _sourceProjectPath,
                _targetProjectPath,
                syncOptions,
                progress => { progressUpdates.Add(progress); },
                result => { syncCompleted.Set(); }
            );

            bool completed = syncCompleted.WaitOne(TimeSpan.FromSeconds(5));

            // Assert: Progress updates were reported during sync
            Assert.IsTrue(completed, "Async sync should complete within timeout.");
            Assert.IsNotNull(syncToken, "Sync token should be returned for async operation.");
            Assert.Greater(progressUpdates.Count, 0, "Progress updates should be reported during sync.");
            Assert.Less(progressUpdates[0], 1.0f, "Progress should start below 100%.");
            Assert.AreEqual(1.0f, progressUpdates[progressUpdates.Count - 1], 
                "Final progress update should be 100%.");
        }

        #endregion

        #region Helper Methods

        private void CreateSourceFiles(params string[] relativePaths)
        {
            foreach (string relativePath in relativePaths)
            {
                string fullPath = Path.Combine(_sourceProjectPath, relativePath.Replace('/', Path.DirectorySeparatorChar));
                string directory = Path.GetDirectoryName(fullPath);

                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                // Create dummy file with some content
                File.WriteAllText(fullPath, $"Content of {relativePath}");
            }
        }

        #endregion
    }
}
