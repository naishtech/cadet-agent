using System;

namespace Covyne.CADET.Editor.Lite.Models
{
    /// <summary>
    /// CICD execution request for bash script execution.
    /// CADET FULL ONLY - excluded from Lite (Asset Store) package.
    /// </summary>
    [Serializable]
    public class CicdExecutionRequest
    {
        public string ScriptPath;
        public string Arguments;
        public string WorkingDirectory;
        public string ProfileJsonPath;
        public bool UseGitSyncFlag;
    }
}
