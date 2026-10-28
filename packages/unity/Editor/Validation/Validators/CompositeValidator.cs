using System.Collections.Generic;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation.Validators
{
    /// <summary>
    /// Combines multiple validators with AND/OR logic
    /// </summary>
    public class CompositeValidator : IValidator
    {
        private readonly List<IValidator> validators;
        private readonly bool useAndLogic; // true = AND (all must pass), false = OR (at least one must pass)
        
        public CompositeValidator(bool useAndLogic = true)
        {
            this.validators = new List<IValidator>();
            this.useAndLogic = useAndLogic;
        }
        
        public CompositeValidator Add(IValidator validator)
        {
            if (validator != null)
            {
                validators.Add(validator);
            }
            return this;
        }
        
        public ValidationResult Validate(object value, BuildProfile context, string fieldName)
        {
            if (validators.Count == 0)
            {
                return ValidationResult.Success(fieldName);
            }
            
            if (useAndLogic)
            {
                // All validators must pass
                foreach (var validator in validators)
                {
                    var result = validator.Validate(value, context, fieldName);
                    if (!result.IsValid)
                    {
                        return result;
                    }
                }
                return ValidationResult.Success(fieldName);
            }
            else
            {
                // At least one validator must pass
                var errors = new List<string>();
                bool hasSuccess = false;
                
                foreach (var validator in validators)
                {
                    var result = validator.Validate(value, context, fieldName);
                    if (result.IsValid)
                    {
                        hasSuccess = true;
                        break;
                    }
                    else
                    {
                        errors.Add(result.ErrorMessage);
                    }
                }
                
                if (hasSuccess)
                {
                    return ValidationResult.Success(fieldName);
                }
                else
                {
                    return ValidationResult.Error(
                        string.Join("; ", errors),
                        fieldName
                    );
                }
            }
        }
    }
}

