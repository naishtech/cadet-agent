using System;
using System.Globalization;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Models
{
    [Serializable]
    public class WorkspaceInfo
    {
        public string JobGuid;
        public string ProfileGuid;
        public string ProfileName;
        public string ProfileJsonPath;
        public string WorkspacePath;
        public BuildJobStatus LastBuildStatus;
        public long DiskUsageMB;
        public bool IsOperationActive;
        public int ActiveProcessId;
        public string ActiveStatusDetail;
        public string ActiveLogPath;
        public string ActiveStatusManifestPath;
        public string ActiveStatusLaunchToken;
        public bool CancelRequested;
        public string LastOperationSummary;
        public string LastCompletedOperationsSummary;
        public string LastTerminalMessage;
        public string LastLogPath;

        [SerializeField] private string _createdAtUtcString;
        [SerializeField] private string _activeProcessStartedAtUtcString;
        [SerializeField] private string _cancelRequestedAtUtcString;
        [SerializeField] private string _lastUpdatedAtUtcString;
        [SerializeField] private string _lastExitCodeString;

        public DateTime CreatedAtUtc
        {
            get => string.IsNullOrEmpty(_createdAtUtcString)
                ? DateTime.UtcNow
                : DateTime.ParseExact(_createdAtUtcString, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            set => _createdAtUtcString = value.ToString("O");
        }

        public DateTime? ActiveProcessStartedAtUtc
        {
            get => string.IsNullOrEmpty(_activeProcessStartedAtUtcString)
                ? (DateTime?)null
                : DateTime.ParseExact(_activeProcessStartedAtUtcString, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            set => _activeProcessStartedAtUtcString = value?.ToString("O");
        }

        public DateTime? CancelRequestedAtUtc
        {
            get => string.IsNullOrEmpty(_cancelRequestedAtUtcString)
                ? (DateTime?)null
                : DateTime.ParseExact(_cancelRequestedAtUtcString, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            set => _cancelRequestedAtUtcString = value?.ToString("O");
        }

        public DateTime? LastUpdatedAtUtc
        {
            get => string.IsNullOrEmpty(_lastUpdatedAtUtcString)
                ? (DateTime?)null
                : DateTime.ParseExact(_lastUpdatedAtUtcString, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            set => _lastUpdatedAtUtcString = value?.ToString("O");
        }

        public int? LastExitCode
        {
            get => string.IsNullOrEmpty(_lastExitCodeString)
                ? (int?)null
                : int.Parse(_lastExitCodeString, CultureInfo.InvariantCulture);
            set => _lastExitCodeString = value?.ToString(CultureInfo.InvariantCulture);
        }
    }
}
