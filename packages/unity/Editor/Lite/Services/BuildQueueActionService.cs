using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class BuildQueueActionService
    {
        public readonly struct DeleteJobPrompt
        {
            public DeleteJobPrompt(string message, bool canDeleteProjectFolder)
            {
                Message = message;
                CanDeleteProjectFolder = canDeleteProjectFolder;
            }

            public string Message { get; }
            public bool CanDeleteProjectFolder { get; }
        }

        public readonly struct StaleCancelResolution
        {
            public StaleCancelResolution(bool isResolved, BuildJobStatus finalStatus, string detail, string repaintReason)
            {
                IsResolved = isResolved;
                FinalStatus = finalStatus;
                Detail = detail;
                RepaintReason = repaintReason;
            }

            public bool IsResolved { get; }
            public BuildJobStatus FinalStatus { get; }
            public string Detail { get; }
            public string RepaintReason { get; }
        }

        public readonly struct DeleteAllEvaluation
        {
            public DeleteAllEvaluation(List<BuildJobDefinition> deletableJobs, int jobsWithFolderDeleteAvailable)
            {
                DeletableJobs = deletableJobs ?? new List<BuildJobDefinition>();
                JobsWithFolderDeleteAvailable = jobsWithFolderDeleteAvailable;
            }

            public List<BuildJobDefinition> DeletableJobs { get; }
            public int JobsWithFolderDeleteAvailable { get; }
        }

        public readonly struct DeleteAllExecutionResult
        {
            public DeleteAllExecutionResult(int removedCount, int removedWithFolderCount)
            {
                RemovedCount = removedCount;
                RemovedWithFolderCount = removedWithFolderCount;
            }

            public int RemovedCount { get; }
            public int RemovedWithFolderCount { get; }
        }

        public static DeleteAllEvaluation EvaluateDeleteAllCandidates(
            IEnumerable<BuildJobDefinition> jobs,
            Func<BuildJobDefinition, bool> canDeleteJob,
            Func<BuildJobDefinition, WorkspaceInfo> resolveDeleteTarget,
            Func<WorkspaceInfo, bool> canDeleteProjectFolder)
        {
            var deletableJobs = new List<BuildJobDefinition>();
            int jobsWithFolderDeleteAvailable = 0;

            if (jobs == null)
            {
                return new DeleteAllEvaluation(deletableJobs, jobsWithFolderDeleteAvailable);
            }

            foreach (BuildJobDefinition job in jobs)
            {
                if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
                {
                    continue;
                }

                if (canDeleteJob != null && !canDeleteJob(job))
                {
                    continue;
                }

                deletableJobs.Add(job);
                WorkspaceInfo workspaceInfo = resolveDeleteTarget != null ? resolveDeleteTarget(job) : null;
                if (canDeleteProjectFolder != null && canDeleteProjectFolder(workspaceInfo))
                {
                    jobsWithFolderDeleteAvailable++;
                }
            }

            return new DeleteAllEvaluation(deletableJobs, jobsWithFolderDeleteAvailable);
        }

        public static DeleteAllExecutionResult ExecuteDeleteAll(
            IReadOnlyList<BuildJobDefinition> deletableJobs,
            bool deleteFoldersWhenAllowed,
            Func<BuildJobDefinition, WorkspaceInfo> resolveDeleteTarget,
            Func<WorkspaceInfo, bool> canDeleteProjectFolder,
            Func<string, bool, string, string, bool> deleteJobEntry)
        {
            int removedCount = 0;
            int removedWithFolderCount = 0;

            if (deletableJobs == null || deleteJobEntry == null)
            {
                return new DeleteAllExecutionResult(removedCount, removedWithFolderCount);
            }

            for (int i = 0; i < deletableJobs.Count; i++)
            {
                BuildJobDefinition job = deletableJobs[i];
                if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
                {
                    continue;
                }

                WorkspaceInfo workspaceInfo = resolveDeleteTarget != null ? resolveDeleteTarget(job) : null;
                bool deleteFolder = deleteFoldersWhenAllowed && canDeleteProjectFolder != null && canDeleteProjectFolder(workspaceInfo);

                bool removed = deleteJobEntry(job.JobGuid, deleteFolder, workspaceInfo?.WorkspacePath, workspaceInfo?.ProfileGuid);
                if (!removed)
                {
                    continue;
                }

                removedCount++;
                if (deleteFolder)
                {
                    removedWithFolderCount++;
                }
            }

            return new DeleteAllExecutionResult(removedCount, removedWithFolderCount);
        }

        public static bool TryRetryJob(BuildJobDefinition job, Func<BuildJobDefinition, bool> retryJob)
        {
            return job != null && retryJob != null && retryJob(job);
        }

        public static bool TryCancelDetachedActiveJob(
            BuildJobDefinition job,
            Func<string, bool> cancelDetachedOperation,
            Func<string, bool> queueHasJob,
            Func<string, bool> cancelQueuedJob)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return false;
            }

            bool cancelled = cancelDetachedOperation != null && cancelDetachedOperation(job.JobGuid);
            if (!cancelled)
            {
                return false;
            }

            try
            {
                if (queueHasJob != null && queueHasJob(job.JobGuid))
                {
                    cancelQueuedJob?.Invoke(job.JobGuid);
                }
            }
            catch
            {
                // Detached cancel can still succeed even if queue state is stale.
            }

            return true;
        }

        public static StaleCancelResolution TryResolveStaleActiveJobAsCancelled(
            BuildJobDefinition job,
            Func<string, WorkspaceInfo> getWorkspaceInfo,
            Func<WorkspaceInfo, BuildJobStatus> normalizeWorkspaceStatus,
            Func<BuildJobStatus, bool> isTerminalStatus,
            Func<WorkspaceInfo, string> getWorkspaceStatusDetail,
            Func<string, BuildJobStatus, string, bool> markJobTerminal,
            Func<string, bool> cancelJob)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return new StaleCancelResolution(false, BuildJobStatus.Cancelled, string.Empty, string.Empty);
            }

            try
            {
                WorkspaceInfo workspace = getWorkspaceInfo?.Invoke(job.JobGuid);
                if (workspace != null && !workspace.IsOperationActive)
                {
                    BuildJobStatus workspaceStatus = normalizeWorkspaceStatus != null
                        ? normalizeWorkspaceStatus(workspace)
                        : workspace.LastBuildStatus;
                    BuildJobStatus finalStatus = isTerminalStatus != null && isTerminalStatus(workspaceStatus)
                        ? workspaceStatus
                        : BuildJobStatus.Cancelled;

                    string detail = getWorkspaceStatusDetail != null ? getWorkspaceStatusDetail(workspace) : string.Empty;
                    if (string.IsNullOrWhiteSpace(detail))
                    {
                        detail = "Cancelled by user.";
                    }

                    if (markJobTerminal != null && markJobTerminal(job.JobGuid, finalStatus, detail))
                    {
                        return new StaleCancelResolution(true, finalStatus, detail, "Resolve stale active job");
                    }
                }

                if (cancelJob != null && cancelJob(job.JobGuid))
                {
                    return new StaleCancelResolution(true, BuildJobStatus.Cancelled, "Cancelled by user.", "Cancel stale queue job");
                }
            }
            catch
            {
                // Fall through to unresolved state; caller can show no-active dialog.
            }

            return new StaleCancelResolution(false, BuildJobStatus.Cancelled, string.Empty, string.Empty);
        }

        public static bool TryOpenBuildOutputDirectory(string directory, bool openDirectoryDirectly, Action<string> openPath, Action<string> revealPath, out string error)
        {
            error = null;

            if (string.IsNullOrWhiteSpace(directory))
            {
                error = "Could not resolve a valid build output directory for this job. Ensure expected output artifacts (or output directory for non-Unity-output runs) exist.";
                return false;
            }

            try
            {
                if (openDirectoryDirectly)
                {
                    openPath?.Invoke(directory);
                    return true;
                }

                revealPath?.Invoke(directory);
                return true;
            }
            catch (Exception ex)
            {
                error = $"Failed to open build folder:\n{directory}\n\n{ex.Message}";
                return false;
            }
        }

        public static DeleteJobPrompt BuildDeleteJobPrompt(BuildJobDefinition job, WorkspaceInfo workspaceInfo, bool canDeleteProjectFolder)
        {
            string workspacePath = workspaceInfo?.WorkspacePath ?? string.Empty;

            if (canDeleteProjectFolder)
            {
                return new DeleteJobPrompt(
                    $"Delete job {job.JobGuid} from build history and the workspace registry?\n\nTarget project folder:\n{workspacePath}\n\nYou can also delete the target project folder if you no longer need it.",
                    true);
            }

            return new DeleteJobPrompt(
                string.IsNullOrWhiteSpace(workspacePath)
                    ? $"Delete job {job.JobGuid} from build history and the workspace registry?\n\nYou can also choose 'Delete Job + Folder'. CADET will remove the job folder only when it can resolve a safe workspace path for this job."
                    : $"Delete job {job.JobGuid} from build history and the workspace registry?\n\nTarget project folder:\n{workspacePath}\n\nYou can also choose 'Delete Job + Folder'. CADET will remove the job folder only when it passes the workspace safety checks.",
                false);
        }

        public static bool TryResolveDeleteJobSelection(bool canDeleteProjectFolder, int? complexChoice, bool? simpleConfirmed, out bool deleteProjectFolder)
        {
            deleteProjectFolder = false;

            if (!complexChoice.HasValue || complexChoice.Value == 2)
            {
                return false;
            }

            deleteProjectFolder = complexChoice.Value == 1;
            return true;
        }

        public static bool ExecuteDeleteJob(
            BuildJobDefinition job,
            bool deleteProjectFolder,
            WorkspaceInfo workspaceInfo,
            Func<string, bool, string, string, bool> deleteJobEntry)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid) || deleteJobEntry == null)
            {
                return false;
            }

            return deleteJobEntry(job.JobGuid, deleteProjectFolder, workspaceInfo?.WorkspacePath, workspaceInfo?.ProfileGuid);
        }
    }
}
