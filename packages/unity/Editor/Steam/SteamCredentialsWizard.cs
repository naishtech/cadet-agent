using UnityEngine;
using UnityEditor;
using System;
using System.IO;
using System.Diagnostics;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Utilities;

namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// Window for Steam Credentials Wizard - wires ViewModel and View together
    /// </summary>
    public class SteamCredentialsWizard : EditorWindow
    {
        private SteamCredentialsWizardViewModel viewModel;
        private SteamCredentialsWizardView view;
        private bool shouldClose = false;
        private Process activeSteamCmdProcess;
        private DateTime? processExitTime;
        private bool isWaitingForLogCheck;
        private string logFilePath;
        
        public static void ShowWindow()
        {
            SteamCredentialsWizard window = GetWindow<SteamCredentialsWizard>(true, CadetLocalization.GetString("Window.SteamCredentialsWizard.Title"));
            window.minSize = new Vector2(550, 350);
            window.maxSize = new Vector2(800, 1000);
            window.position = new Rect(window.position.x, window.position.y, 550, 400);
            window.Initialize();
            window.Show();
        }
        
        private void Initialize()
        {
            // Initialize ViewModel
            viewModel = new SteamCredentialsWizardViewModel();
            
            // Initialize View with ViewModel
            view = new SteamCredentialsWizardView(viewModel);
            
            // Wire up ViewModel events to handlers
            viewModel.OnCredentialsCheckRequested += HandleCheckCredentials;
            viewModel.OnSaveRequested += HandleSaveCredentials;
            viewModel.OnGuardCodeSubmitRequested += HandleSubmitGuardCode;
            viewModel.OnCancelRequested += HandleCancel;
            viewModel.CurrentStepChanged += (step) => Repaint();
            viewModel.RemainingSecondsChanged += (seconds) => Repaint();
            viewModel.IsValidatingCredentialsChanged += (validating) => Repaint();
            viewModel.ValidatingRemainingSecondsChanged += (seconds) => Repaint();
        }
        
        private void OnEnable()
        {
            // Subscribe to EditorApplication.update for process monitoring
            EditorApplication.update += OnUpdate;
        }
        
        private void OnDisable()
        {
            // Unsubscribe from EditorApplication.update
            EditorApplication.update -= OnUpdate;
        }
        
        private void OnUpdate()
        {
            if (viewModel == null)
                return;
            
            // Check if we're waiting for the log check delay
            if (isWaitingForLogCheck && processExitTime.HasValue)
            {
                double elapsedSeconds = (DateTime.Now - processExitTime.Value).TotalSeconds;
                
                // Update countdown (5 seconds total, count down from 5 to 0)
                int remaining = Math.Max(0, 5 - (int)Math.Ceiling(elapsedSeconds));
                if (viewModel != null)
                {
                    viewModel.UpdateValidatingRemainingSeconds(remaining);
                }
                
                if (elapsedSeconds >= 5.0)
                {
                    // 5 seconds have elapsed, check the log file
                    isWaitingForLogCheck = false;
                    if (viewModel != null)
                    {
                        viewModel.StopValidatingCredentials();
                    }
                    CheckLogFileForErrors();
                }
                else
                {
                    // Still waiting, repaint to keep UI responsive
                    Repaint();
                }
                return;
            }
            
            // Poll process status only when in WaitingForProcess step
            if (viewModel.CurrentStep == WizardStep.WaitingForProcess && activeSteamCmdProcess != null)
            {
                try
                {
                    // Check if process has exited
                    bool hasExited = false;
                    try
                    {
                        hasExited = activeSteamCmdProcess.HasExited;
                    }
                    catch (InvalidOperationException)
                    {
                        // Process has been disposed, clean up
                        activeSteamCmdProcess = null;
                        return;
                    }
                    
                    if (hasExited)
                    {
                        // Process finished, store exit time and start waiting for log check
                        processExitTime = DateTime.Now;
                        isWaitingForLogCheck = true;
                        activeSteamCmdProcess = null; // Clear reference
                        // Start validating credentials state
                        if (viewModel != null)
                        {
                            viewModel.StartValidatingCredentials();
                        }
                        Repaint(); // Repaint to show we're waiting
                    }
                    else
                    {
                        // Process still running, repaint to keep UI responsive
                        Repaint();
                    }
                }
                catch
                {
                    // Ignore errors during polling
                }
            }
        }
        
        private void HandleCancel()
        {
            // Clean up any active process (if we were tracking one)
            CleanupActiveProcess();

            // Update status on main thread
            EditorApplication.delayCall += () =>
            {
                viewModel.OnCredentialsCheckComplete(new ValidationResult
                {
                    Type = ValidationResultType.ConnectionFailed,
                    ErrorMessage = "Operation cancelled by user"
                });
            };
        }
        
        private void OnDestroy()
        {
            // Clean up any active process
            CleanupActiveProcess();
        }
        
        private void CleanupActiveProcess()
        {
            if (activeSteamCmdProcess != null)
            {
                try
                {
                    // Check if process is still valid (not disposed)
                    // Accessing HasExited on a disposed process throws InvalidOperationException
                    bool hasExited = false;
                    try
                    {
                        hasExited = activeSteamCmdProcess.HasExited;
                    }
                    catch (InvalidOperationException)
                    {
                        // Process has been disposed, just clean up the reference
                        activeSteamCmdProcess = null;
                        return;
                    }
                    
                    if (!hasExited)
                    {
                        try
                        {
                            // Try to gracefully terminate
                            activeSteamCmdProcess.StandardInput?.WriteLine("quit");
                            activeSteamCmdProcess.StandardInput?.Flush();
                            if (!activeSteamCmdProcess.WaitForExit(2000))
                            {
                                activeSteamCmdProcess.Kill();
                            }
                        }
                        catch
                        {
                            // If graceful shutdown fails, force kill
                            try
                            {
                                activeSteamCmdProcess.Kill();
                            }
                            catch { }
                        }
                    }
                }
                catch
                {
                    // Ignore any other errors during cleanup
                }
                finally
                {
                    try
                    {
                        activeSteamCmdProcess?.Dispose();
                    }
                    catch { }
                    activeSteamCmdProcess = null;
                }
            }
        }
        
        private void OnGUI()
        {
            if (shouldClose)
            {
                Close();
                return;
            }
            
            view.Draw();
            
            // Repaint window while checking credentials to animate spinner
            // Also repaint when waiting for process or on optional guard code step
            if (viewModel != null && (viewModel.IsCheckingCredentials || viewModel.CurrentStep == WizardStep.WaitingForProcess || viewModel.CurrentStep == WizardStep.OptionalGuardCode))
            {
                Repaint();
            }
        }
        
        private void HandleCheckCredentials()
        {
            // Validate credentials are provided
            if (string.IsNullOrEmpty(viewModel.Credentials?.Username) || string.IsNullOrEmpty(viewModel.Credentials?.Password))
            {
                viewModel.OnCredentialsCheckComplete(new ValidationResult
                {
                    Type = ValidationResultType.ConnectionFailed,
                    ErrorMessage = "Username and password are required"
                });
                return;
            }
            
            string username = viewModel.Credentials.Username;
            string password = viewModel.Credentials.Password;
            
            // Get steamcmd path from user directory
            string steamcmdDir = BuildToolsPathHelper.GetSteamCmdPath();
            string steamcmdPath;
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                steamcmdPath = Path.Combine(steamcmdDir, "steamcmd.exe");
            }
            else
            {
                steamcmdPath = Path.Combine(steamcmdDir, "steamcmd.sh");
            }
            
            if (!File.Exists(steamcmdPath))
            {
                viewModel.OnCredentialsCheckComplete(new ValidationResult
                {
                    Type = ValidationResultType.ConnectionFailed,
                    ErrorMessage = CadetLocalization.GetString("Window.SteamCredentialsWizard.SteamCMDNotFound")
                });
                return;
            }
            
            // Truncate the steamcmd console log file before starting
            logFilePath = Path.Combine(steamcmdDir, "logs", "console_log.txt");
            
            // Reset process exit tracking state
            processExitTime = null;
            isWaitingForLogCheck = false;
            
            try
            {
                // Ensure the logs directory exists
                string logDirectory = Path.GetDirectoryName(logFilePath);
                if (!string.IsNullOrEmpty(logDirectory) && !Directory.Exists(logDirectory))
                {
                    Directory.CreateDirectory(logDirectory);
                }
                
                // Truncate the log file (create empty file if it doesn't exist)
                File.WriteAllText(logFilePath, string.Empty);
            }
            catch (Exception logEx)
            {
                // Log warning but don't fail - steamcmd will still work
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to truncate steamcmd log file: {logEx.Message}");
            }
            
            // Launch steamcmd in a new console/terminal window with +quit and track the process
            try
            {
                if (Application.platform == RuntimePlatform.WindowsEditor)
                {
                    // Windows: Launch steamcmd directly with CreateNoWindow=false to show console window
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = steamcmdPath,
                        Arguments = $"+login {username} {password} +quit",
                        WorkingDirectory = steamcmdDir,
                        UseShellExecute = false,
                        CreateNoWindow = false  // Shows console window
                    };
                    activeSteamCmdProcess = Process.Start(psi);
                }
                else if (Application.platform == RuntimePlatform.OSXEditor)
                {
                    // macOS: Create a script that runs steamcmd with +quit, then open it in Terminal
                    string tempScriptPath = Path.Combine(Path.GetTempPath(), $"steamcmd_login_{Guid.NewGuid()}.sh");
                    string scriptContent = $"#!/bin/bash\ncd \"{steamcmdDir}\"\n\"{steamcmdPath}\" +login {username} {password} +quit\n";
                    File.WriteAllText(tempScriptPath, scriptContent);
                    
                    // Make script executable
                    ProcessStartInfo chmodPsi = new ProcessStartInfo
                    {
                        FileName = "/bin/chmod",
                        Arguments = $"+x \"{tempScriptPath}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    Process.Start(chmodPsi)?.WaitForExit();
                    
                    // Launch script process (we'll track this)
                    ProcessStartInfo scriptPsi = new ProcessStartInfo
                    {
                        FileName = "/bin/bash",
                        Arguments = $"\"{tempScriptPath}\"",
                        WorkingDirectory = steamcmdDir,
                        UseShellExecute = false,
                        CreateNoWindow = false  // Should show output
                    };
                    activeSteamCmdProcess = Process.Start(scriptPsi);
                    
                    // Also open Terminal window to show the process
                    ProcessStartInfo terminalPsi = new ProcessStartInfo
                    {
                        FileName = "open",
                        Arguments = $"-a Terminal \"{tempScriptPath}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    Process.Start(terminalPsi);
                }
                else
                {
                    // Linux: Try common terminal emulators and launch script
                    string[] terminals = { "gnome-terminal", "xterm", "konsole", "x-terminal-emulator" };
                    string terminal = null;
                    
                    foreach (string term in terminals)
                    {
                        try
                        {
                            ProcessStartInfo testPsi = new ProcessStartInfo
                            {
                                FileName = "which",
                                Arguments = term,
                                UseShellExecute = false,
                                RedirectStandardOutput = true,
                                CreateNoWindow = true
                            };
                            Process testProcess = Process.Start(testPsi);
                            if (testProcess != null)
                            {
                                testProcess.WaitForExit();
                                if (testProcess.ExitCode == 0)
                                {
                                    terminal = term;
                                    break;
                                }
                            }
                        }
                        catch { }
                    }
                    
                    if (terminal != null)
                    {
                        // Create a temporary script with +quit
                        string tempScriptPath = Path.Combine(Path.GetTempPath(), $"steamcmd_login_{Guid.NewGuid()}.sh");
                        string scriptContent = $"#!/bin/bash\ncd \"{steamcmdDir}\"\n\"{steamcmdPath}\" +login {username} {password} +quit\n";
                        File.WriteAllText(tempScriptPath, scriptContent);
                        
                        // Make script executable
                        ProcessStartInfo chmodPsi = new ProcessStartInfo
                        {
                            FileName = "/bin/chmod",
                            Arguments = $"+x \"{tempScriptPath}\"",
                            UseShellExecute = false,
                            CreateNoWindow = true
                        };
                        Process.Start(chmodPsi)?.WaitForExit();
                        
                        // Launch script process (we'll track this)
                        ProcessStartInfo scriptPsi = new ProcessStartInfo
                        {
                            FileName = "/bin/bash",
                            Arguments = $"\"{tempScriptPath}\"",
                            WorkingDirectory = steamcmdDir,
                            UseShellExecute = false,
                            CreateNoWindow = false
                        };
                        activeSteamCmdProcess = Process.Start(scriptPsi);
                        
                        // Also open terminal window
                        ProcessStartInfo terminalPsi = new ProcessStartInfo
                        {
                            FileName = terminal,
                            Arguments = $"-e \"/bin/bash \\\"{tempScriptPath}\\\"\"",
                            UseShellExecute = false,
                            CreateNoWindow = false
                        };
                        Process.Start(terminalPsi);
                    }
                    else
                    {
                        throw new Exception("No terminal emulator found. Please install gnome-terminal, xterm, or konsole.");
                    }
                }
                
                if (activeSteamCmdProcess == null)
                {
                    throw new Exception("Failed to start SteamCMD process");
                }
                
                // Transition to WaitingForProcess step after successfully launching
                viewModel.OnCredentialsCheckComplete(new ValidationResult
                {
                    Type = ValidationResultType.Success
                });
                Repaint(); // Force repaint to show waiting step
            }
            catch (Exception ex)
            {
                viewModel.OnCredentialsCheckComplete(new ValidationResult
                {
                    Type = ValidationResultType.ConnectionFailed,
                    ErrorMessage = $"Failed to open SteamCMD: {ex.Message}"
                });
            }
        }
        
        private void HandleSubmitGuardCode()
        {
            // For OptionalGuardCode step, guard code is optional
            // Save credentials (with or without guard code) and close wizard
            if (viewModel.SaveCredentials())
            {
                // Credentials saved successfully - refresh CadetWindows
                CadetWindow.RefreshAllWindowsPlatformAvailability();
                shouldClose = true;
            }
        }
        
        private void HandleSaveCredentials()
        {
            // OnSaveRequested is only invoked after credentials are successfully saved (e.g., in ViewModel's success case)
            // Save credentials again to ensure they're persisted (may have already been saved, but this ensures consistency)
            bool saved = viewModel.SaveCredentials();
            
            // Always refresh CadetWindows when save is requested, since credentials were already validated and saved
            // This ensures the "Publish to Steam" checkbox state is updated immediately
            CadetWindow.RefreshAllWindowsPlatformAvailability();
            
            if (saved)
            {
                // Close the wizard after successful save
                shouldClose = true;
            }
        }
        
        private void CheckLogFileForErrors()
        {
            if (string.IsNullOrEmpty(logFilePath))
            {
                // No log file path, proceed with normal flow
                EditorApplication.delayCall += () =>
                {
                    if (viewModel != null)
                    {
                        viewModel.OnProcessFinished();
                        Repaint();
                    }
                };
                return;
            }
            
            try
            {
                if (File.Exists(logFilePath))
                {
                    string logContent = File.ReadAllText(logFilePath);
                    
                    // Check for "ERROR (Invalid Password)" in the log
                    if (logContent.Contains("ERROR (Invalid Password)"))
                    {
                        // Invalid password detected, return to login screen with error
                        EditorApplication.delayCall += () =>
                        {
                            if (viewModel != null)
                            {
                                viewModel.OnCredentialsCheckComplete(new ValidationResult
                                {
                                    Type = ValidationResultType.InvalidCredentials,
                                    ErrorMessage = CadetLocalization.GetString("Window.SteamCredentialsWizard.InvalidCredentials")
                                });
                                Repaint();
                            }
                        };
                        // Reset state
                        processExitTime = null;
                        if (viewModel != null)
                        {
                            viewModel.StopValidatingCredentials();
                        }
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                // Log warning but proceed with normal flow (assume success)
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to read steamcmd log file for error checking: {ex.Message}");
            }
            
            // No error found (or couldn't read file), proceed with normal flow
            EditorApplication.delayCall += () =>
            {
                if (viewModel != null)
                {
                    viewModel.OnProcessFinished();
                    Repaint();
                }
            };
            // Reset state
            processExitTime = null;
            if (viewModel != null)
            {
                viewModel.StopValidatingCredentials();
            }
        }
    }
}
