using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Service for managing build profile ScriptableObjects
    /// Handles CRUD operations for profiles stored in Assets/Config/Covyne/Cadet/Profiles/
    /// </summary>
    public class ProfileService
    {
        private static ProfileService instance;
        private const string PROFILES_DIRECTORY = "Assets/Config/Covyne/Cadet/Profiles";
        
        public static ProfileService Instance
        {
            get
            {
                if (instance == null)
                {
                    instance = new ProfileService();
                }
                return instance;
            }
        }
        
        private ProfileService()
        {
            EnsureProfilesDirectoryExists();
        }
        
        /// <summary>
        /// Ensures the Profiles directory exists, creating it if necessary
        /// </summary>
        private void EnsureProfilesDirectoryExists()
        {
            if (!AssetDatabase.IsValidFolder(PROFILES_DIRECTORY))
            {
                // Create directory structure
                string parentDir = "Assets/Config/Covyne/Cadet";
                if (!AssetDatabase.IsValidFolder(parentDir))
                {
                    string covyneDir = "Assets/Config/Covyne";
                    if (!AssetDatabase.IsValidFolder(covyneDir))
                    {
                        string configDir = "Assets/Config";
                        if (!AssetDatabase.IsValidFolder(configDir))
                        {
                            AssetDatabase.CreateFolder("Assets", "Config");
                        }
                        AssetDatabase.CreateFolder(configDir, "Covyne");
                    }
                    AssetDatabase.CreateFolder(covyneDir, "Cadet");
                }
                AssetDatabase.CreateFolder("Assets/Config/Covyne/Cadet", "Profiles");
                AssetDatabase.Refresh();
            }
        }
        
        /// <summary>
        /// Sanitizes a profile name to be a valid Unity asset filename
        /// </summary>
        private string SanitizeProfileName(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
                return "NewProfile";
            
            // Remove invalid filename characters
            char[] invalidChars = Path.GetInvalidFileNameChars();
            string sanitized = profileName;
            foreach (char c in invalidChars)
            {
                sanitized = sanitized.Replace(c, '_');
            }
            
            // Remove leading/trailing spaces and dots
            sanitized = sanitized.Trim(' ', '.');
            
            // Ensure it's not empty after sanitization
            if (string.IsNullOrEmpty(sanitized))
                sanitized = "NewProfile";
            
            return sanitized;
        }
        
        /// <summary>
        /// Gets the asset path for a profile by name
        /// </summary>
        public string GetProfilePath(string profileName)
        {
            string sanitized = SanitizeProfileName(profileName);
            return $"{PROFILES_DIRECTORY}/{sanitized}.asset";
        }
        
        /// <summary>
        /// Gets all profile assets from the Profiles directory
        /// </summary>
        public List<BuildProfileAsset> GetAllProfiles()
        {
            var profiles = new List<BuildProfileAsset>();
            
            EnsureProfilesDirectoryExists();
            
            // Find all BuildProfileAsset assets in the Profiles directory
            string[] guids = AssetDatabase.FindAssets($"t:{typeof(BuildProfileAsset).Name}", new[] { PROFILES_DIRECTORY });
            
            foreach (string guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var asset = AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(path);
                if (asset != null)
                {
                    // Ensure profile name matches asset name
                    asset.ValidateProfileName();
                    profiles.Add(asset);
                }
            }
            
            // Sort by profile name
            profiles.Sort((a, b) => string.Compare(a.Profile.profileName, b.Profile.profileName, StringComparison.OrdinalIgnoreCase));
            
            return profiles;
        }
        
        /// <summary>
        /// Gets a profile by name
        /// </summary>
        public BuildProfileAsset GetProfile(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
                return null;
            
            string path = GetProfilePath(profileName);
            return AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(path);
        }
        
        /// <summary>
        /// Checks if a profile with the given name exists
        /// </summary>
        public bool ProfileExists(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
                return false;
            
            string path = GetProfilePath(profileName);
            return AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(path) != null;
        }
        
        /// <summary>
        /// Creates a new profile asset
        /// </summary>
        public BuildProfileAsset CreateProfile(BuildProfile profileData)
        {
            if (profileData == null)
            {
                throw new ArgumentNullException(nameof(profileData));
            }
            
            if (string.IsNullOrEmpty(profileData.profileName))
            {
                throw new ArgumentException("Profile name cannot be empty", nameof(profileData));
            }
            
            // Check if profile already exists
            if (ProfileExists(profileData.profileName))
            {
                throw new InvalidOperationException($"Profile '{profileData.profileName}' already exists");
            }
            
            EnsureProfilesDirectoryExists();
            
            // Create asset
            var asset = BuildProfileAsset.CreateInstance(profileData);
            string sanitized = SanitizeProfileName(profileData.profileName);
            string path = $"{PROFILES_DIRECTORY}/{sanitized}.asset";
            
            // Ensure profile name matches sanitized name
            asset.Profile.profileName = sanitized;
            asset.name = sanitized;
            
            AssetDatabase.CreateAsset(asset, path);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            
            return asset;
        }
        
        /// <summary>
        /// Saves/updates an existing profile asset
        /// </summary>
        public void SaveProfile(BuildProfileAsset asset)
        {
            if (asset == null)
            {
                throw new ArgumentNullException(nameof(asset));
            }
            
            if (asset.Profile == null)
            {
                throw new ArgumentException("Asset profile data is null", nameof(asset));
            }
            
            if (string.IsNullOrEmpty(asset.Profile.profileName))
            {
                throw new ArgumentException("Profile name cannot be empty", nameof(asset));
            }
            
            EnsureProfilesDirectoryExists();
            
            // Get current asset path
            string currentPath = AssetDatabase.GetAssetPath(asset);
            
            // Sanitize profile name
            string sanitized = SanitizeProfileName(asset.Profile.profileName);
            string expectedPath = GetProfilePath(sanitized);
            
            // Update profile name to match sanitized version
            asset.Profile.profileName = sanitized;
            asset.name = sanitized;
            
            // If asset doesn't have a path yet (new asset), create it
            if (string.IsNullOrEmpty(currentPath))
            {
                AssetDatabase.CreateAsset(asset, expectedPath);
            }
            else if (currentPath != expectedPath)
            {
                // Profile name changed - rename the asset
                string error = AssetDatabase.MoveAsset(currentPath, expectedPath);
                if (!string.IsNullOrEmpty(error))
                {
                    throw new InvalidOperationException($"Failed to rename profile: {error}");
                }
            }
            
            // Mark asset as dirty and save
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }
        
        /// <summary>
        /// Deletes a profile by name
        /// </summary>
        public bool DeleteProfile(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
                return false;
            
            string path = GetProfilePath(profileName);
            var asset = AssetDatabase.LoadAssetAtPath<BuildProfileAsset>(path);
            
            if (asset == null)
                return false;
            
            bool deleted = AssetDatabase.DeleteAsset(path);
            if (deleted)
            {
                AssetDatabase.Refresh();
            }
            
            return deleted;
        }
        
        /// <summary>
        /// Duplicates a profile with a new name
        /// </summary>
        public BuildProfileAsset DuplicateProfile(string sourceName, string newName)
        {
            if (string.IsNullOrEmpty(sourceName))
                throw new ArgumentException("Source profile name cannot be empty", nameof(sourceName));
            
            if (string.IsNullOrEmpty(newName))
                throw new ArgumentException("New profile name cannot be empty", nameof(newName));
            
            var sourceAsset = GetProfile(sourceName);
            if (sourceAsset == null)
            {
                throw new InvalidOperationException($"Source profile '{sourceName}' not found");
            }
            
            if (ProfileExists(newName))
            {
                throw new InvalidOperationException($"Profile '{newName}' already exists");
            }
            
            // Deep copy the profile data
            string json = JsonUtility.ToJson(sourceAsset.Profile);
            var newProfileData = JsonUtility.FromJson<BuildProfile>(json);
            newProfileData.profileName = newName;
            
            // Create new asset
            return CreateProfile(newProfileData);
        }
        
        /// <summary>
        /// Gets profile names as a list of strings (for UI display)
        /// </summary>
        public List<string> GetProfileNames()
        {
            var profiles = GetAllProfiles();
            return profiles.Select(p => p.Profile.profileName).ToList();
        }
    }
}

