using System;
using System.IO;
using Covyne.CADET.Editor.Mac;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.Utilities;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// Encapsulates platform/tool/credential availability checks for build actions.
    /// </summary>
    public class PlatformAvailabilityViewModel
    {
        public struct PlatformAvailabilityState
        {
            public bool SteamToolsConfigured;
            public bool SteamCredentialsConfigured;
            public bool EpicToolsConfigured;
            public bool EpicCredentialsConfigured;
            public bool SteamPlatformSelected;
            public bool EpicPlatformSelected;
            public bool CosmosBinariesConfigured;
            public bool MacCredentialsMissing;
            public bool WindowsBuildExists;
            public bool MacosBuildExists;
            public string MissingBuildsMessage;
            public bool AllRequiredBuildsExist;
        }

        public PlatformAvailabilityState Evaluate(BuildProfile profile)
        {
            var state = new PlatformAvailabilityState
            {
                SteamToolsConfigured = false,
                SteamCredentialsConfigured = false,
                EpicToolsConfigured = false,
                EpicCredentialsConfigured = false,
                SteamPlatformSelected = false,
                EpicPlatformSelected = false,
                CosmosBinariesConfigured = CheckCosmosBinariesConfigured(),
                MacCredentialsMissing = false,
                WindowsBuildExists = false,
                MacosBuildExists = false,
                MissingBuildsMessage = string.Empty,
                AllRequiredBuildsExist = false
            };

            if (profile == null)
            {
                return state;
            }

            string platform = profile.platform?.ToLower() ?? string.Empty;
            state.SteamPlatformSelected = platform == "steam" || platform == "both";
            state.EpicPlatformSelected = platform == "epic" || platform == "both";

            state.SteamCredentialsConfigured = CheckSteamCredentialsConfigured();
            state.EpicCredentialsConfigured = CheckEpicCredentialsConfigured();
            state.SteamToolsConfigured = CheckSteamCMDToolsConfigured(profile);
            state.EpicToolsConfigured = CheckEpicBuildPatchToolConfigured(profile);
            state.MacCredentialsMissing = CheckMacCredentialsRequirement(profile);

            (bool windowsExists, bool macosExists) = BuildExistenceChecker.CheckBuildsExist(profile);
            state.WindowsBuildExists = windowsExists;
            state.MacosBuildExists = macosExists;
            state.MissingBuildsMessage = BuildExistenceChecker.GetMissingBuildsMessage(profile, windowsExists, macosExists);
            state.AllRequiredBuildsExist = BuildExistenceChecker.AllRequiredBuildsExist(profile, windowsExists, macosExists);

            return state;
        }

        private bool CheckMacCredentialsRequirement(BuildProfile profile)
        {
            if (profile == null)
            {
                return false;
            }

            bool notarizationEnabled = profile.macos != null && profile.macos.enableSigning;
            bool macOsSelected = profile.os == "mac" || profile.os == "both";
            if (notarizationEnabled && macOsSelected)
            {
                return !MacCredentialsHelper.CredentialsFileExists();
            }

            return false;
        }

        private bool CheckSteamCMDToolsConfigured(BuildProfile profile)
        {
            if (profile == null || (profile.platform != "steam" && profile.platform != "both"))
            {
                return false;
            }

            if (profile.os == "windows" || profile.os == "both")
            {
                bool steamcmdExeConfigured = !string.IsNullOrEmpty(profile.steam?.steamcmdExe);
                if (!steamcmdExeConfigured)
                {
                    string steamcmdExeFromPrefs = EditorPrefs.GetString("CADET_SteamCmdExe", "");
                    steamcmdExeConfigured = !string.IsNullOrEmpty(steamcmdExeFromPrefs) && File.Exists(steamcmdExeFromPrefs);
                }

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

            if (profile.os == "mac" || profile.os == "macos" || profile.os == "both")
            {
                bool steamcmdShConfigured = !string.IsNullOrEmpty(profile.steam?.steamcmdSh);
                if (!steamcmdShConfigured)
                {
                    string steamcmdShFromPrefs = EditorPrefs.GetString("CADET_SteamCmdSh", "");
                    steamcmdShConfigured = !string.IsNullOrEmpty(steamcmdShFromPrefs) && File.Exists(steamcmdShFromPrefs);
                }

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

            return true;
        }

        private bool CheckEpicBuildPatchToolConfigured(BuildProfile profile)
        {
            if (profile == null || (profile.platform != "epic" && profile.platform != "both"))
            {
                return false;
            }

            bool buildPatchToolConfigured = false;
            if (!string.IsNullOrEmpty(profile.epic?.buildPatchToolPath))
            {
                string profilePath = profile.epic.buildPatchToolPath;
                string windowsPath = profilePath.Replace('/', Path.DirectorySeparatorChar);

                if (Directory.Exists(windowsPath) || File.Exists(windowsPath))
                {
                    if (Directory.Exists(windowsPath))
                    {
                        string profileOS = profile.os?.ToLower() ?? string.Empty;
                        string osBinaryPath;
                        if (profileOS == "windows" || profileOS == "both")
                        {
                            osBinaryPath = Path.Combine(windowsPath, "Engine", "Binaries", "Win64", "BuildPatchTool.exe");
                        }
                        else if (profileOS == "mac" || profileOS == "macos")
                        {
                            osBinaryPath = Path.Combine(windowsPath, "Engine", "Binaries", "Mac", "BuildPatchTool");
                        }
                        else
                        {
                            osBinaryPath = Path.Combine(windowsPath, "Engine", "Binaries", "Linux", "BuildPatchTool");
                        }

                        buildPatchToolConfigured = File.Exists(osBinaryPath);
                    }
                    else
                    {
                        buildPatchToolConfigured = File.Exists(windowsPath);
                    }
                }
            }

            if (!buildPatchToolConfigured)
            {
                string buildPatchToolFromPrefs = EditorPrefs.GetString("CADET_BuildPatchToolPath", "");
                if (!string.IsNullOrEmpty(buildPatchToolFromPrefs))
                {
                    string osBinaryPath;
                    string profileOS = profile.os?.ToLower() ?? string.Empty;
                    if (profileOS == "windows" || profileOS == "both")
                    {
                        osBinaryPath = Path.Combine(buildPatchToolFromPrefs, "Engine", "Binaries", "Win64", "BuildPatchTool.exe");
                    }
                    else if (profileOS == "mac" || profileOS == "macos")
                    {
                        osBinaryPath = Path.Combine(buildPatchToolFromPrefs, "Engine", "Binaries", "Mac", "BuildPatchTool");
                    }
                    else
                    {
                        osBinaryPath = Path.Combine(buildPatchToolFromPrefs, "Engine", "Binaries", "Linux", "BuildPatchTool");
                    }

                    buildPatchToolConfigured = File.Exists(osBinaryPath);
                }
            }

            if (!buildPatchToolConfigured)
            {
                string bptPath = BuildToolsPathHelper.GetBuildPatchToolPath();
                if (Directory.Exists(bptPath))
                {
                    if (Application.platform == RuntimePlatform.WindowsEditor)
                    {
                        string[] exeFiles = Directory.GetFiles(bptPath, "BuildPatchTool.exe", SearchOption.AllDirectories);
                        buildPatchToolConfigured = exeFiles.Length > 0;
                    }
                    else
                    {
                        string[] binaryFiles = Directory.GetFiles(bptPath, "BuildPatchTool", SearchOption.AllDirectories);
                        buildPatchToolConfigured = binaryFiles.Length > 0;
                    }
                }
            }

            return buildPatchToolConfigured;
        }

        private bool CheckCosmosBinariesConfigured()
        {
            if (Application.platform != RuntimePlatform.WindowsEditor)
            {
                return true;
            }

            string cosmosBinDir = Path.Combine(BuildToolsPathHelper.GetCosmosBinariesPath(), "bin");
            string bashPath = Path.Combine(cosmosBinDir, "bash");
            return File.Exists(bashPath);
        }

        private bool CheckSteamCredentialsConfigured()
        {
            Type helperType = Type.GetType("Covyne.CADET.Editor.Steam.SteamCredentialsHelper, Covyne.CADET.Editor");
            if (helperType == null)
            {
                return false;
            }

            var method = helperType.GetMethod("CredentialsFileExists", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (method == null)
            {
                return false;
            }

            object result = method.Invoke(null, null);
            return result is bool configured && configured;
        }

        private bool CheckEpicCredentialsConfigured()
        {
            Type helperType = Type.GetType("Covyne.CADET.Editor.Epic.EpicCredentialsHelper, Covyne.CADET.Editor");
            if (helperType == null)
            {
                return false;
            }

            var method = helperType.GetMethod("CredentialsFileExists", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (method == null)
            {
                return false;
            }

            object result = method.Invoke(null, null);
            return result is bool configured && configured;
        }
    }
}
