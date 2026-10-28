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
    }
}