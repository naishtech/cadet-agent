using System;

namespace Covyne.CADET.Editor.Models
{
    /// <summary>
    /// Enumeration of console message types
    /// </summary>
    public enum CadetConsoleMessageType
    {
        Log,
        Error,
        Warning,
        Success,
        Progress
    }
    
    /// <summary>
    /// Immutable data model representing a console output message
    /// </summary>
    public class ConsoleMessage
    {
        public readonly string message;
        public readonly DateTime timestamp;
        public readonly CadetConsoleMessageType messageType;
        
        public ConsoleMessage(string message, CadetConsoleMessageType type = CadetConsoleMessageType.Log)
        {
            this.message = message ?? "";
            this.timestamp = DateTime.Now;
            this.messageType = type;
        }
        
        public string GetFormattedMessage(bool showTimestamp)
        {
            if (showTimestamp)
            {
                return $"[{timestamp:HH:mm:ss}] {message}";
            }
            return message;
        }
        
        public string GetPrefix()
        {
            return messageType switch
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

