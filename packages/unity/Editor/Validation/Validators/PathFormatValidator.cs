using System.IO;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Validates path format (absolute vs relative, valid characters)
    /// </summary>
    public class PathFormatValidator : IValidator
    {
        private readonly bool requireAbsolute;
        private readonly bool requireRelative;
        private readonly string customErrorMessage;
        
        public PathFormatValidator(bool requireAbsolute = false, bool requireRelative = false, string customErrorMessage = null)
        {
            this.requireAbsolute = requireAbsolute;
            this.requireRelative = requireRelative;
            this.customErrorMessage = customErrorMessage;
        }
        
        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (value == null || !(value is string path) || string.IsNullOrWhiteSpace(path))
            {
                // Let RequiredValidator handle empty values
                return ValidationResult.Success(fieldName);
            }
            
            // Check for invalid path characters
            char[] invalidChars = Path.GetInvalidPathChars();
            foreach (char c in invalidChars)
            {
                if (path.Contains(c))
                {
                    return ValidationResult.Error(
                        customErrorMessage ?? $"{fieldName}: Path contains invalid characters.",
                        fieldName
                    );
                }
            }
            
            // Check absolute vs relative requirements
            bool isAbsolute = Path.IsPathRooted(path);
            
            if (requireAbsolute && !isAbsolute)
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName}: Path must be absolute.",
                    fieldName
                );
            }
            
            if (requireRelative && isAbsolute)
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName}: Path must be relative.",
                    fieldName
                );
            }
            
            return ValidationResult.Success(fieldName);
        }
    }
}

