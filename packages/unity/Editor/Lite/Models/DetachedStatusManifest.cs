using System;
using System.Globalization;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Models
{
    [Serializable]
    public class DetachedStatusManifest
    {
        [SerializeField] private int schemaVersion;
        [SerializeField] private string jobGuid;
        [SerializeField] private string launchToken;
        [SerializeField] private string profileName;
        [SerializeField] private string startedAtUtc;
        [SerializeField] private string updatedAtUtc;
        [SerializeField] private string terminalAtUtc;
        [SerializeField] private string overallStatus;
        [SerializeField] private string currentOperation;
        [SerializeField] private string currentMessage;
        [SerializeField] private int exitCode;
        [SerializeField] private DetachedStatusOperation[] operations;
        [SerializeField] private string[] summary;

        public int SchemaVersion => schemaVersion;
        public string JobGuid => jobGuid;
        public string LaunchToken => launchToken;
        public string ProfileName => profileName;
        public string OverallStatus => overallStatus;
        public string CurrentOperation => currentOperation;
        public string CurrentMessage => currentMessage;
        public int ExitCode => exitCode;
        public DetachedStatusOperation[] Operations => operations ?? Array.Empty<DetachedStatusOperation>();
        public string[] Summary => summary ?? Array.Empty<string>();

        public DateTime? StartedAtUtc => ParseTimestamp(startedAtUtc);
        public DateTime? UpdatedAtUtc => ParseTimestamp(updatedAtUtc);
        public DateTime? TerminalAtUtc => ParseTimestamp(terminalAtUtc);

        private static DateTime? ParseTimestamp(string value)
        {
            return string.IsNullOrWhiteSpace(value)
                ? (DateTime?)null
                : DateTime.ParseExact(value, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        }
    }

    [Serializable]
    public class DetachedStatusOperation
    {
        [SerializeField] private string id;
        [SerializeField] private string label;
        [SerializeField] private string status;
        [SerializeField] private string startedAtUtc;
        [SerializeField] private string completedAtUtc;
        [SerializeField] private string message;

        public string Id => id;
        public string Label => label;
        public string Status => status;
        public string Message => message;

        public DateTime? StartedAtUtc => ParseTimestamp(startedAtUtc);
        public DateTime? CompletedAtUtc => ParseTimestamp(completedAtUtc);

        private static DateTime? ParseTimestamp(string value)
        {
            return string.IsNullOrWhiteSpace(value)
                ? (DateTime?)null
                : DateTime.ParseExact(value, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        }
    }
}