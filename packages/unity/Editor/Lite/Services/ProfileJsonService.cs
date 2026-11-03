using System;
using System.IO;
using UnityEngine;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Service for serializing BuildProfile to JSON and managing temporary JSON files
    /// </summary>
    public class ProfileJsonService
    {
        /// <summary>
        /// Serializes a BuildProfile to JSON string
        /// </summary>
        public static string SerializeToJson(BuildProfile profile)
        {
            if (profile == null)
            {
                throw new ArgumentNullException(nameof(profile));
            }
            
            return JsonUtility.ToJson(profile, prettyPrint: true);
        }
        
        /// <summary>
        /// Creates a temporary JSON file from a BuildProfile
        /// </summary>
        /// <returns>Path to the temporary JSON file</returns>
        public static string CreateTemporaryJsonFile(BuildProfile profile)
        {
            if (profile == null)
            {
                throw new ArgumentNullException(nameof(profile));
            }
            
            // Create temp directory if it doesn't exist
            string tempDir = Path.Combine(Application.temporaryCachePath, "CADET");
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }
            
            // Create temporary file with GUID as filename
            string guid = Guid.NewGuid().ToString();
            string tempFilePath = Path.Combine(tempDir, $"{guid}.json");
            
            // Serialize and write to file
            string json = SerializeToJson(profile);
            File.WriteAllText(tempFilePath, json);
            
            return tempFilePath;
        }
        
        /// <summary>
        /// Sanitizes a string to be a valid filename
        /// </summary>
        private static string SanitizeFileName(string fileName)
        {
            if (string.IsNullOrEmpty(fileName))
                return "profile";
            
            char[] invalidChars = Path.GetInvalidFileNameChars();
            string sanitized = fileName;
            foreach (char c in invalidChars)
            {
                sanitized = sanitized.Replace(c, '_');
            }
            
            return sanitized.Trim();
        }
        
        /// <summary>
        /// Cleans up a temporary JSON file
        /// </summary>
        public static void CleanupTemporaryFile(string filePath)
        {
            try
            {
                if (!string.IsNullOrEmpty(filePath) && File.Exists(filePath))
                {
                    File.Delete(filePath);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"Failed to cleanup temporary JSON file: {ex.Message}");
            }
        }
    }
}

