using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Mac;

namespace Covyne.CADET.Editor.Views
{
    /// <summary>
    /// View for action buttons - renders checkboxes for build/publish operations and an Execute button
    /// </summary>
    public class ActionButtonsView
    {
        private ActionButtonsViewModel viewModel;
        
        public ActionButtonsView(ActionButtonsViewModel viewModel)
        {
            this.viewModel = viewModel;
            
            // Subscribe to ViewModel events for repainting (per MVVM guidelines)
            viewModel.IsRunningChanged += (running) => RepaintIfNeeded();
            viewModel.HasProfileChanged += (hasProfile) => RepaintIfNeeded();
            viewModel.HasMissingPublishingDependenciesChanged += (missing) => RepaintIfNeeded();
            viewModel.UnityBuildCheckedChanged += (v) => RepaintIfNeeded();
            viewModel.PublishSteamCheckedChanged += (v) => RepaintIfNeeded();
            viewModel.PublishEpicCheckedChanged += (v) => RepaintIfNeeded();
            viewModel.WindowsBuildExistsChanged += (v) => RepaintIfNeeded();
            viewModel.MacosBuildExistsChanged += (v) => RepaintIfNeeded();
            viewModel.MissingBuildsMessageChanged += (v) => RepaintIfNeeded();
            viewModel.SteamAvailableChanged += (v) => RepaintIfNeeded();
            viewModel.EpicAvailableChanged += (v) => RepaintIfNeeded();
            viewModel.MacCredentialsRequirementChanged += (v) => RepaintIfNeeded();
            viewModel.NotarizeMacCheckedChanged += (v) => RepaintIfNeeded();
        }
        
        /// <summary>
        /// Draws the Publishing Tools button - can be called independently from other action buttons
        /// </summary>
        public void DrawPublishingToolsButton()
        {
#if CADET_LITE
            // In Lite: show disabled button with Pro badge, no click action
            EditorGUILayout.BeginHorizontal();
            
            // Get settings icon (Unity's built-in icon - automatically handles light/dark mode)
            GUIContent settingsIcon = EditorGUIUtility.IconContent("SettingsIcon");
            string buttonText = CadetLocalization.GetString("Window.PublishingToolsConfig.Buttons.PublishingTools");
            
            // Combine icon with text
            GUIContent buttonContent;
            if (settingsIcon != null && settingsIcon.image != null)
            {
                buttonContent = new GUIContent(buttonText, settingsIcon.image);
            }
            else
            {
                // If no icon found, just use text
                buttonContent = new GUIContent(buttonText);
            }
            
            // Create cyan button style
            var cyanButtonStyle = new GUIStyle(GUI.skin.button);
            cyanButtonStyle.normal.textColor = Color.white;
            cyanButtonStyle.hover.textColor = Color.white;
            
            // Create dark blue texture for button background
            if (cyanButtonStyle.normal.background == null || cyanButtonStyle.normal.background.name != "cyanButton")
            {
                Texture2D darkBlueTexture = MakeTex(2, 2, new Color(0f, 0.4f, 0.7f)); // Dark blue color
                darkBlueTexture.name = "cyanButton";
                cyanButtonStyle.normal.background = darkBlueTexture;
                cyanButtonStyle.hover.background = MakeTex(2, 2, new Color(0f, 0.5f, 0.8f)); // Lighter dark blue on hover
            }
            
            // Disabled button - no action on click
            EditorGUI.BeginDisabledGroup(true);
            GUILayout.Button(buttonContent, cyanButtonStyle, GUILayout.Height(30), GUILayout.Width(150));
            EditorGUI.EndDisabledGroup();
            
            // Pro badge next to button
            GUILayout.Space(5);
            var proLabelStyle = new GUIStyle(EditorStyles.miniLabel);
            proLabelStyle.normal.textColor = new Color(1f, 0.6f, 0f); // Orange color
            proLabelStyle.fontStyle = FontStyle.Bold;
            GUILayout.Label("PRO", proLabelStyle, GUILayout.Width(30));
            
            EditorGUILayout.EndHorizontal();
#else
            // In Full: normal button behavior
            // Publishing Tools button - always visible, disabled when running, left-aligned with settings icon, cyan background
            EditorGUI.BeginDisabledGroup(viewModel.IsRunning);
            
            // Get settings icon (Unity's built-in icon - automatically handles light/dark mode)
            GUIContent settingsIcon = EditorGUIUtility.IconContent("SettingsIcon");
            string buttonText = CadetLocalization.GetString("Window.PublishingToolsConfig.Buttons.PublishingTools");
            
            // Combine icon with text
            GUIContent buttonContent;
            if (settingsIcon != null && settingsIcon.image != null)
            {
                buttonContent = new GUIContent(buttonText, settingsIcon.image);
            }
            else
            {
                // If no icon found, just use text
                buttonContent = new GUIContent(buttonText);
            }
            
            // Create cyan button style
            var cyanButtonStyle = new GUIStyle(GUI.skin.button);
            cyanButtonStyle.normal.textColor = Color.white;
            cyanButtonStyle.hover.textColor = Color.white;
            
            // Create dark blue texture for button background
            if (cyanButtonStyle.normal.background == null || cyanButtonStyle.normal.background.name != "cyanButton")
            {
                Texture2D darkBlueTexture = MakeTex(2, 2, new Color(0f, 0.4f, 0.7f)); // Dark blue color
                darkBlueTexture.name = "cyanButton";
                cyanButtonStyle.normal.background = darkBlueTexture;
                cyanButtonStyle.hover.background = MakeTex(2, 2, new Color(0f, 0.5f, 0.8f)); // Lighter dark blue on hover
            }
            
            if (GUILayout.Button(buttonContent, cyanButtonStyle, GUILayout.Height(30), GUILayout.Width(150)))
            {
                viewModel.RequestOpenPublishingTools();
            }
            EditorGUI.EndDisabledGroup();
#endif
        }
        
