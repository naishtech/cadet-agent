namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Output of BuildSyncOrchestratorService.Execute().
    /// Distinct from Covyne.CADET.Editor.Lite.Models.SyncResult which is the raw
    /// file-sync backend result. This type adds lifetime metadata used by callers.
    /// </summary>
    public class BuildSyncOutcome
    {
        /// <summary>True if sync completed and build launch may proceed.</summary>
        public bool Success { get; }

        /// <summary>True when sync ended due to user-requested cancellation.</summary>
        public bool Cancelled { get; }

        /// <summary>
        /// Final canonical status code reached before the orchestrator returned.
        /// SYNC_COMPLETE on success; SYNC_FAILED on any error.
        /// </summary>
        public BuildSyncStatus FinalStatus { get; }

        /// <summary>Human-readable error message when Success is false, otherwise empty.</summary>
        public string ErrorMessage { get; }

        /// <summary>Number of files copied during directory sync (0 for git sync).</summary>
        public int FilesCopied { get; }

        /// <summary>Number of files deleted during directory sync (0 for git sync).</summary>
        public int FilesDeleted { get; }

        public BuildSyncOutcome(
            bool success,
            BuildSyncStatus finalStatus,
            string errorMessage = null,
            int filesCopied = 0,
            int filesDeleted = 0,
            bool cancelled = false)
        {
            Success = success;
            FinalStatus = finalStatus;
            ErrorMessage = errorMessage ?? string.Empty;
            FilesCopied = filesCopied;
            FilesDeleted = filesDeleted;
            Cancelled = cancelled;
        }

        public static BuildSyncOutcome Succeeded(int filesCopied = 0, int filesDeleted = 0)
            => new BuildSyncOutcome(true, BuildSyncStatus.SYNC_COMPLETE, null, filesCopied, filesDeleted);

        public static BuildSyncOutcome Failed(string errorMessage)
            => new BuildSyncOutcome(false, BuildSyncStatus.SYNC_FAILED, errorMessage);

        public static BuildSyncOutcome CancelledByUser(string message = "Operation cancelled by user.")
            => new BuildSyncOutcome(false, BuildSyncStatus.SYNC_FAILED, message, cancelled: true);
    }
}
