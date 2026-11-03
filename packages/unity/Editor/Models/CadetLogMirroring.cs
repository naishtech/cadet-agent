using UnityEngine;

namespace Covyne.CADET.Editor.Models
{
    public enum CadetUnityLogLevel
    {
        Debug = 0,
        Info = 1,
        Warn = 2,
        Error = 3
    }

    public static class CadetLogMirrorMapper
    {
        public static CadetUnityLogLevel Map(CadetConsoleMessageType type)
        {
            return type switch
            {
                CadetConsoleMessageType.Warning => CadetUnityLogLevel.Warn,
                CadetConsoleMessageType.Error => CadetUnityLogLevel.Error,
                CadetConsoleMessageType.Success => CadetUnityLogLevel.Info,
                CadetConsoleMessageType.Progress => CadetUnityLogLevel.Info,
                _ => CadetUnityLogLevel.Info,
            };
        }

        public static bool ShouldMirror(CadetUnityLogLevel messageLevel, CadetUnityLogLevel minimumLevel)
        {
            return messageLevel >= minimumLevel;
        }
    }

    public interface ICadetUnityConsoleEmitter
    {
        void Emit(CadetUnityLogLevel level, string message);
    }

    public sealed class CadetUnityConsoleEmitter : ICadetUnityConsoleEmitter
    {
        public void Emit(CadetUnityLogLevel level, string message)
        {
            switch (level)
            {
                case CadetUnityLogLevel.Warn:
                    Debug.LogWarning(message);
                    break;
                case CadetUnityLogLevel.Error:
                    Debug.LogError(message);
                    break;
                default:
                    Debug.Log(message);
                    break;
            }
        }
    }
}