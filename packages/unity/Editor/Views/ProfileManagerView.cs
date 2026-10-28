using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.Localization;

namespace Covyne.CADET.Editor.Views
{
    /// <summary>
    /// View for profile management - renders UI based on ProfileManagerViewModel
    /// </summary>
    public class ProfileManagerView
    {
        private ProfileManagerViewModel viewModel;
        
        public ProfileManagerView(ProfileManagerViewModel viewModel)
        {
            this.viewModel = viewModel;
            
            // Subscribe to ViewModel events for repaint notifications
            viewModel.SelectedIndexChanged += (index) => RepaintIfNeeded();
            viewModel.SelectedProfileInfoChanged += (info) => RepaintIfNeeded();
        }
        
        public void Draw(bool isRunning = false)
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
            // Profile dropdown and action buttons
            EditorGUILayout.BeginHorizontal();
            
            // Profile dropdown - disabled when running
            EditorGUI.BeginDisabledGroup(isRunning);
            GUILayout.Label(CadetLocalization.GetString("Window.Cadet.ProfileLabel"), GUILayout.Width(60));
            int currentIndex = viewModel.SelectedIndex;
            string[] profileArray = new string[viewModel.Profiles.Count];
            for (int i = 0; i < viewModel.Profiles.Count; i++)
            {
                profileArray[i] = viewModel.Profiles[i];
            }
            
            int newIndex = EditorGUILayout.Popup(currentIndex, profileArray, GUILayout.ExpandWidth(true));
            
            if (newIndex != currentIndex)
            {
                viewModel.SelectProfile(newIndex);
            }
            EditorGUI.EndDisabledGroup();
            
            // Action buttons - all disabled when running
            EditorGUI.BeginDisabledGroup(isRunning);
            if (GUILayout.Button(CadetLocalization.GetString("Window.Cadet.Buttons.New"), GUILayout.Width(60)))
            {
                viewModel.RequestNewProfile();
            }
            EditorGUI.EndDisabledGroup();
            
            // Edit, Duplicate, Export buttons - disabled when running or no profile
            EditorGUI.BeginDisabledGroup(isRunning || !viewModel.HasProfile);
            if (GUILayout.Button(CadetLocalization.GetString("Window.Cadet.Buttons.Edit"), GUILayout.Width(60)))
            {
                viewModel.RequestEditProfile();
            }
            
            if (GUILayout.Button(CadetLocalization.GetString("Window.Cadet.Buttons.Duplicate"), GUILayout.Width(70)))
            {
                viewModel.RequestDuplicateProfile();
            }
            
            if (GUILayout.Button(CadetLocalization.GetString("Window.Cadet.Buttons.Export"), GUILayout.Width(70)))
            {
                viewModel.RequestExportProfile();
            }
            EditorGUI.EndDisabledGroup();
            
            // Delete button - disabled when running or no profile selected
            EditorGUI.BeginDisabledGroup(isRunning || !viewModel.HasProfile);
            if (GUILayout.Button(CadetLocalization.GetString("Window.Cadet.Buttons.Delete"), GUILayout.Width(60)))
            {
                viewModel.RequestDeleteProfile();
            }
            EditorGUI.EndDisabledGroup();
            
            EditorGUILayout.EndHorizontal();
            
            EditorGUILayout.Space(5);
            
            // Profile info display
            if (viewModel.HasProfile)
            {
                DrawProfileInfo();
            }
            else
            {
                EditorGUILayout.HelpBox(CadetLocalization.GetString("Window.Cadet.Messages.NoProfilesAvailable"), MessageType.Info);
            }
            
            EditorGUILayout.EndVertical();
        }
        
        private void DrawProfileInfo()
        {
            var info = viewModel.SelectedProfileInfo;
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.Cadet.ProfileInfo.Platform"), info.GetPlatformDisplayName());
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.Cadet.ProfileInfo.UnityProject"), info.projectName);
            EditorGUILayout.LabelField(CadetLocalization.GetString("Window.Cadet.ProfileInfo.BuildOutput"), info.buildOutputPath);
        }
        
        private void RepaintIfNeeded()
        {
            // In Unity Editor, we need to repaint the window
            // This will be handled by the parent window
        }
    }
}

