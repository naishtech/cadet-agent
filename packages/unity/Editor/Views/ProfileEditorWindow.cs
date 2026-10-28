using UnityEngine;
using UnityEditor;
using System.IO;
using System.Collections.Generic;
using Covyne.CADET.Editor.ViewModels;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Validation;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Views
{
    /// <summary>
    /// View for profile editor - renders UI based on ProfileEditorViewModel
    /// </summary>
    public class ProfileEditorWindow : EditorWindow
    {
        private ProfileEditorViewModel viewModel;
        private ValidationManager validationManager;
        private Vector2 scrollPosition;
        
        // Cached validation results for consistent control count between Layout and Repaint passes
        private Dictionary<string, ValidationResult> cachedValidationResults;
        
        // Section foldouts
        private bool showBasicSettings = true;
        private bool showUnitySettings = true;
        private bool showGitSettings = true;
        private bool showSteamSettings = true;
        private bool showEpicSettings = true;
        
        /// <summary>
        /// Shows the profile editor window
        /// </summary>
        /// <param name="profileName">Name of existing profile to edit, or null for new profile</param>
        public static void ShowWindow(string profileName = null)
        {
            ProfileEditorWindow window = GetWindow<ProfileEditorWindow>(CadetLocalization.GetString("Window.ProfileEditor.Title"));
            window.minSize = new Vector2(600, 700);
            window.viewModel = new ProfileEditorViewModel(profileName);
            
            // Initialize validation manager and run initial validation to ensure consistent state
            window.validationManager = new ValidationManager(window.viewModel.Profile);
            window.validationManager.ValidateAll();
            
            // Subscribe to ViewModel events
            window.viewModel.ProfileChanged += (profile) => 
            {
                // Update validation manager when profile changes
                if (window.validationManager != null)
                {
                    window.validationManager.UpdateProfile(profile);
                }
                window.Repaint();
            };
            window.viewModel.OnValidationError += (error) => EditorUtility.DisplayDialog(CadetLocalization.GetString("Window.ProfileEditor.Messages.ValidationError"), error, CadetLocalization.GetString("Window.ProfileEditor.Buttons.OK"));
            window.viewModel.OnSaveSuccess += (message) => 
            {
                EditorUtility.DisplayDialog(CadetLocalization.GetString("Window.ProfileEditor.Messages.ProfileSaved"), message, CadetLocalization.GetString("Window.ProfileEditor.Buttons.OK"));
                window.Close();
            };
            window.viewModel.OnProfileSaved += () =>
            {
                // Refresh profile list in all open CadetWindows
                var cadetWindows = Resources.FindObjectsOfTypeAll<CadetWindow>();
                foreach (var cadetWindow in cadetWindows)
                {
                    if (cadetWindow != null)
                    {
                        cadetWindow.RefreshProfileList();
                    }
                }
            };
            
            window.Show();
            window.Focus(); // Ensure the window is focused and brought to the front
        }
        
        /// <summary>
        /// Legacy method for backward compatibility
        /// </summary>
        [System.Obsolete("Use ShowWindow(string profileName) instead")]
        public static void ShowWindow(BuildProfile existingProfile)
        {
            ShowWindow(existingProfile?.profileName);
        }

        private void OnDisable()
        {
            EditorUtility.ClearProgressBar();
        }
        
        private void OnGUI()
        {
            if (viewModel == null || viewModel.Profile == null)
            {
                EditorGUILayout.HelpBox(CadetLocalization.GetString("Window.ProfileEditor.Messages.InitializationFailed"), MessageType.Error);
                return;
            }
            
            // Cache validation results at start of OnGUI to ensure consistent control count between Layout and Repaint passes
            if (validationManager != null && Event.current.type == EventType.Layout)
            {
                cachedValidationResults = validationManager.ValidateAll();
            }
            
            // Set wider label width for profile editor
            float originalLabelWidth = EditorGUIUtility.labelWidth;
            EditorGUIUtility.labelWidth = 220;
            
            var profile = viewModel.Profile;
            
            // Cache platform value at start to ensure consistent control count between layout and repaint passes
            string currentPlatform = profile.platform;
            bool showSteamSection = currentPlatform == "steam" || currentPlatform == "both";
            bool showEpicSection = currentPlatform == "epic" || currentPlatform == "both";
            
            scrollPosition = EditorGUILayout.BeginScrollView(scrollPosition);
            
            EditorGUILayout.Space(10);
            GUILayout.Label(viewModel.IsNewProfile ? CadetLocalization.GetString("Window.ProfileEditor.CreateNewProfile") : CadetLocalization.GetString("Window.ProfileEditor.EditProfile"), EditorStyles.boldLabel);
            EditorGUILayout.Space(10);
            
            // Basic Settings
            showBasicSettings = EditorGUILayout.Foldout(showBasicSettings, CadetLocalization.GetString("Window.ProfileEditor.BasicSettings"), true);
            if (showBasicSettings)
            {
                EditorGUI.indentLevel++;
                DrawBasicSettings();
                EditorGUI.indentLevel--;
                EditorGUILayout.Space(5);
            }
            
            // Unity Settings
            showUnitySettings = EditorGUILayout.Foldout(showUnitySettings, CadetLocalization.GetString("Window.ProfileEditor.UnitySettings"), true);
            if (showUnitySettings)
            {
                EditorGUI.indentLevel++;
                DrawUnitySettings();
                EditorGUI.indentLevel--;
                EditorGUILayout.Space(5);
            }
            
            // Git Settings (optional)
            showGitSettings = EditorGUILayout.Foldout(showGitSettings, CadetLocalization.GetString("Window.ProfileEditor.GitSettings"), true);
            if (showGitSettings)
            {
                EditorGUI.indentLevel++;
                DrawGitSettings();
                EditorGUI.indentLevel--;
                EditorGUILayout.Space(5);
            }
            
            // Platform-specific settings (conditional) - using cached values
            if (showSteamSection)
            {
                showSteamSettings = EditorGUILayout.Foldout(showSteamSettings, CadetLocalization.GetString("Window.ProfileEditor.SteamSettings"), true);
                if (showSteamSettings)
                {
                    EditorGUI.indentLevel++;
                    DrawSteamSettings();
                    EditorGUI.indentLevel--;
                    EditorGUILayout.Space(5);
                }
            }
            
            if (showEpicSection)
            {
                showEpicSettings = EditorGUILayout.Foldout(showEpicSettings, CadetLocalization.GetString("Window.ProfileEditor.EpicSettings"), true);
                if (showEpicSettings)
                {
                    EditorGUI.indentLevel++;
                    DrawEpicSettings();
                    EditorGUI.indentLevel--;
                    EditorGUILayout.Space(5);
                }
            }
            
            EditorGUILayout.EndScrollView();
            
            // Display general validation errors (errors not tied to specific fields)
            DrawGeneralValidationErrors();
            
            EditorGUILayout.Space(10);
            
            // Action buttons
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Cancel"), GUILayout.Width(100)))
            {
                Close();
            }
            
            bool shouldSave = false;
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Save"), GUILayout.Width(100)))
            {
                // Validate all fields when Save is clicked
                bool hasErrors = false;
                if (validationManager != null)
                {
                    var validationResults = validationManager.ValidateAll();
                    
                    // Check if there are any validation errors
                    foreach (var result in validationResults.Values)
                    {
                        if (!result.IsValid)
                        {
                            hasErrors = true;
                            break;
                        }
                    }
                }
                
                if (!hasErrors)
                {
                    shouldSave = true;
                }
                else
                {
                    // Show validation errors and prevent save
                    Repaint();
                }
            }
            EditorGUILayout.EndHorizontal();
            
            // Save immediately without presync dialogs
            if (shouldSave)
            {
                viewModel.RequestSave();
            }
            
            // Restore original label width
            EditorGUIUtility.labelWidth = originalLabelWidth;
        }

        private void DrawBasicSettings()
        {
            // Cache platform and OS values at start to ensure consistent control count between layout and repaint passes
            string currentPlatform = viewModel.Profile.platform;
            string currentOS = viewModel.Profile.os;
            bool showMacOSSettings = currentOS == "mac" || currentOS == "both";
            bool showMacOSWarning = showMacOSSettings && Application.platform != RuntimePlatform.OSXEditor;
            
            // Cache validation errors at start to ensure consistent control count between layout and repaint passes
            string profileNameError = validationManager?.GetFieldError("profileName");
            string platformError = validationManager?.GetFieldError("platform");
            string osError = validationManager?.GetFieldError("os");
            string macosEntitlementsPathError = validationManager?.GetFieldError("macos.entitlementsPath");
            
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.ProfileName"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.ProfileName")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("profileName");
            string profileName = EditorGUILayout.TextField(viewModel.Profile.profileName);
            if (profileName != viewModel.Profile.profileName)
            {
                viewModel.UpdateProfileName(profileName);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("profileName", profileNameError);

            EditorGUILayout.HelpBox("Profile Name is the label used in the queue and build history. Use a clear name like Steam-Windows-Release.", MessageType.Info);
            
#if CADET_LITE
            // In Lite: Platform is Pro feature - show disabled with Pro label
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.Platform"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.Platform")), GUILayout.Width(EditorGUIUtility.labelWidth));
            EditorGUI.BeginDisabledGroup(true);
            string[] platformOptions = new[]
            {
                CadetLocalization.GetStringWithFallback("Window.ProfileEditor.Options.NoPublishing", "No Publishing"),
                CadetLocalization.GetString("Window.ProfileEditor.Options.Steam"),
                CadetLocalization.GetString("Window.ProfileEditor.Options.Epic"),
                CadetLocalization.GetString("Window.ProfileEditor.Options.Both")
            };
            EditorGUILayout.Popup(GetPlatformIndex(currentPlatform, includeNone: true), platformOptions);
            EditorGUI.EndDisabledGroup();
            var proLabelStyle = new GUIStyle(EditorStyles.miniLabel);
            proLabelStyle.normal.textColor = new Color(1f, 0.6f, 0f);
            proLabelStyle.fontStyle = FontStyle.Bold;
            GUILayout.Label("PRO", proLabelStyle, GUILayout.Width(30));
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.HelpBox("Platform controls which publishing settings appear. Choose Steam, Epic, or Both based on your release targets.", MessageType.Info);
#else
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.Platform"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.Platform")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("platform");
            string[] platformOptions = new[]
            {
                CadetLocalization.GetStringWithFallback("Window.ProfileEditor.Options.NoPublishing", "No Publishing"),
                CadetLocalization.GetString("Window.ProfileEditor.Options.Steam"),
                CadetLocalization.GetString("Window.ProfileEditor.Options.Epic"),
                CadetLocalization.GetString("Window.ProfileEditor.Options.Both")
            };
            EditorGUI.BeginChangeCheck();
            int platformIndex = EditorGUILayout.Popup(GetPlatformIndex(currentPlatform, includeNone: true), platformOptions);
            if (EditorGUI.EndChangeCheck())
            {
                string newPlatform = new[] { "none", "steam", "epic", "both" }[platformIndex];
                if (newPlatform != currentPlatform)
                {
                    // Defer platform update to avoid GUILayout control count mismatches
                    string platformToUpdate = newPlatform;
                    EditorApplication.delayCall += () =>
                    {
                        viewModel.UpdatePlatform(platformToUpdate);
                        Repaint();
                    };
                }
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("platform", platformError);

            EditorGUILayout.HelpBox("Platform controls which publishing settings appear. Choose No Publishing, Steam, Epic, or Both based on your release targets.", MessageType.Info);
#endif
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.OperatingSystem"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.OperatingSystem")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("os");
            string[] osOptions = new[] { CadetLocalization.GetString("Window.ProfileEditor.Options.Windows"), CadetLocalization.GetString("Window.ProfileEditor.Options.Mac"), CadetLocalization.GetString("Window.ProfileEditor.Options.Both") };
            int osIndex = EditorGUILayout.Popup(GetOSIndex(currentOS), osOptions);
            string newOS = new[] { "windows", "mac", "both" }[osIndex];
            if (newOS != currentOS)
            {
                // Defer OS update to avoid GUILayout control count mismatches
                string osToUpdate = newOS;
                EditorApplication.delayCall += () =>
                {
                    viewModel.UpdateOS(osToUpdate);
                    Repaint();
                };
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("os", osError);

            EditorGUILayout.HelpBox("Operating System controls which player builds are produced and which platform-specific options are shown.", MessageType.Info);
            
            // Bundle ID field (for macOS signing)
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.BundleId"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.BundleId")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("bundleId");
            string bundleId = EditorGUILayout.TextField(viewModel.Profile.bundleId ?? "");
            if (bundleId != (viewModel.Profile.bundleId ?? ""))
            {
                viewModel.UpdateBundleId(bundleId);
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.HelpBox("Bundle ID should match your macOS app identifier format, for example com.company.game. Required for macOS signing workflows.", MessageType.Info);
            
            // Show warning if macOS is selected but bundleId is empty
            if ((currentOS == "mac" || currentOS == "both") && string.IsNullOrEmpty(bundleId))
            {
                EditorGUILayout.HelpBox(CadetLocalization.GetStringWithFallback("Window.ProfileEditor.Messages.BundleIdRequired", "Bundle ID is required when macOS is selected"), MessageType.Warning);
                EditorGUILayout.Space(5);
            }
            
            // Show warning if macOS is selected but we're not on macOS (using cached value)
            if (showMacOSWarning)
            {
                EditorGUILayout.Space(5);
                EditorGUILayout.HelpBox(CadetLocalization.GetString("Window.ProfileEditor.Messages.MacOSBuildWarning"), MessageType.Warning);
                EditorGUILayout.Space(5);
            }
            
            // Only show macOS Notorize when OS is mac or both (not windows) - using cached value
            if (showMacOSSettings)
            {
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.Notorize"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.Notorize")), GUILayout.Width(EditorGUIUtility.labelWidth));
                bool notorize = EditorGUILayout.Toggle(viewModel.Profile.macos.enableSigning);
                if (notorize != viewModel.Profile.macos.enableSigning)
                {
                    viewModel.UpdateMacOSEnableSigning(notorize);
                }
                EditorGUILayout.EndHorizontal();

                EditorGUILayout.HelpBox("Enable Notarize when producing signed macOS builds for distribution outside the App Store.", MessageType.Info);
                
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.EntitlementsPath"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.EntitlementsPath")), GUILayout.Width(EditorGUIUtility.labelWidth));
                GUI.SetNextControlName("macos.entitlementsPath");
                string entitlementsPath = EditorGUILayout.TextField(viewModel.Profile.macos.entitlementsPath);
                if (entitlementsPath != viewModel.Profile.macos.entitlementsPath)
                {
                    viewModel.UpdateMacOSEntitlementsPath(entitlementsPath);
                }
                if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Browse"), GUILayout.Width(60)))
                {
                    string path = EditorUtility.OpenFilePanel(CadetLocalization.GetString("Window.ProfileEditor.Dialogs.SelectEntitlementsFile"), 
                        string.IsNullOrEmpty(viewModel.Profile.macos.entitlementsPath) ? "" : Path.GetDirectoryName(viewModel.Profile.macos.entitlementsPath), 
                        "entitlements");
                    if (!string.IsNullOrEmpty(path))
                    {
                        viewModel.UpdateMacOSEntitlementsPath(path);
                        Repaint();
                    }
                }
                EditorGUILayout.EndHorizontal();
                DrawValidationError("macos.entitlementsPath", macosEntitlementsPathError);

                EditorGUILayout.HelpBox("Entitlements Path points to your .entitlements file used during macOS signing. Reuse the same file your notarized app build uses.", MessageType.Info);
            }
            
            EditorGUILayout.EndVertical();
        }
        
        private int GetPlatformIndex(string platform, bool includeNone = false)
        {
            if (includeNone)
            {
                return platform switch
                {
                    "none" => 0,
                    "steam" => 1,
                    "epic" => 2,
                    "both" => 3,
                    _ => 0,
                };
            }

            return platform switch
            {
                "steam" => 0,
                "epic" => 1,
                "both" => 2,
                _ => 0,
            };
        }
        
        private int GetOSIndex(string os)
        {
            return os switch
            {
                "windows" => 0,
                "mac" => 1,
                "both" => 2,
                _ => 0,
            };
        }
        
        private void DrawUnitySettings()
        {
            // Cache validation errors at start to ensure consistent control count between layout and repaint passes
            string editorPathError = validationManager?.GetFieldError("unity.editorPath");
            string projectPathError = validationManager?.GetFieldError("unity.projectPath");
            string buildOutputPathError = validationManager?.GetFieldError("unity.buildOutputPath");
            string projectNameError = validationManager?.GetFieldError("unity.projectName");
            
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.EditorPath"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.EditorPath")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("unity.editorPath");
            string editorPath = EditorGUILayout.TextField(viewModel.Profile.unity.editorPath);
            if (editorPath != viewModel.Profile.unity.editorPath)
            {
                viewModel.UpdateUnityEditorPath(editorPath);
            }
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Browse"), GUILayout.Width(60)))
            {
                string path = EditorUtility.OpenFilePanel(CadetLocalization.GetString("Window.ProfileEditor.Dialogs.SelectUnityEditor"), 
                    string.IsNullOrEmpty(viewModel.Profile.unity.editorPath) ? "" : Path.GetDirectoryName(viewModel.Profile.unity.editorPath), 
                    Application.platform == RuntimePlatform.WindowsEditor ? "exe" : "");
                if (!string.IsNullOrEmpty(path))
                {
                    viewModel.UpdateUnityEditorPath(path);
                    Repaint();
                }
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("unity.editorPath", editorPathError);

            EditorGUILayout.HelpBox("Editor Path should point to the Unity editor executable used for automated builds for this profile.", MessageType.Info);

            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent("Source Project Path", "The Unity project you are actively developing. Files are synchronized from here before build."), GUILayout.Width(EditorGUIUtility.labelWidth));
            string sourceProjectPath = EditorGUILayout.TextField(viewModel.SourceProjectPath);
            if (sourceProjectPath != viewModel.SourceProjectPath)
            {
                viewModel.UpdateSourceProjectPath(sourceProjectPath);
            }
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Browse"), GUILayout.Width(60)))
            {
                string path = EditorUtility.OpenFolderPanel(
                    "Select Source Unity Project",
                    string.IsNullOrEmpty(viewModel.SourceProjectPath) ? "" : viewModel.SourceProjectPath,
                    "");
                if (!string.IsNullOrEmpty(path))
                {
                    viewModel.UpdateSourceProjectPath(path);
                    Repaint();
                }
            }
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.GetControlRect(false, 0);

            EditorGUILayout.HelpBox("Source Project Path is your active development project. CADET syncs from this location before each build.", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent("Sync Project Path", "Path where CADET will sync the Unity project before building. This is NOT the build output location."), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("unity.projectPath");
            string projectPath = EditorGUILayout.TextField(viewModel.Profile.unity.projectPath);
            if (projectPath != viewModel.Profile.unity.projectPath)
            {
                viewModel.UpdateUnityProjectPath(projectPath);
            }
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Browse"), GUILayout.Width(60)))
            {
                string path = EditorUtility.OpenFolderPanel(CadetLocalization.GetString("Window.ProfileEditor.Dialogs.SelectUnityProject"), 
                    string.IsNullOrEmpty(viewModel.Profile.unity.projectPath) ? "" : viewModel.Profile.unity.projectPath, "");
                if (!string.IsNullOrEmpty(path))
                {
                    viewModel.UpdateUnityProjectPath(path);
                    Repaint();
                }
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("unity.projectPath", projectPathError);

            EditorGUILayout.HelpBox("Sync Project Path is the working copy CADET builds from. Keep this separate from your source project to avoid locking issues.", MessageType.Info);

            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.BuildOutputPath"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.BuildOutputPath")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("unity.buildOutputPath");
            string buildOutputPath = EditorGUILayout.TextField(viewModel.Profile.unity.buildOutputPath);
            if (buildOutputPath != viewModel.Profile.unity.buildOutputPath)
            {
                viewModel.UpdateUnityBuildOutputPath(buildOutputPath);
            }
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Browse"), GUILayout.Width(60)))
            {
                string path = EditorUtility.OpenFolderPanel(CadetLocalization.GetString("Window.ProfileEditor.Dialogs.SelectBuildOutputDirectory"), 
                    string.IsNullOrEmpty(viewModel.Profile.unity.buildOutputPath) ? "" : viewModel.Profile.unity.buildOutputPath, "");
                if (!string.IsNullOrEmpty(path))
                {
                    viewModel.UpdateUnityBuildOutputPath(path);
                    Repaint();
                }
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("unity.buildOutputPath", buildOutputPathError);

            EditorGUILayout.HelpBox("Build Output Path is where Unity build artifacts are written before upload or packaging.", MessageType.Info);
            
            // Project Name is derived from the source Unity project metadata.
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.ProjectName"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.ProjectName")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("unity.projectName");
            string projectName = EditorGUILayout.TextField(viewModel.Profile.unity.projectName ?? "");
            if (projectName != (viewModel.Profile.unity.projectName ?? ""))
            {
                viewModel.UpdateUnityProjectName(projectName);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("unity.projectName", projectNameError);

            EditorGUILayout.HelpBox("Build Executable Name controls the output filename used by build, dist, and lite artifact checks. Enter the base name only (without .exe or .app).", MessageType.Info);
            
            EditorGUILayout.EndVertical();
        }
        
        private void DrawGitSettings()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
#if CADET_LITE
            // In Lite: Git Sync is Pro feature - force Directory Sync (useGit = false)
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent("Sync Mode", "Lite supports Directory Sync only"), GUILayout.Width(EditorGUIUtility.labelWidth));
            EditorGUI.BeginDisabledGroup(true);
            EditorGUILayout.LabelField("Directory Sync", GUILayout.ExpandWidth(true));
            EditorGUI.EndDisabledGroup();
            var proLabelStyle = new GUIStyle(EditorStyles.miniLabel);
            proLabelStyle.normal.textColor = new Color(1f, 0.6f, 0f);
            proLabelStyle.fontStyle = FontStyle.Bold;
            GUILayout.Label("PRO: Git Sync", proLabelStyle, GUILayout.Width(80));
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.HelpBox("Sync Mode controls how the build workspace is prepared. Directory Sync copies files directly, while Git Sync uses repository checkout.", MessageType.Info);
            
            // Ensure useGit is false in Lite
            if (viewModel.Profile.useGit)
            {
                viewModel.UpdateUseGit(false);
            }
            
            // Show all Git fields as disabled with Pro labels
            EditorGUI.BeginDisabledGroup(true);
