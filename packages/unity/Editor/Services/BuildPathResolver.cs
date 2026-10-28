using System;
using System.Collections.Generic;
using System.IO;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Shared path and tool resolution helpers used during build/export flows.
    /// </summary>
    public static class BuildPathResolver
    {
        public static string ToUnixPath(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                return path;
            }

            string normalized = path.Replace('\\', '/');
            if (normalized.Length >= 2 && normalized[1] == ':')
            {
                return "/" + char.ToLower(normalized[0]) + normalized.Substring(2);
            }

            return normalized;
        }

        public static string MakeRelativeToProject(string absolutePath, string projectPath)
        {
            if (string.IsNullOrEmpty(absolutePath))
            {
                return absolutePath;
            }

            string unixProjectPath = ToUnixPath(projectPath ?? string.Empty);
            string unixAbsolutePath = ToUnixPath(absolutePath);

            if (!string.IsNullOrEmpty(unixProjectPath) && unixAbsolutePath.StartsWith(unixProjectPath + "/"))
            {
                string relative = unixAbsolutePath.Substring(unixProjectPath.Length + 1);
                return relative.Replace('\\', '/');
            }

            return unixAbsolutePath;
        }

        public static void PopulateSteamCmdPathsFromEditorPrefs(BuildProfile profile)
        {
            if (profile?.steam == null)
            {
                return;
            }

            if (string.IsNullOrEmpty(profile.steam.steamcmdExe))
            {
                string steamcmdExe = EditorPrefs.GetString("CADET_SteamCmdExe", "");
                if (string.IsNullOrEmpty(steamcmdExe))
                {
                    steamcmdExe = Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.exe");
                }

                if (!string.IsNullOrEmpty(steamcmdExe) && !File.Exists(steamcmdExe))
                {
#if UNITY_EDITOR_WIN
                    Debug.LogWarning($"[C.A.D.E.T] SteamCMD executable not found at: {steamcmdExe}");
#endif
                }

                if (!string.IsNullOrEmpty(steamcmdExe))
                {
                    profile.steam.steamcmdExe = ToUnixPath(steamcmdExe);
                }
            }

            if (string.IsNullOrEmpty(profile.steam.steamcmdSh))
            {
                string steamcmdSh = EditorPrefs.GetString("CADET_SteamCmdSh", "");
                if (string.IsNullOrEmpty(steamcmdSh))
                {
                    steamcmdSh = Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.sh");
                }

                if (!string.IsNullOrEmpty(steamcmdSh))
                {
                    profile.steam.steamcmdSh = ToUnixPath(steamcmdSh);
                }
            }
        }

        public static void PopulateEpicBuildPatchToolPathFromEditorPrefs(BuildProfile profile)
        {
            if (profile?.epic == null)
            {
                return;
            }

            string buildPatchToolBasePath = EditorPrefs.GetString("CADET_BuildPatchToolPath", "");
            if (string.IsNullOrEmpty(buildPatchToolBasePath))
            {
                if (!string.IsNullOrEmpty(profile.epic.buildPatchToolPath))
                {
                    string existingPath = profile.epic.buildPatchToolPath.Replace('/', Path.DirectorySeparatorChar);
                    if (Directory.Exists(existingPath))
                    {
                        buildPatchToolBasePath = existingPath;
                    }
                    else if (File.Exists(existingPath))
                    {
                        string binariesToken = "Engine" + Path.DirectorySeparatorChar + "Binaries";
                        if (existingPath.Contains(binariesToken))
                        {
                            int binariesIndex = existingPath.IndexOf(binariesToken, StringComparison.Ordinal);
                            buildPatchToolBasePath = existingPath.Substring(0, binariesIndex).TrimEnd(Path.DirectorySeparatorChar);
                        }
                    }
                }

                if (string.IsNullOrEmpty(buildPatchToolBasePath))
                {
                    buildPatchToolBasePath = BuildToolsPathHelper.GetBuildPatchToolPath();
                }
            }

            string profileOs = profile.os?.ToLower() ?? string.Empty;
            string osBinaryPath;
            if (profileOs == "windows" || profileOs == "both")
            {
                osBinaryPath = Path.Combine(buildPatchToolBasePath, "Engine", "Binaries", "Win64", "BuildPatchTool.exe");
            }
            else if (profileOs == "mac" || profileOs == "macos")
            {
                osBinaryPath = Path.Combine(buildPatchToolBasePath, "Engine", "Binaries", "Mac", "BuildPatchTool");
            }
            else
            {
                osBinaryPath = Path.Combine(buildPatchToolBasePath, "Engine", "Binaries", "Linux", "BuildPatchTool");
            }

            if (!string.IsNullOrEmpty(osBinaryPath))
            {
                if (!File.Exists(osBinaryPath))
                {
                    Debug.LogWarning($"[C.A.D.E.T] BuildPatchTool binary not found at: {osBinaryPath}");
                }

                profile.epic.buildPatchToolPath = ToUnixPath(osBinaryPath);
            }
        }

        public static List<string> GetUnityLogFilePaths(BuildProfile profile)
        {
            List<string> logPaths = new List<string>();
            if (profile?.unity == null || string.IsNullOrEmpty(profile.unity.projectPath))
            {
                return logPaths;
            }

            string projectPath = profile.unity.projectPath.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
            string os = profile.os ?? "windows";

            if (os == "windows" || os == "both")
            {
                logPaths.Add(Path.Combine(projectPath, "Logs", "unity_build_windows.log"));
            }

            if (os == "mac" || os == "macos" || os == "both")
            {
                logPaths.Add(Path.Combine(projectPath, "Logs", "unity_build_macos.log"));
            }

            return logPaths;
        }

        public static void ClearUnityLogFiles(List<string> logFilePaths, Action<string, CadetConsoleMessageType> onLog)
        {
            if (logFilePaths == null || logFilePaths.Count == 0)
            {
                return;
            }

            foreach (string logPath in logFilePaths)
            {
                if (string.IsNullOrEmpty(logPath))
                {
                    continue;
                }

                try
                {
                    string logDirectory = Path.GetDirectoryName(logPath);
                    if (!string.IsNullOrEmpty(logDirectory) && !Directory.Exists(logDirectory))
                    {
                        Directory.CreateDirectory(logDirectory);
                    }

                    if (File.Exists(logPath))
                    {
                        File.WriteAllText(logPath, string.Empty);
                        onLog?.Invoke($"[LOG] Cleared Unity build log: {logPath}", CadetConsoleMessageType.Log);
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[C.A.D.E.T] Failed to clear Unity build log file {logPath}: {ex.Message}");
                    onLog?.Invoke($"[WARN] Failed to clear Unity build log: {logPath}", CadetConsoleMessageType.Warning);
                }
            }
        }
    }
}
