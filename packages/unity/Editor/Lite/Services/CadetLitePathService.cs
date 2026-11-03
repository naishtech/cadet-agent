using System;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Services
{
    /// <summary>
    /// Lightweight path resolver for Lite-side services that cannot depend on Editor-layer services.
    /// </summary>
    public static class CadetLitePathService
    {
        /// <summary>
        /// The plugin root inside a Unity project, relative to the project folder.
        /// This is the one place that knows the path: every caller asks here, so a
        /// different install root is one edit and not a search.
        /// </summary>
        public const string PluginRoot = "Assets/Covyne/Cadet";

        /// <summary>
        /// The CLI root inside the plugin, relative to the project folder.
        /// </summary>
        public const string CliRoot = PluginRoot + "/CLI";

        private const string ConfigPathOverrideEnvVar = "CADET_CONFIG_PATH";

        private static readonly string DefaultWorkspacesRoot =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "CADET", "Workspaces");

        private static readonly string DefaultConfigFilePath =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "CADET", "config.json");

        private static string ResolveConfigFilePath()
        {
            string overridePath = Environment.GetEnvironmentVariable(ConfigPathOverrideEnvVar, EnvironmentVariableTarget.Process);
            return !string.IsNullOrWhiteSpace(overridePath) ? overridePath : DefaultConfigFilePath;
        }

        public static string GetWorkspacesRoot()
        {
            try
            {
                string configFilePath = ResolveConfigFilePath();
                if (!File.Exists(configFilePath))
                {
                    return DefaultWorkspacesRoot;
                }

                string json = File.ReadAllText(configFilePath);
                if (string.IsNullOrWhiteSpace(json))
                {
                    return DefaultWorkspacesRoot;
                }

                CadetConfig config = JsonUtility.FromJson<CadetConfig>(json);
                if (config == null || string.IsNullOrWhiteSpace(config.WorkspacesRoot))
                {
                    return DefaultWorkspacesRoot;
                }

                return config.WorkspacesRoot;
            }
            catch
            {
                return DefaultWorkspacesRoot;
            }
        }

        public static string GetWorkspaceRegistryPath()
        {
            return Path.Combine(GetWorkspacesRoot(), "workspaces.json");
        }

        /// <summary>
        /// Absolute path inside the plugin for a Unity project root, the folder that holds Assets.
        /// </summary>
        public static string GetPluginPath(string projectRoot, params string[] parts)
        {
            return CombineUnderProject(projectRoot, PluginRoot, parts);
        }

        /// <summary>
        /// Absolute path inside the plugin's CLI folder for a Unity project root.
        /// </summary>
        public static string GetCliPath(string projectRoot, params string[] parts)
        {
            return CombineUnderProject(projectRoot, CliRoot, parts);
        }

        private static string CombineUnderProject(string projectRoot, string relativeRoot, string[] parts)
        {
            if (string.IsNullOrWhiteSpace(projectRoot))
            {
                throw new ArgumentNullException(nameof(projectRoot));
            }

            string combined = Path.Combine(projectRoot, relativeRoot.Replace('/', Path.DirectorySeparatorChar));
            if (parts == null)
            {
                return combined;
            }

            foreach (string part in parts)
            {
                if (!string.IsNullOrEmpty(part))
                {
                    combined = Path.Combine(combined, part);
                }
            }

            return combined;
        }
    }
}