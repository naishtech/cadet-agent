using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class BuildQueueStatusTextService
    {
        public const string ExecutedStatusLabel = "Operations";
        public const string PendingOperationsText = "Operations: Status details pending";

        public static string GetRowStatusLabel(BuildJobDefinition job)
        {
            if (job == null)
            {
                return "Unknown";
            }

            return job.Status switch
            {
                BuildJobStatus.Queued => "Queued",
                BuildJobStatus.Syncing => "Syncing",
                BuildJobStatus.Building => "Building",
#if !CADET_LITE
                BuildJobStatus.Publishing => "Publishing",
                BuildJobStatus.Notarizing => "Notarizing",
#endif
                BuildJobStatus.Completed => "Completed",
                BuildJobStatus.Failed => "Failed",
                BuildJobStatus.Cancelled => "Cancelled",
                _ => "Unknown"
            };
        }

        public static string GetJobActivityText(BuildJobDefinition job)
        {
            if (job == null)
            {
                return PendingOperationsText;
            }

            if (!string.IsNullOrWhiteSpace(job.StatusDetail) &&
                !ShouldIgnoreStatusDetailForTerminalJob(job))
            {
                return job.StatusDetail;
            }

            return GetOperationsText(job);
        }

        public static string GetOperationsText(BuildJobDefinition job, WorkspaceInfo workspace = null)
        {
            string operationsSummary = GetWorkspaceOperationsSummary(workspace);
            if (string.IsNullOrWhiteSpace(operationsSummary))
            {
                operationsSummary = GetConfiguredOperationsSummary(job);
            }

            if (string.IsNullOrWhiteSpace(operationsSummary))
            {
                operationsSummary = GetOperationsSummaryFromStatusDetail(job?.StatusDetail);
            }

            return string.IsNullOrWhiteSpace(operationsSummary)
                ? PendingOperationsText
                : $"{ExecutedStatusLabel}: {operationsSummary}";
        }

        public static bool ShouldIgnoreStatusDetailForTerminalJob(BuildJobDefinition job)
        {
            if (job == null || !IsTerminalStatus(job.Status) || string.IsNullOrWhiteSpace(job.StatusDetail))
            {
                return false;
            }

            string detail = job.StatusDetail.Trim();
            return detail.StartsWith("Running:", StringComparison.OrdinalIgnoreCase) ||
                   detail.StartsWith("Executing", StringComparison.OrdinalIgnoreCase) ||
                   detail.StartsWith("Synchronizing", StringComparison.OrdinalIgnoreCase) ||
                   detail.StartsWith("Build in progress", StringComparison.OrdinalIgnoreCase) ||
                   detail.StartsWith("Notarization in progress", StringComparison.OrdinalIgnoreCase) ||
                   detail.StartsWith("Publishing in progress", StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsErrorDetectedStatus(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return false;
            }

            return message.StartsWith("Error Detected:", StringComparison.OrdinalIgnoreCase);
        }

        public static string GetWorkspaceStatusDetail(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return string.Empty;
            }

            BuildJobStatus normalizedStatus = NormalizeWorkspaceStatus(workspace);

            if (workspace.IsOperationActive && !string.IsNullOrWhiteSpace(workspace.ActiveStatusDetail))
            {
                return workspace.ActiveStatusDetail;
            }

            if (IsTerminalStatus(normalizedStatus))
            {
                if (normalizedStatus == BuildJobStatus.Completed)
                {
                    if (!string.IsNullOrWhiteSpace(workspace.LastCompletedOperationsSummary))
                    {
                        return workspace.LastCompletedOperationsSummary;
                    }

                    if (!string.IsNullOrWhiteSpace(workspace.LastOperationSummary))
                    {
                        return workspace.LastOperationSummary;
                    }

                    if (!LooksLikeFailureStatusMessage(workspace.LastTerminalMessage) && !string.IsNullOrWhiteSpace(workspace.LastTerminalMessage))
                    {
                        return workspace.LastTerminalMessage;
                    }
                }

                if (!string.IsNullOrWhiteSpace(workspace.LastTerminalMessage))
                {
                    return workspace.LastTerminalMessage;
                }

                if (!string.IsNullOrWhiteSpace(workspace.LastOperationSummary))
                {
                    return workspace.LastOperationSummary;
                }
            }

            if (!string.IsNullOrWhiteSpace(workspace.ActiveStatusDetail))
            {
                return workspace.ActiveStatusDetail;
            }

            if (!string.IsNullOrWhiteSpace(workspace.LastOperationSummary))
            {
                return workspace.LastOperationSummary;
            }

            string source = string.IsNullOrWhiteSpace(workspace.WorkspacePath) ? "workspace registry" : workspace.WorkspacePath;
            return $"History record from {source}";
        }

        public static BuildJobStatus NormalizeWorkspaceStatus(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return BuildJobStatus.Failed;
            }

            BuildJobStatus status = workspace.LastBuildStatus;

            if (status == BuildJobStatus.Cancelled && HasCompletedSuccessEvidence(workspace))
            {
                return BuildJobStatus.Completed;
            }

#if !CADET_LITE
            if ((status == BuildJobStatus.Publishing || status == BuildJobStatus.Notarizing) && !workspace.IsOperationActive)
            {
                string evidence = $"{workspace.LastOperationSummary} {workspace.LastTerminalMessage} {workspace.ActiveStatusDetail}";
                string lower = (evidence ?? string.Empty).ToLowerInvariant();

                if (lower.Contains("complete") || lower.Contains("success"))
                {
                    return BuildJobStatus.Completed;
                }

                if (lower.Contains("fail") ||
                    lower.Contains("error") ||
                    lower.Contains("process not found") ||
                    lower.Contains("crash"))
                {
                    return BuildJobStatus.Failed;
                }
            }
#endif

            return status;
        }

        public static bool LooksLikeFailureStatusMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return false;
            }

            string lower = message.ToLowerInvariant();
            return lower.Contains("process not found") ||
                   lower.Contains("crash") ||
                   lower.Contains("failed") ||
                   lower.Contains("error");
        }

        public static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }

        private static bool HasCompletedSuccessEvidence(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return false;
            }

            if (workspace.CancelRequested)
            {
                return false;
            }

            if (workspace.LastExitCode.HasValue)
            {
                return workspace.LastExitCode.Value == 0;
            }

            if (!string.IsNullOrWhiteSpace(workspace.LastCompletedOperationsSummary))
            {
                return true;
            }

            if (string.Equals(
                workspace.LastTerminalMessage,
                BuildTerminalOutcomePolicy.BuildInferredDetail(BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable),
                StringComparison.OrdinalIgnoreCase))
            {
                return !string.IsNullOrWhiteSpace(InferWorkspaceOperationsSummary(workspace));
            }

            return LooksLikeCompletedStatusMessage(workspace.LastTerminalMessage) ||
                   LooksLikeCompletedStatusMessage(workspace.LastOperationSummary);
        }

        private static bool LooksLikeCompletedStatusMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return false;
            }

            string lower = message.ToLowerInvariant();
            return !lower.Contains("cancel") &&
                   (lower.Contains("complete") || lower.Contains("success") || lower.Contains("artifacts ready"));
        }

        private static string GetWorkspaceOperationsSummary(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return string.Empty;
            }

            string summary = !string.IsNullOrWhiteSpace(workspace.LastCompletedOperationsSummary)
                ? workspace.LastCompletedOperationsSummary
                : workspace.LastOperationSummary;

            summary = BuildQueueWorkspaceContextService.ExtractExecutedOperationsSummary(summary);
            if (!string.IsNullOrWhiteSpace(summary))
            {
                return summary;
            }

            return InferWorkspaceOperationsSummary(workspace);
        }

        private static string GetConfiguredOperationsSummary(BuildJobDefinition job)
        {
            if (job == null)
            {
                return string.Empty;
            }

            List<string> operations = new List<string>();
            if (job.RunUnityBuild)
            {
                operations.Add("Unity Build");
            }

            if (job.RunNotarizeMac)
            {
                operations.Add("Notarize macOS");
            }

            if (job.RunPublishSteam)
            {
                operations.Add("Publish Steam");
            }

            if (job.RunPublishEpic)
            {
                operations.Add("Publish Epic");
            }

            return operations.Count == 0 ? string.Empty : string.Join(", ", operations);
        }

        private static string GetOperationsSummaryFromStatusDetail(string statusDetail)
        {
            if (string.IsNullOrWhiteSpace(statusDetail))
            {
                return string.Empty;
            }

            string detail = statusDetail.Trim();
            string[] supportedPrefixes =
            {
                "Queued operations:",
                "Running operations:",
                "Completed operations:"
            };

            for (int i = 0; i < supportedPrefixes.Length; i++)
            {
                if (detail.StartsWith(supportedPrefixes[i], StringComparison.OrdinalIgnoreCase))
                {
                    return detail.Substring(supportedPrefixes[i].Length).Trim();
                }
            }

            return string.Empty;
        }

        private static string InferWorkspaceOperationsSummary(WorkspaceInfo workspace)
        {
            if (workspace == null)
            {
                return string.Empty;
            }

            string evidence = string.Join(" ", new[]
            {
                workspace.ActiveStatusDetail,
                workspace.LastTerminalMessage,
                workspace.LastLogPath,
                workspace.ActiveLogPath
            });

            string lower = (evidence ?? string.Empty).ToLowerInvariant();
            List<string> operations = new List<string>();

            if (lower.Contains("unity build") || lower.Contains("unity_build"))
            {
                operations.Add("Unity Build");
            }

#if !CADET_LITE
            if (lower.Contains("notarize") || lower.Contains("macos sign") || lower.Contains("macos build"))
            {
                operations.Add("Notarize macOS");
            }

            if (lower.Contains("steam"))
            {
                operations.Add("Publish Steam");
            }

            if (lower.Contains("epic"))
            {
                operations.Add("Publish Epic");
            }
#endif

            return operations.Count == 0 ? string.Empty : string.Join(", ", operations);
        }
    }
}
