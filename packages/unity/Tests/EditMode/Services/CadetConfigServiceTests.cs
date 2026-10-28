using NUnit.Framework;
using System;
using System.IO;
using System.Threading;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class CadetConfigServiceTests
    {
        private string _configPath;
        private string _backupPath;
        private bool _hadOriginalConfig;

        [SetUp]
        public void SetUp()
        {
            _configPath = CadetConfigService.ConfigFilePath;
            string configDir = Path.GetDirectoryName(_configPath);
            if (!string.IsNullOrEmpty(configDir))
            {
                Directory.CreateDirectory(configDir);
            }

            _hadOriginalConfig = File.Exists(_configPath);
            if (_hadOriginalConfig)
            {
                _backupPath = Path.Combine(
                    configDir ?? string.Empty,
                    $"config.backup.{Guid.NewGuid():N}.json");
                File.Copy(_configPath, _backupPath, true);
                DeleteFileWithRetries(_configPath);
            }
        }

        [TearDown]
        public void TearDown()
        {
            if (File.Exists(_configPath))
            {
                DeleteFileWithRetries(_configPath);
            }

            if (_hadOriginalConfig && !string.IsNullOrEmpty(_backupPath) && File.Exists(_backupPath))
            {
                File.Copy(_backupPath, _configPath, true);
                DeleteFileWithRetries(_backupPath);
            }
        }

        private static void DeleteFileWithRetries(string filePath, int maxAttempts = 10, int delayMs = 50)
        {
            if (string.IsNullOrWhiteSpace(filePath))
            {
                return;
            }

            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    if (!File.Exists(filePath))
                    {
                        return;
                    }

                    File.Delete(filePath);
                    return;
                }
                catch (IOException) when (attempt < maxAttempts)
                {
                    Thread.Sleep(delayMs);
                }
                catch (UnauthorizedAccessException) when (attempt < maxAttempts)
                {
                    Thread.Sleep(delayMs);
                }
            }

            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }

        [Test]
        public void GetWorkspacesRoot_ConfigAbsent_ReturnsDefault()
        {
            string expected = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "CADET",
                "Workspaces");

            string actual = CadetConfigService.GetWorkspacesRoot();

            Assert.AreEqual(expected, actual);
        }

        [Test]
        public void GetWorkspacesRoot_ConfigPresent_ReturnsStoredPath()
        {
            string expected = @"F:/unity/projects/custom-workspaces";
            CadetConfigService.Save(new CadetConfig { WorkspacesRoot = expected });

            string actual = CadetConfigService.GetWorkspacesRoot();

            Assert.AreEqual(expected, actual);
        }

        [Test]
        public void Save_CreatesConfigFileAtExpectedPath()
        {
            CadetConfigService.Save(new CadetConfig { WorkspacesRoot = "F:/ws" });

            Assert.IsTrue(File.Exists(_configPath));
        }

        [Test]
        public void Load_RoundTrips_WorkspacesRoot()
        {
            string expected = @"F:/unity/projects/roundtrip-workspaces";
            CadetConfigService.Save(new CadetConfig { WorkspacesRoot = expected });

            CadetConfig loaded = CadetConfigService.Load();

            Assert.IsNotNull(loaded);
            Assert.AreEqual(expected, loaded.WorkspacesRoot);
        }
    }
}
