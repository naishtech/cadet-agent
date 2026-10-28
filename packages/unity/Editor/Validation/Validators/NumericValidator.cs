using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Validates that a field contains a numeric value
    /// </summary>
    public class NumericValidator : IValidator
    {
        private readonly bool allowNegative;
        private readonly string customErrorMessage;
        
        public NumericValidator(bool allowNegative = true, string customErrorMessage = null)
        {
            this.allowNegative = allowNegative;
            this.customErrorMessage = customErrorMessage;
        }
        
        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (value == null || !(value is string str) || string.IsNullOrWhiteSpace(str))
            {
                // Let RequiredValidator handle empty values
                return ValidationResult.Success(fieldName);
            }
            
            if (!long.TryParse(str, out long numericValue))
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName}: Must be a numeric value.",
                    fieldName
                );
            }
            
            if (!allowNegative && numericValue < 0)
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName}: Must be a positive number.",
                    fieldName
                );
            }
            
            return ValidationResult.Success(fieldName);
        }
    }
}

