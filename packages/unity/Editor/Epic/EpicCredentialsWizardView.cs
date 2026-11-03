using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Epic
{
    /// <summary>
    /// View for Epic Credentials Wizard - renders UI based on EpicCredentialsWizardViewModel
    /// </summary>
    public class EpicCredentialsWizardView
    {
        private EpicCredentialsWizardViewModel viewModel;
        private Vector2 consoleScrollPosition;
        
        public EpicCredentialsWizardView(EpicCredentialsWizardViewModel viewModel)
        {
            this.viewModel = viewModel;
            consoleScrollPosition = Vector2.zero;
            
            // Subscribe to console output changes for auto-scroll
            viewModel.ConsoleOutputChanged += (output) =>
            {
                consoleScrollPosition.y = float.MaxValue; // Auto-scroll to bottom
            };
        }
        
        public void Draw()
        {
            EditorGUILayout.Space(10);
            
            // Step indicator
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            string stepText = CadetLocalization.GetString("Window.EpicCredentialsWizard.Step1");
            GUILayout.Label(stepText, EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.Space(10);
            
            // Info box
            EditorGUILayout.HelpBox(
                CadetLocalization.GetString("Window.EpicCredentialsWizard.InfoBox"),
                MessageType.Info
            );
            
            EditorGUILayout.Space(10);
            
            // Draw credentials step
            DrawCredentialsStep();
            
            EditorGUILayout.Space(10);
            
            // Progress indicator when checking credentials
            if (viewModel.IsCheckingCredentials)
            {
                EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
                
                // Animated progress bar (spinner)
                float animatedProgress = Time.realtimeSinceStartup % 1f;
                Rect progressRect = EditorGUILayout.GetControlRect(false, 20, GUILayout.ExpandWidth(true));
                EditorGUI.ProgressBar(progressRect, animatedProgress, "Checking credentials...");
                
                // Cancel button
                if (GUILayout.Button("Cancel", GUILayout.Width(60)))
                {
                    viewModel.RequestCancel();
                }
                
                EditorGUILayout.EndHorizontal();
                EditorGUILayout.Space(5);
            }
            
            // Console output area (only show when checking credentials)
            if (viewModel.IsCheckingCredentials)
            {
                EditorGUILayout.LabelField("Console Output", EditorStyles.boldLabel);
                
                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                consoleScrollPosition = EditorGUILayout.BeginScrollView(
                    consoleScrollPosition,
                    GUILayout.Height(150)
                );
                
                string consoleText = !string.IsNullOrEmpty(viewModel.ConsoleOutput) 
                    ? viewModel.ConsoleOutput 
                    : "Validating credentials...";
                
                GUIContent content = new GUIContent(consoleText);
                float availableWidth = EditorGUIUtility.currentViewWidth - 50;
                float textHeight = EditorStyles.wordWrappedLabel.CalcHeight(content, availableWidth);
                
                EditorGUILayout.SelectableLabel(
                    consoleText,
                    EditorStyles.wordWrappedLabel,
                    GUILayout.Height(Mathf.Max(textHeight, 140))
                );
                
                // Auto-scroll to bottom
                if (Event.current.type == EventType.Repaint)
                {
                    consoleScrollPosition.y = float.MaxValue;
                }
                
                EditorGUILayout.EndScrollView();
                EditorGUILayout.EndVertical();
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
            
            // Buttons
            DrawButtons();
        }
        
        private void DrawCredentialsStep()
        {
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.EpicCredentialsWizard.ClientIdLabel"), EditorStyles.boldLabel);
            string clientId = EditorGUILayout.TextField(viewModel.Credentials?.ClientId ?? "");
            if (clientId != viewModel.Credentials?.ClientId)
            {
                viewModel.UpdateClientId(clientId);
            }
            
            EditorGUILayout.Space(5);
            
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.EpicCredentialsWizard.ClientSecretLabel"), EditorStyles.boldLabel);
            string clientSecret = EditorGUILayout.PasswordField(viewModel.Credentials?.ClientSecret ?? "");
            if (clientSecret != viewModel.Credentials?.ClientSecret)
            {
                viewModel.UpdateClientSecret(clientSecret);
            }
            
            EditorGUILayout.Space(10);
            
            EditorGUI.BeginDisabledGroup(viewModel.IsCheckingCredentials || 
                                         string.IsNullOrEmpty(viewModel.Credentials?.ClientId) || 
                                         string.IsNullOrEmpty(viewModel.Credentials?.ClientSecret));
            if (GUILayout.Button(CadetLocalization.GetString("Window.EpicCredentialsWizard.CheckCredentials")))
            {
                viewModel.RequestCheckCredentials();
            }
            EditorGUI.EndDisabledGroup();
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
            
            EditorGUI.BeginDisabledGroup(!viewModel.CredentialsValidated && 
                                        (string.IsNullOrEmpty(viewModel.Credentials?.ClientId) || 
                                         string.IsNullOrEmpty(viewModel.Credentials?.ClientSecret)));
            if (GUILayout.Button(CadetLocalization.GetString("Window.EpicCredentialsWizard.Save"), GUILayout.Width(80)))
            {
                if (viewModel.CredentialsValidated)
                {
                    viewModel.RequestSave();
                }
                else
                {
                    // If not validated, just save without validation
                    if (viewModel.SaveCredentials())
                    {
                        viewModel.RequestSave();
                    }
                }
            }
            EditorGUI.EndDisabledGroup();
            
            EditorGUILayout.EndHorizontal();
        }
    }
}

