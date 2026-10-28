namespace Covyne.CADET.Editor.Validation
{
    /// <summary>
    /// Result of field validation
    /// </summary>
    public class ValidationResult
    {
        /// <summary>
        /// Whether the validation passed
        /// </summary>
        public bool IsValid { get; set; }
        
        /// <summary>
        /// Error message if validation failed (null if valid)
        /// </summary>
        public string ErrorMessage { get; set; }
        
        /// <summary>
        /// The field name being validated
        /// </summary>
        public string FieldName { get; set; }
        
        /// <summary>
        /// Severity level of the validation result
        /// </summary>
        public ValidationSeverity Severity { get; set; }
        
        /// <summary>
        /// Creates a successful validation result
        /// </summary>
        public static ValidationResult Success(string fieldName = null)
        {
            return new ValidationResult
            {
                IsValid = true,
                FieldName = fieldName,
                Severity = ValidationSeverity.None
            };
        }
        
        /// <summary>
        /// Creates a failed validation result with error message
        /// </summary>
        public static ValidationResult Error(string errorMessage, string fieldName = null, ValidationSeverity severity = ValidationSeverity.Error)
        {
            return new ValidationResult
            {
                IsValid = false,
                ErrorMessage = errorMessage,
                FieldName = fieldName,
                Severity = severity
            };
        }
    }
    
    /// <summary>
    /// Severity level for validation results
    /// </summary>
    public enum ValidationSeverity
    {
        None,
        Info,
        Warning,
        Error
    }
}

