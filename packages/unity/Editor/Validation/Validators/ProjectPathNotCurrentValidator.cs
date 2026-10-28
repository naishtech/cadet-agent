using System.IO;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Localization;
using UnityEngine;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Validates that the project path is not the same as the current Unity project path
    /// </summary>
    public class ProjectPathNotCurrentValidator : IValidator
    {
        private readonly string customErrorMessage;

        public ProjectPathNotCurrentValidator(string customErrorMessage = null)
        {
            this.customErrorMessage = customErrorMessage;
        }

        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (value == null || !(value is string path) || string.IsNullOrWhiteSpace(path))
            {
                // If path is empty/null, let other validators handle it
                return ValidationResult.Success(fieldName);
            }

            // Get the current project path (Application.dataPath returns the Assets folder, so go up one level)
            string currentProjectPath = Path.GetDirectoryName(Application.dataPath);

            // Normalize paths for comparison (handle different separators and trailing slashes)
            string normalizedPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string normalizedCurrentPath = Path.GetFullPath(currentProjectPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            if (string.Equals(normalizedPath, normalizedCurrentPath, System.StringComparison.OrdinalIgnoreCase))
            {
                return ValidationResult.Error(
                    customErrorMessage ?? CadetLocalization.GetString("Window.ProfileEditor.Validation.ProjectPathCannotBeCurrent"),
                    fieldName
                );
            }

            return ValidationResult.Success(fieldName);
        }
    }
}
