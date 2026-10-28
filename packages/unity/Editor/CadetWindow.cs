using UnityEngine;
using UnityEditor;
using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.Views;
using System.IO;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Utilities;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Lite.Windows;

namespace Covyne.CADET.Editor
{
    public class CadetWindow : EditorWindow
    {
    #if !CADET_LITE
        private const string DiagnosticsPrefix = "[C.A.D.E.T][CadetWindow]";
    #endif
#if CADET_LITE
        private const string ProUpgradeUrl = "https://www.covyne.com/store/p/-cadet-desktop-license";
        private static Func<string, string, string, string, bool> directorySyncConfirmationDialog =
            (title, message, ok, cancel) => EditorUtility.DisplayDialog(title, message, ok, cancel);
#endif

        // MVVM components
        private CadetWindowViewModel viewModel;
        private PlatformAvailabilityViewModel platformAvailabilityViewModel;
        private BuildExecutionStateViewModel buildExecutionStateViewModel;
        private CadetWindowCoordinator cadetWindowCoordinator;
        private ProfileManagerView profileManagerView;
        private ActionButtonsView actionButtonsView;
        private ProgressBarView progressBarView;
        private BuildQueuePanel buildQueuePanel;
        
        // Queue system (available in both Pro and Lite)
        private BuildQueueManager buildQueueManager;
        
        // Cached profile for consistent control count between Layout and Repaint passes
        private BuildProfile cachedCurrentProfile;
        private CadetUnityLogLevel selectedUnityLogLevel = CadetUnityLogLevel.Error;
    #if !CADET_LITE
        private bool showDetachedBashWindow;
    #endif
        
        /// <summary>
        /// Checks if Unity is currently building or compiling
        /// </summary>
        public static bool IsUnityBuilding()
        {
            // Check if Unity is compiling scripts
            if (EditorApplication.isCompiling)
            {
                return true;
            }
            
            // Note: EditorApplication.isPlaying won't detect headless builds
            // For headless builds, we rely on the isRunning flag and process monitoring
            return false;
        }

        [MenuItem("Tools/Covyne/C.A.D.E.T")]
        public static void ShowWindow()
        {
            CadetWindow window = GetWindow<CadetWindow>(CadetLocalization.GetString("Window.Cadet.Title"));
            window.minSize = new Vector2(700, 550);
            // Set initial position and size to match content height
            if (window.position.height > 550)
            {
                window.position = new Rect(window.position.x, window.position.y, window.position.width, 550);
            }
            window.Show();
        }
        
        private void OnEnable()
        {
            Initialize();
        }
        
        private void OnDisable()
        {
            // Do not auto-kill active operations here.
            // Domain reload also triggers OnDisable; detached builds must survive reload.
            buildQueuePanel?.Dispose();
            buildQueuePanel = null;
            if (viewModel?.ConsoleOutput != null)
            {
                viewModel.ConsoleOutput.UnityConsoleMirroringEnabled = false;
            }
        }
        
        /// <summary>
        /// Called when the window gains focus. On macOS, this helps restore the proper
        /// focused appearance when the window regains focus after being in the background.
        /// </summary>
        private void OnFocus()
        {
            // Force a repaint when the window regains focus to ensure proper visual state
            // This fixes the issue on macOS where the window can appear dimmed even after clicking
            Repaint();
        }
        
