using System.Collections.Generic;
using System;
using System.IO;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Validation;
using Covyne.CADET.Editor.Validation.ProfileValidators;
using Covyne.CADET.Editor.ViewModels;
using NUnit.Framework;
using UnityEditor;

namespace Covyne.CADET.Editor.Tests.Validation
{
    [TestFixture]
    public class ProfileValidationEditionBehaviorTests
    {
        [Test]
        public void PlatformFieldValidation_ReflectsEditionRules()
        {
            var profile = new BuildProfile();
            var validators = ProfileFieldValidator.GetValidatorsForField("platform", profile);

            bool acceptsNone = RunValidators(validators, "none", profile, "platform");
            bool acceptsSteam = RunValidators(validators, "steam", profile, "platform");

            Assert.IsTrue(acceptsNone, "All editions should accept 'none' platform value.");
            Assert.IsTrue(acceptsSteam, "All editions should accept 'steam'.");
        }

        [Test]
        public void ValidateProfile_PublishFieldRequirements_AreEditionSpecific()
        {
            var vm = new ProfileEditorViewModel();
            var profile = vm.Profile;

            profile.profileName = "EditionValidation";
            profile.unity.editorPath = EditorApplication.applicationPath;
            profile.unity.projectPath = Directory.GetCurrentDirectory();
            profile.unity.buildOutputPath = Path.GetTempPath();
            profile.unity.projectName = "CadetTests";

            profile.platform = "steam";
            profile.steam.appId = string.Empty;
            profile.steam.depots.Clear();

            bool isValid = vm.ValidateProfile();

            Assert.IsFalse(isValid, "Full should require Steam publish fields when platform is steam.");
        }

        [Test]
        public void ValidationManager_DepotValidation_AreEditionSpecific()
        {
            var profile = new BuildProfile
            {
                profileName = "ValidationManagerEdition",
                platform = "steam",
                os = "windows"
            };

            profile.unity.editorPath = EditorApplication.applicationPath;
            profile.unity.projectPath = Directory.GetCurrentDirectory();
            profile.unity.buildOutputPath = Path.GetTempPath();
            profile.unity.projectName = "CadetTests";
            profile.steam.appId = string.Empty;
            profile.steam.depots.Clear();

            var validationManager = new ValidationManager(profile);
            Dictionary<string, ValidationResult> results = validationManager.ValidateAll();

            bool hasSteamErrors = false;
            foreach (var kvp in results)
            {
                if (kvp.Key.StartsWith("steam.") && !kvp.Value.IsValid)
                {
                    hasSteamErrors = true;
                    break;
                }
            }

            Assert.IsTrue(hasSteamErrors, "Full should enforce Steam validation when platform is steam.");
        }

    [Test]
    public void ValidateProfile_NonePlatform_IsValid()
    {
        var vm = new ProfileEditorViewModel();
        var profile = vm.Profile;

        profile.profileName = "NonePlatformValidation";
        profile.unity.editorPath = EditorApplication.applicationPath;
        profile.unity.projectPath = Directory.GetCurrentDirectory();
        profile.unity.buildOutputPath = Path.GetTempPath();
        profile.unity.projectName = "CadetTests";
        profile.platform = "none";

        bool isValid = vm.ValidateProfile();

        Assert.IsTrue(isValid, "All editions should allow saving with platform 'none'.");
    }

    [Test]
    public void UpdateUnityProjectPath_PreservesManualExecutableNameOverride()
    {
        var vm = new ProfileEditorViewModel();

        string root = Path.Combine(Path.GetTempPath(), $"cadet-project-name-{Guid.NewGuid():N}");
        string projectA = Path.Combine(root, "ProjectA");
        string projectB = Path.Combine(root, "ProjectB");

        try
        {
            CreateProjectSettings(projectA, "AutoNameA");
            CreateProjectSettings(projectB, "AutoNameB");

            vm.UpdateUnityProjectPath(projectA);
            Assert.AreEqual("AutoNameA", vm.Profile.unity.projectName, "Initial project path should auto-populate executable name.");

            vm.UpdateUnityProjectName("ManualOverride");
            vm.UpdateUnityProjectPath(projectB);

            Assert.AreEqual("ManualOverride", vm.Profile.unity.projectName, "Manual executable name should not be overwritten by subsequent project path changes.");
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, true);
            }
        }
    }

    [Test]
    public void UpdateUnityProjectName_StripsExecutableSuffixes()
    {
        var vm = new ProfileEditorViewModel();

        vm.UpdateUnityProjectName("MyGame.exe");
        Assert.AreEqual("MyGame", vm.Profile.unity.projectName, "Windows extension should be stripped from executable name.");

        vm.UpdateUnityProjectName("MyMacGame.app");
        Assert.AreEqual("MyMacGame", vm.Profile.unity.projectName, "macOS bundle extension should be stripped from executable name.");
    }

    [Test]
    public void UpdateUnityBuildOutputPath_AutoPopulatesSteamPathsWithForwardSlashes()
    {
        var vm = new ProfileEditorViewModel();

        vm.UpdateUnityBuildOutputPath("F:\\unity\\projects\\test-cadet\\bin");

        Assert.AreEqual("F:/unity/projects/test-cadet/bin", vm.Profile.unity.buildOutputPath);
        Assert.AreEqual("F:/unity/projects/test-cadet/bin", vm.Profile.steam.contentRoot);
        Assert.AreEqual("F:/unity/projects/test-cadet/bin/build", vm.Profile.steam.buildOutput);
    }

    [Test]
    public void UpdateSteamBuildOutput_NormalizesBackslashesToForwardSlashes()
    {
        var vm = new ProfileEditorViewModel();

        vm.UpdateSteamBuildOutput("F:\\unity\\projects\\test-cadet\\bin\\build");

        Assert.AreEqual("F:/unity/projects/test-cadet/bin/build", vm.Profile.steam.buildOutput);
    }

    [Test]
    public void RequestSave_AutoPopulatesEmptySteamBuildOutputWithForwardSlashes()
    {
        var vm = new ProfileEditorViewModel();
        var profile = vm.Profile;

        profile.profileName = "BuildOutputNormalization";
        profile.unity.buildOutputPath = "F:\\unity\\projects\\test-cadet\\bin";
        profile.steam.contentRoot = string.Empty;
        profile.steam.buildOutput = string.Empty;

        vm.RequestSave();

        Assert.AreEqual("F:/unity/projects/test-cadet/bin", profile.steam.contentRoot);
        Assert.AreEqual("F:/unity/projects/test-cadet/bin/build", profile.steam.buildOutput);
    }

    private static void CreateProjectSettings(string projectPath, string productName)
    {
        string projectSettingsDir = Path.Combine(projectPath, "ProjectSettings");
        Directory.CreateDirectory(projectSettingsDir);

        string settingsPath = Path.Combine(projectSettingsDir, "ProjectSettings.asset");
        File.WriteAllText(settingsPath, $"PlayerSettings:\n  productName: {productName}\n");
    }

        private static bool RunValidators(List<IValidator> validators, object value, BuildProfile profile, string fieldName)
        {
            foreach (var validator in validators)
            {
                var result = validator.Validate(value, profile, fieldName);
                if (!result.IsValid)
                {
                    return false;
                }
            }

            return true;
        }
    }
}
