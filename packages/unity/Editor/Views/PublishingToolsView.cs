using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Steam;
using Covyne.CADET.Editor.Epic;
using Covyne.CADET.Editor.Mac;

namespace Covyne.CADET.Editor.Views
{
    /// <summary>
    /// View for Publishing Tools Configuration window - renders UI based on PublishingToolsViewModel
    /// </summary>
    public class PublishingToolsView
    {
        private PublishingToolsViewModel viewModel;
        private PublishingToolsCardView[] cardViews;
        
        public PublishingToolsView(PublishingToolsViewModel viewModel)
        {
            this.viewModel = viewModel;
            
            // Create views for each dependency card
            cardViews = new PublishingToolsCardView[viewModel.DependencyCards.Count];
            for (int i = 0; i < viewModel.DependencyCards.Count; i++)
            {
                cardViews[i] = new PublishingToolsCardView(viewModel.DependencyCards[i]);
            }
            
            // Subscribe to ViewModel events
            viewModel.ScrollPositionChanged += (pos) => RepaintIfNeeded();
        }
        
        public void Draw()
        {
            // Header
            EditorGUILayout.Space(15);
            GUILayout.Label(CadetLocalization.GetString("Window.PublishingToolsConfig.Header"), new GUIStyle(EditorStyles.boldLabel) { fontSize = 18 });
            
            EditorGUILayout.Space(10);
            
            // Info box
            EditorGUILayout.HelpBox(
                CadetLocalization.GetString("Window.PublishingToolsConfig.InfoBox"),
                MessageType.Info
            );
            
            EditorGUILayout.Space(10);
            
            // Required Dependencies section
            GUILayout.Label(CadetLocalization.GetString("Window.PublishingToolsConfig.RequiredDependencies"), EditorStyles.boldLabel);
            EditorGUILayout.Space(5);
            
            // Scrollable area for dependency cards
            viewModel.ScrollPosition = EditorGUILayout.BeginScrollView(viewModel.ScrollPosition);
            
            // Check if Cosmos Binaries is installed (required on Windows)
            bool cosmosInstalled = viewModel.IsCosmosBinariesInstalled();
            bool isWindows = System.Environment.OSVersion.Platform == System.PlatformID.Win32NT || 
                            System.Environment.OSVersion.Platform == System.PlatformID.Win32Windows;
            
            for (int i = 0; i < cardViews.Length; i++)
            {
                var card = cardViews[i];
                var cardStatus = viewModel.DependencyCards[i].Status;
                
                // Determine if this card requires Cosmos (all except Cosmos itself require it on Windows)
                bool requiresCosmos = false;
                if (isWindows && !cardStatus.name.Contains("Cosmos Binaries"))
                {
                    requiresCosmos = true;
                }
                
                // On Windows, disable other dependencies if Cosmos isn't installed
                // Cosmos itself is never disabled
                bool shouldDisable = false;
                if (requiresCosmos && !cosmosInstalled)
                {
                    shouldDisable = true;
                }
                
                card.SetDisabled(shouldDisable);
                card.SetCosmosRequirement(requiresCosmos, cosmosInstalled);
                card.Draw();
                EditorGUILayout.Space(10);
            }
            
            EditorGUILayout.EndScrollView();
            
            EditorGUILayout.Space(10);
            
            // Platform Credentials section
            DrawPlatformCredentialsSection();
            
            EditorGUILayout.Space(10);
            
            // Bottom button - Close only
            DrawBottomButton();
        }
        
        private void DrawPlatformCredentialsSection()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
            GUILayout.Label(CadetLocalization.GetString("Window.PublishingToolsConfig.Sections.PlatformCredentials"), EditorStyles.boldLabel);
            EditorGUILayout.Space(5);
            
            // Check if dependencies are installed
            bool steamCmdInstalled = viewModel.IsSteamCmdInstalled();
            bool buildPatchToolInstalled = viewModel.IsBuildPatchToolInstalled();
            
            // Steam Credentials
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("Steam:", GUILayout.Width(80));
            bool steamConfigured = SteamCredentialsHelper.CredentialsFileExists();
            string steamStatus = steamConfigured 
                ? CadetLocalization.GetString("Window.ProfileEditor.Messages.SteamCredentialsConfigured")
                : CadetLocalization.GetString("Window.ProfileEditor.Messages.SteamCredentialsNotConfigured");
            GUILayout.Label(steamStatus, EditorStyles.miniLabel);
            GUILayout.FlexibleSpace();
            EditorGUI.BeginDisabledGroup(!steamCmdInstalled);
            if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.Buttons.ConfigureSteamCredentials"), GUILayout.Width(200)))
            {
                viewModel.RequestConfigureSteamCredentials();
            }
            EditorGUI.EndDisabledGroup();
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.Space(5);
            
            // Epic Credentials
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("Epic:", GUILayout.Width(80));
            bool epicConfigured = EpicCredentialsHelper.CredentialsFileExists();
            string epicStatus = epicConfigured 
                ? CadetLocalization.GetString("Window.ProfileEditor.Messages.EpicCredentialsConfigured")
                : CadetLocalization.GetString("Window.ProfileEditor.Messages.EpicCredentialsNotConfigured");
            GUILayout.Label(epicStatus, EditorStyles.miniLabel);
            GUILayout.FlexibleSpace();
            EditorGUI.BeginDisabledGroup(!buildPatchToolInstalled);
            if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.Buttons.ConfigureEpicCredentials"), GUILayout.Width(200)))
            {
                viewModel.RequestConfigureEpicCredentials();
            }
            EditorGUI.EndDisabledGroup();
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.Space(5);
            
            // macOS Credentials
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("macOS:", GUILayout.Width(80));
            bool macConfigured = MacCredentialsHelper.CredentialsFileExists();
            string macStatus = macConfigured 
                ? CadetLocalization.GetString("Window.ProfileEditor.Messages.MacCredentialsConfigured")
                : CadetLocalization.GetString("Window.ProfileEditor.Messages.MacCredentialsNotConfigured");
            GUILayout.Label(macStatus, EditorStyles.miniLabel);
            GUILayout.FlexibleSpace();
            if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.Buttons.ConfigureMacCredentials"), GUILayout.Width(200)))
            {
                viewModel.RequestConfigureMacCredentials();
            }
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.EndVertical();
        }
        
        private void DrawBottomButton()
        {
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            
            if (GUILayout.Button(CadetLocalization.GetString("Window.PublishingToolsConfig.Buttons.Close"), GUILayout.Height(35), GUILayout.Width(150)))
            {
                viewModel.RequestClose();
            }
            
            EditorGUILayout.EndHorizontal();
        }
        
        private void RepaintIfNeeded()
        {
            // In Unity Editor, we need to repaint the window
            // This will be handled by the parent window
        }
    }
}