        private void Initialize()
        {
            selectedUnityLogLevel = CadetFilteredLogger.GetMinimumLevel();
#if !CADET_LITE
            showDetachedBashWindow = CadetDebugPreferences.GetShowDetachedBashWindow();
#endif

            // Initialize ViewModel
            viewModel = new CadetWindowViewModel();
            platformAvailabilityViewModel = new PlatformAvailabilityViewModel();
            buildExecutionStateViewModel = new BuildExecutionStateViewModel();
            BuildQueueBackgroundService.EnsureInitialized();
            cadetWindowCoordinator = new CadetWindowCoordinator(
                UpdateBuildExistenceState,
                UpdatePlatformAvailability,
                UpdateCosmosBinariesAvailability,
                CheckProfileDependencies,
                Repaint);
            viewModel.ConsoleOutput.MinimumUnityConsoleLevel = selectedUnityLogLevel;
            viewModel.ConsoleOutput.UnityConsoleMirroringEnabled = false;
            
            // Initialize execution-history manager (available in both Pro and Lite).
            buildQueueManager = BuildQueueManager.Instance;
            BuildOperationReloadRecoveryService.RefreshNow();
            buildQueuePanel?.Dispose();
            buildQueuePanel = new BuildQueuePanel(Repaint);
            buildQueuePanel.Initialize();
            
            // Initialize Views with ViewModels
            profileManagerView = new ProfileManagerView(viewModel.ProfileManager);
            actionButtonsView = new ActionButtonsView(viewModel.ActionButtons);
            progressBarView = new ProgressBarView(viewModel.ProgressBar, this);
            
            // Wire up ViewModel events to handlers
            viewModel.ProfileManager.OnNewProfileRequested += (name) => OnNewProfile();
            viewModel.ProfileManager.OnEditProfileRequested += (name) => OnEditProfile(name);
            viewModel.ProfileManager.OnDeleteProfileRequested += (name) => OnDeleteProfile(name);
            viewModel.ProfileManager.OnDuplicateProfileRequested += (name) => OnDuplicateProfile(name);
            viewModel.ProfileManager.OnExportProfileRequested += (name) => OnExportProfile(name);
            viewModel.ProfileManager.OnProfileSelected += (name) =>
                cadetWindowCoordinator.OnProfileSelected(name, LogSelectedProfile);
            viewModel.ProfileManager.OnProfilesListChanged += () =>
                cadetWindowCoordinator.OnProfileConfigurationChanged();
            
            // Wire up action button events
            WireUpActionButtons();
            
            // Subscribe to ViewModel events for repaint
            // Status indicator events
            viewModel.ProgressBar.ModeChanged += (mode) => Repaint();
            viewModel.ProgressBar.ProgressChanged += (progress) => Repaint();
            viewModel.ProgressBar.StatusTextChanged += (status) =>
            {
                SyncBuildQueueRuntimeState();
                Repaint();
            };
            viewModel.ProgressBar.IsRunningChanged += (running) => OnProgressBarRunningChanged(running);

            BuildQueueRuntimeState.Instance.CancelActiveOperation = OnCancelOperation;
            SyncBuildQueueRuntimeState();
            
            // Note: ConsoleOutput now writes directly to file (Library/cadet_build.log)
            // No UI repaints needed - use "Monitor CADET Log" button to tail the log file
            
            // Initialize checkbox states for any already-selected profile
            if (viewModel.ProfileManager.HasProfile)
            {
                cadetWindowCoordinator.OnProfileConfigurationChanged();
            }
        }

        private void LogSelectedProfile(string profileName)
        {
            viewModel.ConsoleOutput.AppendLine($"[LOG] Selected profile: {profileName}", CadetConsoleMessageType.Log);
        }
        
        /// <summary>
        /// Handles status indicator running state changes - triggers immediate repaint.
        /// </summary>
        private void OnProgressBarRunningChanged(bool isRunning)
        {
            SyncBuildQueueRuntimeState();
            // Repaint immediately on state change
            Repaint();
        }

        private void DrawUnityConsoleLogLevelPanel()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            GUILayout.Label("Console Logging", EditorStyles.boldLabel);

            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("Log Level", GUILayout.Width(80));
            selectedUnityLogLevel = (CadetUnityLogLevel)EditorGUILayout.EnumPopup(selectedUnityLogLevel, GUILayout.Width(120));
#if !CADET_LITE
            GUILayout.Space(12);
            showDetachedBashWindow = EditorGUILayout.ToggleLeft("Show Bash Window", showDetachedBashWindow, GUILayout.Width(140));
#endif
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.EndVertical();

            if (viewModel?.ConsoleOutput != null)
            {
                viewModel.ConsoleOutput.MinimumUnityConsoleLevel = selectedUnityLogLevel;
            }

            CadetFilteredLogger.SetMinimumLevel(selectedUnityLogLevel);
#if !CADET_LITE
            CadetDebugPreferences.SetShowDetachedBashWindow(showDetachedBashWindow);
#endif
        }
        
        /// <summary>
        /// Refreshes the profile list (called after save/delete/duplicate operations)
        /// </summary>
        public void RefreshProfileList()
        {
            if (viewModel != null && viewModel.ProfileManager != null)
            {
                viewModel.ProfileManager.LoadProfiles();
                Repaint();
            }
        }
        
        private void WireUpActionButtons()
        {
            viewModel.ActionButtons.OnOpenPublishingToolsRequested += () => OpenPublishingToolsIfAvailable();
            viewModel.ActionButtons.OnExecuteRequested += OnExecute;
            
            // Subscribe to ActionButtons ViewModel events for repaint (per MVVM guidelines)
            viewModel.ActionButtons.UnityBuildCheckedChanged += (v) => Repaint();
            viewModel.ActionButtons.PublishSteamCheckedChanged += (v) => Repaint();
            viewModel.ActionButtons.PublishEpicCheckedChanged += (v) => Repaint();
            viewModel.ActionButtons.WindowsBuildExistsChanged += (v) => Repaint();
            viewModel.ActionButtons.MacosBuildExistsChanged += (v) => Repaint();
            viewModel.ActionButtons.MissingBuildsMessageChanged += (v) => Repaint();
            viewModel.ActionButtons.SteamAvailableChanged += (v) => Repaint();
            viewModel.ActionButtons.EpicAvailableChanged += (v) => Repaint();
            viewModel.ActionButtons.NotarizeMacCheckedChanged += (v) => Repaint();
            viewModel.ActionButtons.SteamToolsConfiguredChanged += (v) => Repaint();
            viewModel.ActionButtons.SteamCredentialsConfiguredChanged += (v) => Repaint();
            viewModel.ActionButtons.EpicToolsConfiguredChanged += (v) => Repaint();
            viewModel.ActionButtons.EpicCredentialsConfiguredChanged += (v) => Repaint();
            viewModel.ActionButtons.CosmosBinariesConfiguredChanged += (v) => Repaint();
            
            viewModel.ProgressBar.OnCancelRequested += () => OnCancelOperation();
        }

