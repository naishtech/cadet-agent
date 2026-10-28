using System.Collections.Generic;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Validation.Validators;

namespace Covyne.CADET.Editor.Validation.ProfileValidators
{
    /// <summary>
    /// Validators for Epic settings fields
    /// </summary>
    public static class EpicSettingsValidator
    {
        public static List<IValidator> GetProductIdValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Epic Product ID is required.")
            };
        }
        
        public static List<IValidator> GetOrganizationIdValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Epic Organization ID is required.")
            };
        }
        
        public static List<IValidator> GetArtifactIdValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Epic Artifact ID is required.")
            };
        }
        
        public static List<IValidator> GetSandboxIdValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Epic Sandbox ID is required.")
            };
        }
        
        public static List<IValidator> GetBuildPatchToolPathValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("BuildPatchTool Path is required."),
                new PathExistsValidator(requireDirectory: true, customErrorMessage: "Build Patch Tool not found - check Publishing Tools configuration")
            };
        }
        
        public static bool ShouldValidate(BuildProfile profile)
        {
#if CADET_LITE
            return false;
#else
            return profile != null && (profile.platform == "epic" || profile.platform == "both");
#endif
        }
    }
}

