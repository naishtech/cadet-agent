namespace Covyne.CADET.Editor.Validation
{
    /// <summary>
    /// Tracks validation state for a single field
    /// </summary>
    public class FieldValidationState
    {
        /// <summary>
        /// The field identifier (e.g., "unity.editorPath")
        /// </summary>
        public string FieldName { get; set; }
        
        /// <summary>
        /// The last validated value
        /// </summary>
        public object LastValue { get; set; }
        
        /// <summary>
        /// The current validation result
        /// </summary>
        public ValidationResult ValidationResult { get; set; }
        
        /// <summary>
        /// Whether the field has been modified since last validation
        /// </summary>
        public bool IsDirty { get; set; }
        
        /// <summary>
        /// Whether the field has been validated at least once
        /// </summary>
        public bool HasBeenValidated { get; set; }
        
        public FieldValidationState(string fieldName)
        {
            FieldName = fieldName;
            ValidationResult = ValidationResult.Success(fieldName);
            IsDirty = false;
            HasBeenValidated = false;
        }
    }
}

