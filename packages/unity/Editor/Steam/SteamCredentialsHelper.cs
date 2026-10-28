using System;
using System.IO;
using UnityEngine;

namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// Helper class for reading and writing Steam credentials to ~/.env_cadet_steam_credentials
    /// </summary>
    public static class SteamCredentialsHelper
    {
        private const string CREDENTIALS_FILE_NAME = ".env_cadet_steam_credentials";
        
        /// <summary>
        /// Gets the full path to the credentials file in the user's home directory
        /// </summary>
        public static string GetCredentialsFilePath()
        {
            // #region agent log
            try {
                string logPath = Path.Combine(Path.GetDirectoryName(Application.dataPath), ".cursor", "debug.log");
                string homeDir1 = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string homeDir2 = Environment.GetEnvironmentVariable("HOME");
                string combinedPath = Path.Combine(homeDir1, CREDENTIALS_FILE_NAME);
                string json = "{\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"A\",\"location\":\"SteamCredentialsHelper.cs:19\",\"message\":\"GetCredentialsFilePath entry\",\"data\":{\"homeDir_SpecialFolder\":\"" + (homeDir1 ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"homeDir_ENV_HOME\":\"" + (homeDir2 ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"combinedPath\":\"" + (combinedPath ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"platform\":\"" + Application.platform.ToString() + "\"},\"timestamp\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "}\n";
                File.AppendAllText(logPath, json);
            } catch {}
            // #endregion
            string homeDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(homeDir, CREDENTIALS_FILE_NAME);
        }
        
        /// <summary>
        /// Checks if credentials file exists
        /// </summary>
        public static bool CredentialsFileExists()
        {
            // #region agent log
            try {
                string logPath = Path.Combine(Path.GetDirectoryName(Application.dataPath), ".cursor", "debug.log");
                string filePath = GetCredentialsFilePath();
                bool exists = File.Exists(filePath);
                string homeEnvVar = Environment.GetEnvironmentVariable("HOME");
                string homeSpecialFolder = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                bool tryHomeEnvExists = !string.IsNullOrEmpty(homeEnvVar) ? File.Exists(Path.Combine(homeEnvVar, CREDENTIALS_FILE_NAME)) : false;
                string[] homeDirFiles = new string[0];
                bool homeDirAccessible = false;
                try {
                    if (Directory.Exists(homeSpecialFolder)) {
                        homeDirAccessible = true;
                        homeDirFiles = Directory.GetFiles(homeSpecialFolder, ".*");
                    }
                } catch {}
                string json = "{\"sessionId\":\"debug-session\",\"runId\":\"run1\",\"hypothesisId\":\"B\",\"location\":\"SteamCredentialsHelper.cs:35\",\"message\":\"CredentialsFileExists check\",\"data\":{\"filePath\":\"" + (filePath ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"exists\":" + exists.ToString().ToLower() + ",\"homeEnvVar\":\"" + (homeEnvVar ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"homeSpecialFolder\":\"" + (homeSpecialFolder ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\",\"tryHomeEnvExists\":" + tryHomeEnvExists.ToString().ToLower() + ",\"homeDirAccessible\":" + homeDirAccessible.ToString().ToLower() + ",\"homeDirFilesCount\":" + homeDirFiles.Length + ",\"platform\":\"" + Application.platform.ToString() + "\"},\"timestamp\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "}\n";
                File.AppendAllText(logPath, json);
            } catch {}
            // #endregion
            return File.Exists(GetCredentialsFilePath());
        }
        
        /// <summary>
        /// Reads credentials from the file
        /// </summary>
        public static SteamCredentials ReadCredentials()
        {
            string filePath = GetCredentialsFilePath();
            
            if (!File.Exists(filePath))
            {
                return new SteamCredentials();
            }
            
            try
            {
                string[] lines = File.ReadAllLines(filePath);
                var credentials = new SteamCredentials();
                
                foreach (string line in lines)
                {
                    string trimmedLine = line.Trim();
                    if (string.IsNullOrEmpty(trimmedLine) || trimmedLine.StartsWith("#"))
                        continue;
                    
                    // Parse KEY=VALUE format
                    int equalsIndex = trimmedLine.IndexOf('=');
                    if (equalsIndex > 0)
                    {
                        string key = trimmedLine.Substring(0, equalsIndex).Trim();
                        string value = trimmedLine.Substring(equalsIndex + 1).Trim();
                        
                        // Remove quotes if present
                        if (value.StartsWith("\"") && value.EndsWith("\""))
                        {
                            value = value.Substring(1, value.Length - 2);
                        }
                        
                        switch (key.ToUpper())
                        {
                            case "STEAM_USERNAME":
                                credentials.Username = value;
                                break;
                            case "STEAM_PASSWORD":
                                credentials.Password = value;
                                break;
                            case "STEAM_GUARD_CODE":
                                credentials.GuardCode = value;
                                break;
                        }
                    }
                }
                
                return credentials;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CADET] Failed to read Steam credentials: {ex.Message}");
                return new SteamCredentials();
            }
        }
        
        /// <summary>
        /// Writes credentials to the file
        /// </summary>
        public static bool WriteCredentials(SteamCredentials credentials)
        {
            if (credentials == null)
            {
                Debug.LogError("[CADET] Cannot write null credentials");
                return false;
            }
            
            string filePath = GetCredentialsFilePath();
            
            try
            {
                var lines = new System.Collections.Generic.List<string>();
                lines.Add("# CADET Steam Credentials");
                lines.Add("# This file is automatically generated. Do not edit manually.");
                lines.Add("");
                
                if (!string.IsNullOrEmpty(credentials.Username))
                {
                    lines.Add($"STEAM_USERNAME={credentials.Username}");
                }
                
                if (!string.IsNullOrEmpty(credentials.Password))
                {
                    lines.Add($"STEAM_PASSWORD={credentials.Password}");
                }
                
                if (!string.IsNullOrEmpty(credentials.GuardCode))
                {
                    lines.Add($"STEAM_GUARD_CODE={credentials.GuardCode}");
                }
                
                // Write file with Unix line endings (LF only) to avoid bash warnings when sourcing
                File.WriteAllText(filePath, string.Join("\n", lines) + "\n");
                
                // Set file permissions to user-only (600 on Unix)
                // On Windows, this is handled by the file system
                #if UNITY_EDITOR_WIN
                // Windows doesn't need explicit permission setting
                #else
                try
                {
                    System.Diagnostics.Process.Start("chmod", $"600 \"{filePath}\"");
                }
                catch
                {
                    // Ignore if chmod fails
                }
                #endif
                
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CADET] Failed to write Steam credentials: {ex.Message}");
                return false;
            }
        }
        
        /// <summary>
        /// Deletes the credentials file
        /// </summary>
        public static bool DeleteCredentials()
        {
            string filePath = GetCredentialsFilePath();
            
            if (!File.Exists(filePath))
            {
                return true; // Already deleted
            }
            
            try
            {
                File.Delete(filePath);
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CADET] Failed to delete Steam credentials: {ex.Message}");
                return false;
            }
        }
    }
}

