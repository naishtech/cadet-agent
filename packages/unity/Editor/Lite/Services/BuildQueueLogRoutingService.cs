using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;
using UnityEditor;

namespace Covyne.CADET.Editor.Lite.Services
{
    public readonly struct BuildQueueLogTarget
    {
        public BuildQueueLogTarget(string label, string path)
        {
            Label = label;
            Path = path;
        }

        public string Label { get; }
        public string Path { get; }
    }

    public static class BuildQueueLogRoutingService
    {
        public static List<BuildQueueLogTarget> GetUnityLogTargets(BuildJobDefinition job, BuildProfile profile, WorkspaceInfo workspaceInfo)
        {
            List<BuildQueueLogTarget> targets = new List<BuildQueueLogTarget>();
            string os = profile?.os ?? "windows";
            string logRoot = ResolveLogRootPath(job, profile, workspaceInfo);
            if (string.IsNullOrWhiteSpace(logRoot))
            {
                return targets;
            }

            logRoot = logRoot.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);

            if (os == "windows" || os == "both")
            {
                targets.Add(new BuildQueueLogTarget("Windows", Path.Combine(logRoot, "Logs", "unity_build_windows.log")));
            }

            if (os == "mac" || os == "macos" || os == "both")
            {
                targets.Add(new BuildQueueLogTarget("macOS", Path.Combine(logRoot, "Logs", "unity_build_macos.log")));
            }

            return targets;
        }

        public static string ResolveLogRootPath(BuildJobDefinition job, BuildProfile profile, WorkspaceInfo workspaceInfo)
        {
            if (!string.IsNullOrWhiteSpace(job?.WorkspacePath))
            {
                return job.WorkspacePath;
            }

            if (!string.IsNullOrWhiteSpace(profile?.unity?.projectPath))
            {
                return profile.unity.projectPath;
            }

            if (!string.IsNullOrWhiteSpace(workspaceInfo?.WorkspacePath))
            {
                return workspaceInfo.WorkspacePath;
            }

            if (!string.IsNullOrWhiteSpace(workspaceInfo?.ActiveLogPath))
            {
                try
                {
                    string normalizedLogPath = workspaceInfo.ActiveLogPath
                        .Replace('/', Path.DirectorySeparatorChar)
                        .Replace('\\', Path.DirectorySeparatorChar);
                    string logsDirectory = Path.GetDirectoryName(normalizedLogPath);
                    if (!string.IsNullOrWhiteSpace(logsDirectory))
                    {
                        return Path.GetDirectoryName(logsDirectory);
                    }
                }
                catch
                {
                    // Ignore path normalization issues and fall through.
                }
            }

            return null;
        }

        public static string ResolveBuildLogPath(BuildJobDefinition job, BuildProfile profile, WorkspaceInfo workspaceInfo)
        {
            // Prefer active log path while in-progress, then fall back to preserved last log path.
            string rawLogPath = !string.IsNullOrWhiteSpace(workspaceInfo?.ActiveLogPath)
                ? workspaceInfo.ActiveLogPath
                : workspaceInfo?.LastLogPath;

            if (!string.IsNullOrWhiteSpace(rawLogPath))
            {
                return rawLogPath
                    .Replace('/', Path.DirectorySeparatorChar)
                    .Replace('\\', Path.DirectorySeparatorChar);
            }

            string logRoot = ResolveLogRootPath(job, profile, workspaceInfo);
            if (string.IsNullOrWhiteSpace(logRoot))
            {
                return string.Empty;
            }

            return Path.Combine(logRoot, "Logs", "dist.log")
                .Replace('/', Path.DirectorySeparatorChar)
                .Replace('\\', Path.DirectorySeparatorChar);
        }

        public static void OpenUnityLogMonitor(string logPath)
        {
            if (string.IsNullOrWhiteSpace(logPath))
            {
                UnityEngine.Debug.LogWarning("[C.A.D.E.T] No Unity log path found for this queued job.");
                EditorUtility.DisplayDialog(
                    "Unity Log",
                    "No Unity log path is available for this job.",
                    "OK");
                return;
            }

            if (!File.Exists(logPath))
            {
                EditorUtility.DisplayDialog(
                    "Unity Log Not Ready",
                    $"The Unity log file does not exist yet:\n\n{logPath}\n\nStart or continue the build and try again in a few seconds.",
                    "OK");
                return;
            }

            Utilities.LogTailMonitorUtility.OpenTailMonitor(logPath, "Unity Log Monitor");
        }

#if !CADET_LITE
        public static void OpenBuildLogMonitor(string logPath)
        {
            if (string.IsNullOrWhiteSpace(logPath))
            {
                EditorUtility.DisplayDialog(
                    "Build Log",
                    "No build log path is available for this job.",
                    "OK");
                return;
            }

            if (!File.Exists(logPath))
            {
                EditorUtility.DisplayDialog(
                    "Build Log Not Ready",
                    $"The build log file does not exist yet:\n\n{logPath}\n\nStart or continue the build and try again in a few seconds.",
                    "OK");
                return;
            }

            Utilities.LogTailMonitorUtility.OpenTailMonitor(logPath, "Build Log Monitor");
        }
#endif

        public static void OpenLogFile(string logPath)
        {
            if (string.IsNullOrWhiteSpace(logPath) || !File.Exists(logPath))
            {
                EditorUtility.DisplayDialog(
                    "Open Log",
                    "Log file was not found.",
                    "OK");
                return;
            }

            try
            {
#if UNITY_EDITOR_OSX
                // On macOS, ProcessStartInfo.Verb is not supported. Use the 'open' command instead.
                Process.Start(new ProcessStartInfo
                {
                    FileName = "open",
                    Arguments = $"\"{logPath}\"",
                    UseShellExecute = false
                });
#else
                Process.Start(new ProcessStartInfo
                {
                    FileName = logPath,
                    UseShellExecute = true
                });
#endif
            }
            catch (Exception ex)
            {
                EditorUtility.DisplayDialog(
                    "Open Unity Log",
                    $"Failed to open Unity log file:\n{logPath}\n\n{ex.Message}",
                    "OK");
            }
        }
    }
}
