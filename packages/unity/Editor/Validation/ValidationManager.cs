using System.Collections.Generic;
using System.Linq;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Validation.ProfileValidators;
using Covyne.CADET.Editor.Validation.Validators;

namespace Covyne.CADET.Editor.Validation
{
    /// <summary>
    /// Central manager for field validation
    /// Tracks validation state, registers validators, and provides error retrieval API
    /// </summary>
    public class ValidationManager
    {
        private readonly Dictionary<string, FieldValidationState> fieldStates;
        private readonly Dictionary<string, List<IValidator>> fieldValidators;
        private BuildProfile profile;
        
        public ValidationManager(BuildProfile profile)
        {
            this.profile = profile;
            this.fieldStates = new Dictionary<string, FieldValidationState>();
            this.fieldValidators = new Dictionary<string, List<IValidator>>();
            
            RegisterAllValidators();
        }
        
        /// <summary>
        /// Updates the profile context (for conditional validation)
        /// </summary>
        public void UpdateProfile(BuildProfile newProfile)
        {
            this.profile = newProfile;
            // Re-register validators in case conditional validation rules changed
            RegisterAllValidators();
            // Clear validation states since rules may have changed
            fieldStates.Clear();
        }
        
        /// <summary>
        /// Validates a specific field
        /// </summary>
        public ValidationResult ValidateField(string fieldName, object value)
        {
            if (string.IsNullOrEmpty(fieldName))
            {
                return ValidationResult.Error("Field name is required.", fieldName);
            }
            
            // Get or create field state
            if (!fieldStates.ContainsKey(fieldName))
            {
                fieldStates[fieldName] = new FieldValidationState(fieldName);
            }
            
            var fieldState = fieldStates[fieldName];
            fieldState.LastValue = value;
            fieldState.IsDirty = true;
            
            // Get validators for this field
            if (!fieldValidators.ContainsKey(fieldName))
            {
                // No validators registered, return success
                fieldState.ValidationResult = ValidationResult.Success(fieldName);
                fieldState.HasBeenValidated = true;
                return fieldState.ValidationResult;
            }
            
            var validators = fieldValidators[fieldName];
            if (validators.Count == 0)
            {
                fieldState.ValidationResult = ValidationResult.Success(fieldName);
                fieldState.HasBeenValidated = true;
                return fieldState.ValidationResult;
            }
            
            // Run all validators
            foreach (var validator in validators)
            {
                var result = validator.Validate(value, profile, fieldName);
                if (!result.IsValid)
                {
                    fieldState.ValidationResult = result;
                    fieldState.HasBeenValidated = true;
                    return result;
                }
            }
            
            // All validators passed
            fieldState.ValidationResult = ValidationResult.Success(fieldName);
            fieldState.HasBeenValidated = true;
            return fieldState.ValidationResult;
        }
        
        /// <summary>
        /// Gets the validation error for a field (if any)
        /// </summary>
        public string GetFieldError(string fieldName)
        {
            if (fieldStates.ContainsKey(fieldName))
            {
                var state = fieldStates[fieldName];
                if (state.HasBeenValidated && !state.ValidationResult.IsValid)
                {
                    return state.ValidationResult.ErrorMessage;
                }
            }
            return null;
        }
        
        /// <summary>
        /// Gets the validation result for a field
        /// </summary>
        public ValidationResult GetFieldValidationResult(string fieldName)
        {
            if (fieldStates.ContainsKey(fieldName))
            {
                return fieldStates[fieldName].ValidationResult;
            }
            return ValidationResult.Success(fieldName);
        }
        
        /// <summary>
        /// Checks if a field has validation errors
        /// </summary>
        public bool HasFieldError(string fieldName)
        {
            return !string.IsNullOrEmpty(GetFieldError(fieldName));
        }
        
        /// <summary>
        /// Validates all fields in the profile
        /// </summary>
        public Dictionary<string, ValidationResult> ValidateAll()
        {
            var results = new Dictionary<string, ValidationResult>();
            
            // Validate all registered fields
            foreach (var fieldName in fieldValidators.Keys)
            {
                var value = GetFieldValue(fieldName);
                var result = ValidateField(fieldName, value);
                results[fieldName] = result;
            }
            
            // Also validate depots if Steam is enabled
            if (profile != null && SteamSettingsValidator.ShouldValidate(profile))
            {
                if (profile.steam != null && profile.steam.depots != null)
                {
                    for (int i = 0; i < profile.steam.depots.Count; i++)
                    {
                        var depot = profile.steam.depots[i];
                        ValidateDepot($"steam.depots[{i}].depotId", depot.depotId, results);
                        ValidateDepot($"steam.depots[{i}].localPath", depot.localPath, results);
                        ValidateDepot($"steam.depots[{i}].depotPath", depot.depotPath, results);
                        ValidateDepot($"steam.depots[{i}].recursive", depot.recursive, results);
                    }
                }
            }
            
            return results;
        }
        
