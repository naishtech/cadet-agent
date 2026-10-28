using System;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Models
{
    /// <summary>
    /// Represents the result of a completed build job
    /// </summary>
    [Serializable]
    public class BuildJobResult
    {
        /// <summary>Unique identifier for the job this result belongs to</summary>
        public string JobGuid;
        
        /// <summary>Whether the build completed successfully</summary>
        public bool IsSuccess;
        
        /// <summary>Whether the job was cancelled</summary>
        public bool IsCancelled;
        
        /// <summary>Path to build output (if successful)</summary>
        public string OutputPath;
        
        /// <summary>Error message (if failed)</summary>
        public string ErrorMessage;
        
        // Serialization helper for TimeSpan (Unity JsonUtility doesn't serialize TimeSpan)
        [SerializeField] private long _durationTicks;
        
        /// <summary>Total duration of the build</summary>
        public TimeSpan Duration
        {
            get => TimeSpan.FromTicks(_durationTicks);
            set => _durationTicks = value.Ticks;
        }
        
        /// <summary>Path to log file</summary>
        public string LogPath;

        /// <summary>
        /// Create a success result
        /// </summary>
        public static BuildJobResult Success(string jobGuid, string outputPath)
        {
            return new BuildJobResult
            {
                JobGuid = jobGuid,
                IsSuccess = true,
                IsCancelled = false,
                OutputPath = outputPath,
                ErrorMessage = null
            };
        }

        /// <summary>
        /// Create a failure result
        /// </summary>
        public static BuildJobResult Failure(string jobGuid, string errorMessage)
        {
            return new BuildJobResult
            {
                JobGuid = jobGuid,
                IsSuccess = false,
                IsCancelled = false,
                OutputPath = null,
                ErrorMessage = errorMessage
            };
        }

        /// <summary>
        /// Create a cancelled result
        /// </summary>
        public static BuildJobResult Cancelled(string jobGuid)
        {
            return new BuildJobResult
            {
                JobGuid = jobGuid,
                IsSuccess = false,
                IsCancelled = true,
                OutputPath = null,
                ErrorMessage = "Job was cancelled by user"
            };
        }

        /// <summary>
        /// Serialize to JSON
        /// </summary>
        public string ToJson()
        {
            return JsonUtility.ToJson(this, true);
        }

        /// <summary>
        /// Deserialize from JSON
        /// </summary>
        public static BuildJobResult FromJson(string json)
        {
            if (string.IsNullOrEmpty(json))
                throw new ArgumentException("JSON string cannot be null or empty", nameof(json));
                
            return JsonUtility.FromJson<BuildJobResult>(json);
        }
    }
}
