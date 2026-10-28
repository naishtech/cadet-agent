namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Canonical lifecycle codes for the shared sync orchestration phase.
    /// These codes are emitted by BuildSyncOrchestratorService and must be handled
    /// consistently by all subscribers regardless of build runner mode.
    ///
    /// Display text is also produced by the orchestrator alongside each code.
    /// Consumers should key logic on the code and use the text only for display.
    /// </summary>
    public enum BuildSyncStatus
    {
        /// <summary>Sync operation is initialising. Emitted once before any file I/O begins.</summary>
        SYNC_STARTING,

        /// <summary>Sync operation is in progress. May be emitted multiple times with milestone text.</summary>
        SYNC_PROGRESS,

        /// <summary>Sync operation completed successfully. Build launch may proceed.</summary>
        SYNC_COMPLETE,

        /// <summary>Build process is being launched. Emitted after sync (or skipped sync) succeeds.</summary>
        BUILD_EXECUTING,

        /// <summary>Sync operation failed. Build launch must not proceed.</summary>
        SYNC_FAILED
    }
}
