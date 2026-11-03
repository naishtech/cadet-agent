using System;
using System.IO;
using UnityEngine;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// ViewModel for console output - writes all messages directly to a log file.
    /// This eliminates GUI rendering entirely to prevent Unity crashes from large/frequent log updates.
    /// Use "Monitor CADET Log" button to tail the log file in an external terminal.
    /// </summary>
    public class ConsoleOutputViewModel
    {
        private readonly string logFilePath;
        private readonly object fileLock = new object();
        private readonly ICadetUnityConsoleEmitter unityConsoleEmitter;

        public bool UnityConsoleMirroringEnabled { get; set; }
        public CadetUnityLogLevel MinimumUnityConsoleLevel { get; set; } = CadetUnityLogLevel.Error;
        
        /// <summary>
        /// Gets the path to the CADET log file
        /// </summary>
        public string LogFilePath => logFilePath;
        
        public ConsoleOutputViewModel(ICadetUnityConsoleEmitter emitter = null)
        {
            unityConsoleEmitter = emitter ?? new CadetUnityConsoleEmitter();

            // Store log in Unity's Library folder (not tracked by git)
            string projectPath = Path.GetDirectoryName(Application.dataPath);
            logFilePath = Path.Combine(projectPath, "Library", "cadet_build.log");
            
            // Ensure the directory exists
            string logDirectory = Path.GetDirectoryName(logFilePath);
            if (!string.IsNullOrEmpty(logDirectory) && !Directory.Exists(logDirectory))
            {
                Directory.CreateDirectory(logDirectory);
            }
        }
        
        /// <summary>
        /// Appends a message to the log file (thread-safe)
        /// </summary>
        public void AppendMessage(string message, CadetConsoleMessageType type = CadetConsoleMessageType.Log)
        {
            if (string.IsNullOrEmpty(message))
                return;
            
            string timestamp = DateTime.Now.ToString("HH:mm:ss");
            string prefix = GetPrefix(type);
            string formattedMessage = $"[{timestamp}] {prefix} {message}";
            
            WriteToFile(formattedMessage);
            MirrorToUnityConsole(formattedMessage, type);
        }
        
        /// <summary>
        /// Appends a line to the log file (thread-safe)
        /// </summary>
        public void AppendLine(string line, CadetConsoleMessageType type = CadetConsoleMessageType.Log)
        {
            AppendMessage(line, type);
        }
        
        /// <summary>
        /// Clears the log file
        /// </summary>
        public void Clear()
        {
            try
            {
                lock (fileLock)
                {
                    File.WriteAllText(logFilePath, string.Empty);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[C.A.D.E.T] Failed to clear log file: {ex.Message}");
            }
        }
        
        /// <summary>
        /// Writes a line to the log file (thread-safe)
        /// </summary>
        private void WriteToFile(string line)
        {
            try
            {
                lock (fileLock)
                {
                    File.AppendAllText(logFilePath, line + Environment.NewLine);
                }
            }
            catch (Exception ex)
            {
                // Log to Unity console as fallback (don't throw - logging should never crash)
                Debug.LogWarning($"[C.A.D.E.T] Failed to write to log file: {ex.Message}");
            }
        }

        private void MirrorToUnityConsole(string line, CadetConsoleMessageType type)
        {
            if (!UnityConsoleMirroringEnabled || unityConsoleEmitter == null)
            {
                return;
            }

            CadetUnityLogLevel level = CadetLogMirrorMapper.Map(type);
            if (!CadetLogMirrorMapper.ShouldMirror(level, MinimumUnityConsoleLevel))
            {
                return;
            }

            unityConsoleEmitter.Emit(level, line);
        }
        
        private string GetPrefix(CadetConsoleMessageType type)
        {
            return type switch
            {
                CadetConsoleMessageType.Error => "[ERROR]",
                CadetConsoleMessageType.Warning => "[WARN]",
                CadetConsoleMessageType.Success => "[SUCCESS]",
                CadetConsoleMessageType.Progress => "[PROG]",
                _ => "[LOG]",
            };
        }
    }
}