        private void OpenPublishingToolsIfAvailable()
        {
#if CADET_LITE
            // In Lite: do nothing - button is already disabled with Pro indicator
            // No URL launch to maintain in-place Pro feature visibility
            return;
#else
            // Use reflection so Lite can compile without the pro PublishingTools namespace.
            Type windowType = Type.GetType("Covyne.CADET.Editor.PublishingTools.PublishingToolsWindow, Covyne.CADET.Editor");
            if (windowType == null)
            {
                Application.OpenURL("https://cadet.covyne.io/download-pro");
                return;
            }

            var showMethod = windowType.GetMethod("ShowDependencyConfiguration", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            showMethod?.Invoke(null, null);
#endif
        }
        
        /// <summary>
        /// Checks if the current profile has all required publishing dependencies installed
        /// </summary>
        private void CheckProfileDependencies()
        {
            var profileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
            if (profileAsset == null || profileAsset.Profile == null)
            {
                viewModel.ActionButtons.HasMissingPublishingDependencies = false;
                return;
            }
            
            bool allDependenciesInstalled = ProfileDependencyChecker.CheckProfileDependencies(profileAsset.Profile);
            viewModel.ActionButtons.HasMissingPublishingDependencies = !allDependenciesInstalled;
        }

        private void OnGUI()
        {
            // Cache profile during Layout event to ensure consistent control count between Layout and Repaint passes
            if (Event.current.type == EventType.Layout)
            {
                var profileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
                cachedCurrentProfile = profileAsset?.Profile;
            }
            
            EditorGUILayout.Space(10);
            
            // Header
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label(CadetLocalization.GetString("Window.Cadet.Header"), EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
#if CADET_LITE
            if (GUILayout.Button("Upgrade to CADET Pro", EditorStyles.linkLabel, GUILayout.ExpandWidth(false)))
            {
                Application.OpenURL(ProUpgradeUrl);
            }
#endif
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(10);

            // Publishing Tools button - first control after header
            actionButtonsView.DrawPublishingToolsButton();
            EditorGUILayout.Space(5);

            // Keep main controls interactive while builds run.
            viewModel.ActionButtons.IsRunning = false;
            
            // Profile Management Section
            profileManagerView.Draw(false);
            
            EditorGUILayout.Space(10);
            
            // Action Buttons Section
            viewModel.ActionButtons.HasProfile = viewModel.ProfileManager.HasProfile;
            // Check dependencies when profile changes (also checked in OnProfileSelected)
            CheckProfileDependencies();
            UpdateCosmosBinariesAvailability();
            
            // Use cached profile for platform-specific buttons to ensure consistent control count
            actionButtonsView.Draw(cachedCurrentProfile);

            EditorGUILayout.Space(10);

            // Execution controls (available in both Pro and Lite).
            DrawExecutionControls();

            EditorGUILayout.Space(8);

            // Runtime log level controls
            DrawUnityConsoleLogLevelPanel();

            EditorGUILayout.Space(10);

            buildQueuePanel?.DrawEmbeddedContents();
            
            EditorGUILayout.Space(10);
            
        }

        private void SyncBuildQueueRuntimeState()
        {
            var runtimeState = BuildQueueRuntimeState.Instance;
            if (viewModel?.ProgressBar == null || buildExecutionStateViewModel == null)
            {
                runtimeState.Reset();
                return;
            }

            runtimeState.IsOperationRunning = buildExecutionStateViewModel.IsRunning;

            bool hasTrackedActiveJob = !string.IsNullOrWhiteSpace(runtimeState.ActiveJobGuid);
            if (hasTrackedActiveJob && buildQueueManager != null)
            {
                BuildJobDefinition activeTrackedJob = buildQueueManager.GetJobByGuid(runtimeState.ActiveJobGuid);
                if (activeTrackedJob != null && !string.IsNullOrWhiteSpace(activeTrackedJob.StatusDetail))
                {
                    runtimeState.ActiveStatusText = activeTrackedJob.StatusDetail;
                }
            }

            bool hasTrackedJobStatus = hasTrackedActiveJob && !string.IsNullOrWhiteSpace(runtimeState.ActiveStatusText);
            if (!hasTrackedJobStatus)
            {
                runtimeState.ActiveStatusText = viewModel.ProgressBar.StatusText;
            }

            runtimeState.HasError = viewModel.ProgressBar.HasError;
            runtimeState.HasSuccess = viewModel.ProgressBar.HasSuccess;
            runtimeState.CancelActiveOperation = buildExecutionStateViewModel.IsRunning ? OnCancelOperation : null;
        }

        /// <summary>
        /// Draw execution controls in the main Cadet window.
        /// Available in both Pro and Lite versions.
        /// Thread-safe: button actions are marshaled through EditorApplication.delayCall.
        /// </summary>
        private void DrawExecutionControls()
        {
            if (buildQueueManager == null)
            {
                buildQueueManager = BuildQueueManager.Instance;
            }

            BuildProfileAsset selectedProfileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
            bool hasSelectedProfile = selectedProfileAsset?.Profile != null;
            bool shouldExecute = false;

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);

            EditorGUILayout.BeginHorizontal();
            EditorGUI.BeginDisabledGroup(!hasSelectedProfile);
            var greenButtonStyle = new GUIStyle(GUI.skin.button);
            greenButtonStyle.normal.textColor = Color.white;
            greenButtonStyle.hover.textColor = Color.white;
            greenButtonStyle.normal.background = MakeColorTex(new Color(0.18f, 0.55f, 0.18f));
            greenButtonStyle.hover.background = MakeColorTex(new Color(0.22f, 0.65f, 0.22f));
            if (GUILayout.Button("Execute", greenButtonStyle, GUILayout.Height(28), GUILayout.Width(150)))
            {
                shouldExecute = true;
            }
            EditorGUI.EndDisabledGroup();
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.EndVertical();

            if (shouldExecute)
            {
                if (IsProfileBlockedForExecute(selectedProfileAsset))
                {
                    string profileName = selectedProfileAsset?.Profile?.profileName;
                    EditorApplication.delayCall += () => ShowBuildAlreadyInProgress(profileName);
                }
                else
                {
                    EditorApplication.delayCall += OnExecute;
                }
            }
        }

        private bool IsProfileBlockedForExecute(BuildProfileAsset selectedProfileAsset)
        {
            if (selectedProfileAsset?.Profile == null)
            {
                return false;
            }

            string profileGuid = ResolveProfileGuid(selectedProfileAsset);

            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return false;
            }

            return UnityBuildService.IsBuildInProgressForProfile(profileGuid) ||
                   BuildQueueJobStateService.IsProfileBlockedForExecute(
                       profileGuid,
                       guid => buildQueueManager != null && buildQueueManager.HasJobInProgress(guid));
        }

