using System;
using System.IO;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Utilities;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// ViewModel for profile editor - manages profile data, validation, and save operations
    /// </summary>
    public class ProfileEditorViewModel
    {
        private BuildProfile profile;
        private bool isNewProfile;
        private int selectedDepotIndex;
        private BuildProfileAsset profileAsset; // Reference to the asset if editing existing profile
        private string sourceProjectPath;
        
        public BuildProfile Profile
        {
            get => profile;
            private set
            {
                if (profile != value)
                {
                    profile = value;
                    ProfileChanged?.Invoke(value);
                }
            }
        }
        
        public bool IsNewProfile
        {
            get => isNewProfile;
            private set
            {
                if (isNewProfile != value)
                {
                    isNewProfile = value;
                    IsNewProfileChanged?.Invoke(value);
                }
            }
        }
        
        public int SelectedDepotIndex
        {
            get => selectedDepotIndex;
            set
            {
                if (selectedDepotIndex != value)
                {
                    selectedDepotIndex = value;
                    SelectedDepotIndexChanged?.Invoke(value);
                }
            }
        }

        public string SourceProjectPath
        {
            get => sourceProjectPath;
            private set
            {
                if (sourceProjectPath != value)
                {
                    sourceProjectPath = value;
                    ProfileChanged?.Invoke(profile);
                }
            }
        }
        
        // Events
        public event Action<BuildProfile> ProfileChanged;
        public event Action<bool> IsNewProfileChanged;
        public event Action<int> SelectedDepotIndexChanged;
        public event Action<string> OnValidationError;
        public event Action<string> OnSaveSuccess;
        public event Action OnSaveRequested;
        public event Action OnProfileSaved; // Fired after successful save to refresh profile list
        
        /// <summary>
        /// Creates a ViewModel for editing a profile
        /// </summary>
        /// <param name="profileName">Name of existing profile to edit, or null for new profile</param>
        public ProfileEditorViewModel(string profileName = null)
        {
            if (!string.IsNullOrEmpty(profileName))
            {
                // Load existing profile
                profileAsset = ProfileService.Instance.GetProfile(profileName);
                if (profileAsset != null && profileAsset.Profile != null)
                {
                    // Deep copy the profile to avoid modifying the asset directly
                    profile = JsonUtility.FromJson<BuildProfile>(JsonUtility.ToJson(profileAsset.Profile));
                    profile.InitializeDefaults(); // Initialize bundleId if empty
                    isNewProfile = false;
                }
                else
                {
                    // Profile not found, create new one
                    profile = new BuildProfile();
                    profile.profileName = profileName; // Use the requested name
                    profile.InitializeDefaults(); // Initialize bundleId from project settings
                    isNewProfile = true;
                }
            }
            else
            {
                // Create new profile
                profile = new BuildProfile();
                profile.InitializeDefaults(); // Initialize bundleId from project settings
                isNewProfile = true;
            }
            
            // Set default Unity editor path to current editor installation if not set
            if (profile.unity != null && string.IsNullOrEmpty(profile.unity.editorPath))
            {
                profile.unity.editorPath = EditorApplication.applicationPath;
            }

            if (profile.unity != null && string.IsNullOrEmpty(profile.unity.projectPath) && !string.IsNullOrEmpty(profile.profileName))
            {
                profile.unity.projectPath = GetDefaultTargetPath(profile.profileName);
            }

            SourceProjectPath = LoadSourceProjectPath();
            
            // Populate Epic BuildPatchTool path from EditorPrefs if it's empty
            PopulateEpicBuildPatchToolPathFromEditorPrefs();
            
            // For new profiles on Windows, detect default Git Bash path
            if (isNewProfile && Application.platform == RuntimePlatform.WindowsEditor)
            {
                profile.gitBashPath = DetectGitBashPath();
            }
            
            selectedDepotIndex = -1;
        }

        public void UpdateSourceProjectPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                SourceProjectPath = GetCurrentProjectRoot();
                return;
            }

            SourceProjectPath = path;
        }
        
        /// <summary>
        /// Detects the Git for Windows installation path.
        /// Returns the full path to git.exe if found in common locations, or an empty string.
        /// Git for Windows includes proper credential manager integration out of the box.
        /// </summary>
        private string DetectGitBashPath()
        {
            // On Windows, Git for Windows usually installs to C:\Program Files\Git
            // We look for the git executable in the bin directory
            string[] possiblePaths = new string[]
            {
                "C:\\Program Files\\Git\\bin\\git.exe",
                "C:\\Program Files (x86)\\Git\\bin\\git.exe"
            };

            foreach (string path in possiblePaths)
            {
                if (File.Exists(path))
                {
                    // Return with forward slashes for better compatibility with bash scripts
                    return path.Replace("\\", "/");
                }
            }
            
            return "";
        }
        
        /// <summary>
        /// Legacy constructor for backward compatibility - loads by profile name
        /// </summary>
        [Obsolete("Use constructor with profileName parameter instead")]
        public ProfileEditorViewModel(BuildProfile existingProfile) : this(existingProfile?.profileName)
        {
        }
        
        public void UpdateProfileName(string name)
        {
            if (profile != null)
            {
                profile.profileName = name;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdatePlatform(string platform)
        {
            if (profile != null)
            {
                profile.platform = platform;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateOS(string os)
        {
            if (profile != null)
            {
                profile.os = os;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateMacSign(bool macSign)
        {
            if (profile != null)
            {
                profile.macSign = macSign;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateBundleId(string bundleId)
        {
            if (profile != null)
            {
                profile.bundleId = bundleId;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateUseGit(bool useGit)
        {
            if (profile != null)
            {
                profile.useGit = useGit;
                ProfileChanged?.Invoke(profile);
            }
        }

        public void UpdateInstallGitLfsIfMissing(bool installGitLfsIfMissing)
        {
            if (profile != null)
            {
                profile.installGitLfsIfMissing = installGitLfsIfMissing;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateGitRepository(string gitRepository)
        {
            if (profile != null)
            {
                profile.gitRepository = gitRepository;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateGitBranch(string gitBranch)
        {
            if (profile != null)
            {
                profile.gitBranch = gitBranch;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateGitBashPath(string path)
        {
            if (profile != null)
            {
                profile.gitBashPath = path;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateUnityEditorPath(string path)
        {
            if (profile?.unity != null)
            {
                profile.unity.editorPath = path;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateUnityProjectPath(string path)
        {
            if (profile?.unity != null)
            {
                string previousPath = profile.unity.projectPath;
                string currentProjectName = profile.unity.projectName;
                string previousAutoProjectName = ExtractProjectNameForPath(previousPath);
                bool shouldAutoUpdateProjectName =
                    string.IsNullOrWhiteSpace(currentProjectName) ||
                    string.Equals(currentProjectName, previousAutoProjectName, StringComparison.Ordinal);

                profile.unity.projectPath = path;
                
                // Try to extract project name from Unity PlayerSettings (productName)
                // Falls back to directory name if ProjectSettings can't be read
                if (!string.IsNullOrEmpty(path) && shouldAutoUpdateProjectName)
                {
                    string projectName = NormalizeExecutableName(ExtractProjectNameForPath(path));
                    if (!string.IsNullOrEmpty(projectName))
                    {
                        profile.unity.projectName = projectName;
                    }

                    // Auto-populate build output path to projectPath/Bin
                    // This will also trigger Steam path auto-population via UpdateUnityBuildOutputPath
                    UpdateUnityBuildOutputPath(Path.Combine(path, "Bin"));
                }
                else
                {
                    ProfileChanged?.Invoke(profile);
                }
            }
        }

        private string ExtractProjectNameForPath(string projectPath)
        {
            if (string.IsNullOrWhiteSpace(projectPath))
            {
                return null;
            }

            string projectName = ExtractProductNameFromProject(projectPath);
            if (!string.IsNullOrEmpty(projectName))
            {
                return projectName;
            }

            string cleanPath = projectPath.TrimEnd('/', '\\');
            return Path.GetFileName(cleanPath);
        }

        private string NormalizeExecutableName(string name)
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                return string.Empty;
            }

            string normalized = name.Trim();

            if (normalized.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized.Substring(0, normalized.Length - 4);
            }
            else if (normalized.EndsWith(".app", StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized.Substring(0, normalized.Length - 4);
            }

            return normalized.Trim();
        }

        /// <summary>
        /// Attempts to read the productName from Unity's ProjectSettings.asset file
        /// </summary>
        private string ExtractProductNameFromProject(string projectPath)
        {
            try
            {
                string projectSettingsPath = Path.Combine(projectPath, "ProjectSettings", "ProjectSettings.asset");
                if (!File.Exists(projectSettingsPath))
                    return null;
                
                string content = File.ReadAllText(projectSettingsPath);
                
                // Look for productName in the ProjectSettings.asset file
                // Format: productName: <name>
                var match = Regex.Match(content, @"productName:\s*(.+?)(?:\r?\n|$)");
                if (match.Success)
                {
                    string productName = match.Groups[1].Value.Trim();
                    // Remove quotes if present
                    if (productName.StartsWith("\"") && productName.EndsWith("\""))
                    {
                        productName = productName.Substring(1, productName.Length - 2);
                    }
                    return productName;
                }
            }
            catch
            {
                // If we can't read the file, just return null and fall back to directory name
            }
            
            return null;
        }

        private string GetDefaultTargetPath(string profileName)
        {
            string userHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(userHome, "CADET", "Workspaces", profileName).Replace("\\", "/");
        }

        private string GetCurrentProjectRoot()
        {
            return Path.GetDirectoryName(Path.GetFullPath(Application.dataPath));
        }

        private WorkspaceManager CreateWorkspaceManager()
        {
            string workspaceRoot = Path.GetFullPath(CadetConfigService.GetWorkspacesRoot())
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string registryPath = Path.Combine(workspaceRoot, "workspaces.json");
            return new WorkspaceManager(workspaceRoot, registryPath);
        }

        private string TryGetProfileGuid()
        {
            if (profileAsset == null)
            {
                return string.Empty;
            }

            string assetPath = AssetDatabase.GetAssetPath(profileAsset);
            if (string.IsNullOrWhiteSpace(assetPath))
            {
                return string.Empty;
            }

            return AssetDatabase.AssetPathToGUID(assetPath) ?? string.Empty;
        }

        private string LoadSourceProjectPath()
        {
            string defaultPath = GetCurrentProjectRoot();
            string profileGuid = TryGetProfileGuid();
            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return defaultPath;
            }

            try
            {
                WorkspaceManager workspaceManager = CreateWorkspaceManager();
                ProfileWorkspaceConfig config = workspaceManager.GetProfileConfig(profileGuid);
                return string.IsNullOrWhiteSpace(config.SourceProjectPath) ? defaultPath : config.SourceProjectPath;
            }
            catch
            {
                return defaultPath;
            }
        }

        private void SaveSourceProjectPath()
        {
            string profileGuid = TryGetProfileGuid();
            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return;
            }

            try
            {
                WorkspaceManager workspaceManager = CreateWorkspaceManager();
                workspaceManager.SaveProfileConfig(new ProfileWorkspaceConfig
                {
                    ProfileGuid = profileGuid,
                    SourceProjectPath = string.IsNullOrWhiteSpace(SourceProjectPath) ? GetCurrentProjectRoot() : SourceProjectPath
                });
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[C.A.D.E.T] Failed to persist source project path: {ex.Message}");
            }
        }
        
        public void UpdateUnityBuildOutputPath(string path)
        {
            if (profile?.unity != null)
            {
                string normalizedPath = NormalizeProfilePath(path);
                profile.unity.buildOutputPath = normalizedPath;
                
                // Auto-populate Steam paths from Unity build output path
                // contentRoot = buildOutputPath (same directory)
                // buildOutput = buildOutputPath/build (subdirectory for SteamCMD logs)
                if (profile.steam != null && !string.IsNullOrEmpty(normalizedPath))
                {
                    profile.steam.contentRoot = normalizedPath;
                    profile.steam.buildOutput = NormalizeProfilePath(Path.Combine(normalizedPath, "build"));
                }
                
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateUnityProjectName(string name)
        {
            if (profile?.unity != null)
            {
                profile.unity.projectName = NormalizeExecutableName(name);
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateSteamAppId(string appId)
        {
            if (profile?.steam != null)
            {
                profile.steam.appId = appId;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateSteamUseSentryFile(bool useSentryFile)
        {
            if (profile?.steam != null)
            {
                profile.steam.useSentryFile = useSentryFile;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateSteamDescription(string description)
        {
            if (profile?.steam != null)
            {
                profile.steam.description = description;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateSteamSetLive(string setLive)
        {
            if (profile?.steam != null)
            {
                profile.steam.setLive = setLive;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateSteamContentRoot(string contentRoot)
        {
            if (profile?.steam != null)
            {
                profile.steam.contentRoot = NormalizeProfilePath(contentRoot);
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateSteamBuildOutput(string buildOutput)
        {
            if (profile?.steam != null)
            {
                profile.steam.buildOutput = NormalizeProfilePath(buildOutput);
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void AddSteamDepot()
        {
            if (profile?.steam != null)
            {
                var depot = new SteamDepot();
                // Auto-populate default values based on OS
                PopulateDepotDefaults(depot);
                profile.steam.depots.Add(depot);
                SelectedDepotIndex = profile.steam.depots.Count - 1;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        /// <summary>
        /// Auto-populates depot fields (localPath, depotPath, recursive) based on OS
        /// </summary>
        private void PopulateDepotDefaults(SteamDepot depot)
        {
            if (depot == null)
                return;
            
            // Set default depotPath and recursive (same for all OS)
            if (string.IsNullOrEmpty(depot.depotPath))
            {
                depot.depotPath = ".";
            }
            if (string.IsNullOrEmpty(depot.recursive))
            {
                depot.recursive = "1";
            }
            
            // Set localPath based on OS
            // Windows: "windows\*" (backslash for Windows paths in JSON format)
            // Mac: "macos\*" (backslash for consistency)
            if (string.IsNullOrEmpty(depot.os))
            {
                // If OS not set, try to infer from profile OS setting
                if (profile != null && (profile.os == "windows" || profile.os == "mac"))
                {
                    depot.os = profile.os;
                }
                else
                {
                    // Default to windows if we can't infer
                    depot.os = "windows";
                }
            }
            
            // Only auto-populate localPath if it's empty
            if (string.IsNullOrEmpty(depot.localPath))
            {
                if (depot.os == "windows")
                {
                    depot.localPath = "windows\\*";
                }
                else if (depot.os == "mac")
                {
                    depot.localPath = "macos\\*";
                }
            }
        }
        
        public void RemoveSteamDepot(int index)
        {
            if (profile?.steam != null && index >= 0 && index < profile.steam.depots.Count)
            {
                profile.steam.depots.RemoveAt(index);
                if (selectedDepotIndex == index)
                    SelectedDepotIndex = -1;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateSteamDepot(int index, string depotId, string os, string localPath, string depotPath, string recursive)
        {
            if (profile?.steam != null && index >= 0 && index < profile.steam.depots.Count)
            {
                var depot = profile.steam.depots[index];
                string oldOS = depot.os;
                string oldLocalPath = depot.localPath;
                
                depot.depotId = depotId;
                depot.os = os;
                depot.localPath = localPath;
                depot.depotPath = depotPath;
                depot.recursive = recursive;
                
                // Auto-populate depotPath and recursive if empty
                if (string.IsNullOrEmpty(depot.depotPath))
                {
                    depot.depotPath = ".";
                }
                if (string.IsNullOrEmpty(depot.recursive))
                {
                    depot.recursive = "1";
                }
                
                // If OS changed, auto-update localPath if:
                // 1. localPath is empty, OR
                // 2. localPath matches the default pattern for the old OS (was auto-populated)
                if (os != oldOS)
                {
                    bool shouldAutoUpdate = string.IsNullOrEmpty(localPath) ||
                        (oldOS == "windows" && oldLocalPath == "windows\\*") ||
                        (oldOS == "mac" && oldLocalPath == "macos\\*");
                    
                    if (shouldAutoUpdate)
                    {
                        if (os == "windows")
                        {
                            depot.localPath = "windows\\*";
                        }
                        else if (os == "mac")
                        {
                            depot.localPath = "macos\\*";
                        }
                    }
                }
                // If OS didn't change but localPath is empty, auto-populate based on current OS
                else if (string.IsNullOrEmpty(localPath))
                {
                    if (os == "windows")
                    {
                        depot.localPath = "windows\\*";
                    }
                    else if (os == "mac")
                    {
                        depot.localPath = "macos\\*";
                    }
                }
                
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicProductId(string productId)
        {
            if (profile?.epic != null)
            {
                profile.epic.productId = productId;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicOrganizationId(string organizationId)
        {
            if (profile?.epic != null)
            {
                profile.epic.organizationId = organizationId;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicArtifactId(string artifactId)
        {
            if (profile?.epic != null)
            {
                profile.epic.artifactId = artifactId;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicSandboxId(string sandboxId)
        {
            if (profile?.epic != null)
            {
                profile.epic.sandboxId = sandboxId;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicBuildPatchToolPath(string path)
        {
            if (profile?.epic != null)
            {
                profile.epic.buildPatchToolPath = path;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicBuildVersion(string version)
        {
            if (profile?.epic != null)
            {
                profile.epic.buildVersion = version;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicUseGitTagForVersion(bool useGitTag)
        {
            if (profile?.epic != null)
            {
                profile.epic.useGitTagForVersion = useGitTag;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateEpicLabel(string label)
        {
            if (profile?.epic != null)
            {
                profile.epic.label = label;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateMacOSEnableSigning(bool enableSigning)
        {
            if (profile?.macos != null)
            {
                profile.macos.enableSigning = enableSigning;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public void UpdateMacOSEntitlementsPath(string path)
        {
            if (profile?.macos != null)
            {
                profile.macos.entitlementsPath = path;
                ProfileChanged?.Invoke(profile);
            }
        }
        
        public bool ValidateProfile()
        {
            if (profile == null)
            {
                OnValidationError?.Invoke("Profile is null.");
                return false;
            }
            
            if (string.IsNullOrEmpty(profile.profileName))
            {
                OnValidationError?.Invoke("Profile Name is required.");
                return false;
            }
            
            if (profile.unity == null)
            {
                OnValidationError?.Invoke("Unity settings are missing.");
                return false;
            }
            
            if (string.IsNullOrEmpty(profile.unity.editorPath))
            {
                OnValidationError?.Invoke("Unity Editor Path is required.");
                return false;
            }
            
            if (string.IsNullOrEmpty(profile.unity.projectPath))
            {
                OnValidationError?.Invoke("Unity Project Path is required.");
                return false;
            }

            if (string.IsNullOrEmpty(profile.unity.buildOutputPath))
            {
                OnValidationError?.Invoke("Build Output Path is required.");
                return false;
            }
            
            if (string.IsNullOrEmpty(profile.unity.projectName))
            {
                OnValidationError?.Invoke("Project Name is required.");
                return false;
            }

            bool isValidPlatform = profile.platform == "none" || profile.platform == "steam" || profile.platform == "epic" || profile.platform == "both";
            if (!isValidPlatform)
            {
                OnValidationError?.Invoke("Platform must be 'none', 'steam', 'epic', or 'both'.");
                return false;
            }
            
            // Platform-specific validation
#if !CADET_LITE
            if (profile.platform == "steam" || profile.platform == "both")
            {
                if (profile.steam == null)
                {
                    OnValidationError?.Invoke("Steam settings are missing.");
                    return false;
                }
                
                if (string.IsNullOrEmpty(profile.steam.appId))
                {
                    OnValidationError?.Invoke("Steam App ID is required.");
                    return false;
                }
                
                if (profile.steam.depots == null || profile.steam.depots.Count == 0)
                {
                    OnValidationError?.Invoke("At least one Steam depot is required.");
                    return false;
                }
            }
            
            if (profile.platform == "epic" || profile.platform == "both")
            {
                if (profile.epic == null)
                {
                    OnValidationError?.Invoke("Epic settings are missing.");
                    return false;
                }
                
                if (string.IsNullOrEmpty(profile.epic.productId))
                {
                    OnValidationError?.Invoke("Epic Product ID is required.");
                    return false;
                }
                
                if (string.IsNullOrEmpty(profile.epic.organizationId))
                {
                    OnValidationError?.Invoke("Epic Organization ID is required.");
                    return false;
                }
                
                if (string.IsNullOrEmpty(profile.epic.artifactId))
                {
                    OnValidationError?.Invoke("Epic Artifact ID is required.");
                    return false;
                }
                
                if (string.IsNullOrEmpty(profile.epic.sandboxId))
                {
                    OnValidationError?.Invoke("Epic Sandbox ID is required.");
                    return false;
                }
                
                // Note: buildPatchToolPath validation is not required for saving profiles
                // It will be validated only when executing Epic builds in CadetWindow
            }
#endif
            
            return true;
        }
        
        public void RequestSave()
        {
            // Auto-populate Steam paths from Unity build output path if not already set
            if (profile?.steam != null && profile?.unity != null && !string.IsNullOrEmpty(profile.unity.buildOutputPath))
            {
                if (string.IsNullOrEmpty(profile.steam.contentRoot))
                {
                    profile.steam.contentRoot = NormalizeProfilePath(profile.unity.buildOutputPath);
                }
                if (string.IsNullOrEmpty(profile.steam.buildOutput))
                {
                    profile.steam.buildOutput = NormalizeProfilePath(Path.Combine(profile.unity.buildOutputPath, "build"));
                }
            }
            
            if (ValidateProfile())
            {
                OnSaveRequested?.Invoke();
                
                try
                {
                    if (isNewProfile)
                    {
                        // Create new profile
                        if (ProfileService.Instance.ProfileExists(profile.profileName))
                        {
                            OnValidationError?.Invoke($"A profile with the name '{profile.profileName}' already exists. Please choose a different name.");
                            return;
                        }
                        
                        profileAsset = ProfileService.Instance.CreateProfile(profile);
                        OnSaveSuccess?.Invoke($"Profile '{profile.profileName}' has been created successfully.");
                    }
                    else
                    {
                        // Update existing profile
                        if (profileAsset == null)
                        {
                            // Try to find existing asset by name
                            profileAsset = ProfileService.Instance.GetProfile(profile.profileName);
                        }
                        
                        if (profileAsset != null)
                        {
                            // Update the asset's profile data
                            profileAsset.Profile = profile;
                            ProfileService.Instance.SaveProfile(profileAsset);
                            OnSaveSuccess?.Invoke($"Profile '{profile.profileName}' has been updated successfully.");
                        }
                        else
                        {
                            // Asset not found, create new one
                            profileAsset = ProfileService.Instance.CreateProfile(profile);
                            OnSaveSuccess?.Invoke($"Profile '{profile.profileName}' has been created successfully.");
                        }
                    }
                    
                    SaveSourceProjectPath();

                    // Fire event to refresh profile list
                    OnProfileSaved?.Invoke();
                }
                catch (Exception ex)
                {
                    string errorMessage = $"Failed to save profile: {ex.Message}";
                    Debug.LogError(errorMessage);
                    OnValidationError?.Invoke(errorMessage);
                }
            }
        }
        
        /// <summary>
        /// Populates Epic BuildPatchTool path from EditorPrefs if it's empty in the profile.
        /// This allows the path to be auto-filled when the profile editor opens.
        /// </summary>
        private void PopulateEpicBuildPatchToolPathFromEditorPrefs()
        {
            if (profile?.epic == null)
                return;
            
            // Only populate if the path is empty
            if (string.IsNullOrEmpty(profile.epic.buildPatchToolPath))
            {
                string buildPatchToolPath = EditorPrefs.GetString("CADET_BuildPatchToolPath", "");
                
                // If not in EditorPrefs, check user directory
                if (string.IsNullOrEmpty(buildPatchToolPath))
                {
                    buildPatchToolPath = BuildToolsPathHelper.GetBuildPatchToolPath();
                }
                
                // Verify the directory exists before setting it
                if (!string.IsNullOrEmpty(buildPatchToolPath) && Directory.Exists(buildPatchToolPath))
                {
                    profile.epic.buildPatchToolPath = buildPatchToolPath;
                }
            }
        }

        private static string NormalizeProfilePath(string path)
        {
            return string.IsNullOrEmpty(path) ? path : path.Replace('\\', '/');
        }
}

}

