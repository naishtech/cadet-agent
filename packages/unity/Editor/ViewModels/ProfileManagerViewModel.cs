using System;
using System.Collections.Generic;
using UnityEditor;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// ViewModel for profile management - handles profile list, selection, and CRUD operations
    /// </summary>
    public class ProfileManagerViewModel
    {
        private List<string> profiles;
        private int selectedIndex;
        private ProfileInfo selectedProfileInfo;
        
        // Properties with change events
        public IReadOnlyList<string> Profiles => profiles;
        
        public int SelectedIndex
        {
            get => selectedIndex;
            set
            {
                if (selectedIndex != value)
                {
                    selectedIndex = value;
                    UpdateSelectedProfileInfo();
                    SelectedIndexChanged?.Invoke(value);
                }
            }
        }
        
        public ProfileInfo SelectedProfileInfo
        {
            get => selectedProfileInfo;
            private set
            {
                if (selectedProfileInfo != value)
                {
                    selectedProfileInfo = value;
                    SelectedProfileInfoChanged?.Invoke(value);
                }
            }
        }
        
        public bool HasProfile => profiles.Count > 0 && selectedIndex >= 0 && selectedIndex < profiles.Count;
        
        // Events
        public event Action<int> SelectedIndexChanged;
        public event Action<ProfileInfo> SelectedProfileInfoChanged;
        public event Action OnProfilesListChanged;
        public event Action<string> OnNewProfileRequested;
        public event Action<string> OnEditProfileRequested;
        public event Action<string> OnDeleteProfileRequested;
        public event Action<string> OnDuplicateProfileRequested;
        public event Action<string> OnExportProfileRequested;
        public event Action<string> OnProfileSelected;
        
        public ProfileManagerViewModel()
        {
            profiles = new List<string>();
            selectedIndex = -1;
            selectedProfileInfo = new ProfileInfo();
            LoadProfiles();
        }
        
        public void LoadProfiles()
        {
            var profileAssets = ProfileService.Instance.GetAllProfiles();
            profiles = new List<string>();
            
            foreach (var asset in profileAssets)
            {
                if (asset != null && asset.Profile != null && !string.IsNullOrEmpty(asset.Profile.profileName))
                {
                    profiles.Add(asset.Profile.profileName);
                }
            }
            
            // Restore last selected profile
            string lastProfile = EditorPrefs.GetString("CADET_LastProfile", "");
            if (!string.IsNullOrEmpty(lastProfile) && profiles.Contains(lastProfile))
            {
                selectedIndex = profiles.IndexOf(lastProfile);
            }
            else if (profiles.Count > 0)
            {
                selectedIndex = 0;
            }
            else
            {
                selectedIndex = -1;
            }
            
            UpdateSelectedProfileInfo();
            OnProfilesListChanged?.Invoke();
        }
        
        public void SelectProfile(int index)
        {
            if (index >= 0 && index < profiles.Count)
            {
                SelectedIndex = index;
                string profileName = profiles[index];
                EditorPrefs.SetString("CADET_LastProfile", profileName);
                OnProfileSelected?.Invoke(profileName);
            }
        }
        
        public void RequestNewProfile()
        {
            OnNewProfileRequested?.Invoke("");
        }
        
        public void RequestEditProfile()
        {
            if (HasProfile)
            {
                OnEditProfileRequested?.Invoke(profiles[selectedIndex]);
            }
        }
        
        public void RequestDeleteProfile()
        {
            if (HasProfile)
            {
                OnDeleteProfileRequested?.Invoke(profiles[selectedIndex]);
            }
        }
        
        public void RequestDuplicateProfile()
        {
            if (HasProfile)
            {
                OnDuplicateProfileRequested?.Invoke(profiles[selectedIndex]);
            }
        }
        
        public void RequestExportProfile()
        {
            if (HasProfile)
            {
                OnExportProfileRequested?.Invoke(profiles[selectedIndex]);
            }
        }
        
        public void DeleteProfile(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
                return;
            
            // Delete via ProfileService
            bool deleted = ProfileService.Instance.DeleteProfile(profileName);
            if (deleted)
            {
                // Reload profiles list
                LoadProfiles();
            }
        }
        
        public void DuplicateProfile(string sourceName, string newName)
        {
            if (string.IsNullOrEmpty(sourceName) || string.IsNullOrEmpty(newName))
                return;
            
            try
            {
                // Duplicate via ProfileService
                ProfileService.Instance.DuplicateProfile(sourceName, newName);
                
                // Reload profiles list
                LoadProfiles();
                
                // Select the new profile
                int newIndex = profiles.IndexOf(newName);
                if (newIndex >= 0)
                {
                    SelectProfile(newIndex);
                }
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogError($"Failed to duplicate profile: {ex.Message}");
                EditorUtility.DisplayDialog("Duplicate Failed", $"Failed to duplicate profile: {ex.Message}", "OK");
            }
        }
        
        public string GetSelectedProfileName()
        {
            if (HasProfile)
                return profiles[selectedIndex];
            return "";
        }
        
        private void UpdateSelectedProfileInfo()
        {
            if (HasProfile)
            {
                // Load actual profile data from ScriptableObject
                string profileName = profiles[selectedIndex];
                var asset = ProfileService.Instance.GetProfile(profileName);
                
                if (asset != null && asset.Profile != null)
                {
                    SelectedProfileInfo = new ProfileInfo(asset.Profile);
                }
                else
                {
                    SelectedProfileInfo = new ProfileInfo();
                }
            }
            else
            {
                SelectedProfileInfo = new ProfileInfo();
            }
        }
        
        /// <summary>
        /// Gets the BuildProfileAsset for the selected profile
        /// </summary>
        public BuildProfileAsset GetSelectedProfileAsset()
        {
            if (HasProfile)
            {
                string profileName = profiles[selectedIndex];
                return ProfileService.Instance.GetProfile(profileName);
            }
            return null;
        }
    }
}

