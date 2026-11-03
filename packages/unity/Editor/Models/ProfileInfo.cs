namespace Covyne.CADET.Editor.Models
{
    /// <summary>
    /// Display-only information derived from BuildProfile for UI presentation
    /// </summary>
    public class ProfileInfo
    {
        public string platform;
        public string os;
        public string projectName;
        public string buildOutputPath;
        
        public ProfileInfo()
        {
            platform = "";
            os = "";
            projectName = "";
            buildOutputPath = "";
        }
        
        public ProfileInfo(BuildProfile profile)
        {
            if (profile != null)
            {
                platform = profile.platform ?? "";
                os = profile.os ?? "";
                projectName = profile.unity?.projectName ?? "";
                buildOutputPath = profile.unity?.buildOutputPath ?? "";
            }
            else
            {
                platform = "";
                os = "";
                projectName = "";
                buildOutputPath = "";
            }
        }
        
        public string GetPlatformDisplayName()
        {
            if (string.IsNullOrEmpty(platform))
                return "Unknown";
            
            string platformName = platform.Substring(0, 1).ToUpper() + platform.Substring(1);
            string osName = string.IsNullOrEmpty(os) ? "" : $" ({os.Substring(0, 1).ToUpper() + os.Substring(1)})";
            return platformName + osName;
        }
    }
}

