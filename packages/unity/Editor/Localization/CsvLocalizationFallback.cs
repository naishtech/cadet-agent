using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEditor;

namespace Covyne.CADET.Editor.Localization
{
    /// <summary>
    /// Fallback CSV-based localization when Unity Localization package is not available
    /// </summary>
    public static class CsvLocalizationFallback
    {
        private static Dictionary<string, string> localizationCache;
        private const string CSV_RELATIVE_PATH = "Assets/Covyne/Cadet/Editor/Localization/CADET_Localization_en.csv";
        
        /// <summary>
        /// Loads the CSV file and caches the key-value pairs
        /// </summary>
        private static void LoadCsvIfNeeded()
        {
            if (localizationCache != null)
                return;
            
            localizationCache = new Dictionary<string, string>();
            
            try
            {
                // Use AssetDatabase to find the CSV file
                string csvPath = AssetDatabase.GetAssetPath(AssetDatabase.LoadAssetAtPath<TextAsset>(CSV_RELATIVE_PATH));
                if (string.IsNullOrEmpty(csvPath))
                {
                    // Try alternative: find by GUID or name
                    string[] guids = AssetDatabase.FindAssets("CADET_Localization_en t:TextAsset");
                    if (guids.Length > 0)
                    {
                        csvPath = AssetDatabase.GUIDToAssetPath(guids[0]);
                    }
                }
                
                if (string.IsNullOrEmpty(csvPath) || !File.Exists(csvPath))
                {
                    // Fallback to direct path resolution
                    csvPath = Path.Combine(Application.dataPath, "..", CSV_RELATIVE_PATH);
                    csvPath = Path.GetFullPath(csvPath);
                    if (!File.Exists(csvPath))
                    {
                        Debug.LogWarning($"[CADET Localization] CSV file not found. Expected at: {CSV_RELATIVE_PATH}. Using fallback values.");
                        return;
                    }
                }
                
                string[] lines = File.ReadAllLines(csvPath);
                
                // Skip header line (Key,Id,English(en))
                for (int i = 1; i < lines.Length; i++)
                {
                    string line = lines[i].Trim();
                    if (string.IsNullOrEmpty(line))
                        continue;
                    
                    // Parse CSV line (handle quoted values with commas)
                    var parts = ParseCsvLine(line);
                    if (parts.Length >= 3)
                    {
                        string key = Unquote(parts[0]);
                        // parts[1] is the Id column (we ignore it)
                        string value = Unquote(parts[2]);
                        
                        if (!string.IsNullOrEmpty(key) && !string.IsNullOrEmpty(value))
                        {
                            localizationCache[key] = value;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CADET Localization] Error loading CSV file: {ex.Message}");
            }
        }
        
        /// <summary>
        /// Parses a CSV line, handling quoted values that may contain commas
        /// </summary>
        private static string[] ParseCsvLine(string line)
        {
            List<string> parts = new List<string>();
            bool inQuotes = false;
            string currentPart = "";
            
            for (int i = 0; i < line.Length; i++)
            {
                char c = line[i];
                
                if (c == '"')
                {
                    if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                    {
                        // Escaped quote ("")
                        currentPart += '"';
                        i++; // Skip next quote
                    }
                    else
                    {
                        // Toggle quote state
                        inQuotes = !inQuotes;
                    }
                }
                else if (c == ',' && !inQuotes)
                {
                    // End of field
                    parts.Add(currentPart);
                    currentPart = "";
                }
                else
                {
                    currentPart += c;
                }
            }
            
            // Add the last part
            parts.Add(currentPart);
            
            return parts.ToArray();
        }
        
        /// <summary>
        /// Removes surrounding quotes from a string if present
        /// </summary>
        private static string Unquote(string value)
        {
            if (string.IsNullOrEmpty(value))
                return value;
            
            value = value.Trim();
            if (value.StartsWith("\"") && value.EndsWith("\""))
            {
                return value.Substring(1, value.Length - 2).Replace("\"\"", "\"");
            }
            
            return value;
        }
        
        /// <summary>
        /// Gets a localized string by key
        /// </summary>
        public static string GetString(string key, string fallback)
        {
            LoadCsvIfNeeded();
            
            if (localizationCache != null && localizationCache.TryGetValue(key, out string value))
            {
                return value;
            }
            
            return fallback;
        }
        
        /// <summary>
        /// Forces reload of the CSV file (useful after file updates)
        /// </summary>
        public static void Reload()
        {
            localizationCache = null;
        }
    }
}

