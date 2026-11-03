using System;
using System.IO;
using UnityEngine;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Helper class for getting platform-specific user directory paths for build tools.
    /// Build tools are installed to user directories to avoid git permission issues
    /// and keep the plugin repository clean.
    /// </summary>
    public static class BuildToolsPathHelper
    {
        private const string TOOLS_DIR_NAME = "CADET";
        private const string TOOLS_SUBDIR = "Tools";
        
        /// <summary>
        /// Gets the platform-specific user directory for CADET build tools.
        /// Windows: %APPDATA%/CADET/Tools/
        /// macOS: ~/Library/Application Support/CADET/Tools/
        /// Linux: ~/.local/bin/CADET/Tools/ (XDG-compliant)
        /// </summary>
        public static string GetBuildToolsDirectory()
        {
            string baseDir;
            #if UNITY_EDITOR_WIN
                baseDir = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            #elif UNITY_EDITOR_OSX
                baseDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Personal),
                    "Library", "Application Support"
                );
            #else
                // Linux: Use ~/.local/bin per XDG Base Directory Specification for user executables
                baseDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Personal),
                    ".local", "bin"
                );
            #endif
            
            return Path.Combine(baseDir, TOOLS_DIR_NAME, TOOLS_SUBDIR);
        }
        
        /// <summary>
        /// Gets the path to the BuildPatchTool directory
        /// </summary>
        public static string GetBuildPatchToolPath()
        {
            return Path.Combine(GetBuildToolsDirectory(), "BuildPatchTool");
        }
        
        /// <summary>
        /// Gets the path to the SteamCMD directory
        /// </summary>
        public static string GetSteamCmdPath()
        {
            return Path.Combine(GetBuildToolsDirectory(), "steamcmd");
        }
        
        /// <summary>
        /// Gets the path to the Cosmos binaries directory
        /// </summary>
        public static string GetCosmosBinariesPath()
        {
            return Path.Combine(GetBuildToolsDirectory(), "cosmos-4.0.2~");
        }
        
        /// <summary>
        /// Ensures the build tools directory exists, creating it if necessary
        /// </summary>
        public static void EnsureBuildToolsDirectoryExists()
        {
            string toolsDir = GetBuildToolsDirectory();
            if (!Directory.Exists(toolsDir))
            {
                try
                {
                    Directory.CreateDirectory(toolsDir);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[CADET] Failed to create build tools directory: {ex.Message}");
                }
            }
        }
    }
}
