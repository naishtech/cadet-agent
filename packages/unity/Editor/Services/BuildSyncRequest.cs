using System;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Input model for BuildSyncOrchestratorService.Execute().
    /// Encapsulates all inputs the orchestrator needs: paths, profile, sync mode,
    /// and all structured callbacks.
    ///
    /// Callback ownership rules:
    /// - onStatusChange: orchestrator publishes sync lifecycle statuses.
    ///   Build lifecycle (BUILD_EXECUTING) is emitted here too after successful sync.
    /// - onProgress: optional, called with a 0-1 fraction during directory sync milestones.
    /// - onOutputLine: optional, forwarded raw log lines from the sync backend.
    /// </summary>
    public class BuildSyncRequest
    {
        /// <summary>Source project root to sync from.</summary>
        public string SourcePath { get; set; }

        /// <summary>Target workspace path to sync into.</summary>
        public string TargetPath { get; set; }

        /// <summary>
        /// Profile used to produce sync options and to resolve paths.
        /// Must not be null.
        /// </summary>
        public BuildProfile Profile { get; set; }

        /// <summary>
        /// When true, run git sync; when false, run directory sync.
        /// Corresponds to BuildProfile.useGit.
        /// </summary>
        public bool UseGitSync { get; set; }

        /// <summary>
        /// Optional active job. When supplied, the orchestrator wires status detail
        /// and workspace record updates directly.
        /// </summary>
        public BuildJobDefinition ActiveJob { get; set; }

        /// <summary>
        /// Optional resolved profile asset GUID captured on the editor thread.
        /// Use this instead of AssetDatabase lookups when running on background threads.
        /// </summary>
        public string ProfileGuid { get; set; }

        /// <summary>
        /// Called on each sync status transition with the canonical code and
        /// a human-readable display string.
        /// Always called on the editor thread via BuildStatusEventBus.
        /// </summary>
        public Action<BuildSyncStatus, string> OnStatusChange { get; set; }

        /// <summary>
        /// Optional progress fraction callback (0-1). Called during directory sync
        /// at each available milestone.
        /// </summary>
        public Action<float> OnProgress { get; set; }

        /// <summary>
        /// Optional raw log output line callback, forwarded from the sync backend.
        /// </summary>
        public Action<string> OnOutputLine { get; set; }

        /// <summary>
        /// Optional cancellation probe evaluated during pre-sync and sync loops.
        /// Return true to request cooperative cancellation.
        /// </summary>
        public Func<bool> IsCancellationRequested { get; set; }
    }
}
