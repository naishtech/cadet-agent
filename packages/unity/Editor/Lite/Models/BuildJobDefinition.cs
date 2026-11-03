using System;
using System.Globalization;
using UnityEngine;
using UnityEngine.Events;

namespace Covyne.CADET.Editor.Lite.Models
{
    /// <summary>
    /// Minimal runtime state for a build job in the queue.
    /// All configuration comes from BuildProfile - this only tracks execution state.
    /// </summary>
    [Serializable]
    public class BuildJobDefinition
    {
        /// <summary>Unique identifier for this job execution (generated on creation)</summary>
        public string JobGuid;
        
        /// <summary>Reference to the BuildProfile ScriptableObject GUID</summary>
        public string ProfileGuid;
        
        /// <summary>Workspace path for DirectorySync mode, null for Git Sync mode</summary>
        public string WorkspacePath;
        
        /// <summary>Process ID for cancellation support</summary>
        public int ProcessId;
        
        /// <summary>Current status of the job</summary>
        public BuildJobStatus Status;

        /// <summary>Optional profile name snapshot for UI display</summary>
        public string ProfileName;

        /// <summary>Execution flags captured when the job is queued</summary>
        public bool RunUnityBuild;
        public bool RunNotarizeMac;
        public bool RunPublishSteam;
        public bool RunPublishEpic;
        public bool ShowBlockingSyncDialog;

        /// <summary>Human-readable status detail displayed in queue UI</summary>
        public string StatusDetail;
        
        /// <summary>Event fired when the job's status changes. Non-serialized.</summary>
        [NonSerialized]
        public UnityEvent<string> OnStatusChanged = new UnityEvent<string>();
        
        // Serialization helpers for DateTime (Unity JsonUtility doesn't serialize DateTime? properly)
        [SerializeField] private string _startTimeString;
        [SerializeField] private string _completionTimeString;
        
        /// <summary>When the job started execution</summary>
        public DateTime? StartTime
        {
            get => string.IsNullOrEmpty(_startTimeString) ? (DateTime?)null : DateTime.ParseExact(_startTimeString, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            set => _startTimeString = value?.ToString("O"); // ISO 8601 format
        }
        
        /// <summary>When the job completed (success, failure, or cancellation)</summary>
        public DateTime? CompletionTime
        {
            get => string.IsNullOrEmpty(_completionTimeString) ? (DateTime?)null : DateTime.ParseExact(_completionTimeString, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            set => _completionTimeString = value?.ToString("O"); // ISO 8601 format
        }

        /// <summary>
        /// Create a new build job definition
        /// </summary>
        /// <param name="profileGuid">GUID of the BuildProfile to use</param>
        public BuildJobDefinition(string profileGuid)
        {
            if (profileGuid == null)
                throw new ArgumentNullException(nameof(profileGuid), "Profile GUID cannot be null");
                
            if (string.IsNullOrEmpty(profileGuid))
                throw new ArgumentException("Profile GUID cannot be empty", nameof(profileGuid));
            
            ProfileGuid = profileGuid;
            JobGuid = Guid.NewGuid().ToString();
            Status = BuildJobStatus.Queued;
            ProcessId = 0;
            WorkspacePath = null;
            ProfileName = string.Empty;
            RunUnityBuild = false;
            RunNotarizeMac = false;
            RunPublishSteam = false;
            RunPublishEpic = false;
            ShowBlockingSyncDialog = false;
            StatusDetail = "Queued";
            StartTime = null;
            CompletionTime = null;
        }

        /// <summary>
        /// Parameterless constructor for JSON deserialization
        /// </summary>
        public BuildJobDefinition()
        {
        }

        /// <summary>
        /// Get elapsed time for this job
        /// </summary>
        public TimeSpan? ElapsedTime
        {
            get
            {
                if (!StartTime.HasValue)
                    return null;
                    
                DateTime endTime = CompletionTime ?? DateTime.UtcNow;
                return endTime - StartTime.Value;
            }
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
        public static BuildJobDefinition FromJson(string json)
        {
            if (string.IsNullOrEmpty(json))
                throw new ArgumentException("JSON string cannot be null or empty", nameof(json));
                
            return JsonUtility.FromJson<BuildJobDefinition>(json);
        }
    }
}
