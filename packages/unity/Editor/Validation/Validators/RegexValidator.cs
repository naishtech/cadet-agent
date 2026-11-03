using System;
using System.Text.RegularExpressions;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Validates a field against a regex pattern
    /// </summary>
    public class RegexValidator : IValidator
    {
        private readonly string pattern;
        private readonly string customErrorMessage;
        private readonly RegexOptions options;
        
        public RegexValidator(string pattern, string customErrorMessage = null, RegexOptions options = RegexOptions.None)
        {
            this.pattern = pattern;
            this.customErrorMessage = customErrorMessage;
            this.options = options;
        }
        
        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (value == null || !(value is string str) || string.IsNullOrWhiteSpace(str))
            {
                // Let RequiredValidator handle empty values
                return ValidationResult.Success(fieldName);
            }
            
            try
            {
                if (!Regex.IsMatch(str, pattern, options))
                {
                    return ValidationResult.Error(
                        customErrorMessage ?? $"{fieldName}: Value does not match required pattern.",
                        fieldName
                    );
                }
            }
            catch (ArgumentException ex)
            {
                return ValidationResult.Error(
                    $"Invalid regex pattern: {ex.Message}",
                    fieldName
                );
            }
            
            return ValidationResult.Success(fieldName);
        }
    }
}