        private static string ResolveProfileGuid(BuildProfileAsset selectedProfileAsset)
        {
            if (selectedProfileAsset == null)
            {
                return string.Empty;
            }

            string profileAssetPath = AssetDatabase.GetAssetPath(selectedProfileAsset);
            return string.IsNullOrWhiteSpace(profileAssetPath)
                ? string.Empty
                : AssetDatabase.AssetPathToGUID(profileAssetPath);
        }

        // Profile Management Callbacks
        private void OnNewProfile()
        {
            ProfileEditorWindow.ShowWindow();
        }
        
        private void OnEditProfile(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
            {
                EditorUtility.DisplayDialog("Error", "Profile name is required.", "OK");
                return;
            }
            
            viewModel.ConsoleOutput.AppendLine($"[LOG] Editing profile: {profileName}", CadetConsoleMessageType.Log);
            ProfileEditorWindow.ShowWindow(profileName);
            
            // Subscribe to profile saved event to refresh list
            var editorWindow = GetWindow<ProfileEditorWindow>();
            if (editorWindow != null)
            {
                // The ProfileEditorWindow will handle the save, and we'll refresh on next repaint
                // We can also listen for the window closing to refresh
            }
        }
        
        private void OnDeleteProfile(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
            {
                EditorUtility.DisplayDialog("Error", "Profile name is required.", "OK");
                return;
            }
            
            bool confirmed = EditorUtility.DisplayDialog(
                CadetLocalization.GetString("Window.Cadet.Dialogs.DeleteProfile.Title"),
                string.Format(CadetLocalization.GetString("Window.Cadet.Dialogs.DeleteProfile.Message"), profileName),
                CadetLocalization.GetString("Window.Cadet.Buttons.Delete"),
                CadetLocalization.GetString("Window.Cadet.Buttons.Cancel")
            );
            
            if (confirmed)
            {
                viewModel.ProfileManager.DeleteProfile(profileName);
                viewModel.ConsoleOutput.AppendLine($"[LOG] Deleted profile: {profileName}", CadetConsoleMessageType.Log);
                Repaint();
            }
        }
        
