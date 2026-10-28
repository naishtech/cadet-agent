using System;
using System.IO;
using UnityEngine;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Services
{
    public static class CadetConfigService
    {
        private const string ConfigPathOverrideEnvVar = "CADET_CONFIG_PATH";
        private static readonly object ConfigFileIoLock = new object();

        private static readonly string DefaultWorkspacesRoot =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "CADET", "Workspaces");
        private static readonly string DefaultProfilesRoot =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "CADET", "Profiles");

        public static string ConfigFilePath =>
            ResolveConfigFilePath();

        public static CadetConfig Load()
        {
            lock (ConfigFileIoLock)
            {
                if (!File.Exists(ConfigFilePath))
                    return new CadetConfig();

                string json = File.ReadAllText(ConfigFilePath);
                if (string.IsNullOrWhiteSpace(json))
                    return new CadetConfig();

                return JsonUtility.FromJson<CadetConfig>(json) ?? new CadetConfig();
            }
        }

        public static void Save(CadetConfig config)
        {
            lock (ConfigFileIoLock)
            {
                string dir = Path.GetDirectoryName(ConfigFilePath);
                if (!string.IsNullOrWhiteSpace(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                File.WriteAllText(ConfigFilePath, JsonUtility.ToJson(config, prettyPrint: true));
            }
        }

        /// <summary>
        /// Returns the configured workspaces root, or ~/CADET/Workspaces if not set.
        /// </summary>
        public static string GetWorkspacesRoot()
        {
            string stored = Load().WorkspacesRoot;
            return string.IsNullOrWhiteSpace(stored) ? DefaultWorkspacesRoot : stored;
        }

        /// <summary>
        /// Returns the configured profiles root, or ~/CADET/Profiles if not set.
        /// </summary>
        public static string GetProfilesRoot()
        {
            string stored = Load().ProfilesRoot;
            return string.IsNullOrWhiteSpace(stored) ? DefaultProfilesRoot : stored;
        }

        private static string ResolveConfigFilePath()
        {
            string overridePath = Environment.GetEnvironmentVariable(ConfigPathOverrideEnvVar, EnvironmentVariableTarget.Process);
            if (!string.IsNullOrWhiteSpace(overridePath))
            {
                return overridePath;
            }

            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "CADET", "config.json");
        }
    }
}
