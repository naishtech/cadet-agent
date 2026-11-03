using System;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    /// <summary>
    /// Shared active-operation liveness checks used by both Lite and Pro flows.
    /// A job is only considered active when there is durable evidence that work is still running.
    /// </summary>
    public static class BuildOperationLivenessService
    {
        private const double DetachedRuntimeStartupGraceSeconds = 15.0;
        private const double DetachedRecentLogActivitySeconds = 20.0;

        public static bool IsVerifiedActiveOperation(WorkspaceInfo workspace, DateTime nowUtc)
        {
            if (workspace == null)
            {
                return false;
            }

            if (WorkspaceOperationStateService.IsProcessAlive(workspace))
            {
                return true;
            }

            if (IsTerminalStatus(workspace.LastBuildStatus))
            {
                return false;
            }

            return ShouldTreatDetachedOperationAsRunning(workspace, nowUtc);
        }

        private static bool ShouldTreatDetachedOperationAsRunning(WorkspaceInfo workspace, DateTime nowUtc)
        {
            if (workspace == null || !workspace.IsOperationActive || IsTerminalStatus(workspace.LastBuildStatus))
            {
                return false;
            }

            // When manifest tracking is expected, check if a terminal status is already available from it.
            // If manifest hasn't been written yet (early startup), fall through to grace window logic.
            // This is critical for pure C# detached processes that have manifest paths configured but
            // are still in the early startup phase during reload.
            if (DetachedStatusManifestReader.ExpectsTrackedManifest(workspace))
            {
                if (DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out _))
                {
                    // Manifest file was successfully read. Check if it has a terminal status.
                    if (DetachedStatusManifestReader.IsTerminal(manifest?.OverallStatus))
                    {
                        return false;  // Manifest confirms operation is terminal
                    }
                    // A readable non-terminal manifest is durable evidence that the detached
                    // operation is still progressing, even beyond the startup grace window.
                    return true;
                }
                // Manifest path is configured but file doesn't exist yet.
                // Fall through to grace window logic instead of immediately returning false.
            }

            DateTime referenceUtc = workspace.ActiveProcessStartedAtUtc ??
                                    workspace.LastUpdatedAtUtc ??
                                    workspace.CreatedAtUtc;

            // Allow a short startup grace window for both tracked/untracked PID cases.
            // This prevents transient false negatives immediately after state persistence.
            if ((nowUtc - referenceUtc).TotalSeconds < DetachedRuntimeStartupGraceSeconds)
            {
                return true;
            }

            // Beyond startup grace, require recent log activity when a tracked PID is not alive.
            // This avoids false "active" state caused by stale IsOperationActive=true records.
            return HasRecentDetachedLogActivity(workspace, nowUtc);
        }

        private static bool HasRecentDetachedLogActivity(WorkspaceInfo workspace, DateTime nowUtc)
        {
            if (workspace == null || string.IsNullOrWhiteSpace(workspace.ActiveLogPath) || !File.Exists(workspace.ActiveLogPath))
            {
                return false;
            }

            try
            {
                DateTime logWriteUtc = File.GetLastWriteTimeUtc(workspace.ActiveLogPath);
                DateTime? minimumWriteUtc = workspace.ActiveProcessStartedAtUtc?.AddSeconds(-2d);
                if (minimumWriteUtc.HasValue && logWriteUtc < minimumWriteUtc.Value)
                {
                    return false;
                }

                return (nowUtc - logWriteUtc).TotalSeconds < DetachedRecentLogActivitySeconds;
            }
            catch
            {
                return false;
            }
        }

        private static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }
    }
}
