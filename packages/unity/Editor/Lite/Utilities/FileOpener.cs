using System;
using System.Diagnostics;
using System.IO;
using UnityEngine;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Utility for opening files with the system's default editor
    /// </summary>
    public static class FileOpener
    {
        /// <summary>
        /// Opens a file with the system's default editor
        /// </summary>
        /// <param name="filePath">Path to the file to open</param>
        /// <returns>True if the file was opened successfully, false otherwise</returns>
        public static bool OpenWithDefaultEditor(string filePath)
        {
            UnityEngine.Debug.Log($"[C.A.D.E.T] OpenWithDefaultEditor attempting to open log: {filePath}");
            
            if (string.IsNullOrEmpty(filePath))
            {
                UnityEngine.Debug.LogWarning("[C.A.D.E.T] File path is null or empty");
                return false;
            }

            if (!File.Exists(filePath))
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] File does not exist: {filePath}");
                return false;
            }

            try
            {
                bool isWindows = Application.platform == RuntimePlatform.WindowsEditor;
                ProcessStartInfo psi;

                if (isWindows)
                {
                    // Windows: Use cmd.exe with start command
                    // The empty quotes after start are required for proper path handling
                    string escapedPath = filePath.Replace("\"", "\"\"");
                    psi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = $"/c start \"\" \"{escapedPath}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                }
                else
                {
                    // macOS/Linux: Use 'open' command (macOS) or 'xdg-open' (Linux)
                    if (Application.platform == RuntimePlatform.OSXEditor)
                    {
                        // macOS: Use 'open' command
                        string escapedPath = filePath.Replace("\"", "\\\"");
                        psi = new ProcessStartInfo
                        {
                            FileName = "/usr/bin/open",
                            Arguments = $"\"{escapedPath}\"",
                            UseShellExecute = false,
                            CreateNoWindow = true
                        };
                    }
                    else
                    {
                        // Linux: Use 'xdg-open' command
                        string escapedPath = filePath.Replace("\"", "\\\"");
                        psi = new ProcessStartInfo
                        {
                            FileName = "/usr/bin/xdg-open",
                            Arguments = $"\"{escapedPath}\"",
                            UseShellExecute = false,
                            CreateNoWindow = true
                        };
                    }
                }

                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogError($"[C.A.D.E.T] Failed to open file with default editor: {ex.Message}");
                return false;
            }
        }
    }
}

