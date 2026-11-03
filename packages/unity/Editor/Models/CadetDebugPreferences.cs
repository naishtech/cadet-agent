using UnityEditor;

namespace Covyne.CADET.Editor.Models
{
    public static class CadetDebugPreferences
    {
        public const string ShowDetachedBashWindowEditorPrefsKey = "CADET_ShowDetachedBashWindow";
        private static bool hasCachedShowDetachedBashWindow;
        private static bool cachedShowDetachedBashWindow;

        public static bool GetShowDetachedBashWindow()
        {
            if (hasCachedShowDetachedBashWindow)
            {
                return cachedShowDetachedBashWindow;
            }

            try
            {
                cachedShowDetachedBashWindow = EditorPrefs.GetBool(ShowDetachedBashWindowEditorPrefsKey, false);
                hasCachedShowDetachedBashWindow = true;
                return cachedShowDetachedBashWindow;
            }
            catch
            {
                // EditorPrefs can throw when called from a non-main thread.
                return false;
            }
        }

        public static void SetShowDetachedBashWindow(bool enabled)
        {
            cachedShowDetachedBashWindow = enabled;
            hasCachedShowDetachedBashWindow = true;

            try
            {
                EditorPrefs.SetBool(ShowDetachedBashWindowEditorPrefsKey, enabled);
            }
            catch
            {
                // Ignore non-main-thread writes. Cached value remains authoritative for current session.
            }
        }
    }
}
