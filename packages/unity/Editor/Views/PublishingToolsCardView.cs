using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.PublishingTools;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Views
{
    /// <summary>
    /// View for publishing tools dependency card - renders UI based on DependencyCardViewModel
    /// </summary>
    public class PublishingToolsCardView
    {
        private DependencyCardViewModel viewModel;
        private bool isDisabled;
        private bool requiresCosmos;
        private bool cosmosInstalled;
        
        public PublishingToolsCardView(DependencyCardViewModel viewModel)
        {
            this.viewModel = viewModel;
            this.isDisabled = false;
            this.requiresCosmos = false;
            this.cosmosInstalled = false;
            
            // Subscribe to ViewModel events
            viewModel.StatusChanged += (status) => RepaintIfNeeded();
        }
        
        public void SetDisabled(bool disabled)
        {
            isDisabled = disabled;
        }
        
        public void SetCosmosRequirement(bool requiresCosmos, bool cosmosInstalled)
        {
            this.requiresCosmos = requiresCosmos;
            this.cosmosInstalled = cosmosInstalled;
        }
        
        public void Draw()
        {
            var status = viewModel.Status;
            
            // Show disabled message if card is disabled
            if (isDisabled && status.state == DependencyState.Missing)
            {
                EditorGUILayout.HelpBox("Cosmos Binaries must be installed first on Windows.", MessageType.Warning);
            }
            
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
            // Header with name and status
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label(status.name, EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
            GUILayout.Label($"{status.GetStatusIcon()} {status.GetStatusText()}", GetStatusStyle(status));
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.Space(5);
            
            // Description
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Description"), EditorStyles.miniBoldLabel);
            EditorGUILayout.LabelField(status.description, EditorStyles.wordWrappedLabel);
            
            EditorGUILayout.Space(5);
            
            // Install location
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.InstallLocation"), EditorStyles.miniBoldLabel);
            EditorGUILayout.LabelField(status.installPath, EditorStyles.miniLabel);
            
            EditorGUILayout.Space(10);
            
            // Progress bar (only show when downloading/extracting)
            if (status.state == DependencyState.Downloading || status.state == DependencyState.Extracting)
            {
                Rect rect = EditorGUILayout.GetControlRect(false, 20);
                EditorGUI.ProgressBar(rect, status.downloadProgress, status.GetStatusText());
                EditorGUILayout.Space(5);
            }
            
            // Error message (only show when in error state)
            if (status.state == DependencyState.Error && !string.IsNullOrEmpty(status.errorMessage))
            {
                EditorGUILayout.HelpBox(status.errorMessage, MessageType.Error);
                EditorGUILayout.Space(5);
            }
            
            // Show Cosmos requirement message if needed
            if (requiresCosmos && !cosmosInstalled)
            {
                EditorGUILayout.HelpBox(
                    CadetLocalization.GetString("Window.PublishingToolsConfig.Messages.CosmosRequired"),
                    MessageType.Info
                );
                EditorGUILayout.Space(5);
            }
            
            // License agreement text (shown BEFORE buttons so users see it first)
            DrawLicenseText(status);
            EditorGUILayout.Space(5);
            
            // Action buttons
            DrawActionButtons(status);
            
            // Custom path option (for manual installation)
            EditorGUILayout.Space(5);
            DrawCustomPathSection(status);
            
            EditorGUILayout.EndVertical();
        }
        
        private void DrawActionButtons(DependencyStatus status)
        {
            EditorGUILayout.BeginHorizontal();
            
            switch (status.state)
            {
                case DependencyState.Missing:
                    // Disable button if license not accepted OR if card is disabled (e.g., Cosmos not installed on Windows)
                    EditorGUI.BeginDisabledGroup(!status.licenseAccepted || isDisabled);
                    if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.DownloadExtract"), GUILayout.Height(30)))
                    {
                        viewModel.RequestDownload();
                    }
                    EditorGUI.EndDisabledGroup();
                    break;
                    
                case DependencyState.Downloading:
                case DependencyState.Extracting:
                    EditorGUI.BeginDisabledGroup(true);
                    GUILayout.Button($"{status.GetStatusText()}", GUILayout.Height(30));
                    EditorGUI.EndDisabledGroup();
                    break;
                    
                case DependencyState.Installed:
                    if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.Uninstall"), GUILayout.Height(30)))
                    {
                        viewModel.RequestUninstall();
                    }
                    if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.VerifyInstallation"), GUILayout.Height(30)))
                    {
                        viewModel.RequestVerify();
                    }
                    break;
                    
                case DependencyState.Error:
                    if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.Retry"), GUILayout.Height(30)))
                    {
                        viewModel.RequestDownload();
                    }
                    if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.ManualDownload"), GUILayout.Height(30)))
                    {
                        Application.OpenURL(viewModel.DownloadUrl);
                    }
                    break;
            }
            
            EditorGUILayout.EndHorizontal();
        }
        
        private void DrawLicenseText(DependencyStatus status)
        {
            if (status.state == DependencyState.Installed)
            {
                return; // Don't show license text when already installed
            }
            
            // License agreement section with colored background
            Color originalBg = GUI.backgroundColor;
            GUI.backgroundColor = new Color(1f, 0.95f, 0.8f); // Light yellow/warning color
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            GUI.backgroundColor = originalBg;
            
            GUIStyle boldStyle = new GUIStyle(EditorStyles.miniBoldLabel)
            {
                wordWrap = true
            };
            
            GUIStyle smallStyle = new GUIStyle(EditorStyles.miniLabel)
            {
                wordWrap = true,
                fontSize = 10
            };
            
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.LicenseAgreementRequired"), boldStyle);
            EditorGUILayout.Space(3);
            EditorGUILayout.LabelField(GetLicenseText(status), smallStyle);
            
            EditorGUILayout.Space(5);
            
            // Checkbox and link - disable if Cosmos is required but not installed
            EditorGUILayout.BeginHorizontal();
            bool cosmosBlockingLicense = requiresCosmos && !cosmosInstalled;
            EditorGUI.BeginDisabledGroup(cosmosBlockingLicense);
            status.licenseAccepted = EditorGUILayout.Toggle(status.licenseAccepted, GUILayout.Width(15));
            GUILayout.Label(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.AcceptLicense"), EditorStyles.miniLabel);
            EditorGUI.EndDisabledGroup();
            
            if (!string.IsNullOrEmpty(viewModel.LicenseUrl))
            {
                if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.ViewLicense"), EditorStyles.linkLabel, GUILayout.Width(80)))
                {
                    Application.OpenURL(viewModel.LicenseUrl);
                }
            }
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.EndVertical();
        }
        
        private string GetLicenseText(DependencyStatus status)
        {
            if (status.name.Contains("SteamCMD"))
            {
                string platform = status.name.Contains("Windows") ? "Windows" : "macOS";
                return $"SteamCMD ({platform}) is provided by Valve Corporation. By downloading and using SteamCMD, you agree to comply with Valve's Steam Subscriber Agreement and SteamCMD license terms.";
            }
            else if (status.name.Contains("BuildPatchTool"))
            {
                return "Epic BuildPatchTool is provided by Epic Games. By downloading and using this tool, you agree to comply with Epic Games Store Distribution Agreement. Requires an active Epic Games Developer account.";
            }
            return "Please review and accept the license agreement before downloading.";
        }
        
        private void DrawCustomPathSection(DependencyStatus status)
        {
            // Only show custom path option when not installed or in error state
            if (status.state == DependencyState.Installed)
                return;
            
            EditorGUI.BeginDisabledGroup(isDisabled);
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
            GUIStyle labelStyle = new GUIStyle(EditorStyles.miniLabel)
            {
                fontStyle = FontStyle.Bold
            };
            
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.CustomPathLabel"), labelStyle);
            
            EditorGUILayout.BeginHorizontal();
            
            // Text field for custom path
            status.customPath = EditorGUILayout.TextField(status.customPath);
            
            // Browse button
            if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.Browse"), GUILayout.Width(70)))
            {
                // Use EditorApplication.delayCall to defer the modal dialog outside the layout pass
                EditorApplication.delayCall += () =>
                {
                    string path = BrowseForDependency(status);
                    if (!string.IsNullOrEmpty(path))
                    {
                        status.customPath = path;
                        // Trigger status change to repaint
                        viewModel.UpdateStatus(status);
                    }
                };
            }
            
            EditorGUILayout.EndHorizontal();
            
            // Verify button
            EditorGUI.BeginDisabledGroup(string.IsNullOrEmpty(status.customPath));
            if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Buttons.VerifyCustomPath"), GUILayout.Height(25)))
            {
                viewModel.RequestVerify();
            }
            EditorGUI.EndDisabledGroup();
            
            EditorGUILayout.EndVertical();
            EditorGUI.EndDisabledGroup();
        }
        
        private string BrowseForDependency(DependencyStatus status)
        {
            // For BuildPatchTool, browse for folder
            if (status.name.Contains("BuildPatchTool"))
            {
                return EditorUtility.OpenFolderPanel(
                    string.Format(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Dialogs.SelectDirectory"), status.name),
                    "",
                    ""
                );
            }
            // For SteamCMD, browse for file
            else if (status.name.Contains("SteamCMD") && status.name.Contains("Windows"))
            {
                return EditorUtility.OpenFilePanel(
                    string.Format(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Dialogs.SelectFile"), status.name),
                    "",
                    "exe"
                );
            }
            else if (status.name.Contains("SteamCMD") && status.name.Contains("macOS"))
            {
                return EditorUtility.OpenFilePanel(
                    string.Format(CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.Dialogs.SelectFile"), status.name),
                    "",
                    "sh"
                );
            }
            
            return "";
        }
        
        private GUIStyle GetStatusStyle(DependencyStatus status)
        {
            GUIStyle style = new GUIStyle(EditorStyles.label);
            
            switch (status.state)
            {
                case DependencyState.Missing:
                    style.normal.textColor = new Color(1f, 0.65f, 0f); // Orange
                    break;
                case DependencyState.Downloading:
                case DependencyState.Extracting:
                    style.normal.textColor = new Color(0.3f, 0.7f, 1f); // Blue
                    break;
                case DependencyState.Installed:
                    style.normal.textColor = new Color(0.3f, 0.8f, 0.3f); // Green
                    break;
                case DependencyState.Error:
                    style.normal.textColor = new Color(1f, 0.3f, 0.3f); // Red
                    break;
            }
            
            return style;
        }
        
        private void RepaintIfNeeded()
        {
            // In Unity Editor, we need to repaint the window
            // This will be handled by the parent window
        }
    }
}

