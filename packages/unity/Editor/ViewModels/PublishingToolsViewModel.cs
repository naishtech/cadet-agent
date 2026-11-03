using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEditor;
using Covyne.CADET.Editor.PublishingTools;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Utilities;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// ViewModel for Publishing Tools Configuration window - coordinates dependency management and platform credentials
    /// </summary>
    public class PublishingToolsViewModel
    {
        private List<DependencyCardViewModel> dependencyCards;
        private DependencyInstaller installer;
        private Vector2 scrollPosition;
        
        public IReadOnlyList<DependencyCardViewModel> DependencyCards => dependencyCards;
        public Vector2 ScrollPosition
        {
            get => scrollPosition;
            set
            {
                if (scrollPosition != value)
                {
                    scrollPosition = value;
                    ScrollPositionChanged?.Invoke(value);
                }
            }
        }
        
        // Events
        public event Action<Vector2> ScrollPositionChanged;
        public event Action OnConfigureSteamCredentialsRequested;
        public event Action OnConfigureEpicCredentialsRequested;
        public event Action OnConfigureMacCredentialsRequested;
        public event Action OnCloseRequested;
        
        public PublishingToolsViewModel()
        {
            installer = new DependencyInstaller();
            dependencyCards = new List<DependencyCardViewModel>();
            scrollPosition = Vector2.zero;
            
            InitializeDependencies();
        }
        
        private void InitializeDependencies()
        {
            // Initialize dependencies - Cosmos Binaries FIRST (required on Windows), then optional dependencies
            var dependencies = new List<DependencyStatus>
            {
                new DependencyStatus(
                    CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.CosmosBinaries.Name"),
                    CadetLocalization.GetString("Window.PublishingToolsConfig.DependencyCard.CosmosBinaries.Description"),
                    System.IO.Path.Combine(BuildToolsPathHelper.GetCosmosBinariesPath(), "bin") + System.IO.Path.DirectorySeparatorChar
                ),
                new DependencyStatus(
                    "SteamCMD (Windows)",
                    "Valve's command-line utility for uploading builds to SteamPipe on Windows. Required for Steam deployments from Windows.",
                    System.IO.Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.exe")
                ),
                new DependencyStatus(
                    "SteamCMD (macOS)",
                    "Valve's command-line utility for uploading builds to SteamPipe on macOS. Required for Steam deployments from macOS.",
                    System.IO.Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.sh")
                ),
                new DependencyStatus(
                    "Epic BuildPatchTool",
                    "Epic Games' utility for generating patches and uploading to the Epic Games Store. Required for Epic deployments.",
                    BuildToolsPathHelper.GetBuildPatchToolPath() + System.IO.Path.DirectorySeparatorChar
                )
            };
            
            // Create ViewModels for each dependency - Cosmos first
            var cosmosCard = new DependencyCardViewModel(
                dependencies[0],
                "https://github.com/jart/cosmopolitan",
                "https://github.com/jart/cosmopolitan/releases/download/4.0.2/cosmos-4.0.2.zip"
            );
            cosmosCard.OnDownloadRequested += () => InstallDependency(0);
            cosmosCard.OnVerifyRequested += () => VerifyDependency(0);
            cosmosCard.OnUninstallRequested += () => UninstallDependency(0);
            dependencyCards.Add(cosmosCard);
            
            var steamWinCard = new DependencyCardViewModel(
                dependencies[1],
                "https://store.steampowered.com/subscriber_agreement/",
                "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
            );
            steamWinCard.OnDownloadRequested += () => InstallDependency(1);
            steamWinCard.OnVerifyRequested += () => VerifyDependency(1);
            steamWinCard.OnUninstallRequested += () => UninstallDependency(1);
            dependencyCards.Add(steamWinCard);
            
            var steamMacCard = new DependencyCardViewModel(
                dependencies[2],
                "https://store.steampowered.com/subscriber_agreement/",
                "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz"
            );
            steamMacCard.OnDownloadRequested += () => InstallDependency(2);
            steamMacCard.OnVerifyRequested += () => VerifyDependency(2);
            steamMacCard.OnUninstallRequested += () => UninstallDependency(2);
            dependencyCards.Add(steamMacCard);
            
            var epicCard = new DependencyCardViewModel(
                dependencies[3],
                "https://dev.epicgames.com/portal/en-US/distribution-agreement",
                "https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/BuildPatchTool.zip"
            );
            epicCard.OnDownloadRequested += () => InstallDependency(3);
            epicCard.OnVerifyRequested += () => VerifyDependency(3);
            epicCard.OnUninstallRequested += () => UninstallDependency(3);
            dependencyCards.Add(epicCard);
            
            // Check installation status
            CheckDependencyStatus();
        }
        
        public void CheckDependencyStatus()
        {
            for (int i = 0; i < dependencyCards.Count; i++)
            {
                var card = dependencyCards[i];
                if (installer.IsDependencyInstalled(card.Status.name, card.Status.customPath))
                {
                    card.Status.state = DependencyState.Installed;
                    card.Status.version = installer.GetDependencyVersion(card.Status.name);
                    // Store SteamCMD paths in EditorPrefs if SteamCMD is installed
                    if (card.Status.name.Contains("SteamCMD"))
                    {
                        StoreSteamCmdPathsInEditorPrefs();
                    }
                    // Store BuildPatchTool path in EditorPrefs if BuildPatchTool is installed
                    if (card.Status.name.Contains("BuildPatchTool"))
                    {
                        StoreBuildPatchToolPathInEditorPrefs();
                    }
                }
                else
                {
                    card.Status.state = DependencyState.Missing;
                }
            }
        }
        
        public bool HasAnyDependencyInstalled()
        {
            return dependencyCards.Any(card => card.Status.state == DependencyState.Installed);
        }
        
        /// <summary>
        /// Checks if any SteamCMD dependency is installed (Windows or macOS)
        /// </summary>
        public bool IsSteamCmdInstalled()
        {
            return dependencyCards.Any(card => 
                card.Status.name.Contains("SteamCMD") && 
                card.Status.state == DependencyState.Installed);
        }
        
        /// <summary>
        /// Checks if BuildPatchTool is installed
        /// </summary>
        public bool IsBuildPatchToolInstalled()
        {
            return dependencyCards.Any(card => 
                card.Status.name.Contains("BuildPatchTool") && 
                card.Status.state == DependencyState.Installed);
        }
        
        /// <summary>
        /// Checks if Cosmos Binaries are installed
        /// </summary>
        public bool IsCosmosBinariesInstalled()
        {
            return dependencyCards.Any(card => 
                card.Status.name.Contains("Cosmos Binaries") && 
                card.Status.state == DependencyState.Installed);
        }
        
        public void RequestConfigureSteamCredentials()
        {
            OnConfigureSteamCredentialsRequested?.Invoke();
        }
        
        public void RequestConfigureEpicCredentials()
        {
            OnConfigureEpicCredentialsRequested?.Invoke();
        }
        
        public void RequestConfigureMacCredentials()
        {
            OnConfigureMacCredentialsRequested?.Invoke();
        }
        
        public void RequestClose()
        {
            OnCloseRequested?.Invoke();
        }
        
        private async void InstallDependency(int index)
        {
            var card = dependencyCards[index];
            var dep = card.Status;
            
            // Check if license was accepted
            if (!dep.licenseAccepted)
            {
                EditorUtility.DisplayDialog(
                    "License Agreement Required",
                    $"Please review and accept the license agreement for {dep.name} before installation.",
                    "OK"
                );
                return;
            }
            
            dep.state = DependencyState.Downloading;
            dep.downloadProgress = 0.1f;
            card.UpdateStatus(dep);
            
            bool success = await installer.InstallDependency(
                dep.name,
                (status) =>
                {
                    // Progress callback
                    dep.downloadProgress = status.downloadProgress;
                    dep.bytesDownloaded = status.bytesDownloaded;
                    dep.totalBytes = status.totalBytes;
                    dep.state = status.state;
                    card.UpdateStatus(dep);
                },
                (message) =>
                {
                    // Success callback
                    CheckDependencyStatus();
                    // Store SteamCMD paths in EditorPrefs if SteamCMD was installed
                    if (dep.name.Contains("SteamCMD"))
                    {
                        StoreSteamCmdPathsInEditorPrefs();
                    }
                    // Store BuildPatchTool path in EditorPrefs if BuildPatchTool was installed
                    if (dep.name.Contains("BuildPatchTool"))
                    {
                        StoreBuildPatchToolPathInEditorPrefs();
                    }
                    // Refresh CADET windows to update platform availability after tool installation
                    EditorApplication.delayCall += () => CadetWindow.RefreshAllWindowsPlatformAvailability();
                },
                (error) =>
                {
                    // Error callback
                    Debug.LogError($"[CADET] [ERROR] {error}");
                    dep.state = DependencyState.Error;
                    dep.errorMessage = error;
                    card.UpdateStatus(dep);
                }
            );
            
            if (success)
            {
                dep.state = DependencyState.Installed;
            }
            else
            {
                dep.state = DependencyState.Error;
                Debug.LogError($"[CADET] === Installation failed ===");
            }
            
            card.UpdateStatus(dep);
        }
        
        private void VerifyDependency(int index)
        {
            var card = dependencyCards[index];
            var dep = card.Status;
            
            if (installer.IsDependencyInstalled(dep.name, dep.customPath))
            {
                dep.state = DependencyState.Installed;
                dep.version = installer.GetDependencyVersion(dep.name);
                    // Store SteamCMD paths in EditorPrefs if SteamCMD was verified
                    if (dep.name.Contains("SteamCMD"))
                    {
                        StoreSteamCmdPathsInEditorPrefs();
                    }
                    // Store BuildPatchTool path in EditorPrefs if BuildPatchTool was verified
                    if (dep.name.Contains("BuildPatchTool"))
                    {
                        StoreBuildPatchToolPathInEditorPrefs();
                    }
                EditorUtility.DisplayDialog(
                    "Verification Success",
                    $"{dep.name} is properly installed!",
                    "OK"
                );
                // Refresh CADET windows to update platform availability after tool verification
                EditorApplication.delayCall += () => CadetWindow.RefreshAllWindowsPlatformAvailability();
            }
            else
            {
                dep.state = DependencyState.Missing;
                EditorUtility.DisplayDialog(
                    "Verification Failed",
                    $"{dep.name} was not found in the expected location:\n{dep.installPath}",
                    "OK"
                );
            }
            
            card.UpdateStatus(dep);
        }
        
        private void UninstallDependency(int index)
        {
            var card = dependencyCards[index];
            var dep = card.Status;
            
            // Show confirmation dialog
            bool confirmed = EditorUtility.DisplayDialog(
                "Confirm Uninstall",
                $"Are you sure you want to uninstall {dep.name}?\n\n" +
                $"This will delete the installation directory:\n{dep.installPath}\n\n" +
                "This action cannot be undone.",
                "Uninstall",
                "Cancel"
            );
            
            if (!confirmed)
                return;
            
            // Perform uninstall
            string errorMessage;
            bool success = installer.UninstallDependency(dep.name, out errorMessage);
            
            if (success)
            {
                // Clear custom path if it was set
                dep.customPath = "";
                
                // If SteamCMD was uninstalled, delete Steam credentials file
                if (dep.name.Contains("SteamCMD"))
                {
                    Steam.SteamCredentialsHelper.DeleteCredentials();
                }
                
                // Refresh dependency status
                CheckDependencyStatus();
                
                // Refresh CADET windows to update platform availability after tool uninstallation
                EditorApplication.delayCall += () => CadetWindow.RefreshAllWindowsPlatformAvailability();

                EditorUtility.DisplayDialog(
                    "Uninstall Complete",
                    $"{dep.name} has been successfully uninstalled.",
                    "OK"
                );
            }
            else
            {
                dep.state = DependencyState.Error;
                dep.errorMessage = errorMessage;

                EditorUtility.DisplayDialog(
                    "Uninstall Failed",
                    $"Failed to uninstall {dep.name}:\n\n{errorMessage}",
                    "OK"
                );

                Debug.LogError($"[CADET] [ERROR] Failed to uninstall {dep.name}: {errorMessage}");
            }
            
            card.UpdateStatus(dep);
        }
        
        /// <summary>
        /// Stores SteamCMD paths in EditorPrefs for use during JSON export
        /// </summary>
        private void StoreSteamCmdPathsInEditorPrefs()
        {
            // Check user directory
            string steamcmdExePath = System.IO.Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.exe");
            string steamcmdShPath = System.IO.Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.sh");
            
            // Store paths if files exist
            if (System.IO.File.Exists(steamcmdExePath))
            {
                EditorPrefs.SetString("CADET_SteamCmdExe", steamcmdExePath);
            }
            
            if (System.IO.File.Exists(steamcmdShPath))
            {
                EditorPrefs.SetString("CADET_SteamCmdSh", steamcmdShPath);
            }
        }
        
        /// <summary>
        /// Stores BuildPatchTool path in EditorPrefs for use during JSON export
        /// </summary>
        private void StoreBuildPatchToolPathInEditorPrefs()
        {
            // Check user directory
            string buildPatchToolPath = BuildToolsPathHelper.GetBuildPatchToolPath();
            
            // Store path if directory exists
            if (System.IO.Directory.Exists(buildPatchToolPath))
            {
                EditorPrefs.SetString("CADET_BuildPatchToolPath", buildPatchToolPath);
            }
        }
    }
}