        private void OnDuplicateProfile(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
            {
                EditorUtility.DisplayDialog("Error", "Profile name is required.", "OK");
                return;
            }
            
            // Defer dialog to delayCall to avoid disrupting OnGUI layout state
            string profileToDuplicate = profileName;
            EditorApplication.delayCall += () =>
            {
                // Prompt for new profile name using a simple approach
                // Unity doesn't have a built-in input dialog, so we'll use a custom window
                string newName = EditorInputDialog.Show("Duplicate Profile", $"Enter a name for the duplicate of '{profileToDuplicate}':", $"{profileToDuplicate} Copy");
                
                if (string.IsNullOrEmpty(newName))
                {
                    // User cancelled
                    return;
                }
                
                // Sanitize the name
                newName = newName.Trim();
                if (string.IsNullOrEmpty(newName))
                {
                    EditorUtility.DisplayDialog("Error", "Profile name cannot be empty.", "OK");
                    return;
                }
                
                try
                {
                    viewModel.ProfileManager.DuplicateProfile(profileToDuplicate, newName);
                    viewModel.ConsoleOutput.AppendLine($"[LOG] Duplicated profile '{profileToDuplicate}' to '{newName}'", CadetConsoleMessageType.Log);
                    Repaint();
                }
                catch (Exception ex)
                {
                    EditorUtility.DisplayDialog("Duplicate Failed", $"Failed to duplicate profile: {ex.Message}", "OK");
                    viewModel.ConsoleOutput.AppendLine($"[ERROR] Failed to duplicate profile: {ex.Message}", CadetConsoleMessageType.Error);
                }
            };
        }
        
        /// <summary>
        /// Updates build existence state in the ViewModel based on the current profile
        /// </summary>
        private void UpdateBuildExistenceState()
        {
            var profileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
            if (profileAsset?.Profile == null)
            {
                viewModel.ActionButtons.UpdateBuildExistence(false, false, string.Empty);
                viewModel.ActionButtons.SetMacCredentialsRequirement(false);
                return;
            }

            var state = platformAvailabilityViewModel.Evaluate(profileAsset.Profile);
            viewModel.ActionButtons.UpdateBuildExistence(state.WindowsBuildExists, state.MacosBuildExists, state.MissingBuildsMessage);
            viewModel.ActionButtons.SetMacCredentialsRequirement(state.MacCredentialsMissing);

            // Auto-check Unity Build if required builds don't exist AND macOS credentials are not missing
            if (!state.AllRequiredBuildsExist && !state.MacCredentialsMissing)
            {
                viewModel.ActionButtons.UnityBuildChecked = true;
            }
        }

        /// <summary>
        /// Updates platform availability in the ViewModel based on the current profile configuration, credentials, and tools
        /// </summary>
        private void UpdatePlatformAvailability()
        {
            var profileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
            if (profileAsset?.Profile == null)
            {
                viewModel.ActionButtons.UpdatePlatformAvailability(false, false, false, false, false, false);
                return;
            }

            var state = platformAvailabilityViewModel.Evaluate(profileAsset.Profile);
            // Update ViewModel - this should trigger the UI to update
            viewModel.ActionButtons.UpdatePlatformAvailability(
                state.SteamToolsConfigured,
                state.SteamCredentialsConfigured,
                state.EpicToolsConfigured,
                state.EpicCredentialsConfigured,
                state.SteamPlatformSelected,
                state.EpicPlatformSelected
            );
        }
        
        /// <summary>
        /// Updates Cosmos binaries availability in the ViewModel (Windows only)
        /// </summary>
        private void UpdateCosmosBinariesAvailability()
        {
            var profileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
            var state = platformAvailabilityViewModel.Evaluate(profileAsset?.Profile);
            viewModel.ActionButtons.UpdateCosmosBinariesAvailability(state.CosmosBinariesConfigured);
        }
        
        /// <summary>
        /// Refreshes platform availability for all open CadetWindows (called after credentials are configured)
        /// </summary>
        public static void RefreshAllWindowsPlatformAvailability()
        {
            var cadetWindows = Resources.FindObjectsOfTypeAll<CadetWindow>();
            foreach (var window in cadetWindows)
            {
                if (window != null && window.viewModel != null && window.cadetWindowCoordinator != null)
                {
                    window.cadetWindowCoordinator.OnProfileConfigurationChanged();
                }
            }
        }
        
        /// <summary>
        /// Refreshes macOS credentials state for all open CadetWindows (called after credentials are configured)
        /// </summary>
        public static void RefreshAllWindowsMacCredentialsState()
        {
            var cadetWindows = Resources.FindObjectsOfTypeAll<CadetWindow>();
            foreach (var window in cadetWindows)
            {
                if (window != null && window.viewModel != null && window.cadetWindowCoordinator != null)
                {
                    window.cadetWindowCoordinator.OnMacCredentialsStateChanged();
                }
            }
        }
        