#else
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.UseGit"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.UseGit")), GUILayout.Width(EditorGUIUtility.labelWidth));
            bool useGit = EditorGUILayout.Toggle(viewModel.Profile.useGit);
            if (useGit != viewModel.Profile.useGit)
            {
                viewModel.UpdateUseGit(useGit);
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.HelpBox("Use Git enables repository-based sync instead of direct directory copy. Enable this when your build workspace should track a branch.", MessageType.Info);
#endif
            
            // Only show warning message and git fields when useGit is enabled
            if (viewModel.Profile.useGit)
            {
                // Only show warning if the project path is the same as the current project
                // (If using a separate directory, the warning is not needed as that's the intended workflow)
                if (!string.IsNullOrEmpty(viewModel.Profile.unity.projectPath) && IsCurrentProjectPath(viewModel.Profile.unity.projectPath))
                {
                    EditorGUILayout.Space(5);
                    EditorGUILayout.HelpBox(CadetLocalization.GetString("Window.ProfileEditor.Messages.GitWarning"), MessageType.Warning);
                    EditorGUILayout.Space(5);
                }
                
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.GitRepository"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.GitRepository")), GUILayout.Width(EditorGUIUtility.labelWidth));
                string gitRepository = EditorGUILayout.TextField(viewModel.Profile.gitRepository);
                if (gitRepository != viewModel.Profile.gitRepository)
                {
                    viewModel.UpdateGitRepository(gitRepository);
                }
                EditorGUILayout.EndHorizontal();

                EditorGUILayout.HelpBox("Git Repository should be the clone URL (HTTPS or SSH) for the project repository used in build sync.", MessageType.Info);
                
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.GitBranch"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.GitBranch")), GUILayout.Width(EditorGUIUtility.labelWidth));
                string gitBranch = EditorGUILayout.TextField(viewModel.Profile.gitBranch);
                if (gitBranch != viewModel.Profile.gitBranch)
                {
                    viewModel.UpdateGitBranch(gitBranch);
                }
                EditorGUILayout.EndHorizontal();

                EditorGUILayout.HelpBox("Git Branch is the branch CADET checks out in the build workspace, such as main, release, or qa.", MessageType.Info);

                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(
                    new GUIContent(
                        CadetLocalization.GetStringWithFallback("Window.ProfileEditor.Fields.InstallGitLfsIfMissing", "Install Git LFS If Missing"),
                        CadetLocalization.GetStringWithFallback("Window.ProfileEditor.Tooltips.InstallGitLfsIfMissing", "If enabled, CADET checks Git LFS before git sync and runs 'git lfs install'. If git-lfs is not available, build fails with setup guidance.")),
                    GUILayout.Width(EditorGUIUtility.labelWidth));
                bool installGitLfsIfMissing = EditorGUILayout.Toggle(viewModel.Profile.installGitLfsIfMissing);
                if (installGitLfsIfMissing != viewModel.Profile.installGitLfsIfMissing)
                {
                    viewModel.UpdateInstallGitLfsIfMissing(installGitLfsIfMissing);
                }
                EditorGUILayout.EndHorizontal();

                EditorGUILayout.HelpBox(
                    "Enable this to run a Git LFS preflight before clone/fetch. CADET runs 'git lfs install' when available and shows explicit setup steps when git-lfs is missing.",
                    MessageType.Info);
                
                // Show Git Bash path field only on Windows
                if (Application.platform == RuntimePlatform.WindowsEditor)
                {
                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.GitBashPath"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.GitBashPath")), GUILayout.Width(EditorGUIUtility.labelWidth));
                    string gitBashPath = EditorGUILayout.TextField(viewModel.Profile.gitBashPath);
                    if (gitBashPath != viewModel.Profile.gitBashPath)
                    {
                        viewModel.UpdateGitBashPath(gitBashPath);
                    }
                    
                    if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Browse"), GUILayout.Width(60)))
                    {
                        string path = EditorUtility.OpenFilePanel(CadetLocalization.GetString("Window.ProfileEditor.Dialogs.SelectGitBashPath"), 
                            string.IsNullOrEmpty(viewModel.Profile.gitBashPath) ? "C:\\Program Files\\Git\\bin" : Path.GetDirectoryName(viewModel.Profile.gitBashPath), 
                            "exe");
                        if (!string.IsNullOrEmpty(path))
                        {
                            viewModel.UpdateGitBashPath(path);
                            Repaint();
                        }
                    }
                    EditorGUILayout.EndHorizontal();

                    EditorGUILayout.HelpBox("Git Bash Path should point to bash.exe from Git for Windows, usually C:/Program Files/Git/bin/bash.exe.", MessageType.Info);
                }
                
                // Show "Use Git Tag for Version" checkbox only when platform includes Epic
                if (viewModel.Profile.platform == "epic" || viewModel.Profile.platform == "both")
                {
                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.UseGitTagForVersion"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.UseGitTagForVersion")), GUILayout.Width(EditorGUIUtility.labelWidth));
                    bool useGitTagForVersion = EditorGUILayout.Toggle(viewModel.Profile.epic.useGitTagForVersion);
                    if (useGitTagForVersion != viewModel.Profile.epic.useGitTagForVersion)
                    {
                        viewModel.UpdateEpicUseGitTagForVersion(useGitTagForVersion);
                    }
                    EditorGUILayout.EndHorizontal();

                    EditorGUILayout.HelpBox("Use Git Tag for Version reads the Epic build version from the current Git tag instead of manual entry.", MessageType.Info);
                }
            }
            
