using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Validates that a field is required (non-null, non-empty)
    /// </summary>
    public class RequiredValidator : IValidator
    {
        private readonly string customErrorMessage;
        
        public RequiredValidator(string customErrorMessage = null)
        {
            this.customErrorMessage = customErrorMessage;
        }
        
        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (value == null)
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName} is required.",
                    fieldName
                );
            }
            
            if (value is string str && string.IsNullOrWhiteSpace(str))
            {
                return ValidationResult.Error(
                    customErrorMessage ?? $"{fieldName} is required.",
                    fieldName
                );
            }
            
            return ValidationResult.Success(fieldName);
        }
    }
}

