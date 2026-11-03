using System.Collections.Generic;
using Covyne.CADET.Editor.Validation.Validators;

namespace Covyne.CADET.Editor.Validation.ProfileValidators
{
    /// <summary>
    /// Validators for Unity settings fields
    /// </summary>
    public static class UnitySettingsValidator
    {
        public static List<IValidator> GetEditorPathValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Unity Editor Path is required."),
                new PathExistsValidator(requireFile: true, customErrorMessage: "Unity Editor Path must point to an existing Unity executable.")
            };
        }
        
        public static List<IValidator> GetProjectPathValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Unity Project Path is required."),
                new PathExistsValidator(requireDirectory: true, customErrorMessage: "Unity Project Path must point to an existing directory.")
            };
        }

        public static List<IValidator> GetBuildOutputPathValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Build Output Path is required."),
                new PathFormatValidator(requireAbsolute: true, customErrorMessage: "Build Output Path must be an absolute path.")
            };
        }
        
        public static List<IValidator> GetProjectNameValidators()
        {
            return new List<IValidator>
            {
                new RequiredValidator("Project Name is required.")
            };
        }
    }
}

