using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// View for Steam Credentials Wizard - renders UI based on SteamCredentialsWizardViewModel
    /// </summary>
    public class SteamCredentialsWizardView
    {
        private SteamCredentialsWizardViewModel viewModel;
        
        public SteamCredentialsWizardView(SteamCredentialsWizardViewModel viewModel)
        {
            this.viewModel = viewModel;
        }
        
        public void Draw()
        {
            EditorGUILayout.Space(10);
            
            // Step indicator - simplified (no step numbers for now)
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            string stepText = viewModel.CurrentStep == WizardStep.LoginCredentials 
                ? CadetLocalization.GetString("Window.SteamCredentialsWizard.Step1") 
                : "";
            if (!string.IsNullOrEmpty(stepText))
            {
                GUILayout.Label(stepText, EditorStyles.boldLabel);
            }
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.Space(10);
            
            // Draw current step
            switch (viewModel.CurrentStep)
            {
                case WizardStep.LoginCredentials:
                    DrawLoginStep();
                    break;
                case WizardStep.WaitingForProcess:
                    DrawWaitingForProcessStep();
                    break;
                case WizardStep.OptionalGuardCode:
                    DrawOptionalGuardCodeStep();
                    break;
            }
            
            EditorGUILayout.Space(10);
            
            // Progress indicator when checking credentials (only show once, not in button area)
            if (viewModel.IsCheckingCredentials)
            {
                EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
                
                // Show countdown timer if available
                string progressText;
                if (viewModel.RemainingSeconds > 0)
                {
                    int minutes = viewModel.RemainingSeconds / 60;
                    int seconds = viewModel.RemainingSeconds % 60;
                    progressText = $"Checking credentials... ({minutes:D2}:{seconds:D2} remaining)";
                }
                else
                {
                    progressText = "Checking credentials...";
                }
                
                // Animated progress bar (spinner)
                float animatedProgress = Time.realtimeSinceStartup % 1f;
                Rect progressRect = EditorGUILayout.GetControlRect(false, 20, GUILayout.ExpandWidth(true));
                EditorGUI.ProgressBar(progressRect, animatedProgress, progressText);
                
                // Cancel button
                if (GUILayout.Button("Cancel", GUILayout.Width(60)))
                {
                    viewModel.RequestCancel();
                }
                
                EditorGUILayout.EndHorizontal();
                EditorGUILayout.Space(5);
            }
            
            // Status message
            if (!string.IsNullOrEmpty(viewModel.StatusMessage))
            {
                MessageType messageType = viewModel.StatusMessage.StartsWith("✅") ? MessageType.Info : 
                                         viewModel.StatusMessage.StartsWith("❌") ? MessageType.Error : 
                                         MessageType.None;
                EditorGUILayout.HelpBox(viewModel.StatusMessage, messageType);
            }
            
            EditorGUILayout.Space(10);
            
            // Informational message at bottom
            if (viewModel.CurrentStep == WizardStep.LoginCredentials)
            {
                EditorGUILayout.HelpBox(
                    "Note: Login may take some time. A Steam Guard code may be sent to your email if this computer has not been authenticated before.",
                    MessageType.Info
                );
                EditorGUILayout.Space(5);
            }
            
            // Buttons
            DrawButtons();
        }
        
        private void DrawLoginStep()
        {
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.SteamCredentialsWizard.UsernameLabel"), EditorStyles.boldLabel);
            string username = EditorGUILayout.TextField(viewModel.Credentials?.Username ?? "");
            if (username != viewModel.Credentials?.Username)
            {
                viewModel.UpdateUsername(username);
            }
            
            EditorGUILayout.Space(5);
            
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.SteamCredentialsWizard.PasswordLabel"), EditorStyles.boldLabel);
            string password = EditorGUILayout.PasswordField(viewModel.Credentials?.Password ?? "");
            if (password != viewModel.Credentials?.Password)
            {
                viewModel.UpdatePassword(password);
            }
            
            EditorGUILayout.Space(10);
            
            bool skipValidation = EditorGUILayout.ToggleLeft(
                CadetLocalization.GetString("Window.SteamCredentialsWizard.Fields.SkipValidation"),
                viewModel.SkipValidation
            );
            if (skipValidation != viewModel.SkipValidation)
            {
                viewModel.UpdateSkipValidation(skipValidation);
            }
            
            EditorGUILayout.Space(10);
            
            EditorGUI.BeginDisabledGroup(viewModel.IsCheckingCredentials || 
                                         string.IsNullOrEmpty(viewModel.Credentials?.Username) || 
                                         string.IsNullOrEmpty(viewModel.Credentials?.Password));
            if (GUILayout.Button(CadetLocalization.GetString("Window.SteamCredentialsWizard.CheckCredentials")))
            {
                viewModel.RequestCheckCredentials();
            }
            EditorGUI.EndDisabledGroup();
        }
        
        private void DrawWaitingForProcessStep()
        {
            EditorGUILayout.HelpBox(
                CadetLocalization.GetString("Window.SteamCredentialsWizard.WaitingForProcessMessage"),
                MessageType.Info
            );
            
            // Show validating credentials message with countdown if we're in validation phase
            if (viewModel.IsValidatingCredentials)
            {
                EditorGUILayout.Space(5);
                string validatingText = viewModel.ValidatingRemainingSeconds > 0
                    ? $"Validating credentials... ({viewModel.ValidatingRemainingSeconds}s)"
                    : "Validating credentials...";
                EditorGUILayout.HelpBox(validatingText, MessageType.Info);
            }
        }
        
        private void DrawOptionalGuardCodeStep()
        {
            EditorGUILayout.HelpBox(
                CadetLocalization.GetString("Window.SteamCredentialsWizard.OptionalGuardCodeInstructions"),
                MessageType.Info
            );
            
            EditorGUILayout.Space(10);
            
            EditorGUILayout.LabelField(
                CadetLocalization.GetString("Window.SteamCredentialsWizard.OptionalGuardCodeLabel"),
                EditorStyles.boldLabel
            );
            string guardCode = EditorGUILayout.TextField(viewModel.Credentials?.GuardCode ?? "");
            if (guardCode != viewModel.Credentials?.GuardCode)
            {
                viewModel.UpdateGuardCode(guardCode);
            }
        }
        
        private void DrawButtons()
        {
            EditorGUILayout.BeginHorizontal();
            
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Cancel")))
            {
                // Cancel handled by window
                return;
            }
            
            GUILayout.FlexibleSpace();
            
            if (viewModel.CurrentStep == WizardStep.WaitingForProcess)
            {
                // Only show Cancel button while waiting for process
                // No other buttons needed
            }
            else if (viewModel.CurrentStep == WizardStep.OptionalGuardCode)
            {
                if (GUILayout.Button(CadetLocalization.GetString("Window.SteamCredentialsWizard.Back"), GUILayout.Width(80)))
                {
                    viewModel.MoveToPreviousStep();
                }
                
                // Skip button - closes without saving guard code
                if (GUILayout.Button(CadetLocalization.GetString("Window.SteamCredentialsWizard.Buttons.Skip"), GUILayout.Width(80)))
                {
                    // Save credentials without guard code
                    if (viewModel.Credentials != null)
                    {
                        viewModel.Credentials.GuardCode = "";
                    }
                    viewModel.RequestSave();
                }
                
                // Save button - validates guard code if provided, then saves
                EditorGUI.BeginDisabledGroup(
                    !string.IsNullOrEmpty(viewModel.Credentials?.GuardCode) && 
                    viewModel.Credentials.GuardCode.Length != 5
                );
                if (GUILayout.Button(CadetLocalization.GetString("Window.SteamCredentialsWizard.Buttons.Save"), GUILayout.Width(80)))
                {
                    viewModel.RequestSave();
                }
                EditorGUI.EndDisabledGroup();
            }
            else
            {
                EditorGUI.BeginDisabledGroup(!viewModel.CredentialsValidated);
                if (GUILayout.Button(CadetLocalization.GetString("Window.SteamCredentialsWizard.Next"), GUILayout.Width(80)))
                {
                    viewModel.MoveToNextStep();
                }
                EditorGUI.EndDisabledGroup();
            }
            
            EditorGUILayout.EndHorizontal();
        }
    }
}

