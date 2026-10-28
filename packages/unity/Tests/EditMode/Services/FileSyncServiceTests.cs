using NUnit.Framework;
using System;
using System.Collections;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.TestTools;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// RED phase tests for FileSyncService.
    /// Defines expected behavior before implementation.
    /// </summary>
    [TestFixture]
    public class FileSyncServiceTests
    {
        private string _testRoot;
        private string _sourcePath;
        private string _targetPath;
        private FileSyncService _syncService;

        [SetUp]
        public void SetUp()
        {
            _testRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", Guid.NewGuid().ToString());
            _sourcePath = Path.Combine(_testRoot, "Source");
            _targetPath = Path.Combine(_testRoot, "Workspace");

            Directory.CreateDirectory(_sourcePath);
            Directory.CreateDirectory(_targetPath);

            _syncService = new FileSyncService();
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(_testRoot))
            {
                Directory.Delete(_testRoot, true);
            }
        }

        [Test]
        public void SyncDirectory_CopiesAllFiles()
        {
            File.WriteAllText(Path.Combine(_sourcePath, "a.txt"), "A");
            File.WriteAllText(Path.Combine(_sourcePath, "b.txt"), "B");
            Directory.CreateDirectory(Path.Combine(_sourcePath, "Sub"));
            File.WriteAllText(Path.Combine(_sourcePath, "Sub", "c.txt"), "C");

            SyncResult result = _syncService.SyncDirectory(_sourcePath, _targetPath, SyncOptions.Default());

            Assert.IsTrue(result.Success);
            Assert.IsTrue(File.Exists(Path.Combine(_targetPath, "a.txt")));
            Assert.IsTrue(File.Exists(Path.Combine(_targetPath, "b.txt")));
            Assert.IsTrue(File.Exists(Path.Combine(_targetPath, "Sub", "c.txt")));
            Assert.AreEqual(3, result.FilesCopied);
        }

        [Test]
        public void SyncDirectory_RespectsExcludePatterns()
        {
            Directory.CreateDirectory(Path.Combine(_sourcePath, "Library"));
            Directory.CreateDirectory(Path.Combine(_sourcePath, "Temp"));
            File.WriteAllText(Path.Combine(_sourcePath, "Library", "skip.txt"), "skip");
            File.WriteAllText(Path.Combine(_sourcePath, "Temp", "skip2.txt"), "skip");
            File.WriteAllText(Path.Combine(_sourcePath, "keep.txt"), "keep");

            var options = SyncOptions.Default();
            options.ExcludePatterns = new[] { "Library/", "Temp/" };

            SyncResult result = _syncService.SyncDirectory(_sourcePath, _targetPath, options);

            Assert.IsTrue(result.Success);
            Assert.IsTrue(File.Exists(Path.Combine(_targetPath, "keep.txt")));
            Assert.IsFalse(File.Exists(Path.Combine(_targetPath, "Library", "skip.txt")));
            Assert.IsFalse(File.Exists(Path.Combine(_targetPath, "Temp", "skip2.txt")));
        }

        [Test]
        public void SyncDirectory_CreatesTargetDirectory_WhenMissing()
        {
            Directory.Delete(_targetPath, true);

            File.WriteAllText(Path.Combine(_sourcePath, "test.txt"), "data");
            SyncResult result = _syncService.SyncDirectory(_sourcePath, _targetPath, SyncOptions.Default());

            Assert.IsTrue(result.Success);
            Assert.IsTrue(Directory.Exists(_targetPath));
            Assert.IsTrue(File.Exists(Path.Combine(_targetPath, "test.txt")));
        }

        [Test]
        public void SyncDirectory_OnlyUpdatesChangedFiles()
        {
            File.WriteAllText(Path.Combine(_sourcePath, "a.txt"), "A1");
            File.WriteAllText(Path.Combine(_sourcePath, "b.txt"), "B1");
            _syncService.SyncDirectory(_sourcePath, _targetPath, SyncOptions.Default());

            File.WriteAllText(Path.Combine(_sourcePath, "b.txt"), "B2");

            SyncResult result = _syncService.SyncDirectory(_sourcePath, _targetPath, SyncOptions.Default());

            Assert.IsTrue(result.Success);
            Assert.AreEqual(1, result.FilesCopied);
            Assert.AreEqual("B2", File.ReadAllText(Path.Combine(_targetPath, "b.txt")));
            Assert.AreEqual("A1", File.ReadAllText(Path.Combine(_targetPath, "a.txt")));
        }

        [Test]
        public void SyncDirectory_DetectsDeletedFiles_WhenDeleteExtraneousEnabled()
        {
            File.WriteAllText(Path.Combine(_sourcePath, "a.txt"), "A1");
            File.WriteAllText(Path.Combine(_sourcePath, "b.txt"), "B1");
            var options = SyncOptions.Default();
            options.DeleteExtraneousFiles = true;
            _syncService.SyncDirectory(_sourcePath, _targetPath, options);

            File.Delete(Path.Combine(_sourcePath, "b.txt"));

            SyncResult result = _syncService.SyncDirectory(_sourcePath, _targetPath, options);

            Assert.IsTrue(result.Success);
            Assert.IsFalse(File.Exists(Path.Combine(_targetPath, "b.txt")));
            Assert.AreEqual(1, result.FilesDeleted);
        }

        [Test]
        public void SyncDirectory_WithInvalidSource_ThrowsException()
        {
            string missingSource = Path.Combine(_testRoot, "DoesNotExist");

            Assert.Throws<DirectoryNotFoundException>(() =>
                _syncService.SyncDirectory(missingSource, _targetPath, SyncOptions.Default()));
        }

        [Test]
        public void SyncDirectory_WithNullPaths_ThrowsArgumentException()
        {
            Assert.Throws<ArgumentException>(() =>
                _syncService.SyncDirectory(null, _targetPath, SyncOptions.Default()));

            Assert.Throws<ArgumentException>(() =>
                _syncService.SyncDirectory(_sourcePath, null, SyncOptions.Default()));
        }

        [Test]
        public void GenerateManifest_CreatesManifestForSourceFiles()
        {
            File.WriteAllText(Path.Combine(_sourcePath, "a.txt"), "A");
            Directory.CreateDirectory(Path.Combine(_sourcePath, "Sub"));
            File.WriteAllText(Path.Combine(_sourcePath, "Sub", "b.txt"), "B");

            SyncManifest manifest = _syncService.GenerateManifest(_sourcePath, SyncOptions.Default());

            Assert.IsNotNull(manifest);
            Assert.AreEqual(2, manifest.Entries.Count);
            Assert.IsTrue(manifest.Entries.Any(e => e.RelativePath == "a.txt"));
            Assert.IsTrue(manifest.Entries.Any(e => e.RelativePath == "Sub/b.txt"));
        }

        [Test]
        public void SaveAndLoadManifest_PreservesEntries()
        {
            File.WriteAllText(Path.Combine(_sourcePath, "a.txt"), "A");
            SyncManifest original = _syncService.GenerateManifest(_sourcePath, SyncOptions.Default());

            string manifestPath = Path.Combine(_testRoot, ".cadet-sync-manifest.json");
            _syncService.SaveManifest(original, manifestPath);

            SyncManifest loaded = _syncService.LoadManifest(manifestPath);

            Assert.AreEqual(original.Entries.Count, loaded.Entries.Count);
            Assert.AreEqual(original.Entries[0].RelativePath, loaded.Entries[0].RelativePath);
            Assert.AreEqual(original.Entries[0].FileSize, loaded.Entries[0].FileSize);
        }

        [UnityTest]
        public IEnumerator SyncDirectory_ReportsProgressFromZeroToOne()
        {
            for (int i = 0; i < 10; i++)
            {
                File.WriteAllText(Path.Combine(_sourcePath, $"f{i}.txt"), i.ToString());
            }

            float lastProgress = 0f;
            bool completed = false;

            _syncService.SyncDirectoryAsync(
                _sourcePath,
                _targetPath,
                SyncOptions.Default(),
                progress => lastProgress = progress,
                _ => completed = true);

            yield return new WaitUntil(() => completed);

            Assert.GreaterOrEqual(lastProgress, 1f);
        }


    }
}
