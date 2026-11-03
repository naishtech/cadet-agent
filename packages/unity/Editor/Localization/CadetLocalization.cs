using System;

namespace Covyne.CADET.Editor.Localization
{
    /// <summary>
    /// Helper class for accessing localized strings in Editor code.
    /// Works with or without Unity Localization package - automatically falls back to CSV parsing if package is not available.
    /// </summary>
    public static class CadetLocalization
    {
        private static bool? hasLocalizationPackage;
        private static object cadetTableCollection;
        private const string TABLE_COLLECTION_NAME = "CADET";
        
        /// <summary>
        /// Checks if Unity Localization package is available
        /// </summary>
        private static bool HasLocalizationPackage()
        {
            if (hasLocalizationPackage.HasValue)
                return hasLocalizationPackage.Value;
            
            // Check if the Unity Localization types are available
            Type localizationEditorSettingsType = Type.GetType("UnityEditor.Localization.LocalizationEditorSettings, Unity.Localization.Editor");
            hasLocalizationPackage = localizationEditorSettingsType != null;
            
            return hasLocalizationPackage.Value;
        }
        
        /// <summary>
        /// Gets the CADET string table collection using Unity Localization package (if available)
        /// </summary>
        private static object GetTableCollection()
        {
            if (!HasLocalizationPackage())
                return null;
                
            if (cadetTableCollection != null)
                return cadetTableCollection;
            
            try
            {
                Type localizationEditorSettingsType = Type.GetType("UnityEditor.Localization.LocalizationEditorSettings, Unity.Localization.Editor");
                var getStringTableCollectionMethod = localizationEditorSettingsType.GetMethod("GetStringTableCollection", new[] { typeof(string) });
                cadetTableCollection = getStringTableCollectionMethod?.Invoke(null, new object[] { TABLE_COLLECTION_NAME });
            }
            catch
            {
                // If anything goes wrong, fall back to CSV
            }
            
            return cadetTableCollection;
        }
        
        /// <summary>
        /// Gets a localized string by key using Unity Localization package
        /// Returns null if not found (instead of fallback) to allow CSV fallback to try
        /// </summary>
        private static string GetStringFromPackage(string key, string fallback)
        {
            var tableCollection = GetTableCollection();
            if (tableCollection == null)
                return null;
            
            try
            {
                // Get the table for "en" locale
                Type tableCollectionType = tableCollection.GetType();
                var getTableMethod = tableCollectionType.GetMethod("GetTable", new[] { typeof(string) });
                var enTable = getTableMethod?.Invoke(tableCollection, new object[] { "en" });
                
                if (enTable == null)
                    return null;
                
                // Get the entry for the key
                Type stringTableType = Type.GetType("UnityEngine.Localization.Tables.StringTable, Unity.Localization");
                if (stringTableType == null || !stringTableType.IsInstanceOfType(enTable))
                    return null;
                
                var getEntryMethod = stringTableType.GetMethod("GetEntry", new[] { typeof(string) });
                var entry = getEntryMethod?.Invoke(enTable, new object[] { key });
                
                if (entry == null)
                    return null;
                
                // Get the localized string value
                Type entryType = entry.GetType();
                var getLocalizedStringMethod = entryType.GetMethod("GetLocalizedString");
                var localizedString = getLocalizedStringMethod?.Invoke(entry, null) as string;
                
                // Return null if empty to allow CSV fallback
                return localizedString;
            }
            catch
            {
                // If anything goes wrong, fall back to CSV
                return fallback;
            }
        }
        
        /// <summary>
        /// Gets a localized string by key
        /// </summary>
        /// <param name="key">The localization key (e.g., "Window.ProfileEditor.Fields.ProfileName")</param>
        /// <returns>The localized string, or the key itself if not found</returns>
        public static string GetString(string key)
        {
            return GetStringWithFallback(key, key);
        }
        
        /// <summary>
        /// Gets a localized string by key with a fallback value
        /// </summary>
        /// <param name="key">The localization key</param>
        /// <param name="fallback">Fallback string to use if key is not found</param>
        /// <returns>The localized string, or the fallback if not found</returns>
        public static string GetStringWithFallback(string key, string fallback)
        {
            // Try Unity Localization package first if available
            if (HasLocalizationPackage())
            {
                string result = GetStringFromPackage(key, null);
                // If package found a value, use it
                if (!string.IsNullOrEmpty(result))
                    return result;
            }
            
            // Fall back to CSV parsing
            return CsvLocalizationFallback.GetString(key, fallback);
        }
        
        /// <summary>
        /// Forces reload of the localization data (useful after table/file updates)
        /// </summary>
        public static void Reload()
        {
            cadetTableCollection = null;
            hasLocalizationPackage = null;
            CsvLocalizationFallback.Reload();
        }
    }
}
