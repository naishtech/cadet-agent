using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Utilities
{
    public interface ILogTailProcessStarter
    {
        Process Start(ProcessStartInfo processStartInfo);
    }

    internal sealed class DefaultLogTailProcessStarter : ILogTailProcessStarter
    {
        public Process Start(ProcessStartInfo processStartInfo)
        {
            return Process.Start(processStartInfo);
        }
    }

    /// <summary>
    /// Opens OS terminal windows to monitor log files in real time.
    /// </summary>
    public static class LogTailMonitorUtility
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][LogMonitor]";
        private const string MinimumLevelEditorPrefsKey = "CADET_UnityConsoleMinimumLevel";
        private const int DebugLevel = 0;
        private static int cachedMinimumLevel = 3;
        private static readonly Dictionary<string, Process> ActiveMonitorsByPath =
            new Dictionary<string, Process>(StringComparer.OrdinalIgnoreCase);

        private static readonly Dictionary<string, DateTime> LastLaunchByPathUtc =
            new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);

        private static readonly object SyncLock = new object();
        private static readonly TimeSpan LaunchDedupWindow = TimeSpan.FromSeconds(2);

        private static ILogTailProcessStarter processStarter = new DefaultLogTailProcessStarter();

        public static bool OpenTailMonitor(string logPath, string label)
        {
            return OpenTailMonitorForPlatform(logPath, label, Application.platform);
        }

        public static bool OpenTailMonitorForPlatform(string logPath, string label, RuntimePlatform platform)
        {
            if (string.IsNullOrWhiteSpace(logPath))
            {
                UnityEngine.Debug.LogWarning("[C.A.D.E.T] No Unity log path found for this queued job.");
                return false;
            }

            if (!File.Exists(logPath))
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Unity build log file does not exist yet: {logPath}");
                return false;
            }

            string normalizedPath = NormalizePath(logPath);
            if (IsDuplicateRequest(normalizedPath))
            {
                return false;
            }

            try
            {
                ProcessStartInfo startInfo = BuildStartInfoForPlatform(normalizedPath, label, platform);
                if (platform == RuntimePlatform.OSXEditor)
                {
                    LogDiagnostic(
                        $"{DiagnosticsPrefix} Launching macOS log tail monitor. path='{normalizedPath}' label='{label ?? string.Empty}' fileName='{startInfo.FileName}' arguments='{startInfo.Arguments}'.");
                }

                Process process = processStarter.Start(startInfo);
                if (process == null)
                {
                    UnityEngine.Debug.LogError($"[C.A.D.E.T] Failed to start log tail monitor process for path: {normalizedPath}");
                    return false;
                }

                if (platform == RuntimePlatform.OSXEditor && !ValidateMacLaunchProcess(process, normalizedPath))
                {
                    return false;
                }

                RegisterMonitorProcess(normalizedPath, process);
                return true;
            }
            catch (Exception ex)
            {
                string platformName = platform == RuntimePlatform.OSXEditor ? "macOS" : "Windows";
                UnityEngine.Debug.LogError($"[C.A.D.E.T] Failed to launch {platformName} log tail monitor for '{normalizedPath}': {ex}");

                if (platform == RuntimePlatform.OSXEditor)
                {
                    UnityEngine.Debug.LogError("[C.A.D.E.T] macOS Terminal permission or automation issue may have blocked launch.");
                }

                return false;
            }
        }

        public static ProcessStartInfo BuildStartInfoForPlatform(string logPath, string label, RuntimePlatform platform)
        {
            if (platform == RuntimePlatform.WindowsEditor)
            {
                return BuildWindowsStartInfo(logPath, label);
            }

            if (platform == RuntimePlatform.OSXEditor)
            {
                return BuildMacStartInfo(logPath, label);
            }

            throw new PlatformNotSupportedException($"Log tail monitor is only supported on Windows and macOS editors. Platform: {platform}");
        }

        public static void SetProcessStarterForTests(ILogTailProcessStarter starter)
        {
            processStarter = starter ?? new DefaultLogTailProcessStarter();
        }

        public static void ResetForTests()
        {
            lock (SyncLock)
            {
                foreach (KeyValuePair<string, Process> entry in ActiveMonitorsByPath)
                {
                    TryDispose(entry.Value);
                }

                ActiveMonitorsByPath.Clear();
                LastLaunchByPathUtc.Clear();
                processStarter = new DefaultLogTailProcessStarter();
            }
        }

        private static string NormalizePath(string path)
        {
            return Path.GetFullPath(path)
                .Replace('/', Path.DirectorySeparatorChar)
                .Replace('\\', Path.DirectorySeparatorChar);
        }

        private static bool IsDuplicateRequest(string normalizedPath)
        {
            lock (SyncLock)
            {
                if (ActiveMonitorsByPath.TryGetValue(normalizedPath, out Process activeProcess))
                {
                    bool hasExited = SafeHasExited(activeProcess);
                    if (!hasExited)
                    {
                        return true;
                    }

                    TryDispose(activeProcess);
                    ActiveMonitorsByPath.Remove(normalizedPath);
                }

                if (LastLaunchByPathUtc.TryGetValue(normalizedPath, out DateTime lastLaunchUtc))
                {
                    if (DateTime.UtcNow - lastLaunchUtc < LaunchDedupWindow)
                    {
                        return true;
                    }
                }

                LastLaunchByPathUtc[normalizedPath] = DateTime.UtcNow;
                return false;
            }
        }

        private static void RegisterMonitorProcess(string normalizedPath, Process process)
        {
            lock (SyncLock)
            {
                ActiveMonitorsByPath[normalizedPath] = process;
            }

            try
            {
                process.EnableRaisingEvents = true;
                process.Exited += (_, _) =>
                {
                    lock (SyncLock)
                    {
                        if (ActiveMonitorsByPath.TryGetValue(normalizedPath, out Process existing) && existing == process)
                        {
                            ActiveMonitorsByPath.Remove(normalizedPath);
                            TryDispose(process);
                        }
                    }
                };
            }
            catch
            {
                // If we cannot attach exit events, cooldown dedupe still prevents click storms.
            }
        }

        private static bool SafeHasExited(Process process)
        {
            if (process == null)
            {
                return true;
            }

            try
            {
                return process.HasExited;
            }
            catch
            {
                return true;
            }
        }

        private static ProcessStartInfo BuildWindowsStartInfo(string logPath, string label)
        {
            string escapedPathForPowerShell = logPath.Replace("'", "''");
            string safeLabel = string.IsNullOrWhiteSpace(label) ? "Unity Log Monitor" : label;
            string safeLabelForCmd = safeLabel.Replace("\"", "");

            // Single command: open cmd window, set title, then tail with built-in Windows PowerShell.
            string powerShellCommand =
                "$Host.UI.RawUI.WindowTitle='" + safeLabelForCmd + "'; " +
                "Write-Host '[C.A.D.E.T] Unity Log Monitor started at' (Get-Date); " +
                "Write-Host '[C.A.D.E.T] Monitoring: " + escapedPathForPowerShell + "'; " +
                "Write-Host ''; " +
                "Get-Content -LiteralPath '" + escapedPathForPowerShell + "' -Tail 0 -Wait";

            return new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/k powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"{powerShellCommand}\"",
                UseShellExecute = true,
                CreateNoWindow = false
            };
        }

        private static ProcessStartInfo BuildMacStartInfo(string logPath, string label)
        {
            string escapedLogPathForAppleScript = EscapeForAppleScriptString(logPath);

            // Use AppleScript string handling plus `quoted form of` rather than nesting shell escaping
            // inside an osascript command string. This is substantially more robust for macOS paths.
            string arguments =
                $"-e \"set logPath to \\\"{escapedLogPathForAppleScript}\\\"\" " +
                "-e \"set tailCommand to \\\"tail -n 0 -F \\\" & quoted form of logPath\" " +
                "-e \"tell application \\\"Terminal\\\" to activate\" " +
                "-e \"tell application \\\"Terminal\\\" to do script tailCommand\"";

            return new ProcessStartInfo
            {
                FileName = "/usr/bin/osascript",
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
        }

        private static string EscapeForAppleScriptString(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static bool ValidateMacLaunchProcess(Process process, string normalizedPath)
        {
            if (process == null)
            {
                return false;
            }

            try
            {
                // osascript should exit almost immediately. If it exits with a non-zero code,
                // terminal launch failed (e.g., automation permissions), so report explicitly.
                if (!process.WaitForExit(1500))
                {
                    return true;
                }

                if (process.ExitCode == 0)
                {
                    return true;
                }

                string stdErr = process.StandardError?.ReadToEnd()?.Trim();
                if (string.IsNullOrWhiteSpace(stdErr))
                {
                    stdErr = process.StandardOutput?.ReadToEnd()?.Trim();
                }

                string detail = string.IsNullOrWhiteSpace(stdErr)
                    ? $"osascript exited with code {process.ExitCode}."
                    : stdErr;

                UnityEngine.Debug.LogError($"[C.A.D.E.T] Failed to launch macOS log tail monitor for '{normalizedPath}': {detail}");
                return false;
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogError($"[C.A.D.E.T] Failed to validate macOS log tail monitor launch for '{normalizedPath}': {ex.Message}");
                return false;
            }
        }

        private static void TryDispose(Process process)
        {
            try
            {
                process?.Dispose();
            }
            catch
            {
                // Best effort cleanup only.
            }
        }

        private static void LogDiagnostic(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return;
            }

            if (DebugLevel < GetMinimumLevel())
            {
                return;
            }

            UnityEngine.Debug.Log(message);
        }

        private static int GetMinimumLevel()
        {
            try
            {
                cachedMinimumLevel = EditorPrefs.GetInt(MinimumLevelEditorPrefsKey, cachedMinimumLevel);
            }
            catch (Exception)
            {
                return cachedMinimumLevel;
            }

            return cachedMinimumLevel;
        }
    }
}