        private void ValidateDepot(string fieldName, object value, Dictionary<string, ValidationResult> results)
        {
            // Use depot-specific validators
            List<IValidator> validators = null;
            if (fieldName.EndsWith(".depotId"))
            {
                validators = SteamDepotValidator.GetDepotIdValidators();
            }
            else if (fieldName.EndsWith(".localPath"))
            {
                validators = SteamDepotValidator.GetLocalPathValidators();
            }
            else if (fieldName.EndsWith(".depotPath"))
            {
                validators = SteamDepotValidator.GetDepotPathValidators();
            }
            else if (fieldName.EndsWith(".recursive"))
            {
                validators = SteamDepotValidator.GetRecursiveValidators();
            }
            
            if (validators != null && validators.Count > 0)
            {
                foreach (var validator in validators)
                {
                    var result = validator.Validate(value, profile, fieldName);
                    if (!result.IsValid)
                    {
                        results[fieldName] = result;
                        return;
                    }
                }
            }
            
            results[fieldName] = ValidationResult.Success(fieldName);
        }
        
        /// <summary>
        /// Checks if all fields are valid
        /// </summary>
        public bool IsAllValid()
        {
            var results = ValidateAll();
            return results.Values.All(r => r.IsValid);
        }
        
        /// <summary>
        /// Clears validation state for a field (useful when field is reset)
        /// </summary>
        public void ClearFieldState(string fieldName)
        {
            if (fieldStates.ContainsKey(fieldName))
            {
                fieldStates.Remove(fieldName);
            }
        }
        
        /// <summary>
        /// Clears all validation states
        /// </summary>
        public void ClearAllStates()
        {
            fieldStates.Clear();
        }
        
        private void RegisterAllValidators()
        {
            fieldValidators.Clear();
            
            if (profile == null)
                return;
            
            // Register validators for all fields
            RegisterField("profileName", ProfileFieldValidator.GetValidatorsForField("profileName", profile));
            RegisterField("platform", ProfileFieldValidator.GetValidatorsForField("platform", profile));
            RegisterField("os", ProfileFieldValidator.GetValidatorsForField("os", profile));
            
            // Unity settings
            RegisterField("unity.editorPath", UnitySettingsValidator.GetEditorPathValidators());
            RegisterField("unity.projectPath", UnitySettingsValidator.GetProjectPathValidators());
            RegisterField("unity.buildOutputPath", UnitySettingsValidator.GetBuildOutputPathValidators());
            RegisterField("unity.projectName", UnitySettingsValidator.GetProjectNameValidators());
            
            // Steam settings (conditional)
            if (SteamSettingsValidator.ShouldValidate(profile))
            {
                RegisterField("steam.appId", SteamSettingsValidator.GetAppIdValidators());
            }
            
            // Epic settings (conditional)
            if (EpicSettingsValidator.ShouldValidate(profile))
            {
                RegisterField("epic.productId", EpicSettingsValidator.GetProductIdValidators());
                RegisterField("epic.organizationId", EpicSettingsValidator.GetOrganizationIdValidators());
                RegisterField("epic.artifactId", EpicSettingsValidator.GetArtifactIdValidators());
                RegisterField("epic.sandboxId", EpicSettingsValidator.GetSandboxIdValidators());
                // Note: epic.buildPatchToolPath validation is not required for saving profiles
                // It will be validated only when executing Epic builds in CadetWindow
            }
            
            // MacOS settings (conditional)
            if (profile.macos != null && profile.macos.enableSigning && (profile.os == "mac" || profile.os == "both"))
            {
                var entitlementsValidators = new List<IValidator>
                {
                    new RequiredValidator("Entitlements Path is required when macOS signing is enabled."),
                    new PathExistsValidator(requireFile: true, customErrorMessage: "Entitlements Path must point to an existing file.")
                };
                RegisterField("macos.entitlementsPath", entitlementsValidators);
            }
        }
        
        private void RegisterField(string fieldName, List<IValidator> validators)
        {
            if (validators != null && validators.Count > 0)
            {
                fieldValidators[fieldName] = validators;
            }
        }
        
        private object GetFieldValue(string fieldName)
        {
            if (profile == null)
                return null;
            
            // Basic fields
            if (fieldName == "profileName") return profile.profileName;
            if (fieldName == "platform") return profile.platform;
            if (fieldName == "os") return profile.os;
            
            // Unity settings
            if (profile.unity != null)
            {
                if (fieldName == "unity.editorPath") return profile.unity.editorPath;
                if (fieldName == "unity.projectPath") return profile.unity.projectPath;
                if (fieldName == "unity.buildOutputPath") return profile.unity.buildOutputPath;
                if (fieldName == "unity.projectName") return profile.unity.projectName;
            }
            
            // Steam settings
            if (profile.steam != null)
            {
                if (fieldName == "steam.appId") return profile.steam.appId;
            }
            
            // Epic settings
            if (profile.epic != null)
            {
                if (fieldName == "epic.productId") return profile.epic.productId;
                if (fieldName == "epic.organizationId") return profile.epic.organizationId;
                if (fieldName == "epic.artifactId") return profile.epic.artifactId;
                if (fieldName == "epic.sandboxId") return profile.epic.sandboxId;
                if (fieldName == "epic.buildPatchToolPath") return profile.epic.buildPatchToolPath;
            }
            
            // MacOS settings
            if (profile.macos != null)
            {
                if (fieldName == "macos.entitlementsPath") return profile.macos.entitlementsPath;
            }
            
            return null;
        }
    }
}

