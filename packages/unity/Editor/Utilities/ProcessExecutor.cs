using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Threading;
using UnityEngine;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Unified process executor for bash script execution with platform-specific handling.
    /// Windows: Uses Cosmos bash with -c flag and sets COSMOS_BIN_DIR
    /// Mac/Linux: Uses system /bin/bash directly (no -c flag) and does NOT set COSMOS_BIN_DIR
    /// </summary>
    public class ProcessExecutor
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][ProcessExecutor]";
        // Thread-safe registry for tracking active processes
        private static readonly object processRegistryLock = new object();
        private static readonly Dictionary<int, ProcessInfo> activeProcesses = new Dictionary<int, ProcessInfo>();
        /// <summary>
        /// Result of script execution
        /// </summary>
        public class ProcessResult
        {
            public string Output { get; set; }
            public string Error { get; set; }
            public int ExitCode { get; set; }
            public bool Success => ExitCode == 0;
        }

        /// <summary>
        /// Execute a bash script synchronously
        /// </summary>
        public static ProcessResult ExecuteScript(
            string scriptPath,
            string arguments = "",
            string workingDirectory = null,
            Action<string> onOutputLine = null,
            int timeoutMs = 120000,
            Action<Process> onProcessStarted = null)
        {
            if (string.IsNullOrEmpty(scriptPath))
                throw new ArgumentException("Script path cannot be null or empty", nameof(scriptPath));

            if (!File.Exists(scriptPath))
            {
                return new ProcessResult
                {
                    Output = "",
                    Error = $"[ERROR] Script not found: {scriptPath}",
                    ExitCode = -1
                };
            }

            string projectPath = Path.GetDirectoryName(Application.dataPath);
            if (string.IsNullOrEmpty(workingDirectory))
                workingDirectory = projectPath;

            bool isWindows = Application.platform == RuntimePlatform.WindowsEditor;
            string bashPath = GetBashPath(isWindows, projectPath);
            string cosmosBinDir = GetCosmosBinDir(isWindows, projectPath);

            if (isWindows && string.IsNullOrEmpty(bashPath))
            {
                return new ProcessResult
                {
                    Output = "",
                    Error = "[ERROR] " + CadetLocalization.GetString("Window.PublishingToolsConfig.Messages.CosmosBinariesNotFound"),
                    ExitCode = -1
                };
            }

            ProcessStartInfo psi = CreateProcessStartInfo(
                isWindows,
                bashPath,
                scriptPath,
                arguments,
                workingDirectory,
                cosmosBinDir
            );

            return ExecuteProcess(psi, onOutputLine, timeoutMs, onProcessStarted);
        }

        /// <summary>
        /// Starts a bash script in detached mode and returns the spawned process identity.
        /// Scripts have special needs (cosmos bash on Windows, complex argument strings),
        /// so this implements its own detached launcher rather than delegating to ProcessLaunchService.
        /// </summary>
        public static bool TryStartDetachedScript(
            string scriptPath,
            string arguments,
            string workingDirectory,
            out int processId,
            out DateTime processStartUtc,
            out string errorMessage,
            string logDirectory = null)
        {
            processId = 0;
            processStartUtc = DateTime.UtcNow;
            errorMessage = string.Empty;
            Stopwatch stopwatch = Stopwatch.StartNew();
            long previousElapsedMs = 0;

            void LogTiming(string message)
            {
                long elapsedMs = stopwatch.ElapsedMilliseconds;
                long deltaMs = elapsedMs - previousElapsedMs;
                previousElapsedMs = elapsedMs;
                CadetFilteredLogger.Debug($"{DiagnosticsPrefix} Timing detached script '{scriptPath ?? string.Empty}' {message} +{deltaMs}ms total={elapsedMs}ms.");
            }

            if (string.IsNullOrEmpty(scriptPath))
            {
                errorMessage = "Script path cannot be null or empty";
                LogTiming("aborted: empty script path");
                return false;
            }

            if (!File.Exists(scriptPath))
            {
                errorMessage = $"Script not found: {scriptPath}";
                LogTiming("aborted: script file missing");
                return false;
            }

            string projectPath = Path.GetDirectoryName(Application.dataPath);
            if (string.IsNullOrEmpty(workingDirectory))
            {
                workingDirectory = projectPath;
            }

            bool isWindows = Application.platform == RuntimePlatform.WindowsEditor;
            string bashPath = GetBashPath(isWindows, projectPath);
            string cosmosBinDir = GetCosmosBinDir(isWindows, projectPath);
            LogTiming($"Resolved launcher environment isWindows={isWindows} bashPath='{bashPath ?? string.Empty}' cosmosBinDir='{cosmosBinDir ?? string.Empty}'");

            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} TryStartDetachedScript start isWindows={isWindows} script='{scriptPath}' workingDir='{workingDirectory}' " +
                $"logDirectory='{logDirectory ?? string.Empty}' bashPath='{bashPath ?? string.Empty}' cosmosBinDir='{cosmosBinDir ?? string.Empty}' args='{arguments ?? string.Empty}'.");

            if (isWindows && string.IsNullOrEmpty(bashPath))
            {
                errorMessage = CadetLocalization.GetString("Window.PublishingToolsConfig.Messages.CosmosBinariesNotFound");
                CadetFilteredLogger.Error($"{DiagnosticsPrefix} Detached launch aborted because cosmos bash path could not be resolved for script '{scriptPath}'.");
                LogTiming("aborted: bash path missing on Windows");
                return false;
            }

            // Build cosmos-aware bash command for Windows, system bash for Unix
            if (isWindows)
            {
                bool started = TryStartDetachedScriptWindows(bashPath, scriptPath, arguments, workingDirectory, cosmosBinDir, logDirectory, out processId, out processStartUtc, out errorMessage);
                LogTiming($"Windows detached launch returned started={started} pid={processId} startUtc={processStartUtc:O} error='{errorMessage ?? string.Empty}'");
                return started;
            }
            else
            {
                bool started = TryStartDetachedScriptUnix(bashPath, scriptPath, arguments, workingDirectory, logDirectory, out processId, out processStartUtc, out errorMessage);
                LogTiming($"Unix detached launch returned started={started} pid={processId} startUtc={processStartUtc:O} error='{errorMessage ?? string.Empty}'");
                return started;
            }
        }

        private static bool TryStartDetachedScriptWindows(
            string bashPath,
            string scriptPath,
            string arguments,
            string workingDirectory,
            string cosmosBinDir,
            string logDirectory,
            out int processId,
            out DateTime processStartUtc,
            out string errorMessage)
        {
            processId = 0;
            processStartUtc = DateTime.UtcNow;
            errorMessage = string.Empty;
            Stopwatch stopwatch = Stopwatch.StartNew();
            long previousElapsedMs = 0;

            void LogTiming(string message)
            {
                long elapsedMs = stopwatch.ElapsedMilliseconds;
                long deltaMs = elapsedMs - previousElapsedMs;
                previousElapsedMs = elapsedMs;
                CadetFilteredLogger.Debug($"{DiagnosticsPrefix} Timing windows detached script '{scriptPath ?? string.Empty}' {message} +{deltaMs}ms total={elapsedMs}ms.");
            }

            try
            {
                bool showConsoleWindow = ShouldShowDetachedBashConsole();
                string logsDir = !string.IsNullOrEmpty(logDirectory) ? logDirectory : Path.Combine(workingDirectory, "Logs");
                Directory.CreateDirectory(logsDir);
                string launchId = Guid.NewGuid().ToString("N");
                string pidFilePath = Path.Combine(logsDir, $"cadet-detached-launch-{launchId}.pid");
                string traceFilePath = Path.Combine(logsDir, $"cadet-detached-launch-{launchId}.trace.log");

                string logPath = Path.Combine(logsDir, Path.GetFileNameWithoutExtension(scriptPath) + ".log");
                string ps1Path = GenerateWindowsBashPs1(
                    bashPath,
                    scriptPath,
                    arguments,
                    cosmosBinDir,
                    captureOutput: false,
                    logPath: logPath,
                    keepConsoleOpen: showConsoleWindow,
                    pidFilePath: showConsoleWindow ? pidFilePath : null,
                    traceFilePath: traceFilePath,
                    launchLabel: launchId);
                LogTiming($"Prepared launch artifacts showConsoleWindow={showConsoleWindow} logsDir='{logsDir}'");

                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Windows detached launch prepared launchId='{launchId}' showConsoleWindow={showConsoleWindow} script='{scriptPath}' " +
                    $"workingDir='{workingDirectory}' ps1='{ps1Path}' pidFile='{pidFilePath}' trace='{traceFilePath}' log='{logPath}'.");

                ProcessStartInfo psi;
                if (showConsoleWindow)
                {
                    psi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = BuildWindowsCmdHostedConsoleFileArguments(ps1Path),
                        UseShellExecute = true,
                        WindowStyle = ProcessWindowStyle.Normal,
                        WorkingDirectory = workingDirectory
                    };
                }
                else
                {
                    psi = new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{ps1Path}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = false,
                        RedirectStandardError = false,
                        WorkingDirectory = workingDirectory
                    };
                }
                LogTiming($"Created ProcessStartInfo showConsoleWindow={showConsoleWindow}");

                CadetFilteredLogger.Debug($"{DiagnosticsPrefix} Windows detached launch start info: {BuildProcessStartInfoSummary(psi)}");

                using (var process = Process.Start(psi))
                {
                    LogTiming($"Process.Start returned hostPid={process?.Id ?? 0}");
                    if (process == null)
                    {
                        errorMessage = "Failed to start detached bash process.";
                        CadetFilteredLogger.Error(
                            $"{DiagnosticsPrefix} {errorMessage} launchId='{launchId}' script='{scriptPath}' trace='{traceFilePath}' log='{logPath}'.");
                        return false;
                    }

                    CadetFilteredLogger.Debug(
                        $"{DiagnosticsPrefix} Windows detached launcher host started launchId='{launchId}' hostPid={process.Id} showConsoleWindow={showConsoleWindow}.");

                    // In visible console mode, cmd/powershell host can stay alive after the child exits
                    // (the host remains open for inspection). Track the child bash PID, not the host PID.
                    if (showConsoleWindow)
                    {
                        if (!TryReadDetachedPid(pidFilePath, out int detachedChildPid))
                        {
                            LogTiming("Timed out waiting for visible-console child PID capture");
                            errorMessage = "Detached bash process launched, but child PID was not captured for the visible console path.";
                            CadetFilteredLogger.Error(
                                $"{DiagnosticsPrefix} {errorMessage} launchId='{launchId}' script='{scriptPath}' pidFile='{pidFilePath}' " +
                                $"pidState={DescribeFileArtifact(pidFilePath)} traceState={DescribeFileArtifact(traceFilePath)} logState={DescribeFileArtifact(logPath)} ps1State={DescribeFileArtifact(ps1Path)} " +
                                $"tracePreview='{ReadFilePreview(traceFilePath)}' pidPreview='{ReadFilePreview(pidFilePath)}'.");
                            return false;
                        }

                        processId = detachedChildPid;
                        processStartUtc = ResolveProcessStartUtc(processId);
                        LogTiming($"Visible-console child PID captured childPid={processId}");
                        CadetFilteredLogger.Debug(
                            $"{DiagnosticsPrefix} Windows detached child PID captured launchId='{launchId}' childPid={processId} startUtc={processStartUtc:O} " +
                            $"pidState={DescribeFileArtifact(pidFilePath)} traceState={DescribeFileArtifact(traceFilePath)}.");
                    }
                    else
                    {
                        processId = process.Id;
                        processStartUtc = ProcessLaunchService.ResolveProcessStartUtcOrNow(process);
                        LogTiming($"Hidden launch host PID captured pid={processId}");
                        CadetFilteredLogger.Debug(
                            $"{DiagnosticsPrefix} Windows hidden detached launch using host PID launchId='{launchId}' pid={processId} startUtc={processStartUtc:O} " +
                            $"traceState={DescribeFileArtifact(traceFilePath)}.");
                    }

                    TryDeleteFile(pidFilePath);
                    LogTiming($"Windows detached launch completed processId={processId}");
                    CadetFilteredLogger.Debug(
                        $"{DiagnosticsPrefix} Windows detached launch completed launchId='{launchId}' processId={processId} startUtc={processStartUtc:O} " +
                        $"traceState={DescribeFileArtifact(traceFilePath)} logState={DescribeFileArtifact(logPath)}.");
                    return true;
                }
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                LogTiming($"Windows detached launch exception='{ex.Message}'");
                CadetFilteredLogger.Error($"{DiagnosticsPrefix} Windows detached launch failed for script '{scriptPath}': {ex}");
                return false;
            }
        }

        private static bool ShouldShowDetachedBashConsole()
        {
            return CadetDebugPreferences.GetShowDetachedBashWindow();
        }

        private static bool TryStartDetachedScriptUnix(
            string bashPath,
            string scriptPath,
            string arguments,
            string workingDirectory,
            string logDirectory,
            out int processId,
            out DateTime processStartUtc,
            out string errorMessage)
        {
            processId = 0;
            processStartUtc = DateTime.UtcNow;
            errorMessage = string.Empty;

            try
            {
                bool showBashWindow = Application.platform == RuntimePlatform.OSXEditor && ShouldShowDetachedBashConsole();

                string logsDir = !string.IsNullOrWhiteSpace(logDirectory)
                    ? logDirectory
                    : Path.Combine(workingDirectory, "Logs");
                Directory.CreateDirectory(logsDir);

                string launchId = Guid.NewGuid().ToString("N");
                string launcherPath = Path.Combine(logsDir, $"cadet-detached-launch-{launchId}.sh");
                string pidFilePath = Path.Combine(logsDir, $"cadet-detached-launch-{launchId}.pid");

                string quotedWorkingDir = BashSingleQuote(workingDirectory);
                string quotedBashPath = BashSingleQuote(bashPath);
                string quotedScriptPath = BashSingleQuote(scriptPath);
                string quotedPidFilePath = BashSingleQuote(pidFilePath);

                string scriptBody;
                if (showBashWindow)
                {
                    scriptBody = "#!/bin/bash\n" +
                                 $"cd {quotedWorkingDir}\n" +
                                 $"\"{bashPath}\" \"{scriptPath}\" {arguments} &\n" +
                                 "child_pid=$!\n" +
                                 $"echo $child_pid > {quotedPidFilePath}\n" +
                                 "wait $child_pid\n";
                }
                else
                {
                    scriptBody = "#!/bin/bash\n" +
                                 $"cd {quotedWorkingDir}\n" +
                                 $"nohup {quotedBashPath} {quotedScriptPath} {arguments} > /dev/null 2>&1 &\n" +
                                 $"echo $! > {quotedPidFilePath}\n" +
                                 "exit 0\n";
                }

                File.WriteAllText(launcherPath, scriptBody);
                CadetFilteredLogger.Debug($"[C.A.D.E.T][ProcessExecutor] Unix detached launch prepared. showWindow={showBashWindow} launcher='{launcherPath}' pidFile='{pidFilePath}' script='{scriptPath}' workingDir='{workingDirectory}'.");

                // Ensure launcher is executable for open/Terminal invocation on macOS.
                var chmodInfo = new ProcessStartInfo
                {
                    FileName = "/bin/chmod",
                    Arguments = $"+x \"{launcherPath}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var chmodProcess = Process.Start(chmodInfo))
                {
                    chmodProcess?.WaitForExit(2000);
                }

                if (showBashWindow)
                {
                    var openInfo = new ProcessStartInfo
                    {
                        FileName = "open",
                        Arguments = $"-a Terminal \"{launcherPath}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WorkingDirectory = workingDirectory
                    };

                    using (var process = Process.Start(openInfo))
                    {
                        if (process == null)
                        {
                            errorMessage = "Failed to open Terminal for detached script process.";
                            return false;
                        }
                    }
                }
                else
                {
                    var launchInfo = new ProcessStartInfo
                    {
                        FileName = "/bin/bash",
                        Arguments = $"\"{launcherPath}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = false,
                        RedirectStandardError = false,
                        WorkingDirectory = workingDirectory
                    };

                    using (var process = Process.Start(launchInfo))
                    {
                        if (process == null)
                        {
                            errorMessage = "Failed to start detached script process.";
                            return false;
                        }
                    }
                }

                if (!TryReadDetachedPid(pidFilePath, out processId))
                {
                    errorMessage = "Detached script launched but PID was not captured.";
                    CadetFilteredLogger.Error($"[C.A.D.E.T][ProcessExecutor] {errorMessage} launcher='{launcherPath}' pidFile='{pidFilePath}' showWindow={showBashWindow}.");
                    return false;
                }

                processStartUtc = ResolveProcessStartUtc(processId);
                CadetFilteredLogger.Debug($"[C.A.D.E.T][ProcessExecutor] Unix detached launch captured PID {processId} startUtc={processStartUtc:O} showWindow={showBashWindow} script='{scriptPath}'.");

                // Best-effort cleanup of temporary launch artifacts.
                TryDeleteFile(launcherPath);
                TryDeleteFile(pidFilePath);
                return true;
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                CadetFilteredLogger.Error($"[C.A.D.E.T][ProcessExecutor] Unix detached launch failed for script '{scriptPath}': {ex}");
                return false;
            }
        }

        private static bool TryReadDetachedPid(string pidFilePath, out int pid)
        {
            pid = 0;
            const int maxAttempts = 40;

            for (int i = 0; i < maxAttempts; i++)
            {
                try
                {
                    if (File.Exists(pidFilePath))
                    {
                        string raw = File.ReadAllText(pidFilePath)?.Trim();
                        if (int.TryParse(raw, out int parsed) && parsed > 0)
                        {
                            pid = parsed;
                            return true;
                        }
                    }
                }
                catch
                {
                    // Ignore transient file access while launcher writes pid file.
                }

                Thread.Sleep(100);
            }

            return false;
        }

        private static DateTime ResolveProcessStartUtc(int pid)
        {
            try
            {
                using Process process = Process.GetProcessById(pid);
                return ProcessLaunchService.ResolveProcessStartUtcOrNow(process);
            }
            catch
            {
                return DateTime.UtcNow;
            }
        }

        private static void TryDeleteFile(string filePath)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(filePath) && File.Exists(filePath))
                {
                    File.Delete(filePath);
                }
            }
            catch
            {
                // Cleanup should never fail the launch path.
            }
        }

        private static string DescribeFileArtifact(string filePath)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(filePath))
                {
                    return "path=<empty>";
                }

                if (!File.Exists(filePath))
                {
                    return $"path='{filePath}' exists=false";
                }

                FileInfo info = new FileInfo(filePath);
                return $"path='{filePath}' exists=true size={info.Length} lastWriteUtc={info.LastWriteTimeUtc:O}";
            }
            catch (Exception ex)
            {
                return $"path='{filePath}' error='{ex.Message}'";
            }
        }

        private static string ReadFilePreview(string filePath, int maxChars = 1200)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
                {
                    return string.Empty;
                }

                string content = File.ReadAllText(filePath);
                if (content.Length > maxChars)
                {
                    content = content.Substring(0, maxChars);
                }

                return content.Replace("\r", "\\r").Replace("\n", "\\n");
            }
            catch (Exception ex)
            {
                return $"<read-failed:{ex.Message}>";
            }
        }

        private static string BuildProcessStartInfoSummary(ProcessStartInfo psi)
        {
            if (psi == null)
            {
                return "<null>";
            }

            return $"file='{psi.FileName}' args='{psi.Arguments}' useShellExecute={psi.UseShellExecute} createNoWindow={psi.CreateNoWindow} windowStyle={psi.WindowStyle} workingDir='{psi.WorkingDirectory}'";
        }

        private static string BashSingleQuote(string value)
        {
            if (value == null)
            {
                return "''";
            }

            return "'" + value.Replace("'", "'\"'\"'") + "'";
        }

        /// <summary>
        /// Execute a bash script asynchronously
        /// </summary>
        public static async Task<ProcessResult> ExecuteScriptAsync(
            string scriptPath,
            string arguments = "",
            string workingDirectory = null,
            Action<string> onOutputLine = null,
            int timeoutMs = 120000)
        {
            // Wrap callback to marshal back to Unity main thread
            Action<string> threadSafeOutputLine = onOutputLine != null
                ? (line) => UnityEditor.EditorApplication.delayCall += () => onOutputLine(line)
                : null;

            return await Task.Run(() => ExecuteScript(scriptPath, arguments, workingDirectory, threadSafeOutputLine, timeoutMs));
        }

        /// <summary>
        /// Get the appropriate bash path for the current platform
        /// </summary>
        private static string GetBashPath(bool isWindows, string projectPath)
        {
            if (isWindows)
            {
                // Check user directory
                string cosmosBashPath = Path.Combine(BuildToolsPathHelper.GetCosmosBinariesPath(), "bin", "bash");
                return File.Exists(cosmosBashPath) ? cosmosBashPath : null;
            }
            else
            {
                // Mac/Linux: Use system bash instead
                return "/bin/bash";
            }
        }

        /// <summary>
        /// Get Cosmos bin directory path (Windows only, returns null on Mac/Linux)
        /// </summary>
        private static string GetCosmosBinDir(bool isWindows, string projectPath)
        {
            if (!isWindows)
                return null; // DO NOT set COSMOS_BIN_DIR on Mac/Linux

            // Check user directory
            string cosmosBinDir = Path.Combine(BuildToolsPathHelper.GetCosmosBinariesPath(), "bin");
            return Directory.Exists(cosmosBinDir) ? cosmosBinDir : null;
        }

        /// <summary>
        /// Builds an inline PowerShell command that mirrors the known-good minimal test:
        ///   $env:PATH = 'cosmosBin;' + $env:PATH
        ///   $env:COSMOS_BIN_DIR = 'cosmosBin'
        ///   Start-Process -FilePath 'bash' -ArgumentList 'script', args... -NoNewWindow -Wait
        /// Used only for the visible debug console path.
        /// </summary>
        private static string BuildWindowsMinimalConsoleCommand(
            string bashPath,
            string scriptPath,
            string arguments,
            string cosmosBinDir,
            string pidFilePath)
        {
            string escapedCosmosBin = cosmosBinDir.Replace("'", "''");
            string escapedBash = bashPath.Replace("'", "''");
            string escapedPidFile = pidFilePath.Replace("'", "''");

            return string.Join("; ", new[]
            {
                $"$env:PATH = '{escapedCosmosBin};' + $env:PATH",
                $"$env:COSMOS_BIN_DIR = '{escapedCosmosBin}'",
                $"$p = Start-Process -FilePath '{escapedBash}' -ArgumentList {BuildArgumentList(EscapeBashPath(scriptPath), arguments)} -NoNewWindow -PassThru",
                $"Set-Content -Path '{escapedPidFile}' -Value $p.Id -NoNewline",
                "Wait-Process -Id $p.Id",
                "$p.Refresh()",
                "Write-Host ''",
                "Write-Host '[CADET] Exit code:' $p.ExitCode",
                "Read-Host '[CADET] Press Enter to close this window'",
                "exit $p.ExitCode"
            });
        }

        /// <summary>
        /// Helper to build PowerShell argument list string without LINQ
        /// </summary>
        private static string BuildArgumentList(string scriptPath, string arguments)
        {
            var argList = new System.Text.StringBuilder();
            argList.Append("'").Append(scriptPath.Replace("'", "''")).Append("'");
            if (!string.IsNullOrEmpty(arguments))
            {
                string[] args = arguments.Trim().Split(new[] { ' ' }, System.StringSplitOptions.RemoveEmptyEntries);
                foreach (string a in args)
                {
                    argList.Append(", '").Append(a.Replace("'", "''")).Append("'");
                }
            }
            return argList.ToString();
        }

        private static string BuildWindowsCmdHostedConsoleArguments(string powerShellCommand)
        {
            string encodedCommand = Convert.ToBase64String(Encoding.Unicode.GetBytes(powerShellCommand));
            return $"/c powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand {encodedCommand}";
        }

        private static string BuildWindowsCmdHostedConsoleFileArguments(string ps1Path)
        {
            string escapedPs1Path = ps1Path.Replace("\"", "\"\"");
                return $"/c powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{escapedPs1Path}\"";
        }

        /// <summary>
        /// Generates a temporary PowerShell script that mirrors cosmos-bash-build-help-minimal.ps1:
        ///   $env:PATH = 'cosmosBin;' + $env:PATH
        ///   $env:COSMOS_BIN_DIR = 'cosmosBin'
        ///   $p = Start-Process -FilePath 'bash' -ArgumentList 'script', args... -NoNewWindow -PassThru -Wait
        ///   exit $p.ExitCode
        /// Bash stdout/stderr are always captured to temp files. They are written to logPath and,
        /// when captureOutput=true, also piped to powershell's own stdout/stderr so C# can read them.
        /// </summary>
        private static string GenerateWindowsBashPs1(
            string bashPath,
            string scriptPath,
            string arguments,
            string cosmosBinDir,
            bool captureOutput,
            string logPath,
            bool keepConsoleOpen = false,
            string pidFilePath = null,
            string traceFilePath = null,
            string launchLabel = null)
        {
            string ps1Path = Path.Combine(Path.GetTempPath(), $"cadet-bash-{Guid.NewGuid():N}.ps1");
            string escapedCosmosBin = cosmosBinDir.Replace("'", "''");
            string escapedBash      = bashPath.Replace("'", "''");
            string escapedScript    = scriptPath.Replace("'", "''");
            string escapedLogPath   = logPath.Replace("'", "''");
            string escapedLogDir    = Path.GetDirectoryName(logPath).Replace("'", "''");
            string escapedPidPath   = string.IsNullOrWhiteSpace(pidFilePath) ? null : pidFilePath.Replace("'", "''");
            string escapedTracePath = string.IsNullOrWhiteSpace(traceFilePath) ? null : traceFilePath.Replace("'", "''");
            string escapedLaunchLabel = string.IsNullOrWhiteSpace(launchLabel) ? string.Empty : launchLabel.Replace("'", "''");

            // Build PS1 -ArgumentList: 'scriptPath', 'arg1', 'arg2', ...
            var argItems = new List<string> { $"'{escapedScript}'" };
            if (!string.IsNullOrEmpty(arguments))
            {
                foreach (string arg in arguments.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
                    argItems.Add($"'{arg.Replace("'", "''")}'" );
            }
            string argList = string.Join(", ", argItems);

            var sb = new StringBuilder();
            sb.AppendLine("$ErrorActionPreference = 'Stop'");
            if (!string.IsNullOrWhiteSpace(escapedTracePath))
            {
                sb.AppendLine("function Write-CadetTrace([string]$message) {");
                sb.AppendLine($"    Add-Content -LiteralPath '{escapedTracePath}' -Value (([DateTime]::UtcNow.ToString('o')) + ' {escapedLaunchLabel} ' + $message)");
                sb.AppendLine("}");
                sb.AppendLine("Write-CadetTrace 'launcher-start'");
            }
            sb.AppendLine($"$env:PATH = '{escapedCosmosBin};' + $env:PATH");
            sb.AppendLine($"$env:COSMOS_BIN_DIR = '{escapedCosmosBin}'");
            sb.AppendLine($"$null = New-Item -ItemType Directory -Force -Path '{escapedLogDir}'");
            sb.AppendLine("$__out = [System.IO.Path]::GetTempFileName()");
            sb.AppendLine("$__err = [System.IO.Path]::GetTempFileName()");
            if (!string.IsNullOrWhiteSpace(escapedTracePath))
            {
                sb.AppendLine($"Write-CadetTrace \"before-start bash='{escapedBash}' script='{escapedScript}' keepConsoleOpen={keepConsoleOpen} captureOutput={captureOutput} cwd=$((Get-Location).Path)\"");
            }
            sb.AppendLine($"$p = Start-Process -FilePath '{escapedBash}' -ArgumentList {argList} -NoNewWindow -PassThru -RedirectStandardOutput $__out -RedirectStandardError $__err");
            if (!string.IsNullOrWhiteSpace(escapedPidPath))
            {
                sb.AppendLine($"Set-Content -LiteralPath '{escapedPidPath}' -Value $p.Id -NoNewline");
                if (!string.IsNullOrWhiteSpace(escapedTracePath))
                {
                    sb.AppendLine($"Write-CadetTrace \"pid-written path='{escapedPidPath}' pid=$($p.Id)\"");
                }
            }
            else if (!string.IsNullOrWhiteSpace(escapedTracePath))
            {
                sb.AppendLine("Write-CadetTrace \"pid-file-disabled\"");
            }
            if (!string.IsNullOrWhiteSpace(escapedTracePath))
            {
                sb.AppendLine("Write-CadetTrace \"waiting-for-child pid=$($p.Id)\"");
            }
            sb.AppendLine("function Write-CadetRedirectedLines([string]$path, [ref]$offset, [bool]$isError, [bool]$emitConsole) {");
            sb.AppendLine("    if (-not (Test-Path -LiteralPath $path)) { return }");
            sb.AppendLine("    $lines = @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)");
            sb.AppendLine("    if ($null -eq $lines -or $lines.Count -eq 0) { return }");
            sb.AppendLine("    for ($i = $offset.Value; $i -lt $lines.Count; $i++) {");
            sb.AppendLine("        $line = $lines[$i]");
            sb.AppendLine("        Add-Content -LiteralPath '" + escapedLogPath + "' -Value $line -Encoding utf8");
            sb.AppendLine("        if ($emitConsole) {");
            sb.AppendLine("            if ($isError) { [Console]::Error.WriteLine($line) } else { Write-Host $line }");
            sb.AppendLine("        }");
            sb.AppendLine("    }");
            sb.AppendLine("    $offset.Value = $lines.Count");
            sb.AppendLine("}");
            sb.AppendLine("$__outOffset = 0");
            sb.AppendLine("$__errOffset = 0");
            sb.AppendLine("while (-not $p.HasExited) {");
            sb.AppendLine("    Write-CadetRedirectedLines $__out ([ref]$__outOffset) $false " + (keepConsoleOpen ? "$true" : "$false"));
            sb.AppendLine("    Write-CadetRedirectedLines $__err ([ref]$__errOffset) $true " + (keepConsoleOpen ? "$true" : "$false"));
            sb.AppendLine("    Start-Sleep -Milliseconds 200");
            sb.AppendLine("    $p.Refresh()");
            sb.AppendLine("}");
            sb.AppendLine("$p.WaitForExit()");
            sb.AppendLine("$p.Refresh()");
            sb.AppendLine("Write-CadetRedirectedLines $__out ([ref]$__outOffset) $false " + (keepConsoleOpen ? "$true" : "$false"));
            sb.AppendLine("Write-CadetRedirectedLines $__err ([ref]$__errOffset) $true " + (keepConsoleOpen ? "$true" : "$false"));
            sb.AppendLine("$__outLines = Get-Content -LiteralPath $__out -ErrorAction SilentlyContinue");
            sb.AppendLine("$__errLines = Get-Content -LiteralPath $__err -ErrorAction SilentlyContinue");

            if (captureOutput)
            {
                // Pipe to PS1's own stdout/stderr so C# can capture them via redirected streams
                sb.AppendLine("$__outLines");
                sb.AppendLine("$__errLines | ForEach-Object { [Console]::Error.WriteLine($_) }");
            }
            if (!string.IsNullOrWhiteSpace(escapedTracePath))
            {
                sb.AppendLine("Write-CadetTrace \"child-exited exitCode=$($p.ExitCode) outLines=$($__outLines.Count) errLines=$($__errLines.Count)\"");
            }
            sb.AppendLine("Remove-Item -LiteralPath $__out, $__err -ErrorAction SilentlyContinue");

            if (keepConsoleOpen)
            {
                sb.AppendLine("Write-Host ''");
                sb.AppendLine("Write-Host '[CADET] Exit code:' $p.ExitCode");
                sb.AppendLine("Read-Host '[CADET] Press Enter to close this window'");
                sb.AppendLine("exit $p.ExitCode");
            }
            else
            {
                sb.AppendLine("exit $p.ExitCode");
            }

            File.WriteAllText(ps1Path, sb.ToString(), Encoding.UTF8);
            return ps1Path;
        }

        /// <summary>
        /// Create ProcessStartInfo with platform-specific configuration.
        /// Windows: generates a PS1 (cosmos-bash-build-help-minimal approach) and runs via powershell.exe.
        /// Mac/Linux: runs /bin/bash directly.
        /// </summary>
        private static ProcessStartInfo CreateProcessStartInfo(
            bool isWindows,
            string bashPath,
            string scriptPath,
            string arguments,
            string workingDirectory,
            string cosmosBinDir)
        {
            if (isWindows)
            {
                string logPath = Path.Combine(workingDirectory, "Logs", Path.GetFileNameWithoutExtension(scriptPath) + ".log");
                string ps1Path = GenerateWindowsBashPs1(bashPath, scriptPath, arguments, cosmosBinDir, captureOutput: true, logPath: logPath);
                return new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NonInteractive -NoProfile -ExecutionPolicy Bypass -File \"{ps1Path}\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = workingDirectory
                };
            }
            else
            {
                // Mac/Linux: run bash directly with inherited environment
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = bashPath,
                    Arguments = string.IsNullOrEmpty(arguments)
                        ? $"\"{scriptPath}\""
                        : $"\"{scriptPath}\" {arguments}",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = workingDirectory
                };

                foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
                    psi.EnvironmentVariables[entry.Key.ToString()] = entry.Value.ToString();

                return psi;
            }
        }

        /// <summary>
        /// Execute the process and capture output
        /// </summary>
        private static ProcessResult ExecuteProcess(ProcessStartInfo psi, Action<string> onOutputLine, int timeoutMs, Action<Process> onProcessStarted = null)
        {
            ProcessResult result = new ProcessResult
            {
                Output = "",
                Error = "",
                ExitCode = -1
            };

            ProcessInfo processInfo = null;

            try
            {
                using Process process = new Process();
                process.StartInfo = psi;

                StringBuilder output = new StringBuilder();
                StringBuilder error = new StringBuilder();

                process.OutputDataReceived += (sender, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        output.AppendLine(e.Data);
                        onOutputLine?.Invoke(e.Data);
                    }
                };

                process.ErrorDataReceived += (sender, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        error.AppendLine(e.Data);
                        onOutputLine?.Invoke(e.Data);
                    }
                };

                ProcessLaunchService.StartAttached(process);
                
                // Register process for tracking
                processInfo = new ProcessInfo
                {
                    ProcessId = process.Id,
                    Command = $"{psi.FileName} {psi.Arguments}",
                    Arguments = ExtractArguments(psi),
                    StartTime = DateTime.Now,
                    Process = process
                };
                RegisterProcess(processInfo);
                
                // Begin asynchronous reading BEFORE WaitForExit to ensure real-time output capture
                // OutputDataReceived events will fire as data becomes available
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                // Notify callback that process has started (for cancellation support)
                onProcessStarted?.Invoke(process);

                // Wait for process to exit - output will be captured in real-time via event handlers
                // Note: For processes that buffer output internally (like SteamCMD.exe on Windows),
                // output may still be buffered by the process itself, but this setup ensures
                // we capture it as soon as it's available from the process's stdout/stderr
                bool exited = process.WaitForExit(timeoutMs);

                if (!exited)
                {
                    process.Kill();
                    result.Error = $"[ERR] Process timeout after {timeoutMs}ms";
                    result.ExitCode = -1;
                    UnregisterProcess(process.Id);
                    return result;
                }

                result.Output = output.ToString();
                result.Error = error.ToString();
                result.ExitCode = process.ExitCode;

                // Detect if process was killed externally
                bool wasKilled = WasProcessKilled(process, result.ExitCode);
                if (wasKilled)
                {
                    if (string.IsNullOrEmpty(result.Error))
                    {
                        result.Error = "[ERROR] Process was terminated (killed externally)";
                    }
                    else
                    {
                        result.Error = "[ERROR] Process was terminated (killed externally)\n" + result.Error;
                    }
                }
            }
            catch (Exception ex)
            {
                result.Error = $"[ERR] {ex.Message}";
                result.ExitCode = -1;
            }
            finally
            {
                // Unregister process when done
                if (processInfo != null)
                {
                    UnregisterProcess(processInfo.ProcessId);
                }
            }

            return result;
        }

        /// <summary>
        /// Convert Windows path to Unix-style path for Cosmos bash.
        /// Converts "F:/path" or "F:\path" to "/f/path"
        /// </summary>
        private static string ToUnixPath(string winPath)
        {
            if (string.IsNullOrEmpty(winPath)) return winPath;
            winPath = winPath.Replace('\\', '/');
            if (winPath.Length >= 2 && winPath[1] == ':')
            {
                return "/" + char.ToLower(winPath[0]) + winPath[2..];
            }
            return winPath;
        }

        /// <summary>
        /// Escape single quotes in paths for bash command strings
        /// </summary>
        private static string EscapeBashPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return path;
            return path.Replace("'", "'\\''");
        }

        /// <summary>
        /// Preserve essential Windows environment variables needed by Unity and other tools
        /// </summary>
        private static void PreserveEssentialEnvironmentVariables(ProcessStartInfo psi)
        {
            // Essential Windows environment variables
            string[] essentialVars = {
                "APPDATA", "LOCALAPPDATA", "USERPROFILE", "TEMP", "TMP",
                "PATH", "SystemRoot", "ProgramFiles", "ProgramFiles(x86)",
                "CommonProgramFiles", "CommonProgramFiles(x86)"
            };

            // Preserve essential variables
            foreach (string varName in essentialVars)
            {
                string value = Environment.GetEnvironmentVariable(varName);
                if (!string.IsNullOrEmpty(value))
                {
                    psi.EnvironmentVariables[varName] = value;
                }
            }

            // On Windows, HOME might not be set - set it to USERPROFILE if available
            if (!psi.EnvironmentVariables.ContainsKey("HOME"))
            {
                string userProfile = Environment.GetEnvironmentVariable("USERPROFILE");
                if (!string.IsNullOrEmpty(userProfile))
                {
                    psi.EnvironmentVariables["HOME"] = userProfile;
                }
            }
        }

        /// <summary>
        /// Register a process for tracking
        /// </summary>
        private static void RegisterProcess(ProcessInfo processInfo)
        {
            lock (processRegistryLock)
            {
                activeProcesses[processInfo.ProcessId] = processInfo;
            }
        }

        /// <summary>
        /// Unregister a process from tracking
        /// </summary>
        private static void UnregisterProcess(int processId)
        {
            lock (processRegistryLock)
            {
                activeProcesses.Remove(processId);
            }
        }

        /// <summary>
        /// Extract arguments from ProcessStartInfo
        /// </summary>
        private static string ExtractArguments(ProcessStartInfo psi)
        {
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                // On Windows, extract arguments from bash -c command
                string args = psi.Arguments;
                if (args.StartsWith("-c \"") && args.Contains("bash '"))
                {
                    int bashIdx = args.IndexOf("bash '");
                    int scriptEndIdx = args.IndexOf("'", bashIdx + 6);
                    if (scriptEndIdx > bashIdx + 6)
                    {
                        return args.Substring(scriptEndIdx + 1).TrimEnd('"');
                    }
                }
            }
            else
            {
                // On Mac/Linux, extract arguments after script path
                string args = psi.Arguments;
                if (args.StartsWith("\""))
                {
                    int endIdx = args.IndexOf("\"", 1);
                    if (endIdx > 1 && endIdx < args.Length - 1)
                    {
                        return args.Substring(endIdx + 1).Trim();
                    }
                }
            }
            return "";
        }

        /// <summary>
        /// Detect if a process was killed externally vs. exited normally
        /// </summary>
        private static bool WasProcessKilled(Process process, int exitCode)
        {
            try
            {
                // On Windows, exit code -1 typically indicates kill (Process.Kill() or external termination)
                // Other non-zero exit codes are normal script failures, not external kills
                if (Application.platform == RuntimePlatform.WindowsEditor)
                {
                    // Only exit code -1 indicates external kill on Windows
                    // Exit codes 1-255 are normal script failures
                    return exitCode == -1;
                }
                else
                {
                    // On Unix, exit codes 128+ typically indicate signals (kill)
                    // Exit code -1 or other negative values also indicate kill
                    return exitCode < 0 || exitCode >= 128;
                }
            }
            catch
            {
                // If we can't determine, assume it wasn't killed
                return false;
            }
        }
    }
}

