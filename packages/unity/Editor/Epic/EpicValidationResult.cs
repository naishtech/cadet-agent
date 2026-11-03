namespace Covyne.CADET.Editor.Epic
{
    /// <summary>
    /// Result of Epic credential validation
    /// </summary>
    public class EpicValidationResult
    {
        public EpicValidationResultType Type { get; set; }
        public string ErrorMessage { get; set; }
    }
}

