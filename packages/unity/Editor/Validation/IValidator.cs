using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Validation
{
    /// <summary>
    /// Interface for field validators following standard validator patterns
    /// </summary>
    public interface IValidator
    {
        /// <summary>
        /// Validates a field value within the context of a BuildProfile
        /// </summary>
        /// <param name="value">The value to validate</param>
        /// <param name="context">The BuildProfile context (for conditional validation)</param>
        /// <param name="fieldName">The name of the field being validated (for error messages)</param>
        /// <returns>ValidationResult indicating success or failure with error message</returns>
        ValidationResult Validate(object value, BuildProfile context, string fieldName);
    }
}