        private void OnExportProfile(string profileName)
        {
            if (string.IsNullOrEmpty(profileName))
            {
                EditorUtility.DisplayDialog("Error", "Profile name is required.", "OK");
                return;
            }
            
            var profileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
            if (profileAsset == null || profileAsset.Profile == null)
            {
                EditorUtility.DisplayDialog("Error", "Profile not found.", "OK");
                return;
            }
            
            try
            {
                // Create a copy of the profile for export
                BuildProfile exportProfile = JsonUtility.FromJson<BuildProfile>(JsonUtility.ToJson(profileAsset.Profile));
                
                // Populate dependency paths before export to keep exported JSON executable as-is.
                BuildPathResolver.PopulateSteamCmdPathsFromEditorPrefs(exportProfile);
                BuildPathResolver.PopulateEpicBuildPatchToolPathFromEditorPrefs(exportProfile);
                
                // Serialize profile to JSON
                string json = ProfileJsonService.SerializeToJson(exportProfile);
                
                // Get default filename
                string sanitizedProfileName = profileName;
                char[] invalidChars = Path.GetInvalidFileNameChars();
                foreach (char c in invalidChars)
                {
                    sanitizedProfileName = sanitizedProfileName.Replace(c, '_');
                }
                string defaultFileName = $"{sanitizedProfileName}.json";
                
                // Show save file dialog
                string projectPath = Path.GetDirectoryName(Application.dataPath);
                string filePath = EditorUtility.SaveFilePanel(
                    CadetLocalization.GetString("Window.Cadet.Dialogs.ExportProfile.Title"),
                    projectPath,
                    defaultFileName,
                    "json"
                );
                
                if (!string.IsNullOrEmpty(filePath))
                {
                    // Write JSON to file
                    File.WriteAllText(filePath, json);
                    viewModel.ConsoleOutput.AppendLine($"[SUCCESS] Profile '{profileName}' exported to: {filePath}", CadetConsoleMessageType.Success);
                    EditorUtility.DisplayDialog(
                        CadetLocalization.GetString("Window.Cadet.Dialogs.ExportProfile.SuccessTitle"),
                        string.Format(CadetLocalization.GetString("Window.Cadet.Dialogs.ExportProfile.SuccessMessage"), profileName, filePath),
                        "OK"
                    );
                }
            }
            catch (Exception ex)
            {
                viewModel.ConsoleOutput.AppendLine($"[ERROR] Failed to export profile: {ex.Message}", CadetConsoleMessageType.Error);
                EditorUtility.DisplayDialog(
                    CadetLocalization.GetString("Window.Cadet.Dialogs.ExportProfile.ErrorTitle"),
                    string.Format(CadetLocalization.GetString("Window.Cadet.Dialogs.ExportProfile.ErrorMessage"), ex.Message),
                    "OK"
                );
            }
        }
        
        // Action Button Callbacks
        
        /// <summary>
        /// Handles the Execute request from the checkbox-based UI.
        /// Runs checked operations sequentially: Unity Build first, then Steam publish, then Epic publish.
        /// </summary>
        private async void OnExecute()
        {
#if !CADET_LITE
            Stopwatch executeStopwatch = Stopwatch.StartNew();
            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} OnExecute start unityBuild={viewModel.ActionButtons.UnityBuildChecked} " +
                $"notarize={viewModel.ActionButtons.NotarizeMacChecked} steam={viewModel.ActionButtons.PublishSteamChecked} epic={viewModel.ActionButtons.PublishEpicChecked}.");
#endif
#if CADET_LITE
            if (buildQueuePanel != null && buildQueuePanel.IsInCooldown)
            {
                string remaining = buildQueuePanel.CooldownRemainingText;
                string msg = string.IsNullOrEmpty(remaining)
                    ? "A cooldown is active between builds.\n\nUpgrade to CADET Pro to enable unlimited builds with no cooldowns."
                    : $"A cooldown is active \u2014 next build available in {remaining}.\n\nUpgrade to CADET Pro to enable unlimited builds with no cooldowns.";
                EditorUtility.DisplayDialog("Build Cooldown Active", msg, "OK");
                return;
            }

            BuildProfile selectedProfile = viewModel.ProfileManager.GetSelectedProfileAsset()?.Profile;
            if (!ShowDirectorySyncConfirmation(selectedProfile))
            {
                return;
            }

            bool runNotarizeMac = false;
            bool runPublishSteam = false;
            bool runPublishEpic = false;
#else
            bool runNotarizeMac = viewModel.ActionButtons.NotarizeMacChecked;
            bool runPublishSteam = viewModel.ActionButtons.PublishSteamChecked;
            bool runPublishEpic = viewModel.ActionButtons.PublishEpicChecked;
#endif

            BuildProfileAsset selectedProfileAsset = viewModel.ProfileManager.GetSelectedProfileAsset();
            string selectedProfileGuid = ResolveProfileGuid(selectedProfileAsset);

#if !CADET_LITE
            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} OnExecute selection resolved after {executeStopwatch.ElapsedMilliseconds}ms " +
                $"profile='{selectedProfileAsset?.Profile?.profileName ?? string.Empty}' guid='{selectedProfileGuid ?? string.Empty}'.");
