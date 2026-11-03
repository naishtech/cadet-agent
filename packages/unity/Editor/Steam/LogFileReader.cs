using System;
using System.IO;
using System.Text;

namespace Covyne.CADET.Editor.Steam
{
    /// <summary>
    /// Handles incremental reading of a log file with position tracking
    /// </summary>
    public class LogFileReader
    {
        private readonly string filePath;
        private readonly StringBuilder accumulatedContent;
        private long lastPosition;
        
        public string Content => accumulatedContent.ToString();
        
        public LogFileReader(string filePath)
        {
            this.filePath = filePath;
            this.accumulatedContent = new StringBuilder();
            this.lastPosition = 0;
        }
        
        public void Clear()
        {
            try 
            { 
                // Use FileShare.ReadWrite to allow SteamCMD to continue writing while we clear
                // This prevents sharing violations
                if (File.Exists(filePath))
                {
                    using (var fs = new FileStream(filePath, FileMode.Truncate, FileAccess.Write, FileShare.ReadWrite))
                    {
                        // File is now truncated (cleared)
                    }
                }
            } 
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[LogFileReader] Could not clear log file: {ex.Message}");
                // If we can't clear it, just reset our position tracking
                // The file might be locked by SteamCMD, which is okay
            }
            
            accumulatedContent.Clear();
            lastPosition = 0;
        }
        
        /// <summary>
        /// Reads any new content appended to the file since last read.
        /// Returns true if new content was found.
        /// </summary>
        public bool ReadNewContent()
        {
            if (!File.Exists(filePath))
                return false;
            
            try
            {
                using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (fs.Length < lastPosition)
                    {
                        // File was truncated, reset
                        lastPosition = 0;
                        accumulatedContent.Clear();
                    }
                    
                    if (fs.Length <= lastPosition)
                        return false;
                    
                    fs.Seek(lastPosition, SeekOrigin.Begin);

                    using var reader = new StreamReader(fs, Encoding.UTF8, true, 1024, true);
                    string newContent = reader.ReadToEnd();
                    lastPosition = fs.Length;

                    if (string.IsNullOrEmpty(newContent))
                        return false;

                    // Remove BOM if present
                    if (newContent[0] == '\uFEFF')
                        newContent = newContent[1..];

                    accumulatedContent.Append(newContent);
                    return true;
                }
            }
            catch (IOException)
            {
                // File might be locked momentarily
                return false;
            }
        }
    }
}

