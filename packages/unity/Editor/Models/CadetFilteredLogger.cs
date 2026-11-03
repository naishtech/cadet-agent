using UnityEditor;

namespace Covyne.CADET.Editor.Models
{
    /// <summary>
    /// Emits CADET lifecycle logs to Unity console using the same level filter as ConsoleOutputViewModel.
    /// </summary>
    public static class CadetFilteredLogger
    {
        public const string MinimumLevelEditorPrefsKey = "CADET_UnityConsoleMinimumLevel";

        private static readonly ICadetUnityConsoleEmitter emitter = new CadetUnityConsoleEmitter();
        private static int cachedMinimumLevel = (int)CadetUnityLogLevel.Error;

        public static CadetUnityLogLevel GetMinimumLevel()
        {
            int stored = GetMinimumLevelValue();
            if (stored < (int)CadetUnityLogLevel.Debug || stored > (int)CadetUnityLogLevel.Error)
            {
                return CadetUnityLogLevel.Error;
            }

            return (CadetUnityLogLevel)stored;
        }

        public static void SetMinimumLevel(CadetUnityLogLevel level)
        {
            cachedMinimumLevel = (int)level;
            EditorPrefs.SetInt(MinimumLevelEditorPrefsKey, (int)level);
        }

        public static void Info(string message)
        {
            Emit(CadetUnityLogLevel.Info, message);
        }

        public static void Debug(string message)
        {
            Emit(CadetUnityLogLevel.Debug, message);
        }

        public static void Warn(string message)
        {
            Emit(CadetUnityLogLevel.Warn, message);
        }

        public static void Error(string message)
        {
            Emit(CadetUnityLogLevel.Error, message);
        }

        public static void Emit(CadetUnityLogLevel level, string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return;
            }

            CadetUnityLogLevel minimum = GetMinimumLevel();
            if (!CadetLogMirrorMapper.ShouldMirror(level, minimum))
            {
                return;
            }

            emitter.Emit(level, message);
        }

        private static int GetMinimumLevelValue()
        {
            try
            {
                cachedMinimumLevel = EditorPrefs.GetInt(MinimumLevelEditorPrefsKey, cachedMinimumLevel);
            }
            catch (System.Exception)
            {
                return cachedMinimumLevel;
            }

            return cachedMinimumLevel;
        }
    }
}
