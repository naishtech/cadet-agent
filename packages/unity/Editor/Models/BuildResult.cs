namespace Covyne.CADET.Editor.Models
{
    /// <summary>
    /// Result of a build script execution, containing output and success status
    /// </summary>
    public class BuildResult
    {
        public string Output { get; set; }
        public bool Success { get; set; }
        public int ExitCode { get; set; }
        public string ErrorMessage { get; set; }
        public bool DetachedOperationActive { get; set; }
        
        public BuildResult()
        {
            Output = "";
            Success = true;
            ExitCode = 0;
            ErrorMessage = "";
            DetachedOperationActive = false;
        }
        
        public BuildResult(string output, bool success, int exitCode, string errorMessage = "")
        {
            Output = output ?? "";
            Success = success;
            ExitCode = exitCode;
            ErrorMessage = errorMessage ?? "";
            DetachedOperationActive = false;
        }
    }
}