        public void Draw(BuildProfile currentProfile = null)
        {
            // Cache values at start to ensure consistent control count between Layout and Repaint passes
            bool hasProfile = viewModel.HasProfile;
            bool hasMissingDeps = viewModel.HasMissingPublishingDependencies;
            bool steamAvailable = viewModel.SteamAvailable;
            bool epicAvailable = viewModel.EpicAvailable;
            string missingBuildsMessage = viewModel.MissingBuildsMessage;
            bool macCredentialsMissing = viewModel.IsUnityBuildDisabledDueToMissingMacCredentials;
            
            // Check if platforms are selected but not available (credentials not configured or other issues)
            bool steamPlatformSelected = false;
            bool epicPlatformSelected = false;
            if (currentProfile != null)
            {
                string platform = currentProfile.platform?.ToLower() ?? "";
                steamPlatformSelected = platform == "steam" || platform == "both";
                epicPlatformSelected = platform == "epic" || platform == "both";
            }

            // Use ViewModel state for tools and credentials availability
            bool steamToolsConfigured = viewModel.SteamToolsConfigured;
            bool steamCredentialsConfigured = viewModel.SteamCredentialsConfigured;
            bool epicToolsConfigured = viewModel.EpicToolsConfigured;
            bool epicCredentialsConfigured = viewModel.EpicCredentialsConfigured;
            bool cosmosBinariesConfigured = viewModel.CosmosBinariesConfigured;
            
            // Check if we're on Windows (Cosmos is only required on Windows)
            bool isWindows = Application.platform == RuntimePlatform.WindowsEditor;
            bool cosmosMissingOnWindows = isWindows && !cosmosBinariesConfigured;
            
            // Build Operations Section
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Sections.BuildOperations"), EditorStyles.boldLabel);
            GUILayout.Space(5);
            
            // Unity Build checkbox - disabled if profile doesn't exist, is running, macOS credentials are missing, or Cosmos binaries are missing (Windows only)
            bool unityBuildDisabled = !hasProfile || viewModel.IsRunning || macCredentialsMissing || cosmosMissingOnWindows;
            EditorGUI.BeginDisabledGroup(unityBuildDisabled);
            EditorGUILayout.BeginHorizontal();
            bool unityBuildChecked = EditorGUILayout.ToggleLeft(
                new GUIContent(
                    CadetLocalization.GetString("Window.Cadet.Checkboxes.UnityBuild"),
                    CadetLocalization.GetString("Window.Cadet.Tooltips.UnityBuild")
                ),
                viewModel.UnityBuildChecked,
                GUILayout.Width(200)
            );
            if (unityBuildChecked != viewModel.UnityBuildChecked && !macCredentialsMissing && !cosmosMissingOnWindows)
            {
                viewModel.UnityBuildChecked = unityBuildChecked;
            }
            // Show inline message if Cosmos binaries are missing (Windows only) - priority over other messages
            if (cosmosMissingOnWindows && hasProfile)
            {
                GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Messages.CosmosBinariesNotConfigured"), EditorStyles.miniLabel);
            }
            EditorGUILayout.EndHorizontal();
            EditorGUI.EndDisabledGroup();
            
            // Show info message if macOS credentials are missing (only if Cosmos is not missing)
            if (macCredentialsMissing && !cosmosMissingOnWindows)
            {
                EditorGUILayout.HelpBox(CadetLocalization.GetString("Window.Cadet.Messages.MacCredentialsNotConfigured"), MessageType.Warning);
            }
            // Show info message if builds are missing (only when Unity Build is unchecked, macOS credentials are not missing, and Cosmos is not missing)
            else if (!viewModel.UnityBuildChecked && !string.IsNullOrEmpty(missingBuildsMessage) && !macCredentialsMissing && !cosmosMissingOnWindows)
            {
                EditorGUILayout.HelpBox(missingBuildsMessage, MessageType.Info);
            }
            else
            {
                // Reserve control rect to maintain consistent control count
                EditorGUILayout.GetControlRect(false, 0);
            }
            
            GUILayout.Space(5);
            
            // Notarization is a Pro-only operation and must not be available in Lite.
#if !CADET_LITE
            // Notarize macOS Build checkbox - only show if profile OS is mac or both
            bool showNotarizeCheckbox = false;
            if (currentProfile != null)
            {
                string profileOS = currentProfile.os?.ToLower() ?? "";
                showNotarizeCheckbox = profileOS == "mac" || profileOS == "macos" || profileOS == "both";
            }
            
            if (showNotarizeCheckbox)
            {
                // Check if macOS credentials are configured (notarization always requires credentials)
                bool macCredentialsExist = MacCredentialsHelper.CredentialsFileExists();
                bool notarizeDisabled = !viewModel.MacosBuildExists || !hasProfile || viewModel.IsRunning || !macCredentialsExist;
                EditorGUI.BeginDisabledGroup(notarizeDisabled);
                EditorGUILayout.BeginHorizontal();
                bool notarizeMacChecked = EditorGUILayout.ToggleLeft(
                    new GUIContent(
                        CadetLocalization.GetString("Window.Cadet.Checkboxes.NotarizeMac"),
                        CadetLocalization.GetString("Window.Cadet.Tooltips.NotarizeMac")
                    ),
                    viewModel.NotarizeMacChecked,
                    GUILayout.Width(200)
                );
                if (notarizeMacChecked != viewModel.NotarizeMacChecked && viewModel.MacosBuildExists && macCredentialsExist)
                {
                    viewModel.NotarizeMacChecked = notarizeMacChecked;
                }
                // Show disabled reason inline if credentials are missing
                if (!macCredentialsExist && hasProfile && viewModel.MacosBuildExists)
                {
                    GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Messages.MacCredentialsNotConfigured"), EditorStyles.miniLabel);
                }
                EditorGUILayout.EndHorizontal();
                EditorGUI.EndDisabledGroup();
                
                GUILayout.Space(5);
            }
#endif
            
            // Publish to Steam checkbox
#if CADET_LITE
            EditorGUI.BeginDisabledGroup(true);
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.ToggleLeft(
                new GUIContent(
                    CadetLocalization.GetString("Window.Cadet.Checkboxes.PublishSteam"),
                    "Steam publishing requires CADET Pro."
                ),
                false,
                GUILayout.Width(200)
            );
            GUILayout.Label("PRO", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();
            EditorGUI.EndDisabledGroup();
#else
            EditorGUI.BeginDisabledGroup(!steamAvailable || !hasProfile || viewModel.IsRunning || hasMissingDeps);
            EditorGUILayout.BeginHorizontal();
            bool steamChecked = EditorGUILayout.ToggleLeft(
                new GUIContent(
                    CadetLocalization.GetString("Window.Cadet.Checkboxes.PublishSteam"),
                    steamAvailable 
                        ? CadetLocalization.GetString("Window.Cadet.Tooltips.PublishSteam")
                        : CadetLocalization.GetString("Window.Cadet.Tooltips.SteamNotConfigured")
                ),
                viewModel.PublishSteamChecked,
                GUILayout.Width(200)
            );
            if (steamChecked != viewModel.PublishSteamChecked && steamAvailable)
            {
                viewModel.PublishSteamChecked = steamChecked;
            }
            // Show disabled reason inline - priority: tools first, then credentials
            if (!steamAvailable && hasProfile && steamPlatformSelected)
            {
                if (!steamToolsConfigured)
                {
                    GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Messages.SteamBuildToolsNotConfigured"), EditorStyles.miniLabel);
                }
                else if (!steamCredentialsConfigured)
                {
                    GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Messages.SteamCredentialsNotConfigured"), EditorStyles.miniLabel);
                }
            }
            EditorGUILayout.EndHorizontal();
            EditorGUI.EndDisabledGroup();
#endif
            
            // Publish to Epic checkbox
#if CADET_LITE
            EditorGUI.BeginDisabledGroup(true);
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.ToggleLeft(
                new GUIContent(
                    CadetLocalization.GetString("Window.Cadet.Checkboxes.PublishEpic"),
                    "Epic publishing requires CADET Pro."
                ),
                false,
                GUILayout.Width(200)
            );
            GUILayout.Label("PRO", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();
            EditorGUI.EndDisabledGroup();
#else
            bool epicCheckboxDisabled = !epicAvailable || !hasProfile || viewModel.IsRunning || hasMissingDeps;
            
            EditorGUI.BeginDisabledGroup(epicCheckboxDisabled);
            EditorGUILayout.BeginHorizontal();
            bool epicChecked = EditorGUILayout.ToggleLeft(
                new GUIContent(
                    CadetLocalization.GetString("Window.Cadet.Checkboxes.PublishEpic"),
                    epicAvailable 
                        ? CadetLocalization.GetString("Window.Cadet.Tooltips.PublishEpic")
                        : CadetLocalization.GetString("Window.Cadet.Tooltips.EpicNotConfigured")
                ),
                viewModel.PublishEpicChecked,
                GUILayout.Width(200)
            );
            if (epicChecked != viewModel.PublishEpicChecked && epicAvailable)
            {
                viewModel.PublishEpicChecked = epicChecked;
            }
            // Show disabled reason inline - priority: tools first, then credentials
            if (epicCheckboxDisabled && hasProfile && epicPlatformSelected)
            {
                if (!epicToolsConfigured)
                {
                    GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Messages.EpicBuildToolsNotConfigured"), EditorStyles.miniLabel);
                }
                else if (!epicCredentialsConfigured)
                {
                    GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Messages.EpicCredentialsNotConfigured"), EditorStyles.miniLabel);
                }
            }
            EditorGUILayout.EndHorizontal();
            EditorGUI.EndDisabledGroup();
#endif
            
            EditorGUILayout.EndVertical();
        }
        
        private Texture2D MakeTex(int width, int height, Color col)
        {
            Color[] pix = new Color[width * height];
            for (int i = 0; i < pix.Length; i++)
                pix[i] = col;
            
            Texture2D result = new Texture2D(width, height);
            result.SetPixels(pix);
            result.Apply();
            return result;
        }
        
        private void RepaintIfNeeded()
        {
            // In Unity Editor, we need to repaint the window
            // This will be handled by the parent window
        }
    }
}