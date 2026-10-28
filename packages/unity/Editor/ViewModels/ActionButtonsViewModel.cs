using System;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// ViewModel for action buttons - manages checkbox states and Execute command
    /// </summary>
    public class ActionButtonsViewModel
    {
        // State properties
        private bool isRunning;
        private bool hasProfile;
        private bool hasMissingPublishingDependencies;
        
        // Checkbox state properties
        private bool unityBuildChecked;
        private bool publishSteamChecked;
        private bool publishEpicChecked;
        private bool notarizeMacChecked;
        
        // Build existence state
        private bool windowsBuildExists;
        private bool macosBuildExists;
        private string missingBuildsMessage;
        
        // Platform availability
        private bool steamAvailable;
        private bool epicAvailable;
        
        // Platform tools and credentials availability (separate tracking for inline messages)
        private bool steamToolsConfigured;
        private bool steamCredentialsConfigured;
        private bool epicToolsConfigured;
        private bool epicCredentialsConfigured;
        
        // Cosmos binaries availability (Windows only, required for Unity Build)
        private bool cosmosBinariesConfigured;
        
        // macOS credentials requirement
        private bool isUnityBuildDisabledDueToMissingMacCredentials;
        
        public bool IsRunning
        {
            get => isRunning;
            set
            {
                if (isRunning != value)
                {
                    isRunning = value;
                    IsRunningChanged?.Invoke(value);
                }
            }
        }
        
        public bool HasProfile
        {
            get => hasProfile;
            set
            {
                if (hasProfile != value)
                {
                    hasProfile = value;
                    HasProfileChanged?.Invoke(value);
                }
            }
        }
        
        public bool HasMissingPublishingDependencies
        {
            get => hasMissingPublishingDependencies;
            set
            {
                if (hasMissingPublishingDependencies != value)
                {
                    hasMissingPublishingDependencies = value;
                    HasMissingPublishingDependenciesChanged?.Invoke(value);
                }
            }
        }
        
        // Checkbox state properties with change notifications
        public bool UnityBuildChecked
        {
            get => unityBuildChecked;
            set
            {
                if (unityBuildChecked != value)
                {
                    unityBuildChecked = value;
                    UnityBuildCheckedChanged?.Invoke(value);
                }
            }
        }
        
        public bool PublishSteamChecked
        {
            get => publishSteamChecked;
            set
            {
                if (publishSteamChecked != value)
                {
                    publishSteamChecked = value;
                    PublishSteamCheckedChanged?.Invoke(value);
                }
            }
        }
        
        public bool PublishEpicChecked
        {
            get => publishEpicChecked;
            set
            {
                if (publishEpicChecked != value)
                {
                    publishEpicChecked = value;
                    PublishEpicCheckedChanged?.Invoke(value);
                }
            }
        }
        
        public bool NotarizeMacChecked
        {
            get => notarizeMacChecked;
            set
            {
                if (notarizeMacChecked != value)
                {
                    notarizeMacChecked = value;
                    NotarizeMacCheckedChanged?.Invoke(value);
                }
            }
        }
        
        // Build existence state (read-only from View perspective, set via UpdateBuildExistence)
        public bool WindowsBuildExists
        {
            get => windowsBuildExists;
            private set
            {
                if (windowsBuildExists != value)
                {
                    windowsBuildExists = value;
                    WindowsBuildExistsChanged?.Invoke(value);
                }
            }
        }
        
        public bool MacosBuildExists
        {
            get => macosBuildExists;
            private set
            {
                if (macosBuildExists != value)
                {
                    macosBuildExists = value;
                    MacosBuildExistsChanged?.Invoke(value);
                }
            }
        }
        
        public string MissingBuildsMessage
        {
            get => missingBuildsMessage;
            private set
            {
                if (missingBuildsMessage != value)
                {
                    missingBuildsMessage = value;
                    MissingBuildsMessageChanged?.Invoke(value);
                }
            }
        }
        
        // Platform availability (read-only from View perspective, set via UpdatePlatformAvailability)
        public bool SteamAvailable
        {
            get => steamAvailable;
            private set
            {
                if (steamAvailable != value)
                {
                    steamAvailable = value;
                    SteamAvailableChanged?.Invoke(value);
                }
            }
        }
        
        public bool EpicAvailable
        {
            get => epicAvailable;
            private set
            {
                if (epicAvailable != value)
                {
                    epicAvailable = value;
                    EpicAvailableChanged?.Invoke(value);
                }
            }
        }
        
        public bool IsUnityBuildDisabledDueToMissingMacCredentials
        {
            get => isUnityBuildDisabledDueToMissingMacCredentials;
            private set
            {
                if (isUnityBuildDisabledDueToMissingMacCredentials != value)
                {
                    isUnityBuildDisabledDueToMissingMacCredentials = value;
                    MacCredentialsRequirementChanged?.Invoke(value);
                }
            }
        }
        
        // Platform tools and credentials availability (read-only from View perspective, set via UpdatePlatformAvailability)
        public bool SteamToolsConfigured
        {
            get => steamToolsConfigured;
            private set
            {
                if (steamToolsConfigured != value)
                {
                    steamToolsConfigured = value;
                    SteamToolsConfiguredChanged?.Invoke(value);
                }
            }
        }
        
        public bool SteamCredentialsConfigured
        {
            get => steamCredentialsConfigured;
            private set
            {
                if (steamCredentialsConfigured != value)
                {
                    steamCredentialsConfigured = value;
                    SteamCredentialsConfiguredChanged?.Invoke(value);
                }
            }
        }
        
        public bool EpicToolsConfigured
        {
            get => epicToolsConfigured;
            private set
            {
                if (epicToolsConfigured != value)
                {
                    epicToolsConfigured = value;
                    EpicToolsConfiguredChanged?.Invoke(value);
                }
            }
        }
        
        public bool EpicCredentialsConfigured
        {
            get => epicCredentialsConfigured;
            private set
            {
                if (epicCredentialsConfigured != value)
                {
                    epicCredentialsConfigured = value;
                    EpicCredentialsConfiguredChanged?.Invoke(value);
                }
            }
        }
        
        // Cosmos binaries availability (read-only from View perspective, set via UpdateCosmosBinariesAvailability)
        public bool CosmosBinariesConfigured
        {
            get => cosmosBinariesConfigured;
            private set
            {
                if (cosmosBinariesConfigured != value)
                {
                    cosmosBinariesConfigured = value;
                    CosmosBinariesConfiguredChanged?.Invoke(value);
                }
            }
        }
        
        // State change events
        public event Action<bool> IsRunningChanged;
        public event Action<bool> HasProfileChanged;
        public event Action<bool> HasMissingPublishingDependenciesChanged;
        
        // Checkbox change events
        public event Action<bool> UnityBuildCheckedChanged;
        public event Action<bool> PublishSteamCheckedChanged;
        public event Action<bool> PublishEpicCheckedChanged;
        public event Action<bool> NotarizeMacCheckedChanged;
        
        // Build existence change events
        public event Action<bool> WindowsBuildExistsChanged;
        public event Action<bool> MacosBuildExistsChanged;
        public event Action<string> MissingBuildsMessageChanged;
        
        // Platform availability change events
        public event Action<bool> SteamAvailableChanged;
        public event Action<bool> EpicAvailableChanged;
        
        // Platform tools and credentials change events
        public event Action<bool> SteamToolsConfiguredChanged;
        public event Action<bool> SteamCredentialsConfiguredChanged;
        public event Action<bool> EpicToolsConfiguredChanged;
        public event Action<bool> EpicCredentialsConfiguredChanged;
        
        // Cosmos binaries change event
        public event Action<bool> CosmosBinariesConfiguredChanged;
        
        // macOS credentials requirement change event
        public event Action<bool> MacCredentialsRequirementChanged;
        
        // Action events
        public event Action OnOpenPublishingToolsRequested;
        public event Action OnExecuteRequested;
        
        public ActionButtonsViewModel()
        {
            isRunning = false;
            hasProfile = false;
            hasMissingPublishingDependencies = false;
            unityBuildChecked = false;
            publishSteamChecked = false;
            publishEpicChecked = false;
            notarizeMacChecked = false;
            windowsBuildExists = false;
            macosBuildExists = false;
            missingBuildsMessage = string.Empty;
            steamAvailable = false;
            epicAvailable = false;
            steamToolsConfigured = false;
            steamCredentialsConfigured = false;
            epicToolsConfigured = false;
            epicCredentialsConfigured = false;
            cosmosBinariesConfigured = false;
            isUnityBuildDisabledDueToMissingMacCredentials = false;
        }
        
        /// <summary>
        /// Updates build existence state - called by Window when profile is selected
        /// </summary>
        public void UpdateBuildExistence(bool windowsExists, bool macosExists, string missingMessage)
        {
            WindowsBuildExists = windowsExists;
            MacosBuildExists = macosExists;
            MissingBuildsMessage = missingMessage ?? string.Empty;
        }
        
        /// <summary>
        /// Updates platform availability based on profile configuration - called by Window
        /// </summary>
        public void UpdatePlatformAvailability(bool steamToolsConfigured, bool steamCredentialsConfigured, bool epicToolsConfigured, bool epicCredentialsConfigured, bool steamPlatformSelected, bool epicPlatformSelected)
        {
            // Update individual flags
            SteamToolsConfigured = steamToolsConfigured;
            SteamCredentialsConfigured = steamCredentialsConfigured;
            EpicToolsConfigured = epicToolsConfigured;
            EpicCredentialsConfigured = epicCredentialsConfigured;
            
            // Calculate combined availability
#if CADET_LITE
            SteamAvailable = false;
            EpicAvailable = false;
#else
            SteamAvailable = steamPlatformSelected && steamToolsConfigured && steamCredentialsConfigured;
            EpicAvailable = epicPlatformSelected && epicToolsConfigured && epicCredentialsConfigured;
#endif
            
            // Uncheck unavailable platforms
            if (!SteamAvailable && publishSteamChecked)
            {
                PublishSteamChecked = false;
            }
            if (!EpicAvailable && publishEpicChecked)
            {
                PublishEpicChecked = false;
            }
        }
        
        /// <summary>
        /// Sets macOS credentials requirement - called by Window when notarization is enabled but credentials are missing
        /// </summary>
        public void SetMacCredentialsRequirement(bool isRequiredButMissing)
        {
            IsUnityBuildDisabledDueToMissingMacCredentials = isRequiredButMissing;
            
            // If credentials are required but missing, uncheck Unity Build
            if (isRequiredButMissing)
            {
                UnityBuildChecked = false;
            }
        }
        
        /// <summary>
        /// Updates Cosmos binaries availability - called by Window (Windows only)
        /// </summary>
        public void UpdateCosmosBinariesAvailability(bool cosmosBinariesConfigured)
        {
            CosmosBinariesConfigured = cosmosBinariesConfigured;
            
            // If Cosmos binaries are missing, uncheck Unity Build
            if (!cosmosBinariesConfigured)
            {
                UnityBuildChecked = false;
            }
        }
        
        /// <summary>
        /// Resets checkbox states - called when profile changes
        /// </summary>
        public void ResetCheckboxStates()
        {
            UnityBuildChecked = false;
            PublishSteamChecked = false;
            PublishEpicChecked = false;
            NotarizeMacChecked = false;
        }
        
        public void RequestOpenPublishingTools()
        {
            OnOpenPublishingToolsRequested?.Invoke();
        }
        
        /// <summary>
        /// Request execution of checked operations - View calls this method
        /// </summary>
        public void RequestExecute()
        {
            OnExecuteRequested?.Invoke();
        }
    }
}