#endif

            var result = await BuildExecutionSequenceService.ExecuteAsync(new BuildExecutionSequenceService.Request
            {
                SelectedProfileAsset = selectedProfileAsset,
                SelectedProfileGuid = selectedProfileGuid,
                RunUnityBuild = viewModel.ActionButtons.UnityBuildChecked,
                RunNotarizeMac = runNotarizeMac,
                RunPublishSteam = runPublishSteam,
                RunPublishEpic = runPublishEpic,
                IsBuildInProgressForProfile = (profileGuid) =>
                    UnityBuildService.IsBuildInProgressForProfile(profileGuid) ||
                    BuildQueueJobStateService.IsProfileBlockedForExecute(
                        profileGuid,
                        guid => buildQueueManager != null && buildQueueManager.HasJobInProgress(guid)),
                ExecuteBuildOperation = (profile, buildOnly, publishOnly, notarizeOnly, platform, profileGuid, activeJob) =>
                    ExecuteBuildProfileWithExecutionResult(profile, buildOnly, publishOnly, notarizeOnly, platform, profileGuid, activeJob),
                OnBuildSucceeded = UpdateBuildExistenceState,
                StopProgress = viewModel.ProgressBar.Stop,
                AppendOutput = (line, type) => viewModel.ConsoleOutput.AppendLine(line, type)
            });

#if !CADET_LITE
            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} OnExecute completed after {executeStopwatch.ElapsedMilliseconds}ms " +
                $"result='{result.Code}' profile='{result.ProfileName ?? selectedProfileAsset?.Profile?.profileName ?? string.Empty}'.");
#endif

            if (result.Code == BuildExecutionSequenceService.ExecuteResultCode.NoProfile)
            {
                EditorUtility.DisplayDialog("No Profile", "Please select a profile first.", "OK");
                return;
            }

            if (result.Code == BuildExecutionSequenceService.ExecuteResultCode.BuildInProgress)
            {
                ShowBuildAlreadyInProgress(result.ProfileName);
                return;
            }

            if (result.Code == BuildExecutionSequenceService.ExecuteResultCode.EpicConfigMissing)
            {
                EditorUtility.DisplayDialog(
                    "Epic Build Configuration Required",
                    "BuildPatchTool Path is required to publish to Epic. Please configure it in Publishing Tools or the profile editor.",
                    "OK"
                );
            }

            if (result.Code == BuildExecutionSequenceService.ExecuteResultCode.DetachedOperationStarted)
            {
                return;
            }
        }

        private async Task<BuildOperationExecutionService.ExecutionResult> ExecuteBuildProfileWithExecutionResult(
            BuildProfile profile,
            bool buildOnly,
            bool publishOnly,
            bool notarizeOnly,
            string platform = null,
            string profileGuid = null,
            BuildJobDefinition activeJob = null)
        {
            string operationName = notarizeOnly
                ? "Notarize macOS Build"
                : (buildOnly ? "Build Only" : (publishOnly ? "Publish Only" : "Build & Publish"));
            var request = new BuildOperationExecutionService.Request
            {
                Profile = profile,
                ProfileGuid = profileGuid,
                ActiveJob = activeJob,
                OperationName = operationName,
                PlatformOverride = platform,
                BuildOnly = buildOnly,
                PublishOnly = publishOnly,
                NotarizeOnly = notarizeOnly,
                ClearUnityLogsBeforeExecute = buildOnly || !publishOnly,
                ExecutionState = buildExecutionStateViewModel,
                ActionButtons = viewModel.ActionButtons,
                ConsoleOutput = viewModel.ConsoleOutput,
                ProgressBar = viewModel.ProgressBar,
                KeepConsoleMirroringAfterCompletion = false,
                ShowBlockingSyncDialog = activeJob == null || (activeJob != null && activeJob.ShowBlockingSyncDialog),
                OnBlockingSyncCancelRequested = OnCancelOperation,
                Repaint = Repaint,
#if !CADET_LITE
                ExecuteDistScript = ExecuteDistScript
#endif
            };

            return await BuildOperationExecutionService.ExecuteWithResultAsync(request);
        }
        
        /// <summary>
        /// Executes macOS notarization operation and returns the full execution result.
        /// This overload is used by tracked jobs so detached-state handoff is preserved.
        /// </summary>
        private async Task<BuildOperationExecutionService.ExecutionResult> ExecuteNotarizeMacWithResult(BuildProfile profile, BuildJobDefinition activeJob)
        {
            string operationName = "Notarize macOS Build";
            var request = new BuildOperationExecutionService.Request
            {
                Profile = profile,
                ProfileGuid = activeJob?.ProfileGuid ?? ResolveProfileGuid(viewModel.ProfileManager.GetSelectedProfileAsset()),
            ActiveJob = activeJob,
                OperationName = operationName,
                PlatformOverride = null,
                BuildOnly = false,
                PublishOnly = false,
                NotarizeOnly = true,
                ClearUnityLogsBeforeExecute = false,
                ExecutionState = buildExecutionStateViewModel,
                ActionButtons = viewModel.ActionButtons,
                ConsoleOutput = viewModel.ConsoleOutput,
                ProgressBar = viewModel.ProgressBar,
                KeepConsoleMirroringAfterCompletion = false,
                Repaint = Repaint,
#if !CADET_LITE
                ExecuteDistScript = ExecuteDistScript
#endif
            };

            return await BuildOperationExecutionService.ExecuteWithResultAsync(request);
        }

        /// <summary>
        /// Executes macOS notarization operation and returns success/failure status.
        /// This runs signing and notarization on an existing macOS build without rebuilding.
        /// </summary>
        private async Task<bool> ExecuteNotarizeMacWithResult(BuildProfile profile)
        {
            BuildOperationExecutionService.ExecutionResult result = await ExecuteNotarizeMacWithResult(profile, null);
            return result.Success;
        }
        
