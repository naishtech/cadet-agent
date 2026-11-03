using System;
using System.IO;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Validates that two configured paths are separate and not nested inside one another.
    /// </summary>
    public sealed class DistinctPathValidator : IValidator
    {
        private readonly Func<BuildProfile, string> _otherPathSelector;
        private readonly string _errorMessage;

        public DistinctPathValidator(Func<BuildProfile, string> otherPathSelector, string errorMessage)
        {
            _otherPathSelector = otherPathSelector ?? throw new ArgumentNullException(nameof(otherPathSelector));
            _errorMessage = string.IsNullOrWhiteSpace(errorMessage)
                ? "Configured paths must be different."
                : errorMessage;
        }

        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (value is not string currentPath || string.IsNullOrWhiteSpace(currentPath) || context == null)
            {
                return ValidationResult.Success(fieldName);
            }

            string otherPath = _otherPathSelector(context);
            if (string.IsNullOrWhiteSpace(otherPath))
            {
                return ValidationResult.Success(fieldName);
            }

            string normalizedCurrent = NormalizePath(currentPath);
            string normalizedOther = NormalizePath(otherPath);

            if (string.Equals(normalizedCurrent, normalizedOther, StringComparison.OrdinalIgnoreCase) ||
                normalizedCurrent.StartsWith(normalizedOther + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                normalizedOther.StartsWith(normalizedCurrent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                return ValidationResult.Error(_errorMessage, fieldName);
            }

            return ValidationResult.Success(fieldName);
        }

        private static string NormalizePath(string path)
        {
            return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
    }
}