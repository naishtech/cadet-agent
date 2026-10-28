using System.Collections.Generic;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Validation.Validators;

namespace Covyne.CADET.Editor.Validation.ProfileValidators
{
    /// <summary>
    /// Factory for creating validators for profile fields
    /// Handles conditional validation based on platform/OS settings
    /// </summary>
    public static class ProfileFieldValidator
    {
        /// <summary>
        /// Creates validators for a field based on its name and context
        /// </summary>
        public static List<IValidator> GetValidatorsForField(string fieldName, BuildProfile profile)
        {
            var validators = new List<IValidator>();
            
            // Basic settings
            if (fieldName == "profileName")
            {
                validators.Add(new RequiredValidator("Profile Name is required."));
            }
            else if (fieldName == "platform")
            {
                validators.Add(new RequiredValidator("Platform is required."));
                validators.Add(new RegexValidator(@"^(none|steam|epic|both)$", "Platform must be 'none', 'steam', 'epic', or 'both'."));
            }
            else if (fieldName == "os")
            {
                validators.Add(new RequiredValidator("Operating System is required."));
                validators.Add(new RegexValidator(@"^(windows|mac|both)$", "OS must be 'windows', 'mac', or 'both'."));
            }
            // Unity settings
            else if (fieldName == "unity.editorPath")
            {
                validators.Add(new RequiredValidator("Unity Editor Path is required."));
                validators.Add(new PathExistsValidator(requireFile: true, customErrorMessage: "Unity Editor Path must point to an existing Unity executable."));
            }
            else if (fieldName == "unity.projectPath")
            {
                validators.Add(new RequiredValidator("Unity Project Path is required."));
                validators.Add(new PathExistsValidator(requireDirectory: true, customErrorMessage: "Unity Project Path must point to an existing directory."));
            }
            else if (fieldName == "unity.buildOutputPath")
            {
                validators.Add(new RequiredValidator("Build Output Path is required."));
                validators.Add(new PathFormatValidator(requireAbsolute: true, customErrorMessage: "Build Output Path must be an absolute path."));
            }
            else if (fieldName == "unity.projectName")
            {
                validators.Add(new RequiredValidator("Project Name is required."));
            }
            // Steam settings (conditional on platform)
            else if (fieldName == "steam.appId")
            {
                if (ShouldValidateSteam(profile))
                {
                    validators.Add(new RequiredValidator("Steam App ID is required."));
                    validators.Add(new NumericValidator(allowNegative: false, customErrorMessage: "Steam App ID must be a positive number."));
                }
            }
            else if (fieldName == "steam.depots")
            {
                if (ShouldValidateSteam(profile))
                {
                    if (profile?.steam?.depots == null || profile.steam.depots.Count == 0)
                    {
                        validators.Add(new RequiredValidator("At least one Steam depot is required."));
                    }
                }
            }
            // Epic settings (conditional on platform)
            else if (fieldName == "epic.productId")
            {
                if (ShouldValidateEpic(profile))
                {
                    validators.Add(new RequiredValidator("Epic Product ID is required."));
                }
            }
            else if (fieldName == "epic.organizationId")
            {
                if (ShouldValidateEpic(profile))
                {
                    validators.Add(new RequiredValidator("Epic Organization ID is required."));
                }
            }
            else if (fieldName == "epic.artifactId")
            {
                if (ShouldValidateEpic(profile))
                {
                    validators.Add(new RequiredValidator("Epic Artifact ID is required."));
                }
            }
            else if (fieldName == "epic.sandboxId")
            {
                if (ShouldValidateEpic(profile))
                {
                    validators.Add(new RequiredValidator("Epic Sandbox ID is required."));
                }
            }
            // Note: epic.buildPatchToolPath validation is not required for saving profiles
            // It will be validated only when executing Epic builds in CadetWindow
            // MacOS settings (conditional on os and enableSigning)
            else if (fieldName == "macos.entitlementsPath")
            {
                if (ShouldValidateMacOSEntitlements(profile))
                {
                    validators.Add(new RequiredValidator("Entitlements Path is required when macOS signing is enabled."));
                    validators.Add(new PathExistsValidator(requireFile: true, customErrorMessage: "Entitlements Path must point to an existing file."));
                }
            }
            
            return validators;
        }
        
        private static bool ShouldValidateSteam(BuildProfile profile)
        {
#if CADET_LITE
            return false;
#else
            return profile != null && (profile.platform == "steam" || profile.platform == "both");
#endif
        }
        
        private static bool ShouldValidateEpic(BuildProfile profile)
        {
#if CADET_LITE
            return false;
#else
            return profile != null && (profile.platform == "epic" || profile.platform == "both");
#endif
        }
        
        private static bool ShouldValidateMacOSEntitlements(BuildProfile profile)
        {
            return profile != null && 
                   profile.macos != null && 
                   profile.macos.enableSigning && 
                   (profile.os == "mac" || profile.os == "both");
        }
    }
}

