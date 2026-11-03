using UnityEngine;
using UnityEditor;
using System;
using System.IO;
using System.Diagnostics;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Utilities;

namespace Covyne.CADET.Editor.Epic
{
    /// <summary>
    /// Window for Epic Credentials Wizard - wires ViewModel and View together
    /// </summary>
    public class EpicCredentialsWizard : EditorWindow
    {
        private EpicCredentialsWizardViewModel viewModel;
        private EpicCredentialsWizardView view;
        private bool shouldClose = false;
        private Process activeBuildPatchToolProcess;
        
        public static void ShowWindow()
        {
            EpicCredentialsWizard window = GetWindow<EpicCredentialsWizard>(true, CadetLocalization.GetString("Window.EpicCredentialsWizard.Title"));
            window.minSize = new Vector2(500, 400);
            window.maxSize = new Vector2(500, 600);
            window.Initialize();
            window.Show();
        }
        
        private void Initialize()
        {
            // Initialize ViewModel
            viewModel = new EpicCredentialsWizardViewModel();
            
            // Initialize View with ViewModel
            view = new EpicCredentialsWizardView(viewModel);
            
            // Wire up ViewModel events to handlers
            viewModel.OnCredentialsCheckRequested += HandleCheckCredentials;
            viewModel.OnSaveRequested += HandleSaveCredentials;
            viewModel.OnCancelRequested += HandleCancel;
        }
        
        private void HandleCancel()
        {
            CleanupActiveProcess();

            // Update status on main thread
            EditorApplication.delayCall += () =>
            {
                viewModel.OnCredentialsCheckComplete(new EpicValidationResult
                {
                    Type = EpicValidationResultType.ConnectionFailed,
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
            if (activeBuildPatchToolProcess != null && !activeBuildPatchToolProcess.HasExited)
            {
                try
                {
                    activeBuildPatchToolProcess.Kill();
                }
                catch { }
                finally
                {
                    activeBuildPatchToolProcess?.Dispose();
                    activeBuildPatchToolProcess = null;
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
            if (viewModel != null && viewModel.IsCheckingCredentials)
            {
                Repaint();
            }
        }
        
        private void HandleCheckCredentials()
        {
            // Clean up any existing process
            CleanupActiveProcess();
            
            // Clear console output for new check
            viewModel.UpdateConsoleOutput("");
            
            // Run validation in background thread to avoid blocking UI
            System.Threading.Thread validationThread = new System.Threading.Thread(() =>
            {
                try
                {
                    EpicValidationResult result = ValidateCredentials(
                        viewModel.Credentials.ClientId, 
                        viewModel.Credentials.ClientSecret
                    );

                    // Update ViewModel on main thread
                    EditorApplication.delayCall += () =>
                    {
                        viewModel.OnCredentialsCheckComplete(result);
                    };
                }
                catch (Exception ex)
                {
                    EditorApplication.delayCall += () =>
                    {
                        viewModel.OnCredentialsCheckComplete(new EpicValidationResult
                        {
                            Type = EpicValidationResultType.ConnectionFailed,
                            ErrorMessage = ex.Message
                        });
                    };
                }
            });
            
            validationThread.IsBackground = true;
            validationThread.Start();
        }
        
        private void HandleSaveCredentials()
        {
            if (viewModel.SaveCredentials())
            {
                // Credentials saved successfully - refresh CadetWindows and close the wizard
                CadetWindow.RefreshAllWindowsPlatformAvailability();
                shouldClose = true;
            }
        }
        
        private EpicValidationResult ValidateCredentials(string clientId, string clientSecret)
        {
            // For Epic, we validate by checking if BuildPatchTool is installed
            // and attempting to use the credentials (simplified validation)
            // Check user directory
            string buildPatchToolPath = BuildToolsPathHelper.GetBuildPatchToolPath();
            
            if (!Directory.Exists(buildPatchToolPath))
            {
                return new EpicValidationResult
                {
                    Type = EpicValidationResultType.ConnectionFailed,
                    ErrorMessage = CadetLocalization.GetString("Window.EpicCredentialsWizard.BuildPatchToolNotFound")
                };
            }
            
            // Check for BuildPatchTool.exe in subdirectories (Windows)
            string[] exeFiles = Directory.GetFiles(buildPatchToolPath, "BuildPatchTool.exe", SearchOption.AllDirectories);
            if (exeFiles.Length == 0)
            {
                // Also check for Mac/Linux binary
                string[] macBinaries = Directory.GetFiles(buildPatchToolPath, "BuildPatchTool", SearchOption.AllDirectories);
                if (macBinaries.Length == 0)
                {
                    return new EpicValidationResult
                    {
                        Type = EpicValidationResultType.ConnectionFailed,
                        ErrorMessage = CadetLocalization.GetString("Window.EpicCredentialsWizard.BuildPatchToolNotFound")
                    };
                }
            }
            
            // Basic validation - check that credentials are not empty
            // Full validation would require making an API call to Epic's OAuth endpoint
            // For now, we just verify the format is reasonable
            if (string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(clientSecret))
            {
                return new EpicValidationResult
                {
                    Type = EpicValidationResultType.InvalidCredentials,
                    ErrorMessage = "Client ID and Client Secret are required"
                };
            }
            
            // If we get here, credentials appear valid (format-wise)
            // Note: Actual authentication would require an API call to Epic's OAuth endpoint
            // This is a simplified validation that just checks the credentials are present
            viewModel.UpdateConsoleOutput("Credentials format validated.\nNote: Full authentication will be performed during build/publish operations.");
            
            return new EpicValidationResult
            {
                Type = EpicValidationResultType.Success
            };
        }
    }
}

