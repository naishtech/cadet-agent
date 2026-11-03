using System;
using System.Diagnostics;

namespace Covyne.CADET.Editor.Models
{
    /// <summary>
    /// Model representing information about an active process
    /// </summary>
    public class ProcessInfo
    {
        public int ProcessId { get; set; }
        public string Command { get; set; }
        public string Arguments { get; set; }
        public DateTime StartTime { get; set; }
        public Process Process { get; set; }

        /// <summary>
        /// Gets the runtime duration of the process
        /// </summary>
        public TimeSpan GetRuntimeDuration()
        {
            return DateTime.Now - StartTime;
        }


        /// <summary>
        /// Gets formatted runtime string (e.g., "1h 23m 45s" or "5m 30s" or "45s")
        /// </summary>
        public string GetFormattedRuntime()
        {
            TimeSpan duration = GetRuntimeDuration();
            
            if (duration.TotalHours >= 1)
            {
                int hours = (int)duration.TotalHours;
                int minutes = duration.Minutes;
                int seconds = duration.Seconds;
                return $"{hours}h {minutes}m {seconds}s";
            }
            else if (duration.TotalMinutes >= 1)
            {
                int minutes = (int)duration.TotalMinutes;
                int seconds = duration.Seconds;
                return $"{minutes}m {seconds}s";
            }
            else
            {
                int seconds = duration.Seconds;
                return $"{seconds}s";
            }
        }

        /// <summary>
        /// Checks if the process is still running
        /// </summary>
        public bool IsRunning()
        {
            try
            {
                if (Process == null)
                    return false;
                
                return !Process.HasExited;
            }
            catch
            {
                // Process may have been disposed
                return false;
            }
        }
    }
}

