using System.IO;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Validates that a file or directory path exists on the filesystem
    /// </summary>
    public class PathExistsValidator : IValidator
    {
        private readonly bool requireFile;
        private readonly bool requireDirectory;
        private readonly string customErrorMessage;
        
        /// <summary>
        /// Creates a validator that checks if a path exists
        /// </summary>
        /// <param name="requireFile">If true, path must be a file</param>
        /// <param name="requireDirectory">If true, path must be a directory</param>
        /// <param name="customErrorMessage">Custom error message</param>
        public PathExistsValidator(bool requireFile = false, bool requireDirectory = false, string customErrorMessage = null)
        {
            this.requireFile = requireFile;
            this.requireDirectory = requireDirectory;
            this.customErrorMessage = customErrorMessage;
        }
        
        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (value == null || !(value is string path) || string.IsNullOrWhiteSpace(path))
            {
                // Let RequiredValidator handle empty values
                return ValidationResult.Success(fieldName);
            }
            
            // Check if path is a macOS .app bundle (which is a directory but should be treated as an executable)
            bool isMacOSAppBundle = path.EndsWith(".app", System.StringComparison.OrdinalIgnoreCase) && Directory.Exists(path);
            
            if (!File.Exists(path) && !Directory.Exists(path))
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName}: Path does not exist: {path}",
                    fieldName
                );
            }
            
            // For requireFile, also accept .app bundles as valid (they're executables on macOS)
            if (requireFile && !File.Exists(path) && !isMacOSAppBundle)
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName}: Path must be a file: {path}",
                    fieldName
                );
            }
            
            if (requireDirectory && !Directory.Exists(path))
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName}: Path must be a directory: {path}",
                    fieldName
                );
            }
            
            return ValidationResult.Success(fieldName);
        }
    }
}

