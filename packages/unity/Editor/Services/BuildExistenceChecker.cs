using System.IO;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Service to check if Unity builds exist in the output directory
    /// </summary>
    public static class BuildExistenceChecker
    {
        /// <summary>
        /// Checks if Unity builds exist for the configured operating systems
        /// </summary>
        /// <param name="profile">The build profile to check</param>
        /// <returns>Tuple indicating if Windows and macOS builds exist</returns>
        public static (bool windowsExists, bool macosExists) CheckBuildsExist(BuildProfile profile)
        {
            if (profile == null || profile.unity == null)
                return (false, false);
            
            string buildOutputPath = profile.unity.buildOutputPath;
            string projectName = profile.unity.projectName;
            
            if (string.IsNullOrEmpty(buildOutputPath) || string.IsNullOrEmpty(projectName))
                return (false, false);
            
            // Normalize path separators
            buildOutputPath = buildOutputPath.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
            
            bool windowsExists = CheckWindowsBuildExists(buildOutputPath, projectName);
            bool macosExists = CheckMacosBuildExists(buildOutputPath, projectName);
            
            return (windowsExists, macosExists);
        }
        
        /// <summary>
        /// Checks if a Windows build exists
        /// </summary>
        private static bool CheckWindowsBuildExists(string buildOutputPath, string projectName)
        {
            // Support both output layouts:
            // 1) <buildOutputPath>/Bin/windows/{projectName}.exe
            // 2) <buildOutputPath>/windows/{projectName}.exe
            string[] windowsPaths =
            {
                Path.Combine(buildOutputPath, "Bin", "windows"),
                Path.Combine(buildOutputPath, "windows")
            };

            foreach (string windowsPath in windowsPaths)
            {
                if (!Directory.Exists(windowsPath))
                    continue;

                string exePath = Path.Combine(windowsPath, $"{projectName}.exe");
                if (File.Exists(exePath))
                    return true;
            }

            return false;
        }
        
        /// <summary>
        /// Checks if a macOS build exists
        /// </summary>
        private static bool CheckMacosBuildExists(string buildOutputPath, string projectName)
        {
            // Support both output layouts:
            // 1) <buildOutputPath>/Bin/macos/{projectName}.app
            // 2) <buildOutputPath>/macos/{projectName}.app
            string[] macosPaths =
            {
                Path.Combine(buildOutputPath, "Bin", "macos"),
                Path.Combine(buildOutputPath, "macos")
            };

            foreach (string macosPath in macosPaths)
            {
                if (!Directory.Exists(macosPath))
                    continue;

                // Look for {projectName}.app (it's a directory on macOS)
                string appPath = Path.Combine(macosPath, $"{projectName}.app");
                if (Directory.Exists(appPath))
                    return true;
            }

            return false;
        }
        
        /// <summary>
        /// Gets a localized message describing which builds are missing based on the profile's OS configuration
        /// </summary>
        /// <param name="profile">The build profile</param>
        /// <param name="windowsExists">Whether Windows build exists</param>
        /// <param name="macosExists">Whether macOS build exists</param>
        /// <returns>Localized message or empty string if all required builds exist</returns>
        public static string GetMissingBuildsMessage(BuildProfile profile, bool windowsExists, bool macosExists)
        {
            if (profile == null)
                return string.Empty;
            
            string os = profile.os?.ToLower() ?? "windows";
            
            bool needsWindows = os == "windows" || os == "both";
            bool needsMacos = os == "mac" || os == "macos" || os == "both";
            
            bool windowsMissing = needsWindows && !windowsExists;
            bool macosMissing = needsMacos && !macosExists;
            
            if (windowsMissing && macosMissing)
            {
                return CadetLocalization.GetString("Window.Cadet.Messages.BuildNotFound.Both");
            }
            else if (windowsMissing)
            {
                return CadetLocalization.GetString("Window.Cadet.Messages.BuildNotFound.Windows");
            }
            else if (macosMissing)
            {
                return CadetLocalization.GetString("Window.Cadet.Messages.BuildNotFound.MacOS");
            }
            
            return string.Empty;
        }
        
        /// <summary>
        /// Checks if all required builds exist for the profile's configured OS
        /// </summary>
        /// <param name="profile">The build profile</param>
        /// <param name="windowsExists">Whether Windows build exists</param>
        /// <param name="macosExists">Whether macOS build exists</param>
        /// <returns>True if all required builds exist</returns>
        public static bool AllRequiredBuildsExist(BuildProfile profile, bool windowsExists, bool macosExists)
        {
            if (profile == null)
                return false;
            
            string os = profile.os?.ToLower() ?? "windows";
            
            bool needsWindows = os == "windows" || os == "both";
            bool needsMacos = os == "mac" || os == "macos" || os == "both";
            
            if (needsWindows && !windowsExists)
                return false;
            
            if (needsMacos && !macosExists)
                return false;
            
            return true;
        }
    }
}

