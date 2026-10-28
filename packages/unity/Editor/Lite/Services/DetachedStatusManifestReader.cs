using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Covyne.CADET.Editor.Lite.Models;
using UnityEngine;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class DetachedStatusManifestReader
    {
        public static bool ExpectsTrackedManifest(WorkspaceInfo workspace)
        {
            return workspace != null &&
                   (!string.IsNullOrWhiteSpace(workspace.ActiveStatusManifestPath) ||
                    !string.IsNullOrWhiteSpace(workspace.ActiveStatusLaunchToken));
        }

        public static bool TryReadTrackedManifest(WorkspaceInfo workspace, out DetachedStatusManifest manifest, out string errorMessage)
        {
            manifest = null;
            errorMessage = string.Empty;

            if (workspace == null)
            {
                errorMessage = "Detached dist workspace state was not available.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(workspace.ActiveStatusManifestPath))
            {
                errorMessage = "Detached dist status file path was not persisted for this tracked run.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(workspace.ActiveStatusLaunchToken))
            {
                errorMessage = "Detached dist launch token was not persisted for this tracked run.";
                return false;
            }

            if (!File.Exists(workspace.ActiveStatusManifestPath))
            {
                errorMessage = $"Detached dist status file not found: {workspace.ActiveStatusManifestPath}";
                return false;
            }

            try
            {
                string json = File.ReadAllText(workspace.ActiveStatusManifestPath);
                manifest = JsonUtility.FromJson<DetachedStatusManifest>(json);
            }
            catch (Exception ex)
            {
                errorMessage = $"Detached dist status file could not be read: {ex.Message}";
                return false;
            }

            if (manifest == null)
            {
                errorMessage = "Detached dist status file was empty or invalid JSON.";
                return false;
            }

            if (!string.Equals(manifest.JobGuid, workspace.JobGuid, StringComparison.OrdinalIgnoreCase))
            {
                errorMessage = "Detached dist status file job GUID did not match the tracked job.";
                manifest = null;
                return false;
            }

            if (!string.Equals(manifest.LaunchToken, workspace.ActiveStatusLaunchToken, StringComparison.OrdinalIgnoreCase))
            {
                errorMessage = "Detached dist status file launch token did not match the tracked run.";
                manifest = null;
                return false;
            }

            return true;
        }

        public static BuildJobStatus? TryMapOverallStatus(string overallStatus)
        {
            return Normalize(overallStatus) switch
            {
                "completed" => BuildJobStatus.Completed,
                "failed" => BuildJobStatus.Failed,
                "cancelled" => BuildJobStatus.Cancelled,
                _ => null
            };
        }

        public static bool IsTerminal(string overallStatus)
        {
            return TryMapOverallStatus(overallStatus).HasValue;
        }

        public static string BuildSummaryText(DetachedStatusManifest manifest)
        {
            if (manifest == null)
            {
                return string.Empty;
            }

            string[] providedSummary = manifest.Summary
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .ToArray();
            if (providedSummary.Length > 0)
            {
                return string.Join(" | ", providedSummary);
            }

            string completed = JoinLabels(manifest, "completed");
            string skipped = JoinLabels(manifest, "skipped");
            string running = JoinLabels(manifest, "running");
            string pending = JoinLabels(manifest, "pending");

            var segments = new List<string>();
            if (!string.IsNullOrWhiteSpace(running))
            {
                segments.Add($"Running: {running}");
            }

            if (!string.IsNullOrWhiteSpace(skipped))
            {
                segments.Add($"Skipped: {skipped}");
            }

            if (!string.IsNullOrWhiteSpace(completed))
            {
                segments.Add($"Completed: {completed}");
            }

            if (segments.Count == 0 && !string.IsNullOrWhiteSpace(pending))
            {
                segments.Add($"Pending: {pending}");
            }

            if (segments.Count > 0)
            {
                return string.Join(" | ", segments);
            }

            return manifest.CurrentMessage ?? string.Empty;
        }

        public static string BuildCompletedOperationsText(DetachedStatusManifest manifest)
        {
            return JoinLabels(manifest, "completed");
        }

        public static string BuildTerminalMessage(DetachedStatusManifest manifest)
        {
            if (manifest == null)
            {
                return string.Empty;
            }

            string summary = BuildSummaryText(manifest);
            if (!string.IsNullOrWhiteSpace(summary) && IsTerminal(manifest.OverallStatus))
            {
                return summary;
            }

            if (!string.IsNullOrWhiteSpace(manifest.CurrentMessage))
            {
                return manifest.CurrentMessage;
            }

            return TryMapOverallStatus(manifest.OverallStatus) switch
            {
                BuildJobStatus.Completed => "Detached dist operation completed successfully.",
                BuildJobStatus.Cancelled => "Detached dist operation was cancelled.",
                BuildJobStatus.Failed => "Detached dist operation failed.",
                _ => string.Empty
            };
        }

        private static string JoinLabels(DetachedStatusManifest manifest, string status)
        {
            if (manifest == null)
            {
                return string.Empty;
            }

            return string.Join(", ", manifest.Operations
                .Where(operation => string.Equals(Normalize(operation.Status), status, StringComparison.Ordinal))
                .Select(operation => string.IsNullOrWhiteSpace(operation.Label) ? operation.Id : operation.Label)
                .Where(label => !string.IsNullOrWhiteSpace(label)));
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value)
                ? string.Empty
                : value.Trim().ToLowerInvariant();
        }
    }
}