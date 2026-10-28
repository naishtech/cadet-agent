using System;
using System.IO;
using System.Threading;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// Prevents service EditMode tests from writing to the user's real CADET workspaces registry.
    /// </summary>
    [SetUpFixture]
    public sealed class ServicesWorkspacesIsolationSetUpFixture
    {
        private const string ConfigPathOverrideEnvVar = "CADET_CONFIG_PATH";
        private string configPath;
        private string backupPath;
        private bool hadOriginalConfig;
        private string tempRoot;
        private string previousConfigPathOverride;

        [OneTimeSetUp]
        public void OneTimeSetUp()
        {
            previousConfigPathOverride = Environment.GetEnvironmentVariable(ConfigPathOverrideEnvVar, EnvironmentVariableTarget.Process);

            tempRoot = Path.Combine(Path.GetTempPath(), "CADETTests", "Services", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string testConfigDir = Path.Combine(tempRoot, "UserConfig");
            Directory.CreateDirectory(testConfigDir);
            string testConfigPath = Path.Combine(testConfigDir, "config.json");
            Environment.SetEnvironmentVariable(ConfigPathOverrideEnvVar, testConfigPath, EnvironmentVariableTarget.Process);

            configPath = CadetConfigService.ConfigFilePath;
            string configDir = Path.GetDirectoryName(configPath);
            if (!string.IsNullOrWhiteSpace(configDir))
            {
                Directory.CreateDirectory(configDir);
            }

            hadOriginalConfig = File.Exists(configPath);
            if (hadOriginalConfig)
            {
                backupPath = Path.Combine(configDir ?? string.Empty, $"config.services-tests.backup.{Guid.NewGuid():N}.json");
                File.Copy(configPath, backupPath, overwrite: true);
            }

            CadetConfigService.Save(new CadetConfig
            {
                WorkspacesRoot = Path.Combine(tempRoot, "Workspaces"),
                ProfilesRoot = Path.Combine(tempRoot, "Profiles")
            });
        }

        [OneTimeTearDown]
        public void OneTimeTearDown()
        {
            try
            {
                if (hadOriginalConfig && !string.IsNullOrWhiteSpace(backupPath) && File.Exists(backupPath))
                {
                    File.Copy(backupPath, configPath, overwrite: true);
                    DeleteFileWithRetries(backupPath);
                }
                else if (File.Exists(configPath))
                {
                    DeleteFileWithRetries(configPath);
                }
            }
            finally
            {
                Environment.SetEnvironmentVariable(ConfigPathOverrideEnvVar, previousConfigPathOverride, EnvironmentVariableTarget.Process);

                if (!string.IsNullOrWhiteSpace(tempRoot) && Directory.Exists(tempRoot))
                {
                    try
                    {
                        Directory.Delete(tempRoot, recursive: true);
                    }
                    catch
                    {
                        // Best effort cleanup only.
                    }
                }
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
    }
}
