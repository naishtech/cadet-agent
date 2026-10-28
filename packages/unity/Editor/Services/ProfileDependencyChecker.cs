using System.IO;
using UnityEditor;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Utility class for checking if required publishing dependencies are installed for a build profile
    /// </summary>
    public static class ProfileDependencyChecker
    {
        /// <summary>
        /// Checks if all required dependencies for publishing are installed for the given profile
        /// </summary>
        /// <param name="profile">The build profile to check</param>
        /// <returns>True if all required dependencies are installed, false otherwise</returns>
        public static bool CheckProfileDependencies(BuildProfile profile)
        {
            if (profile == null)
            {
                return false;
            }

            string unityProjectPath = Path.GetDirectoryName(UnityEngine.Application.dataPath);
            
            // Check SteamCMD dependencies if platform is Steam or both
            if (profile.platform == "steam" || profile.platform == "both")
            {
                // Check SteamCMD Windows if OS is Windows or both
                if (profile.os == "windows" || profile.os == "both")
                {
                    // First check if steamcmdExe is configured in profile
                    bool steamcmdExeConfigured = !string.IsNullOrEmpty(profile.steam?.steamcmdExe);

                    // If not in profile, check EditorPrefs
                    if (!steamcmdExeConfigured)
                    {
                        string steamcmdExeFromPrefs = EditorPrefs.GetString("CADET_SteamCmdExe", "");
                        steamcmdExeConfigured = !string.IsNullOrEmpty(steamcmdExeFromPrefs) && File.Exists(steamcmdExeFromPrefs);
                    }

                    // If still not configured, check user directory
                    if (!steamcmdExeConfigured)
                    {
                        string steamcmdExePath = Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.exe");
                        steamcmdExeConfigured = File.Exists(steamcmdExePath);
                    }

                    if (!steamcmdExeConfigured)
                    {
                        return false;
                    }
                }

                // Check SteamCMD macOS if OS is mac or both
                if (profile.os == "mac" || profile.os == "macos" || profile.os == "both")
                {
                    // First check if steamcmdSh is configured in profile
                    bool steamcmdShConfigured = !string.IsNullOrEmpty(profile.steam?.steamcmdSh);

                    // If not in profile, check EditorPrefs
                    if (!steamcmdShConfigured)
                    {
                        string steamcmdShFromPrefs = EditorPrefs.GetString("CADET_SteamCmdSh", "");
                        steamcmdShConfigured = !string.IsNullOrEmpty(steamcmdShFromPrefs) && File.Exists(steamcmdShFromPrefs);
                    }

                    // If still not configured, check user directory
                    if (!steamcmdShConfigured)
                    {
                        string steamcmdShPath = Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.sh");
                        steamcmdShConfigured = File.Exists(steamcmdShPath);
                    }

                    if (!steamcmdShConfigured)
                    {
                        return false;
                    }
                }
            }
            
            // Check BuildPatchTool if platform is Epic or both
            if (profile.platform == "epic" || profile.platform == "both")
            {
                // First check if buildPatchToolPath is configured in profile
                bool buildPatchToolConfigured = !string.IsNullOrEmpty(profile.epic?.buildPatchToolPath);

                // If not in profile, check EditorPrefs
                if (!buildPatchToolConfigured)
                {
                    string buildPatchToolFromPrefs = EditorPrefs.GetString("CADET_BuildPatchToolPath", "");
                    if (!string.IsNullOrEmpty(buildPatchToolFromPrefs))
                    {
                        // Determine OS-specific binary path based on profile OS setting
                        string osBinaryPath;
                        string profileOS = profile.os?.ToLower() ?? "";

                        // When os is "both", default to Windows binary (can be overridden per build if needed)
                        if (profileOS == "windows" || profileOS == "both")
                        {
                            // For Windows, use Win64 binary
                            osBinaryPath = Path.Combine(buildPatchToolFromPrefs, "Engine", "Binaries", "Win64", "BuildPatchTool.exe");
                        }
                        else if (profileOS == "mac" || profileOS == "macos")
                        {
                            // For Mac, use Mac binary
                            osBinaryPath = Path.Combine(buildPatchToolFromPrefs, "Engine", "Binaries", "Mac", "BuildPatchTool");
                        }
                        else
                        {
                            // Default to Linux for other OS values
                            osBinaryPath = Path.Combine(buildPatchToolFromPrefs, "Engine", "Binaries", "Linux", "BuildPatchTool");
                        }

                        buildPatchToolConfigured = File.Exists(osBinaryPath);
                    }
                }

                // If still not configured, check user directory
                if (!buildPatchToolConfigured)
                {
                    string bptPath = BuildToolsPathHelper.GetBuildPatchToolPath();
                    if (Directory.Exists(bptPath))
                    {
                        // Check for BuildPatchTool.exe in subdirectories (Windows)
                        string[] exeFiles = Directory.GetFiles(bptPath, "BuildPatchTool.exe", SearchOption.AllDirectories);
                        if (exeFiles.Length > 0)
                        {
                            buildPatchToolConfigured = true;
                        }
                        else
                        {
                            // Also check for Mac/Linux binary
                            string[] macBinaries = Directory.GetFiles(bptPath, "BuildPatchTool", SearchOption.AllDirectories);
                            buildPatchToolConfigured = macBinaries.Length > 0;
                        }
                    }
                }

                if (!buildPatchToolConfigured)
                {
                    return false;
                }
            }
            
            return true;
        }
    }
}