#if !CADET_LITE
        private BuildResult ExecuteDistScript(
            string projectPath,
            string profileJsonPath,
            string profileName,
            string profileGuid,
            bool buildOnly,
            bool publishOnly,
            bool notarizeOnly = false,
            Action<string> onOutputLine = null,
            Action<BuildSyncStatus, string> onStatusChange = null,
            Action<float> onSyncProgress = null,
            BuildJobDefinition activeJob = null)
        {
            return DistScriptService.Execute(
                projectPath, profileJsonPath, profileGuid, buildOnly, publishOnly, notarizeOnly,
                onOutputLine,
                onStatusChange,
                onSyncProgress,
                activeJob,
                processTracker: buildExecutionStateViewModel.ProcessTracker);
        }
#endif

        private static void ShowBuildAlreadyInProgress(string profileName)
        {
            string displayName = string.IsNullOrWhiteSpace(profileName) ? "this profile" : profileName;
            EditorUtility.DisplayDialog(
                "Build In Progress",
                $"Build already in progress for {displayName}.",
                "Back");
        }

#if CADET_LITE
        internal static void SetDirectorySyncConfirmationDialogForTests(Func<string, string, string, string, bool> handler)
        {
            directorySyncConfirmationDialog = handler ?? ((title, message, ok, cancel) => EditorUtility.DisplayDialog(title, message, ok, cancel));
        }

        internal static void ResetDirectorySyncConfirmationDialogForTests()
        {
            directorySyncConfirmationDialog = (title, message, ok, cancel) => EditorUtility.DisplayDialog(title, message, ok, cancel);
        }

        private static bool ShowDirectorySyncConfirmation(BuildProfile profile)
        {
            if (profile == null || profile.useGit)
            {
                return true;
            }

            string title = CadetLocalization.GetString("Dialog.DirectorySync.Title");
            string message = CadetLocalization.GetString("Dialog.DirectorySync.Message")
                .Replace("\\n", "\n");
            string ok = CadetLocalization.GetString("Dialog.DirectorySync.Ok");
            string cancel = CadetLocalization.GetString("Window.Cadet.Buttons.Cancel");

            return directorySyncConfirmationDialog(title, message, ok, cancel);
        }
#endif

        private void OnCancelOperation()
        {
            bool confirmed = EditorUtility.DisplayDialog(
                "Cancel Operation",
                "Are you sure you want to cancel the current operation?",
                "Cancel",
                "Continue"
            );
            
            if (confirmed)
            {
                BuildOperationCancellationService.CancelConfirmed(new BuildOperationCancellationService.Request
                {
                    ExecutionState = buildExecutionStateViewModel,
                    ActionButtons = viewModel.ActionButtons,
                    ConsoleOutput = viewModel.ConsoleOutput,
                    ProgressBar = viewModel.ProgressBar,
                    GetTrackedJob = guid => buildQueueManager?.GetJobByGuid(guid),
                    CancelTrackedJob = guid => buildQueueManager != null && buildQueueManager.CancelJob(guid),
                    ActiveTrackedJobGuid = BuildQueueRuntimeState.Instance.ActiveJobGuid,
                    KeepConsoleMirroringAfterCompletion = false,
                    CleanupActiveBuildProcess = CleanupActiveBuildProcess
                });
                Repaint();
            }
        }
        
        /// <summary>
        /// Kills the active build process if it's still running, including all child processes
        /// </summary>
        private void CleanupActiveBuildProcess()
        {
            buildExecutionStateViewModel?.CleanupActiveBuildProcess();
        }

        private Texture2D MakeColorTex(Color color)
        {
            var tex = new Texture2D(2, 2);
            var pixels = new Color[] { color, color, color, color };
            tex.SetPixels(pixels);
            tex.Apply();
            return tex;
        }
        
    }
}
