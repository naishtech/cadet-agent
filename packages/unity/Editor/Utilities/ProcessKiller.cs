using System;
using System.Diagnostics;
using UnityEngine;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Utility class for killing processes and their child processes.
    /// Handles platform-specific process termination including git processes.
    /// </summary>
    public static class ProcessKiller
    {
        /// <summary>
        /// Kills a process and all its children on Windows using taskkill.
        /// Also kills any orphaned git processes that might have been spawned.
        /// </summary>
        /// <param name="processId">The process ID to kill</param>
        public static void KillProcessTreeWindows(int processId)
        {
            try
            {
                // Use taskkill /T /F to kill the process tree (parent + all children)
                // /T = kill process tree (child processes)
                // /F = force kill
                // This will kill bash.exe, git.exe, git-remote-https.exe, and any other child processes
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = $"/T /F /PID {processId}",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                
                using (Process killProcess = Process.Start(psi))
                {
                    if (killProcess != null)
                    {
                        killProcess.WaitForExit(5000);
                        if (killProcess.ExitCode != 0)
                        {
                            UnityEngine.Debug.LogWarning($"[C.A.D.E.T] taskkill exited with code {killProcess.ExitCode} for PID {processId}");
                        }
                    }
                }
                
                // Also kill any orphaned git processes that might have been spawned
                // This handles cases where git.exe spawns git-remote-https.exe for network operations
                // and the child process might not be properly associated with the parent tree
                KillOrphanedGitProcessesWindows();
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Error using taskkill to kill process tree: {ex.Message}");
            }
        }
        
        /// <summary>
        /// Kills any orphaned git processes on Windows that might have been spawned during the build.
        /// This is a safety measure for cases where git-remote-https.exe or similar processes
        /// might not be properly terminated by killing the parent process tree.
        /// Only kills git processes from the Git for Windows installation.
        /// </summary>
        public static void KillOrphanedGitProcessesWindows()
        {
            try
            {
                // Get all git-related processes
                string[] gitProcessNames = { "git", "git-remote-https", "git-remote-http", "git-credential-manager" };
                
                foreach (string processName in gitProcessNames)
                {
                    try
                    {
                        Process[] gitProcesses = Process.GetProcessesByName(processName);
                        foreach (Process gitProcess in gitProcesses)
                        {
                            try
                            {
                                // Check if this git process is associated with Git for Windows (our git)
                                // by checking if it's from the Git installation directory
                                string processPath = "";
                                try
                                {
                                    processPath = gitProcess.MainModule?.FileName ?? "";
                                }
                                catch
                                {
                                    // Can't get process path, skip this process
                                    continue;
                                }
                                
                                // Only kill git processes from the Git for Windows installation
                                if (processPath.Contains("Git") && processPath.Contains("bin"))
                                {
                                    gitProcess.Kill();
                                }
                            }
                            catch (Exception ex)
                            {
                                // Process might have already exited
                                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Could not kill git process {processName}: {ex.Message}");
                            }
                            finally
                            {
                                gitProcess.Dispose();
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Error getting {processName} processes: {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Error killing orphaned git processes: {ex.Message}");
            }
        }
        
        /// <summary>
        /// Kills a process and all its children on Unix-like systems (Mac/Linux).
        /// Also kills any orphaned git processes that might have been spawned.
        /// </summary>
        /// <param name="processId">The process ID to kill</param>
        public static void KillProcessTreeUnix(int processId)
        {
            try
            {
                // Use pkill -P to kill process and its children, or kill with negative PID for process group
                // First try pkill (more modern, available on most systems)
                // This will kill bash, git, and any child processes
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "pkill",
                    Arguments = $"-P {processId}",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                
                using (Process killProcess = Process.Start(psi))
                {
                    if (killProcess != null)
                    {
                        killProcess.WaitForExit(2000);
                    }
                }
                
                // Also kill the parent process itself
                psi = new ProcessStartInfo
                {
                    FileName = "kill",
                    Arguments = $"-9 {processId}",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                
                using (Process killProcess = Process.Start(psi))
                {
                    if (killProcess != null)
                    {
                        killProcess.WaitForExit(2000);
                    }
                }
                
                // Kill any orphaned git processes (git-remote-https, etc.)
                KillOrphanedGitProcessesUnix();
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Error killing process tree on Unix: {ex.Message}");
            }
        }
        
        /// <summary>
        /// Kills any orphaned git processes on Unix systems.
        /// Uses pkill to find and kill git-related processes.
        /// </summary>
        public static void KillOrphanedGitProcessesUnix()
        {
            try
            {
                // Kill any git-remote processes that might be hanging
                string[] gitProcessPatterns = { "git-remote-https", "git-remote-http", "git-credential" };
                
                foreach (string pattern in gitProcessPatterns)
                {
                    try
                    {
                        ProcessStartInfo psi = new ProcessStartInfo
                        {
                            FileName = "pkill",
                            Arguments = $"-9 -f {pattern}",
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            RedirectStandardOutput = true,
                            RedirectStandardError = true
                        };
                        
                        using (Process killProcess = Process.Start(psi))
                        {
                            if (killProcess != null)
                            {
                                killProcess.WaitForExit(1000);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Could not kill {pattern}: {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Error killing orphaned git processes on Unix: {ex.Message}");
            }
        }
        
        /// <summary>
        /// Kills a process tree on the current platform.
        /// Automatically selects the appropriate method based on the operating system.
        /// </summary>
        /// <param name="processId">The process ID to kill</param>
        public static void KillProcessTree(int processId)
        {
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                KillProcessTreeWindows(processId);
            }
            else
            {
                KillProcessTreeUnix(processId);
            }
        }
    }
}

