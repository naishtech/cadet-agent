using System;
using System.IO;
using System.Threading;
using UnityEngine;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Shared sync orchestration service used by both Lite (UnityBuildService) and
    /// non-Lite (DistScriptService) build paths.
    ///
    /// Ownership rules:
    /// - This service owns all sync-phase workspace status transitions.
    /// - Callers (runners) own build-phase status transitions after this returns.
    /// - Status callbacks (OnStatusChange, OnOutputLine) are invoked on the calling thread;
    ///   callers that need editor-thread marshalling must wrap Execute() inside Task.Run.
    ///
    /// Sync mode selection:
    /// - BuildSyncRequest.UseGitSync == false  →  directory sync via FileSyncService.
    /// - BuildSyncRequest.UseGitSync == true   →  git sync status signals only; actual git
    ///   operations are delegated to dist.sh --git-sync by the non-Lite runner.
    /// </summary>
    public static class BuildSyncOrchestratorService
    {
        /// <summary>
        /// Executes the appropriate sync operation for the given request and returns
        /// a BuildSyncOutcome describing success or failure.
        ///
        /// Emits statuses via request.OnStatusChange in this order on success:
        ///   Directory sync: SYNC_STARTING → SYNC_PROGRESS → SYNC_COMPLETE
        ///   Git sync:       SYNC_STARTING → SYNC_PROGRESS ("Git Syncing") → SYNC_COMPLETE
        ///
        /// On failure, SYNC_FAILED is emitted before returning.
        /// BUILD_EXECUTING is NOT emitted here; that is the caller's responsibility.
        ///
        /// Note: this method blocks the calling thread. It is designed to be called from
        /// within Task.Run so the editor main thread remains responsive during sync.
        /// </summary>
        /// <exception cref="ArgumentNullException">Thrown when request or request.Profile is null.</exception>
        public static BuildSyncOutcome Execute(BuildSyncRequest request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.Profile == null) throw new ArgumentNullException(nameof(request.Profile));

            try
            {
                return request.UseGitSync
                    ? ExecuteGitSync(request)
                    : ExecuteDirectorySync(request);
            }
            catch (OperationCanceledException)
            {
                const string cancelledText = "Workspace sync cancelled by user.";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, cancelledText);
                request.OnOutputLine?.Invoke("[WARN] Workspace sync cancelled by user.");
                return BuildSyncOutcome.CancelledByUser(cancelledText);
            }
        }

        // ── Directory sync ────────────────────────────────────────────────────

        private static BuildSyncOutcome ExecuteDirectorySync(BuildSyncRequest request)
        {
            ThrowIfCancellationRequested(request);

            string sourcePath = request.SourcePath;
            string targetPath = request.TargetPath;

            // Validate source exists.
            if (string.IsNullOrWhiteSpace(sourcePath) || !Directory.Exists(sourcePath))
            {
                string err = $"Invalid or missing source project path: {sourcePath}";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, err);
                return BuildSyncOutcome.Failed(err);
            }

            // Validate target path is set.
            if (string.IsNullOrWhiteSpace(targetPath))
            {
                const string err = "Target project path is not configured.";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, err);
                return BuildSyncOutcome.Failed(err);
            }

            // Normalise paths consistently.
            sourcePath = Path.GetFullPath(sourcePath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            targetPath = Path.GetFullPath(targetPath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            // Same-project guard: prevent overwriting the currently open project.
            if (IsCurrentProjectPath(targetPath))
            {
                const string err = "Sync Project Path cannot be the currently open Unity project. Please choose a separate sync path.";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, err);
                return BuildSyncOutcome.Failed(err);
            }

            SyncOptions syncOptions = ProfileSavePreflightService.BuildSyncOptions(sourcePath, request.Profile);
            var preflightService = new ProfileSavePreflightService();
            ProjectSyncStatus projectSyncStatus;

            EmitStatus(request, BuildSyncStatus.SYNC_STARTING, "Checking workspace sync status. Use Git Sync (Pro feature) to skip this step");

            try
            {
                projectSyncStatus = preflightService.CheckSyncStatus(
                    sourcePath,
                    targetPath,
                    syncOptions,
                    progress =>
                    {
                        ThrowIfCancellationRequested(request);
                        request.OnProgress?.Invoke(progress * 0.5f);
                    },
                    () => request.IsCancellationRequested?.Invoke() == true);
            }
            catch (OperationCanceledException)
            {
                const string cancelledText = "Workspace sync cancelled by user.";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, cancelledText);
                request.OnOutputLine?.Invoke("[WARN] Workspace sync cancelled by user.");
                return BuildSyncOutcome.CancelledByUser(cancelledText);
            }
            catch (Exception ex)
            {
                string err = $"Sync status check failed: {ex.Message}";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, err);
                request.OnOutputLine?.Invoke($"[ERROR] {err}");
                return BuildSyncOutcome.Failed(err);
            }

            ThrowIfCancellationRequested(request);

            if (projectSyncStatus == ProjectSyncStatus.InSync)
            {
                request.OnProgress?.Invoke(1f);
                EmitStatus(request, BuildSyncStatus.SYNC_COMPLETE, "Workspace already synchronized. Preparing build process.");
                request.OnOutputLine?.Invoke("[SYNC] Workspace already in sync. Skipping directory sync.");
                return BuildSyncOutcome.Succeeded();
            }

            string syncStartText = projectSyncStatus == ProjectSyncStatus.TargetMissing
                ? "Target workspace missing. Synchronizing workspace files..."
                : "Workspace out of sync. Synchronizing workspace files...";

            EmitStatus(request, BuildSyncStatus.SYNC_PROGRESS, syncStartText);
            request.OnOutputLine?.Invoke($"[SYNC] Directory sync: '{sourcePath}' -> '{targetPath}'");

            var syncService = new FileSyncService();
            using var syncCancellation = new CancellationTokenSource();

            SyncResult syncResult;
            try
            {
                syncResult = syncService.SyncDirectory(
                    sourcePath,
                    targetPath,
                    syncOptions,
                    progress =>
                    {
                        if (request.IsCancellationRequested?.Invoke() == true)
                        {
                            syncCancellation.Cancel();
                            throw new OperationCanceledException("Directory sync cancelled by user.");
                        }

                        request.OnProgress?.Invoke(0.5f + progress * 0.5f);
                    },
                    syncCancellation.Token);
            }
            catch (OperationCanceledException)
            {
                const string cancelledText = "Workspace sync cancelled by user.";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, cancelledText);
                request.OnOutputLine?.Invoke("[WARN] Workspace sync cancelled by user.");
                return BuildSyncOutcome.CancelledByUser(cancelledText);
            }
            catch (Exception ex)
            {
                string err = $"Directory sync threw an exception: {ex.Message}";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, err);
                request.OnOutputLine?.Invoke($"[ERROR] {err}");
                return BuildSyncOutcome.Failed(err);
            }

            if (syncResult == null || !syncResult.Success)
            {
                string detail = syncResult != null && !string.IsNullOrWhiteSpace(syncResult.ErrorMessage)
                    ? syncResult.ErrorMessage
                    : "Directory sync failed with no error detail.";
                string err = $"Directory sync failed: {detail}";
                EmitStatus(request, BuildSyncStatus.SYNC_FAILED, err);
                request.OnOutputLine?.Invoke($"[ERROR] {err}");
                return BuildSyncOutcome.Failed(err);
            }

            string completeText = "Workspace sync complete. Preparing build process.";
            request.OnProgress?.Invoke(1f);
            EmitStatus(request, BuildSyncStatus.SYNC_COMPLETE, completeText);
            request.OnOutputLine?.Invoke(
                $"[SYNC] Completed. Copied {syncResult.FilesCopied} file(s), deleted {syncResult.FilesDeleted} file(s).");

            return BuildSyncOutcome.Succeeded(syncResult.FilesCopied, syncResult.FilesDeleted);
        }

        // ── Git sync ──────────────────────────────────────────────────────────

        /// <summary>
        /// Emits the canonical git-sync status signals. Actual repository operations
        /// are performed by dist.sh --git-sync; this method only signals lifecycle steps
        /// so the UI and event bus receive consistent statuses on the non-Lite path.
        /// </summary>
        private static BuildSyncOutcome ExecuteGitSync(BuildSyncRequest request)
        {
            ThrowIfCancellationRequested(request);
            EmitStatus(request, BuildSyncStatus.SYNC_STARTING, "Git Syncing (starting).");
            ThrowIfCancellationRequested(request);
            EmitStatus(request, BuildSyncStatus.SYNC_PROGRESS, "Git Syncing.");
            ThrowIfCancellationRequested(request);
            EmitStatus(request, BuildSyncStatus.SYNC_COMPLETE, "Git Sync Complete.");
            return BuildSyncOutcome.Succeeded();
        }

        private static void ThrowIfCancellationRequested(BuildSyncRequest request)
        {
            if (request?.IsCancellationRequested?.Invoke() == true)
            {
                throw new OperationCanceledException("Sync orchestration cancelled by user.");
            }
        }

        // ── Helpers ───────────────────────────────────────────────────────────

        private static void EmitStatus(BuildSyncRequest request, BuildSyncStatus code, string text)
        {
            request.OnStatusChange?.Invoke(code, text);

            if (request.ActiveJob != null)
            {
                request.ActiveJob.StatusDetail = text;
                BuildStatusEventBus.PublishStatusChange(request.ActiveJob.JobGuid, text);
            }
        }

        /// <summary>
        /// Resolves the source project path from profile workspace config or falls back to the
        /// currently open Unity project. Mirrors UnityBuildService.ResolveSourceProjectPath.
        /// </summary>
        public static string ResolveSourcePath(BuildSyncRequest request, WorkspaceManager workspaceManager)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));

            string defaultSourcePath = Path.GetDirectoryName(Path.GetFullPath(Application.dataPath));
            string profileGuid = UnityBuildService.ResolveProfileGuid(request.Profile, request.ActiveJob, request.ProfileGuid);

            if (string.IsNullOrWhiteSpace(profileGuid) || workspaceManager == null)
                return defaultSourcePath;

            ProfileWorkspaceConfig config = workspaceManager.GetProfileConfig(profileGuid);
            string configuredSourcePath = config?.SourceProjectPath;

            if (string.IsNullOrWhiteSpace(configuredSourcePath))
                return defaultSourcePath;

            return Path.GetFullPath(configuredSourcePath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        /// <summary>
        /// Guards against the target path matching the currently open Unity project, which would
        /// overwrite the editor's own project files.
        /// </summary>
        public static bool IsCurrentProjectPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return false;
            string currentProject = Path.GetDirectoryName(Path.GetFullPath(Application.dataPath))
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string normalized = Path.GetFullPath(path)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return string.Equals(currentProject, normalized, StringComparison.OrdinalIgnoreCase);
        }
    }
}

