namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// Result of credential validation
    /// </summary>
    public class ValidationResult
    {
        public ValidationResultType Type { get; set; }
        public string ErrorMessage { get; set; }
    }
}

