using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class BuildQueueJobStateService
    {
        public readonly struct OpenBuildFolderCheckCacheEntry
        {
            public OpenBuildFolderCheckCacheEntry(bool canOpen, double expiresAt)
            {
                CanOpen = canOpen;
                ExpiresAt = expiresAt;
            }

            public bool CanOpen { get; }
            public double ExpiresAt { get; }
        }

        public readonly struct ExecutingStateCacheEntry
        {
            public ExecutingStateCacheEntry(bool isExecuting, double expiresAt)
            {
                IsExecuting = isExecuting;
                ExpiresAt = expiresAt;
            }

            public bool IsExecuting { get; }
            public double ExpiresAt { get; }
        }

        public static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }

        public static bool IsDirectorySyncInProgress(BuildJobDefinition job, WorkspaceInfo workspace, BuildProfile profile)
        {
            if (job == null || job.Status != BuildJobStatus.Syncing)
            {
                return false;
            }

            if (profile != null)
            {
                return !profile.useGit;
            }

            string detail = !string.IsNullOrWhiteSpace(workspace?.ActiveStatusDetail)
                ? workspace.ActiveStatusDetail
                : (!string.IsNullOrWhiteSpace(workspace?.LastOperationSummary)
                    ? workspace.LastOperationSummary
                    : job.StatusDetail);

            if (!string.IsNullOrWhiteSpace(detail) &&
                detail.IndexOf("git sync", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return false;
            }

            return true;
        }

        /// <summary>
        /// Single authoritative execute-blocker check. Returns true when the given profile
        /// has a verified in-progress job from manager state or workspace liveness.
        /// Use this instead of calling queueManager.HasJobInProgress directly from UI callers.
        /// </summary>
        public static bool IsProfileBlockedForExecute(string profileGuid, Func<string, bool> hasTrackedJobInProgress)
        {
            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return false;
            }

            if (HasVerifiedActiveWorkspaceForProfile(profileGuid))
            {
                return true;
            }

            return hasTrackedJobInProgress?.Invoke(profileGuid) ?? false;
        }

        /// <summary>
        /// Returns true when the job is terminal AND the same profile has no other job
        /// currently in progress. Use instead of queueManager.CanRetryJob to enforce
        /// the consistency rule that retry is not allowed while a sibling job is running.
        /// </summary>
        public static bool CanRetryJob(
            BuildJobDefinition job,
            Func<BuildJobDefinition, bool> canRetryTrackedJob,
            Func<string, bool> hasTrackedJobInProgress)
        {
            if (job == null)
            {
                return false;
            }

            bool canRetry = canRetryTrackedJob != null
                ? canRetryTrackedJob(job)
                : IsTerminalStatus(job.Status);

            if (!canRetry)
            {
                return false;
            }

            return !IsProfileBlockedForExecute(job.ProfileGuid, hasTrackedJobInProgress);
        }

        public static bool IsHistoryOnlyJob(BuildJobDefinition job, Func<string, BuildJobDefinition> getTrackedJob)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return false;
            }

            return getTrackedJob == null || getTrackedJob(job.JobGuid) == null;
        }

        public static bool CanDeleteJob(
            BuildJobDefinition job,
            Func<string, bool> isTrackedJobActive,
            Func<string, BuildJobDefinition> getTrackedJob)
        {
            if (job == null)
            {
                return false;
            }

            if (IsTerminalStatus(job.Status))
            {
                return true;
            }

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            bool runtimeStillExecuting = runtimeState != null &&
                                        runtimeState.IsOperationRunning &&
                                        string.Equals(runtimeState.ActiveJobGuid, job.JobGuid, StringComparison.OrdinalIgnoreCase);

            WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(job.JobGuid);
            if (workspace != null)
            {
                bool workspaceStillExecuting = BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, DateTime.UtcNow);
                return !workspaceStillExecuting && !runtimeStillExecuting;
            }

            if ((isTrackedJobActive?.Invoke(job.JobGuid) ?? false) &&
                workspace == null)
            {
                return !runtimeStillExecuting;
            }

            return IsHistoryOnlyJob(job, getTrackedJob);
        }

        public static bool CanCancelJob(
            BuildJobDefinition job,
            bool isExecuting,
            Func<string, bool> isTrackedJobActive,
            Func<string, BuildJobDefinition> getTrackedJob)
        {
            if (job == null)
            {
                return false;
            }

            if (WorkspaceOperationStateService.IsOperationActive(job.JobGuid) || isExecuting)
            {
                return true;
            }

            if (job.Status == BuildJobStatus.Queued)
            {
                  return getTrackedJob != null &&
                      getTrackedJob(job.JobGuid) != null &&
                      !IsHistoryOnlyJob(job, getTrackedJob);
            }

            if (job.Status == BuildJobStatus.Building || job.Status == BuildJobStatus.Syncing)
            {
                  return (isTrackedJobActive?.Invoke(job.JobGuid) ?? false) ||
                       WorkspaceOperationStateService.IsOperationActive(job.JobGuid) ||
                       isExecuting;
            }

            return false;
        }

        private static bool HasVerifiedActiveWorkspaceForProfile(string profileGuid)
        {
            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return false;
            }

            List<WorkspaceInfo> activeOperations = WorkspaceOperationStateService.GetActiveOperations();
            DateTime nowUtc = DateTime.UtcNow;
            for (int i = 0; i < activeOperations.Count; i++)
            {
                WorkspaceInfo workspace = activeOperations[i];
                if (workspace == null || !string.Equals(workspace.ProfileGuid, profileGuid, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
                {
                    return true;
                }
            }

            return false;
        }

        public static bool IsCurrentlyExecutingJob(
            BuildJobDefinition job,
            BuildQueueRuntimeState runtimeState,
            IDictionary<string, ExecutingStateCacheEntry> executingStateCache,
            double now,
            double cacheSeconds,
            Func<string, WorkspaceInfo> getWorkspace,
            Func<WorkspaceInfo, bool> isProcessAlive)
        {
            if (job == null)
            {
                return false;
            }

            if (runtimeState != null &&
                runtimeState.IsOperationRunning &&
                string.Equals(runtimeState.ActiveJobGuid, job.JobGuid, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return false;
            }

            if (executingStateCache != null &&
                executingStateCache.TryGetValue(job.JobGuid, out ExecutingStateCacheEntry cached) &&
                now < cached.ExpiresAt)
            {
                return cached.IsExecuting;
            }

            WorkspaceInfo workspace = getWorkspace != null ? getWorkspace(job.JobGuid) : null;
            bool isExecuting = isProcessAlive != null && isProcessAlive(workspace);

            if (executingStateCache != null)
            {
                executingStateCache[job.JobGuid] = new ExecutingStateCacheEntry(isExecuting, now + cacheSeconds);
            }

            return isExecuting;
        }

        public static bool CanOpenBuildFolder(
            BuildJobDefinition job,
            IDictionary<string, OpenBuildFolderCheckCacheEntry> openBuildFolderCheckCache,
            double now,
            double cacheSeconds,
            Func<BuildJobDefinition, bool> canResolveOpenableBuildOutputDirectory)
        {
            if (job == null || !IsTerminalStatus(job.Status))
            {
                return false;
            }

            string cacheKey = string.IsNullOrWhiteSpace(job.JobGuid)
                ? string.Concat("job-", job.GetHashCode())
                : job.JobGuid;

            if (openBuildFolderCheckCache != null &&
                openBuildFolderCheckCache.TryGetValue(cacheKey, out OpenBuildFolderCheckCacheEntry cached) &&
                now < cached.ExpiresAt)
            {
                return cached.CanOpen;
            }

            bool canOpen = canResolveOpenableBuildOutputDirectory != null &&
                           canResolveOpenableBuildOutputDirectory(job);

            if (openBuildFolderCheckCache != null)
            {
                openBuildFolderCheckCache[cacheKey] = new OpenBuildFolderCheckCacheEntry(canOpen, now + cacheSeconds);
            }

            return canOpen;
        }
    }
}