#if CADET_LITE
            EditorGUI.EndDisabledGroup();
#endif
            EditorGUILayout.EndVertical();
        }
        
        private void DrawSteamSettings()
        {
            // Cache validation errors at start to ensure consistent control count between layout and repaint passes
            string appIdError = validationManager?.GetFieldError("steam.appId");
            
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
#if CADET_LITE
            // In Lite: Steam Settings is Pro feature - show all fields disabled with Pro label
            EditorGUILayout.BeginHorizontal();
            var proLabelStyle = new GUIStyle(EditorStyles.boldLabel);
            proLabelStyle.normal.textColor = new Color(1f, 0.6f, 0f);
            GUILayout.Label("PRO FEATURE - Steam Publishing", proLabelStyle);
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(5);
            EditorGUI.BeginDisabledGroup(true);
#endif
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.AppID"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.AppID")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("steam.appId");
            string appId = EditorGUILayout.TextField(viewModel.Profile.steam.appId);
            if (appId != viewModel.Profile.steam.appId)
            {
                viewModel.UpdateSteamAppId(appId);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("steam.appId", appIdError);

            EditorGUILayout.HelpBox("Find your App ID in the Steamworks Partner site: partner.steamgames.com → Apps → select your game → App Admin. You can use App ID 480 (Spacewar) for testing.", MessageType.Info);

            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.Description"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.Description")), GUILayout.Width(EditorGUIUtility.labelWidth));
            string description = EditorGUILayout.TextField(viewModel.Profile.steam.description);
            if (description != viewModel.Profile.steam.description)
            {
                viewModel.UpdateSteamDescription(description);
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.HelpBox("Description is used as the Steam build description or changelist note for this upload.", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.SetLiveBranch"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.SetLiveBranch")), GUILayout.Width(EditorGUIUtility.labelWidth));
            string setLive = EditorGUILayout.TextField(viewModel.Profile.steam.setLive);
            if (setLive != viewModel.Profile.steam.setLive)
            {
                viewModel.UpdateSteamSetLive(setLive);
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.HelpBox("Set Live Branch is the Steam branch to switch live after upload, for example public, beta, or internal.", MessageType.Info);
            
            EditorGUILayout.Space(5);
            GUILayout.Label(CadetLocalization.GetString("Window.ProfileEditor.Depots"), EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Depots define what files are uploaded and where they install for each OS target.", MessageType.Info);
            
            // Depot list
            for (int i = 0; i < viewModel.Profile.steam.depots.Count; i++)
            {
                EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
                
                if (viewModel.SelectedDepotIndex == i)
                {
                    EditorGUILayout.BeginVertical();
                    DrawDepotEditor(viewModel.Profile.steam.depots[i]);
                    EditorGUILayout.EndVertical();
                }
                else
                {
                    GUILayout.Label(string.Format(CadetLocalization.GetString("Window.ProfileEditor.DepotLabel"), i + 1, viewModel.Profile.steam.depots[i].depotId, viewModel.Profile.steam.depots[i].os), GUILayout.ExpandWidth(true));
                }
                
                if (GUILayout.Button(viewModel.SelectedDepotIndex == i ? CadetLocalization.GetString("Window.ProfileEditor.Buttons.Done") : CadetLocalization.GetString("Window.ProfileEditor.Buttons.Edit"), GUILayout.Width(50)))
                {
                    viewModel.SelectedDepotIndex = viewModel.SelectedDepotIndex == i ? -1 : i;
                }
                
                if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.Remove"), GUILayout.Width(60)))
                {
                    // Defer removal until next frame to avoid GUILayout control count mismatches
                    int depotIndex = i;
                    EditorApplication.delayCall += () =>
                    {
                        viewModel.RemoveSteamDepot(depotIndex);
                        // Reset selected depot index if the removed depot was selected
                        if (viewModel.SelectedDepotIndex == depotIndex)
                        {
                            viewModel.SelectedDepotIndex = -1;
                        }
                        else if (viewModel.SelectedDepotIndex > depotIndex)
                        {
                            // Adjust selected index if a depot before it was removed
                            viewModel.SelectedDepotIndex--;
                        }
                        Repaint();
                    };
                }
                
                EditorGUILayout.EndHorizontal();
            }
            
            if (GUILayout.Button(CadetLocalization.GetString("Window.ProfileEditor.Buttons.AddDepot")))
            {
                viewModel.AddSteamDepot();
            }
            
#if CADET_LITE
            EditorGUI.EndDisabledGroup();
#endif
            EditorGUILayout.EndVertical();
        }
        
        private void DrawDepotEditor(SteamDepot depot)
        {
            int depotIndex = viewModel.SelectedDepotIndex;
            if (depotIndex < 0 || depotIndex >= viewModel.Profile.steam.depots.Count)
                return;
            
            string depotIdFieldName = $"steam.depots[{depotIndex}].depotId";
            string localPathFieldName = $"steam.depots[{depotIndex}].localPath";
            string depotPathFieldName = $"steam.depots[{depotIndex}].depotPath";
            string recursiveFieldName = $"steam.depots[{depotIndex}].recursive";
            
            // Cache validation errors at start to ensure consistent control count between layout and repaint passes
            string depotIdError = validationManager?.GetFieldError(depotIdFieldName);
            string localPathError = validationManager?.GetFieldError(localPathFieldName);
            string depotPathError = validationManager?.GetFieldError(depotPathFieldName);
            string recursiveError = validationManager?.GetFieldError(recursiveFieldName);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.DepotID"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.DepotID")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName(depotIdFieldName);
            string depotId = EditorGUILayout.TextField(depot.depotId);
            EditorGUILayout.EndHorizontal();
            DrawValidationError(depotIdFieldName, depotIdError);

            EditorGUILayout.HelpBox("Find your Depot ID in the Steamworks Partner site: partner.steamgames.com → Apps → select your game → Steamworks Settings → Depots tab.", MessageType.Info);

            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.OS"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.DepotOS")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName($"steam.depots[{depotIndex}].os");
            string[] depotOSOptions = new[] { CadetLocalization.GetString("Window.ProfileEditor.Options.Windows"), CadetLocalization.GetString("Window.ProfileEditor.Options.Mac") };
            int depotOSIndex = EditorGUILayout.Popup(depot.os == "windows" ? 0 : 1, depotOSOptions);
            string newDepotOS = depotOSIndex == 0 ? "windows" : "mac";
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.HelpBox("Depot OS should match the binaries in this depot: Windows for PC builds, Mac for macOS builds.", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.LocalPath"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.LocalPath")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName(localPathFieldName);
            string localPath = EditorGUILayout.TextField(depot.localPath);
            EditorGUILayout.EndHorizontal();
            DrawValidationError(localPathFieldName, localPathError);

            EditorGUILayout.HelpBox("Local Path is the folder on your machine to upload for this depot, usually relative to your build output folder (for example: . or Build/Windows).", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.DepotPath"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.DepotPath")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName(depotPathFieldName);
            string depotPath = EditorGUILayout.TextField(depot.depotPath);
            EditorGUILayout.EndHorizontal();
            DrawValidationError(depotPathFieldName, depotPathError);

            EditorGUILayout.HelpBox("Depot Path is the install location inside the Steam depot (for example: . or a subfolder like Binaries). Use . to place files at the depot root.", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.Recursive"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.Recursive")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName(recursiveFieldName);
            string[] recursiveOptions = new[] { CadetLocalization.GetString("Window.ProfileEditor.Options.Yes1"), CadetLocalization.GetString("Window.ProfileEditor.Options.No0") };
            int recursiveIndex = EditorGUILayout.Popup(depot.recursive == "1" ? 0 : 1, recursiveOptions);
            string newRecursive = recursiveIndex == 0 ? "1" : "0";
            EditorGUILayout.EndHorizontal();
            DrawValidationError(recursiveFieldName, recursiveError);

            EditorGUILayout.HelpBox("Recursive controls whether Steam uploads files from subfolders inside Local Path. Set Yes (1) for most builds unless you only want top-level files.", MessageType.Info);
            
            // Update through ViewModel if any value changed
            if (depotId != depot.depotId || newDepotOS != depot.os || localPath != depot.localPath || 
                depotPath != depot.depotPath || newRecursive != depot.recursive)
            {
                viewModel.UpdateSteamDepot(depotIndex, depotId, newDepotOS, localPath, depotPath, newRecursive);
            }
        }
        
        private void DrawEpicSettings()
        {
            // Cache validation errors at start to ensure consistent control count between layout and repaint passes
            string productIdError = validationManager?.GetFieldError("epic.productId");
            string organizationIdError = validationManager?.GetFieldError("epic.organizationId");
            string artifactIdError = validationManager?.GetFieldError("epic.artifactId");
            string sandboxIdError = validationManager?.GetFieldError("epic.sandboxId");
            string labelError = validationManager?.GetFieldError("epic.label");
            string buildVersionError = validationManager?.GetFieldError("epic.buildVersion");
            
            // Cache showManualVersion to ensure consistent control count
            bool showManualVersion = !viewModel.Profile.useGit || !viewModel.Profile.epic.useGitTagForVersion;
            
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            
#if CADET_LITE
            // In Lite: Epic Settings is Pro feature - show all fields disabled with Pro label
            EditorGUILayout.BeginHorizontal();
            var proLabelStyle = new GUIStyle(EditorStyles.boldLabel);
            proLabelStyle.normal.textColor = new Color(1f, 0.6f, 0f);
            GUILayout.Label("PRO FEATURE - Epic Publishing", proLabelStyle);
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(5);
            EditorGUI.BeginDisabledGroup(true);
#endif
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.ProductID"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.ProductID")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("epic.productId");
            string productId = EditorGUILayout.TextField(viewModel.Profile.epic.productId);
            if (productId != viewModel.Profile.epic.productId)
            {
                viewModel.UpdateEpicProductId(productId);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("epic.productId", productIdError);

            EditorGUILayout.HelpBox("Product ID is in Epic Developer Portal (dev.epicgames.com): Products -> your product -> Product Settings.", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.OrganizationID"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.OrganizationID")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("epic.organizationId");
            string organizationId = EditorGUILayout.TextField(viewModel.Profile.epic.organizationId);
            if (organizationId != viewModel.Profile.epic.organizationId)
            {
                viewModel.UpdateEpicOrganizationId(organizationId);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("epic.organizationId", organizationIdError);

            EditorGUILayout.HelpBox("Organization ID is in Epic Developer Portal: open the organization switcher (top-left) -> Organization Settings.", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.ArtifactID"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.ArtifactID")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("epic.artifactId");
            string artifactId = EditorGUILayout.TextField(viewModel.Profile.epic.artifactId);
            if (artifactId != viewModel.Profile.epic.artifactId)
            {
                viewModel.UpdateEpicArtifactId(artifactId);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("epic.artifactId", artifactIdError);

            EditorGUILayout.HelpBox("Artifact ID is in your product's Artifacts and Binaries section. It identifies which artifact (build stream) this upload targets.", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.SandboxID"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.SandboxID")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("epic.sandboxId");
            string sandboxId = EditorGUILayout.TextField(viewModel.Profile.epic.sandboxId);
            if (sandboxId != viewModel.Profile.epic.sandboxId)
            {
                viewModel.UpdateEpicSandboxId(sandboxId);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("epic.sandboxId", sandboxIdError);

            EditorGUILayout.HelpBox("Sandbox ID is in your product's Sandboxes section. Use the sandbox that matches your target environment (for example: Live, Stage, or Dev).", MessageType.Info);
            
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.EpicLabel"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.EpicLabel")), GUILayout.Width(EditorGUIUtility.labelWidth));
            GUI.SetNextControlName("epic.label");
            string label = EditorGUILayout.TextField(viewModel.Profile.epic.label ?? "");
            if (label != (viewModel.Profile.epic.label ?? ""))
            {
                viewModel.UpdateEpicLabel(label);
            }
            EditorGUILayout.EndHorizontal();
            DrawValidationError("epic.label", labelError);

            EditorGUILayout.HelpBox("Label is the channel/tag name shown in Epic deployment tooling (for example: Live or QA). Keep it consistent with your release process.", MessageType.Info);
            
            // Show build version field only when git tag is not enabled OR when git is not enabled
            // Hide the field when both git is enabled AND useGitTagForVersion is true (using cached value)
            if (showManualVersion)
            {
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(new GUIContent(CadetLocalization.GetString("Window.ProfileEditor.Fields.BuildVersion"), CadetLocalization.GetString("Window.ProfileEditor.Tooltips.BuildVersion")), GUILayout.Width(EditorGUIUtility.labelWidth));
                GUI.SetNextControlName("epic.buildVersion");
                GUI.enabled = !viewModel.Profile.epic.useGitTagForVersion;
                string buildVersion = EditorGUILayout.TextField(viewModel.Profile.epic.buildVersion ?? "");
                if (buildVersion != viewModel.Profile.epic.buildVersion)
                {
                    viewModel.UpdateEpicBuildVersion(buildVersion);
                }
                GUI.enabled = true;
                EditorGUILayout.EndHorizontal();
                DrawValidationError("epic.buildVersion", buildVersionError);

                EditorGUILayout.HelpBox("Build Version is your explicit version string when not using Git tags. Use a stable format such as 1.2.3 or 2026.03.18.", MessageType.Info);
            }
            
#if CADET_LITE
            EditorGUI.EndDisabledGroup();
#endif
            EditorGUILayout.EndVertical();
        }
        
        /// <summary>
        /// Gets the current value of a field for validation
        /// </summary>
        private object GetFieldValue(string fieldName)
        {
            if (viewModel?.Profile == null)
                return null;
            
            var profile = viewModel.Profile;
            
            if (fieldName == "profileName") return profile.profileName;
            if (fieldName == "platform") return profile.platform;
            if (fieldName == "os") return profile.os;
            
            if (profile.unity != null)
            {
                if (fieldName == "unity.editorPath") return profile.unity.editorPath;
                if (fieldName == "unity.projectPath") return profile.unity.projectPath;
                if (fieldName == "unity.buildOutputPath") return profile.unity.buildOutputPath;
                if (fieldName == "unity.projectName") return profile.unity.projectName;
            }
            
            if (profile.steam != null)
            {
                if (fieldName == "steam.appId") return profile.steam.appId;
            }
            
            if (profile.epic != null)
            {
                if (fieldName == "epic.productId") return profile.epic.productId;
                if (fieldName == "epic.organizationId") return profile.epic.organizationId;
                if (fieldName == "epic.artifactId") return profile.epic.artifactId;
                if (fieldName == "epic.sandboxId") return profile.epic.sandboxId;
            }
            
            if (profile.macos != null)
            {
                if (fieldName == "macos.entitlementsPath") return profile.macos.entitlementsPath;
            }
            
            return null;
        }
        
        /// <summary>
        /// Draws a validation error message if the field has an error
        /// </summary>
        /// <param name="fieldName">The field name to check for errors</param>
        /// <param name="cachedError">Optional cached error message to ensure consistent control count between layout and repaint passes</param>
        private void DrawValidationError(string fieldName, string cachedError = null)
        {
            if (validationManager == null)
            {
                // Reserve a control rect to maintain consistent control count
                EditorGUILayout.GetControlRect(false, 0);
                return;
            }
            
            string error = cachedError ?? validationManager.GetFieldError(fieldName);
            if (!string.IsNullOrEmpty(error))
            {
                EditorGUILayout.HelpBox(error, MessageType.Error);
            }
            else
            {
                // Reserve a control rect to maintain consistent control count between Layout and Repaint passes
                EditorGUILayout.GetControlRect(false, 0);
            }
        }
        
        /// <summary>
        /// Draws general validation errors that are not related to specific fields displayed in the UI
        /// </summary>
        private void DrawGeneralValidationErrors()
        {
            if (validationManager == null || cachedValidationResults == null)
            {
                // Reserve control rect to maintain consistent control count
                EditorGUILayout.GetControlRect(false, 0);
                return;
            }
            
            // List of field names that have corresponding UI fields
            var fieldsWithUI = new HashSet<string>
            {
                "profileName",
                "platform",
                "os",
                "unity.editorPath",
                "unity.projectPath",
                "unity.buildOutputPath",
                "unity.projectName",
                "steam.appId",
                "epic.productId",
                "epic.organizationId",
                "epic.artifactId",
                "epic.sandboxId",
                "epic.label",
                "epic.buildVersion",
                "macos.entitlementsPath"
            };
            
            // Add depot fields
            if (viewModel?.Profile?.steam?.depots != null)
            {
                for (int i = 0; i < viewModel.Profile.steam.depots.Count; i++)
                {
                    fieldsWithUI.Add($"steam.depots[{i}].depotId");
                    fieldsWithUI.Add($"steam.depots[{i}].localPath");
                    fieldsWithUI.Add($"steam.depots[{i}].depotPath");
                    fieldsWithUI.Add($"steam.depots[{i}].recursive");
                }
            }
            
            // Collect errors for fields without UI using cached validation results
            var generalErrors = new List<string>();
            foreach (var kvp in cachedValidationResults)
            {
                if (!kvp.Value.IsValid && !fieldsWithUI.Contains(kvp.Key))
                {
                    generalErrors.Add(kvp.Value.ErrorMessage);
                }
            }
            
            // Display general errors if any
            if (generalErrors.Count > 0)
            {
                EditorGUILayout.Space(10);
                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                EditorGUILayout.LabelField("Validation Errors", EditorStyles.boldLabel);
                EditorGUILayout.Space(5);
                
                foreach (var error in generalErrors)
                {
                    EditorGUILayout.HelpBox(error, MessageType.Error);
                }
                
                EditorGUILayout.EndVertical();
            }
            else
            {
                // Reserve control rect to maintain consistent control count between Layout and Repaint passes
                EditorGUILayout.GetControlRect(false, 0);
            }
        }
        
        /// <summary>
        /// Checks if the given path is the same as the current Unity project path.
        /// </summary>
        private bool IsCurrentProjectPath(string path)
        {
            if (string.IsNullOrEmpty(path))
                return false;
            
            // Get the current project path (Application.dataPath returns the Assets folder, so go up one level)
            string currentProjectPath = Path.GetDirectoryName(Application.dataPath);
            
            // Normalize paths for comparison (handle different separators and trailing slashes)
            string normalizedPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string normalizedCurrentPath = Path.GetFullPath(currentProjectPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            
            return string.Equals(normalizedPath, normalizedCurrentPath, System.StringComparison.OrdinalIgnoreCase);
        }
    }
}
