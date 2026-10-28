using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using UnityEngine;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Shared process launch helper used by both attached execution flows and detached launch flows.
    /// </summary>
    public static class ProcessLaunchService
    {
        public static void StartAttached(Process process)
        {
            if (process == null)
            {
                throw new ArgumentNullException(nameof(process));
            }

            process.Start();
        }

        public static bool TryStartDetached(
            string fileName,
            string arguments,
            string workingDirectory,
            string statusManifestPath,
            string jobGuid,
            string launchToken,
            out int processId,
            out DateTime processStartUtc,
            out string errorMessage)
        {
            processId = 0;
            processStartUtc = DateTime.UtcNow;
            errorMessage = string.Empty;

            try
            {
                if (Application.platform == RuntimePlatform.WindowsEditor)
                {
                    ProcessStartInfo windowsStartInfo = CreateDetachedStartInfo(
                        Application.platform,
                        fileName,
                        arguments,
                        workingDirectory);

                    using (var process = Process.Start(windowsStartInfo))
                    {
                        if (process == null)
                        {
                            errorMessage = "Failed to start detached process.";
                            return false;
                        }

                        processId = process.Id;
                        processStartUtc = TryGetProcessStartUtc(process);

                        if (!string.IsNullOrWhiteSpace(statusManifestPath) &&
                            !string.IsNullOrWhiteSpace(jobGuid) &&
                            !string.IsNullOrWhiteSpace(launchToken))
                        {
                            string watcherLogPath = BuildWatcherDebugLogPath(statusManifestPath);
                            if (!TryStartDetachedStatusWatcherWindows(processId, statusManifestPath, jobGuid, launchToken, watcherLogPath, out string watcherError))
                            {
                                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Detached status watcher did not start for PID {processId}: {watcherError}. Log: {watcherLogPath}");
                            }
                        }

                        return true;
                    }
                }

                ProcessStartInfo directStartInfo = CreateDetachedStartInfo(
                    Application.platform,
                    fileName,
                    arguments,
                    workingDirectory);

                using (var process = Process.Start(directStartInfo))
                {
                    if (process == null)
                    {
                        errorMessage = "Failed to start detached process.";
                        return false;
                    }

                    processId = process.Id;
                    processStartUtc = TryGetProcessStartUtc(process);
                    return true;
                }
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }
        }

        public static ProcessStartInfo CreateDetachedStartInfo(
            RuntimePlatform platform,
            string fileName,
            string arguments,
            string workingDirectory)
        {
            return new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments ?? string.Empty,
                WorkingDirectory = workingDirectory ?? string.Empty,
                UseShellExecute = false,
                CreateNoWindow = platform == RuntimePlatform.WindowsEditor,
                RedirectStandardOutput = false,
                RedirectStandardError = false
            };
        }

        public static DateTime ResolveProcessStartUtcOrNow(Process process)
        {
            return TryGetProcessStartUtc(process);
        }

        private static DateTime TryGetProcessStartUtc(Process process)
        {
            if (process == null)
            {
                return DateTime.UtcNow;
            }

            try
            {
                return process.StartTime.ToUniversalTime();
            }
            catch
            {
                return DateTime.UtcNow;
            }
        }

        private static bool TryStartDetachedStatusWatcherWindows(
            int targetProcessId,
            string statusManifestPath,
            string jobGuid,
            string launchToken,
            string watcherLogPath,
            out string errorMessage)
        {
            errorMessage = string.Empty;

            if (targetProcessId <= 0)
            {
                errorMessage = "Target PID was invalid.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(statusManifestPath) ||
                string.IsNullOrWhiteSpace(jobGuid) ||
                string.IsNullOrWhiteSpace(launchToken))
            {
                errorMessage = "Status watcher requires statusManifestPath, jobGuid, and launchToken.";
                return false;
            }

            try
            {
                string script = BuildDetachedStatusWatcherScript(targetProcessId, statusManifestPath, jobGuid, launchToken, watcherLogPath);

                // Encode as UTF-16LE Base64 for -EncodedCommand: no file on disk,
                // no command-line escaping or length issues.
                string encodedScript = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));

                var watcherStartInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand " + encodedScript,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false
                };

                using (var watcher = Process.Start(watcherStartInfo))
                {
                    if (watcher == null)
                    {
                        errorMessage = "Failed to start detached status watcher process.";
                        return false;
                    }
                }

                return true;
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }
        }

        private static string BuildDetachedStatusWatcherScript(
            int targetProcessId,
            string statusManifestPath,
            string jobGuid,
            string launchToken,
            string watcherLogPath)
        {
            // Use single-quoted PS strings; replace any embedded single quotes.
            string escapedManifestPath = (statusManifestPath ?? string.Empty).Replace("'", "''");
            string escapedJobGuid = (jobGuid ?? string.Empty).Replace("'", "''");
            string escapedLaunchToken = (launchToken ?? string.Empty).Replace("'", "''");
            string escapedWatcherLogPath = (watcherLogPath ?? string.Empty).Replace("'", "''");

            // Written as a proper script file (not -Command inline) to avoid length/escaping limits.
            return
                "$ErrorActionPreference = 'SilentlyContinue'\n" +
                "$pidToWatch = " + targetProcessId + "\n" +
                "$statusPath = '" + escapedManifestPath + "'\n" +
                "$jobGuid = '" + escapedJobGuid + "'\n" +
                "$launchToken = '" + escapedLaunchToken + "'\n" +
                "$watcherLogPath = '" + escapedWatcherLogPath + "'\n" +
                "function Write-Diag([string]$line) {\n" +
                "    if ([string]::IsNullOrWhiteSpace($watcherLogPath)) { return }\n" +
                "    try {\n" +
                "        $prefix = [DateTime]::UtcNow.ToString('o') + ' ' + $line + [Environment]::NewLine\n" +
                "        [System.IO.File]::AppendAllText($watcherLogPath, $prefix, [System.Text.Encoding]::UTF8)\n" +
                "    } catch { }\n" +
                "}\n" +
                "$startedAt = [DateTime]::UtcNow.ToString('o')\n" +
                "$exitCode = 1\n" +
                "Write-Diag ('Watcher start. pid=' + $pidToWatch + '; manifest=' + $statusPath)\n" +
                "try {\n" +
                "    $proc = [System.Diagnostics.Process]::GetProcessById($pidToWatch)\n" +
                "    if ($null -ne $proc) {\n" +
                "        # Force handle acquisition before WaitForExit; otherwise ExitCode can resolve as 0.\n" +
                "        $null = $proc.Handle\n" +
                "        Write-Diag ('Attached to pid=' + $proc.Id + '; name=' + $proc.ProcessName)\n" +
                "        $proc.WaitForExit()\n" +
                "        $proc.Refresh()\n" +
                "        Write-Diag ('After refresh. hasExited=' + $proc.HasExited)\n" +
                "        $exitCode = [int]$proc.ExitCode\n" +
                "        Write-Diag ('Process exited. exitCode=' + $exitCode)\n" +
                "    }\n" +
                "} catch {\n" +
                "    $exitCode = 1\n" +
                "    Write-Diag ('Exception while watching process: ' + $_.Exception.Message)\n" +
                "}\n" +
                "$overall = if ($exitCode -eq 0) { 'completed' } else { 'failed' }\n" +
                "$message = if ($exitCode -eq 0) { 'Unity build completed successfully.' } else { \"Unity build failed with exit code $exitCode.\" }\n" +
                "Write-Diag ('Final status=' + $overall + '; exitCode=' + $exitCode)\n" +
                "$terminalAt = [DateTime]::UtcNow.ToString('o')\n" +
                "$obj = [ordered]@{\n" +
                "    schemaVersion = 1\n" +
                "    jobGuid = $jobGuid\n" +
                "    launchToken = $launchToken\n" +
                "    profileName = ''\n" +
                "    startedAtUtc = $startedAt\n" +
                "    updatedAtUtc = $terminalAt\n" +
                "    terminalAtUtc = $terminalAt\n" +
                "    overallStatus = $overall\n" +
                "    currentOperation = 'unity_build'\n" +
                "    currentMessage = $message\n" +
                "    exitCode = [int]$exitCode\n" +
                "    operations = @(@{ id = 'unity_build'; label = 'Unity Build'; status = $overall; message = $message })\n" +
                "    summary = @($message)\n" +
                "}\n" +
                "$json = $obj | ConvertTo-Json -Compress -Depth 6\n" +
                "$statusDir = Split-Path -Parent $statusPath\n" +
                "if (-not [string]::IsNullOrWhiteSpace($statusDir)) { New-Item -ItemType Directory -Path $statusDir -Force | Out-Null }\n" +
                "[System.IO.File]::WriteAllText($statusPath, $json, [System.Text.Encoding]::UTF8)\n" +
                "Write-Diag 'Manifest write complete.'\n";
        }

        private static string BuildWatcherDebugLogPath(string statusManifestPath)
        {
            if (string.IsNullOrWhiteSpace(statusManifestPath))
            {
                return string.Empty;
            }

            return statusManifestPath + ".watcher.log";
        }
    }
}