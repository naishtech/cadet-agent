using System;
using System.Collections.Generic;
using UnityEditor;

namespace Covyne.CADET.Editor.Models
{
    /// <summary>
    /// Data model representing a build profile configuration
    /// </summary>
    [Serializable]
    public class BuildProfile
    {
        public string profileName;
        public string platform; // "steam", "epic", "custom"
        public string os; // "windows", "macos", "linux"
        public string bundleId; // macOS bundle id (e.g., "com.example.app")
        public bool macSign;
        public bool useGit;
        public bool installGitLfsIfMissing;
        public string gitRepository;
        public string gitBranch;
        public string gitBashPath;
        
        public UnitySettings unity;
        public SteamSettings steam;
        public EpicSettings epic;
        public MacOSSettings macos;
        
        public BuildProfile()
        {
            profileName = "";
#if CADET_LITE
            platform = "none";
#else
            platform = "steam";
#endif
            os = "windows";
            // Initialize with empty - will be populated by InitializeDefaults() if empty
            bundleId = "";
            macSign = false;
            useGit = false;
            installGitLfsIfMissing = false;
            gitRepository = "";
            gitBranch = "";
            gitBashPath = "";
            unity = new UnitySettings();
            steam = new SteamSettings();
            epic = new EpicSettings();
            macos = new MacOSSettings();
        }
        
        /// <summary>
        /// Initialize default bundleId from current project's player settings if not already set.
        /// Must be called after deserialization to populate bundleId with project's bundle identifier.
        /// </summary>
        public void InitializeDefaults()
        {
            if (string.IsNullOrEmpty(bundleId))
            {
                try
                {
                    bundleId = PlayerSettings.applicationIdentifier ?? "com.example.app";
                }
                catch
                {
                    // If there's any issue reading PlayerSettings, fall back to default
                    bundleId = "com.example.app";
                }
            }
        }
    }
    
    [Serializable]
    public class UnitySettings
    {
        public string editorPath;
        public string projectPath;
        public string buildOutputPath;
        public string projectName;
        
        public UnitySettings()
        {
            editorPath = "";
            projectPath = "";
            buildOutputPath = "";
            projectName = "";
        }
    }
    
    [Serializable]
    public class SteamSettings
    {
        public string appId;
        public string steamcmdExe;
        public string steamcmdSh;
        public bool useSentryFile;
        public string description;
        public string setLive;
        public string contentRoot;
        public string buildOutput;
        public List<SteamDepot> depots;
        
        public SteamSettings()
        {
            appId = "";
            steamcmdExe = "";
            steamcmdSh = "";
            useSentryFile = false;
            description = "";
            setLive = "";
            contentRoot = "";
            buildOutput = "";
            depots = new List<SteamDepot>();
        }
    }
    
    [Serializable]
    public class SteamDepot
    {
        public string depotId;
        public string os;
        public string localPath;
        public string depotPath;
        public string recursive;
        
        public SteamDepot()
        {
            depotId = "";
            os = "";
            localPath = "";
            depotPath = "";
            recursive = "1";
        }
    }
    
    [Serializable]
    public class EpicSettings
    {
        public string productId;
        public string organizationId;
        public string artifactId;
        public string sandboxId;
        public string buildPatchToolPath;
        public string buildVersion;
        public bool useGitTagForVersion;
        public string label;
        
        public EpicSettings()
        {
            productId = "";
            organizationId = "";
            artifactId = "";
            sandboxId = "";
            buildPatchToolPath = "";
            buildVersion = "";
            useGitTagForVersion = false;
            label = "dev";
        }
    }
    
    [Serializable]
    public class MacOSSettings
    {
        public bool enableSigning;
        public string entitlementsPath;
        
        public MacOSSettings()
        {
            enableSigning = false;
            entitlementsPath = "";
        }
    }
}

