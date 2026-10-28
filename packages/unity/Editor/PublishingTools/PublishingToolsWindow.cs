using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.Views;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Epic;
using Covyne.CADET.Editor.Mac;

namespace Covyne.CADET.Editor.PublishingTools
{
    /// <summary>
    /// Publishing Tools Configuration window for dependency management and platform credentials
    /// </summary>
    public class PublishingToolsWindow : EditorWindow
    {
        private PublishingToolsViewModel viewModel;
        private PublishingToolsView view;

        public static void ShowWindow()
        {
            PublishingToolsWindow window = GetWindow<PublishingToolsWindow>(CadetLocalization.GetString("Window.PublishingToolsConfig.Title"));
            window.minSize = new Vector2(600, 500);
            window.maxSize = new Vector2(600, 800);
            window.Show();
        }

        /// <summary>
        /// Opens the publishing tools window for dependency configuration
        /// </summary>
        public static void ShowDependencyConfiguration()
        {
            ShowWindow();
        }

        private void OnEnable()
        {
            Initialize();
        }

        private void Initialize()
        {
            // Initialize ViewModel
            viewModel = new PublishingToolsViewModel();
            
            // Initialize View
            view = new PublishingToolsView(viewModel);
            
            // Subscribe to each dependency card's status changes for repaint
            foreach (var card in viewModel.DependencyCards)
            {
                card.StatusChanged += (status) => Repaint();
            }
            
            // Wire up credential configuration events
            viewModel.OnConfigureSteamCredentialsRequested += () =>
            {
                Steam.SteamCredentialsWizard.ShowWindow();
            };
            
            viewModel.OnConfigureEpicCredentialsRequested += () =>
            {
                EpicCredentialsWizard.ShowWindow();
            };
            
            viewModel.OnConfigureMacCredentialsRequested += () =>
            {
                // Defer modal dialog to avoid GUI layout errors - must be called outside of OnGUI
                EditorApplication.delayCall += HandleConfigureMacCredentials;
            };
            
            viewModel.OnCloseRequested += () =>
            {
                Close();
            };
        }

        private void OnGUI()
        {
            view.Draw();
        }
        
        /// <summary>
        /// Handles macOS credentials configuration - shows input dialog and saves password
        /// </summary>
        private void HandleConfigureMacCredentials()
        {
            string title = CadetLocalization.GetString("Window.PublishingToolsConfig.Dialogs.ConfigureMacCredentials.Title");
            string message = CadetLocalization.GetString("Window.PublishingToolsConfig.Dialogs.ConfigureMacCredentials.Message");
            
            // Show custom dialog for macOS credentials (larger size, proper message handling)
            string password = MacCredentialsDialog.Show(title, message);
            
            if (!string.IsNullOrEmpty(password))
            {
                // Save the password
                bool success = MacCredentialsHelper.WriteGeneratedPassword(password);
                
                if (success)
                {
                    // Show success dialog
                    EditorUtility.DisplayDialog(
                        title,
                        CadetLocalization.GetString("Window.PublishingToolsConfig.Dialogs.ConfigureMacCredentials.Success"),
                        "OK"
                    );
                    
                    // Refresh all CadetWindows to update UI state
                    CadetWindow.RefreshAllWindowsMacCredentialsState();
                    
                    // Repaint this window
                    Repaint();
                }
                else
                {
                    // Show error dialog
                    EditorUtility.DisplayDialog(
                        title,
                        string.Format(CadetLocalization.GetString("Window.PublishingToolsConfig.Dialogs.ConfigureMacCredentials.Error"), "Unknown error"),
                        "OK"
                    );
                }
            }
            // If user cancelled (password is null/empty), do nothing
        }
    }
}

