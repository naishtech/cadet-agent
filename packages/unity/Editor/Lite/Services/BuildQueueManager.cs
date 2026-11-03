using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Events;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    /// <summary>
    /// Manages in-memory tracked jobs and workspace-backed execution history.
    /// Singleton pattern for global access across Editor sessions.
    /// Thread-safe: All operations on shared state use lock(_lock).
    /// </summary>
    public class BuildQueueManager
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";
        private const string MinimumLevelEditorPrefsKey = "CADET_UnityConsoleMinimumLevel";
        private const int DebugLevel = 0;
        private const int WarnLevel = 2;
        private const int ErrorLevel = 3;
        private static int _cachedMinimumLevel = ErrorLevel;
        private static BuildQueueManager _instance;
        private static object _instanceLock = new object();
        
        private RuntimeState _state;
        private object _lock = new object();

        /// <summary>
        /// Get or create the singleton instance
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public static BuildQueueManager Instance
        {
            get
            {
                if (_instance == null)
                {
                    lock (_instanceLock)
                    {
                        if (_instance == null)
                        {
                            _instance = new BuildQueueManager();
                        }
                    }
                }
                return _instance;
            }
        }

        /// <summary>
        /// Number of compatibility pending jobs retained in the legacy queued bucket.
        /// </summary>
        public int PendingCompatibilityCount => _state.QueuedJobs.Count;

        /// <summary>
        /// Number of actively running jobs.
        /// </summary>
        public int ActiveExecutionCount => _state.ActiveJobs.Count;

        /// <summary>
        /// Number of completed jobs retained in execution history.
        /// </summary>
        public int HistoryCount => _state.CompletedJobs.Count;

        /// <summary>
        /// Compatibility wrapper for legacy queue-oriented callers.
        /// </summary>
        public int QueuedCount => PendingCompatibilityCount;

        /// <summary>
        /// Compatibility wrapper for legacy queue-oriented callers.
        /// </summary>
        public int ActiveCount => ActiveExecutionCount;

        /// <summary>
        /// Compatibility wrapper for legacy queue-oriented callers.
        /// </summary>
        public int CompletedCount => HistoryCount;

        /// <summary>
        /// Returns true if the profile already has a pending compatibility or active job.
        /// Prevents duplicate profile jobs from being tracked before the workspace
        /// registry reflects the in-progress state.
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public bool HasJobInProgress(string profileGuid)
        {
            if (string.IsNullOrWhiteSpace(profileGuid))
            {
                return false;
            }

            lock (_lock)
            {
                DateTime nowUtc = DateTime.UtcNow;

                for (int i = 0; i < _state.QueuedJobs.Count; i++)
                {
                    BuildJobDefinition queuedJob = _state.QueuedJobs[i];
                    if (!ProfileGuidEquals(queuedJob?.ProfileGuid, profileGuid))
                    {
                        continue;
                    }

                    WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(queuedJob.JobGuid);
                    if (workspace == null)
                    {
                        return true;
                    }

                    if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
                    {
                        return true;
                    }

                    if (!IsTerminalStatus(workspace.LastBuildStatus))
                    {
                        return true;
                    }
                }

                for (int i = 0; i < _state.ActiveJobs.Count; i++)
                {
                    BuildJobDefinition activeJob = _state.ActiveJobs[i];
                    if (!ProfileGuidEquals(activeJob?.ProfileGuid, profileGuid))
                    {
                        continue;
                    }

                    WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(activeJob.JobGuid);
                    if (workspace == null)
                    {
                        return true;
                    }

                    if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
                    {
                        return true;
                    }

                    if (IsTerminalStatus(workspace.LastBuildStatus) && !workspace.IsOperationActive)
                    {
                        continue;
                    }

                    if (HasExplicitInactiveOperationEvidence(workspace))
                    {
                        continue;
                    }

                    return true;
                }

                return false;
            }
        }

        /// <summary>
        /// Create a new execution-history manager.
        /// Private constructor for singleton pattern; tests may instantiate directly.
        /// </summary>
        public BuildQueueManager()
        {
            _state = new RuntimeState();
        }

        #region Core Execution Tracking

        /// <summary>
        /// Add a pending job to the legacy compatibility bucket.
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public void AddPendingJob(BuildJobDefinition job)
        {
            if (job == null)
                throw new ArgumentNullException(nameof(job));

            lock (_lock)
            {
                EnsureJobInitialized(job);
                LogDiagnostic($"AddPendingJob requested for job '{job.JobGuid}' profile '{job.ProfileGuid}' status '{job.Status}' detail '{job.StatusDetail}'. {FormatCounts()}");

                if (HasConflictingLiveJob(job))
                {
                    return;
                }

                RemoveCompletedDuplicates(job.JobGuid);
                ResetJobForPendingCompatibilityTracking(job);

                _state.QueuedJobs.Add(job);
                LogDiagnostic($"AddPendingJob accepted for job '{job.JobGuid}'. {FormatCounts()}");
                
            }
        }

        /// <summary>
        /// Compatibility wrapper for older queue-oriented callers.
        /// </summary>
        public void Enqueue(BuildJobDefinition job)
        {
            AddPendingJob(job);
        }

        /// <summary>
        /// Track a job as actively executing.
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public void TrackActiveJob(BuildJobDefinition job)
        {
            if (job == null)
                throw new ArgumentNullException(nameof(job));

            lock (_lock)
            {
                EnsureJobInitialized(job);
                _state.QueuedJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, job.JobGuid));
                _state.CompletedJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, job.JobGuid));
                
                if (_state.ActiveJobs.Any(existing => JobGuidEquals(existing?.JobGuid, job.JobGuid)))
                {
                    return;
                }

                job.Status = BuildJobStatus.Building;
                job.StartTime ??= DateTime.UtcNow;
                _state.ActiveJobs.Add(job);
                LogDiagnostic($"TrackActiveJob activated '{job.JobGuid}'. {FormatCounts()}");
                SyncWorkspaceStatus(job, BuildJobStatus.Building);

            }
        }

        /// <summary>
        /// Compatibility wrapper for older queue-oriented callers.
        /// </summary>
        public void StartJob(BuildJobDefinition job)
        {
            TrackActiveJob(job);
        }

        /// <summary>
        /// Execute a job immediately.
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public void ExecuteImmediately(BuildJobDefinition job)
        {
            TrackActiveJob(job);
        }

        #endregion

        /// <summary>
        /// Check if a specific job is currently active
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public bool IsJobActive(string jobGuid)
        {
            lock (_lock)
            {
                return _state.ActiveJobs.Any(j => JobGuidEquals(j?.JobGuid, jobGuid));
            }
        }

        #region Cancellation

        /// <summary>
        /// Cancel a job from compatibility pending storage or active execution.
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public bool CancelJob(string jobGuid)
        {
            lock (_lock)
            {
                // Check pending compatibility jobs.
                var pendingJob = _state.QueuedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                if (pendingJob != null)
                {
                    if (pendingJob.Status == BuildJobStatus.Completed ||
                        pendingJob.Status == BuildJobStatus.Failed ||
                        pendingJob.Status == BuildJobStatus.Cancelled)
                    {
                        throw new InvalidOperationException($"Cannot cancel job in status: {pendingJob.Status}");
                    }

                    pendingJob.Status = BuildJobStatus.Cancelled;
                    pendingJob.CompletionTime = DateTime.UtcNow;
                    _state.QueuedJobs.Remove(pendingJob);
                    _state.CompletedJobs.Add(pendingJob);
                    LogDiagnostic($"CancelJob cancelled pending compatibility job '{jobGuid}'. {FormatCounts()}");
                    SyncWorkspaceStatus(pendingJob, BuildJobStatus.Cancelled);
                    return true;
                }

                // Check active jobs
                var activeJob = _state.ActiveJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                if (activeJob != null)
                {
                    if (activeJob.Status == BuildJobStatus.Completed || 
                        activeJob.Status == BuildJobStatus.Failed ||
                        activeJob.Status == BuildJobStatus.Cancelled)
                    {
                        throw new InvalidOperationException($"Cannot cancel job in status: {activeJob.Status}");
                    }

                    activeJob.Status = BuildJobStatus.Cancelled;
                    activeJob.CompletionTime = DateTime.UtcNow;
                    _state.ActiveJobs.Remove(activeJob);
                    _state.CompletedJobs.Add(activeJob);
                    LogDiagnostic($"CancelJob cancelled active job '{jobGuid}'. {FormatCounts()}");
                    SyncWorkspaceStatus(activeJob, BuildJobStatus.Cancelled);
                    
                    // TODO: Kill process using ProcessKiller if ProcessId is set
                    
                    return true;
                }

                var completedJob = _state.CompletedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                if (completedJob != null)
                {
                    throw new InvalidOperationException($"Cannot cancel job in status: {completedJob.Status}");
                }

                return false;
            }
        }

        public bool DeleteJobEntry(string jobGuid, bool deleteProjectFolder, string workspacePathOverride = null, string profileGuidOverride = null)
        {
            lock (_lock)
            {
                bool removed = false;

                var queuedJob = _state.QueuedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                if (queuedJob != null && IsTerminalStatus(queuedJob.Status))
                {
                    _state.QueuedJobs.Remove(queuedJob);
                    removed = true;
                }

                var activeJob = _state.ActiveJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                bool removeOrphanedActiveJob = activeJob != null && CanDeleteOrphanedActiveJob(jobGuid);
                if (activeJob != null && (IsTerminalStatus(activeJob.Status) || removeOrphanedActiveJob))
                {
                    _state.ActiveJobs.Remove(activeJob);
                    removed = true;

                    if (removeOrphanedActiveJob)
                    {
                        ClearStaleRuntimeState(jobGuid);
                    }
                }

                var completedJob = _state.CompletedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                if (completedJob != null)
                {
                    _state.CompletedJobs.Remove(completedJob);
                    removed = true;
                }

                removed = RemoveWorkspaceRecord(jobGuid, deleteProjectFolder, workspacePathOverride, profileGuidOverride) || removed;

                if (removed)
                {
                }

                return removed;
            }
        }

        private static bool CanDeleteOrphanedActiveJob(string jobGuid)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return false;
            }

            WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(jobGuid);
            if (workspace != null && BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, DateTime.UtcNow))
            {
                return false;
            }

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            return runtimeState == null ||
                   !runtimeState.IsOperationRunning ||
                   !JobGuidEquals(runtimeState.ActiveJobGuid, jobGuid);
        }

        private static void ClearStaleRuntimeState(string jobGuid)
        {
            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            if (runtimeState == null ||
                !JobGuidEquals(runtimeState.ActiveJobGuid, jobGuid))
            {
                return;
            }

            runtimeState.ActiveJobGuid = null;
            runtimeState.ActiveStatusText = string.Empty;
            runtimeState.IsOperationRunning = false;
            runtimeState.CancelActiveOperation = null;
        }

        #endregion

        #region Job Completion

        /// <summary>
        /// Mark a job as completed and move to history
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public void CompleteJob(string jobGuid, BuildJobStatus finalStatus)
        {
            lock (_lock)
            {
                var job = _state.ActiveJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                if (job == null)
                    throw new ArgumentException($"Job {jobGuid} not found in active jobs");

                BuildTerminalOutcomePolicy.NormalizeTerminalOutcome(
                    finalStatus,
                    job.StatusDetail,
                    out BuildJobStatus normalizedStatus,
                    out string normalizedDetail);

                job.Status = normalizedStatus;
                if (!string.IsNullOrWhiteSpace(normalizedDetail))
                {
                    job.StatusDetail = normalizedDetail;
                }
                job.CompletionTime = DateTime.UtcNow;
                
                _state.ActiveJobs.Remove(job);
                _state.CompletedJobs.Add(job);
                LogDiagnostic($"CompleteJob moved '{jobGuid}' to terminal status '{normalizedStatus}' with detail '{job.StatusDetail}'. {FormatCounts()}");
                SyncWorkspaceStatus(job, normalizedStatus);
                job.OnStatusChanged ??= new UnityEvent<string>();
                string statusText = BuildQueueStatusTextService.GetRowStatusLabel(job);
                if (string.IsNullOrWhiteSpace(statusText))
                {
                    statusText = normalizedStatus.ToString();
                }
                job.OnStatusChanged.Invoke(statusText);
                
            }
        }

        public bool MarkJobTerminal(string jobGuid, BuildJobStatus finalStatus, string statusDetail = null)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return false;
            }

            lock (_lock)
            {
                BuildJobDefinition job = _state.ActiveJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                if (job != null)
                {
                    _state.ActiveJobs.Remove(job);
                    _state.CompletedJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, jobGuid));
                    _state.CompletedJobs.Add(job);
                }
                else
                {
                    job = _state.QueuedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                    if (job != null)
                    {
                        _state.QueuedJobs.Remove(job);
                        _state.CompletedJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, jobGuid));
                        _state.CompletedJobs.Add(job);
                    }
                    else
                    {
                        job = _state.CompletedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
                    }
                }

                if (job == null)
                {
                    LogDiagnostic($"MarkJobTerminal found no tracked job for '{jobGuid}'. {FormatCounts()}");
                    return false;
                }

                string detailForNormalization = !string.IsNullOrWhiteSpace(statusDetail)
                    ? statusDetail
                    : job.StatusDetail;
                BuildTerminalOutcomePolicy.NormalizeTerminalOutcome(
                    finalStatus,
                    detailForNormalization,
                    out BuildJobStatus normalizedStatus,
                    out string normalizedDetail);

                EnsureJobInitialized(job);
                job.Status = normalizedStatus;
                job.ProcessId = 0;
                job.CompletionTime = DateTime.UtcNow;
                if (!string.IsNullOrWhiteSpace(normalizedDetail))
                {
                    job.StatusDetail = normalizedDetail;
                }

                LogDiagnostic($"MarkJobTerminal set '{jobGuid}' to '{normalizedStatus}' with detail '{job.StatusDetail}'. {FormatCounts()}");

                SyncWorkspaceStatus(job, normalizedStatus);
                job.OnStatusChanged ??= new UnityEvent<string>();
                string statusText = BuildQueueStatusTextService.GetRowStatusLabel(job);
                if (string.IsNullOrWhiteSpace(statusText))
                {
                    statusText = normalizedStatus.ToString();
                }
                job.OnStatusChanged.Invoke(statusText);

                return true;
            }
        }

        public bool CanRetryJob(BuildJobDefinition job)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return false;
            }

            lock (_lock)
            {
                BuildJobDefinition tracked = GetJobInternal(job.JobGuid) ?? job;
                return IsTerminalStatus(tracked.Status);
            }
        }

        public bool RetryJob(BuildJobDefinition job)
        {
            return RetryJobDirect(job) != null;
        }

        public BuildJobDefinition RetryJobDirect(BuildJobDefinition job)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return null;
            }

            lock (_lock)
            {
                BuildJobDefinition tracked = GetJobInternal(job.JobGuid) ?? CloneJob(job);
                if (!IsTerminalStatus(tracked.Status))
                {
                    return null;
                }

                if (!string.IsNullOrWhiteSpace(tracked.ProfileGuid) && HasJobInProgress(tracked.ProfileGuid))
                {
                    LogDiagnosticWarning(
                        $"Rejecting retry for job '{tracked.JobGuid}' because profile '{tracked.ProfileGuid}' already has an in-progress job. {FormatCounts()}");
                    return null;
                }

                _state.ActiveJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, tracked.JobGuid));
                _state.CompletedJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, tracked.JobGuid));
                _state.QueuedJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, tracked.JobGuid));

                EnsureRetryableOperations(tracked, job);
                ResetJobForPendingCompatibilityTracking(tracked);
                tracked.Status = BuildJobStatus.Building;
                tracked.StartTime = DateTime.UtcNow;
                tracked.StatusDetail = $"Running operations: {string.Join(", ", GetOperations(tracked))}";

                _state.ActiveJobs.Add(tracked);
                LogDiagnostic($"RetryJobDirect activated '{tracked.JobGuid}'. {FormatCounts()}");
                SyncWorkspaceStatus(tracked, BuildJobStatus.Building);
                return tracked;
            }
        }

        /// <summary>
        /// Add a job directly to history (for testing or external completion)
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public void AddToHistory(BuildJobDefinition job)
        {
            if (job == null)
                throw new ArgumentNullException(nameof(job));

            lock (_lock)
            {
                EnsureJobInitialized(job);
                if (!IsTerminalStatus(job.Status))
                {
                    job.Status = BuildJobStatus.Completed;
                    job.ProcessId = 0;
                    job.CompletionTime ??= DateTime.UtcNow;
                    if (LooksLikeActiveStatusDetail(job.StatusDetail))
                    {
                        job.StatusDetail = "Completed successfully";
                    }
                }

                if (!_state.CompletedJobs.Contains(job))
                {
                    _state.CompletedJobs.Add(job);
                    SyncWorkspaceStatus(job, job.Status);
                }
            }
        }

        #endregion

        #region Job Tracking

        /// <summary>
        /// Get a job by its GUID
        /// Thread-safe: Uses lock for synchronized access
        /// </summary>
        public BuildJobDefinition GetJobByGuid(string jobGuid)
        {
            lock (_lock)
            {
                return _state.QueuedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid)) ??
                       _state.ActiveJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid)) ??
                       _state.CompletedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
            }
        }

        /// <summary>
        /// Get GUIDs of all currently active (non-terminal) jobs
        /// Thread-safe: Returns a copy to prevent external modification
        /// </summary>
        public List<string> GetActiveJobGuids()
        {
            lock (_lock)
            {
                return _state.ActiveJobs
                    .Where(j => !string.IsNullOrWhiteSpace(j?.JobGuid))
                    .Select(j => j.JobGuid)
                    .ToList();
            }
        }

        /// <summary>
        /// Get all jobs across all states
        /// Thread-safe: Returns a copy to prevent external modification
        /// </summary>
        public List<BuildJobDefinition> GetAllJobs()
        {
            lock (_lock)
            {
                var allJobs = new List<BuildJobDefinition>();
                allJobs.AddRange(_state.QueuedJobs);
                allJobs.AddRange(_state.ActiveJobs);
                allJobs.AddRange(_state.CompletedJobs);
                return allJobs;
            }
        }

        /// <summary>
        /// Get execution-status summary across compatibility pending storage, active work, and history.
        /// Thread-safe: Uses lock for synchronized access.
        /// </summary>
        public BuildExecutionStatusSummary GetExecutionStatusSummary()
        {
            lock (_lock)
            {
                DateTime nowUtc = DateTime.UtcNow;
                var effectiveByJobGuid = new Dictionary<string, BuildJobStatus>(StringComparer.OrdinalIgnoreCase);
                int syntheticId = 0;

                // Start with tracked in-memory buckets, then let workspace liveness override stale terminals.
                AddJobsToEffectiveStatusMap(_state.CompletedJobs, effectiveByJobGuid, ref syntheticId, nowUtc);
                AddJobsToEffectiveStatusMap(_state.QueuedJobs, effectiveByJobGuid, ref syntheticId, nowUtc);
                AddJobsToEffectiveStatusMap(_state.ActiveJobs, effectiveByJobGuid, ref syntheticId, nowUtc);

                // Overlay durable active workspace evidence so an in-progress detached build never appears as completed.
                List<WorkspaceInfo> activeWorkspaces = WorkspaceOperationStateService.GetActiveOperations();
                for (int i = 0; i < activeWorkspaces.Count; i++)
                {
                    WorkspaceInfo workspace = activeWorkspaces[i];
                    if (workspace == null || string.IsNullOrWhiteSpace(workspace.JobGuid))
                    {
                        continue;
                    }

                    string normalizedJobGuid = workspace.JobGuid.Trim();
                    if (!effectiveByJobGuid.ContainsKey(normalizedJobGuid))
                    {
                        continue;
                    }

                    if (!BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
                    {
                        continue;
                    }

                    effectiveByJobGuid[normalizedJobGuid] = NormalizeActiveStatus(workspace.LastBuildStatus);
                }

                int pendingCompatibilityCount = 0;
                int activeExecutionCount = 0;
                int historyCount = 0;

                foreach (BuildJobStatus status in effectiveByJobGuid.Values)
                {
                    if (status == BuildJobStatus.Queued)
                    {
                        pendingCompatibilityCount++;
                    }
                    else if (IsTerminalStatus(status))
                    {
                        historyCount++;
                    }
                    else
                    {
                        activeExecutionCount++;
                    }
                }

                return new BuildExecutionStatusSummary
                {
                    PendingCompatibilityCount = pendingCompatibilityCount,
                    ActiveExecutionCount = activeExecutionCount,
                    HistoryCount = historyCount,
                    TotalCount = effectiveByJobGuid.Count
                };
            }
        }

        /// <summary>
        /// Compatibility wrapper for legacy queue-oriented callers.
        /// </summary>
        public QueueStatus GetQueueStatus()
        {
            BuildExecutionStatusSummary summary = GetExecutionStatusSummary();
            return new QueueStatus
            {
                QueuedCount = summary.PendingCompatibilityCount,
                ActiveCount = summary.ActiveExecutionCount,
                CompletedCount = summary.HistoryCount,
                TotalCount = summary.TotalCount
            };
        }

        private static BuildJobStatus NormalizeActiveStatus(BuildJobStatus status)
        {
            return IsTerminalStatus(status) ? BuildJobStatus.Building : status;
        }

        private static string BuildEffectiveKey(BuildJobDefinition job, ref int syntheticId)
        {
            if (!string.IsNullOrWhiteSpace(job?.JobGuid))
            {
                return job.JobGuid.Trim();
            }

            syntheticId++;
            return $"__synthetic_{syntheticId}";
        }

        private static BuildJobStatus ResolveEffectiveStatus(BuildJobDefinition job, DateTime nowUtc)
        {
            if (job == null)
            {
                return BuildJobStatus.Failed;
            }

            BuildJobStatus status = job.Status;
            if (string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return status;
            }

            WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(job.JobGuid);
            if (workspace == null)
            {
                return status;
            }

            if (BuildOperationLivenessService.IsVerifiedActiveOperation(workspace, nowUtc))
            {
                return NormalizeActiveStatus(workspace.LastBuildStatus);
            }

            if (IsTerminalStatus(workspace.LastBuildStatus))
            {
                return workspace.LastBuildStatus;
            }

            return status;
        }

        private static void AddJobsToEffectiveStatusMap(
            List<BuildJobDefinition> jobs,
            Dictionary<string, BuildJobStatus> effectiveByJobGuid,
            ref int syntheticId,
            DateTime nowUtc)
        {
            if (jobs == null)
            {
                return;
            }

            for (int i = 0; i < jobs.Count; i++)
            {
                BuildJobDefinition job = jobs[i];
                string key = BuildEffectiveKey(job, ref syntheticId);
                effectiveByJobGuid[key] = ResolveEffectiveStatus(job, nowUtc);
            }
        }

        #endregion

        private static bool IsTerminalStatus(BuildJobStatus status)
        {
            return status == BuildJobStatus.Completed ||
                   status == BuildJobStatus.Failed ||
                   status == BuildJobStatus.Cancelled;
        }

        private static bool HasExplicitInactiveOperationEvidence(WorkspaceInfo workspace)
        {
            if (workspace == null || workspace.IsOperationActive)
            {
                return false;
            }

            return workspace.ActiveProcessId > 0 ||
                   workspace.ActiveProcessStartedAtUtc.HasValue ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveStatusDetail) ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveLogPath) ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveStatusManifestPath) ||
                   !string.IsNullOrWhiteSpace(workspace.ActiveStatusLaunchToken);
        }

        private bool RemoveWorkspaceRecord(string jobGuid, bool deleteProjectFolder, string workspacePathOverride, string profileGuidOverride)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return false;
            }

            try
            {
                string workspacesRoot = Path.GetFullPath(CadetLitePathService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
                var workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);
                return workspaceManager.RemoveWorkspaceRecord(jobGuid, deleteProjectFolder, workspacePathOverride, profileGuidOverride);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[C.A.D.E.T] Failed to remove workspace record for job {jobGuid}: {ex.Message}");
                return false;
            }
        }

        private void SyncWorkspaceStatus(BuildJobDefinition job, BuildJobStatus status)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return;
            }

            try
            {
                string workspacesRoot = Path.GetFullPath(CadetLitePathService.GetWorkspacesRoot())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
                var workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);

                WorkspaceInfo existing = workspaceManager.GetWorkspaceByJobGuid(job.JobGuid);
                if (!ShouldPersistWorkspaceRecord(job, status, existing))
                {
                    return;
                }

                if (IsTerminalStatus(status))
                {
                    BuildJobStatus seedStatus = existing != null && !IsTerminalStatus(existing.LastBuildStatus)
                        ? existing.LastBuildStatus
                        : BuildJobStatus.Building;

                    workspaceManager.UpsertWorkspaceRecord(
                        job.JobGuid,
                        job.ProfileGuid ?? existing?.ProfileGuid ?? string.Empty,
                        existing?.ProfileJsonPath ?? string.Empty,
                        !string.IsNullOrWhiteSpace(job.WorkspacePath) ? job.WorkspacePath : existing?.WorkspacePath ?? string.Empty,
                        seedStatus,
                        job.ProfileName ?? existing?.ProfileName ?? string.Empty);

                    PersistTerminalWorkspaceSummary(workspaceManager, job, status);
                    return;
                }

                string workspacePath = !string.IsNullOrWhiteSpace(job.WorkspacePath)
                    ? job.WorkspacePath
                    : existing?.WorkspacePath ?? string.Empty;
                string profileJsonPath = existing?.ProfileJsonPath ?? string.Empty;

                workspaceManager.UpsertWorkspaceRecord(
                    job.JobGuid,
                    job.ProfileGuid ?? existing?.ProfileGuid ?? string.Empty,
                    profileJsonPath,
                    workspacePath,
                    status,
                    job.ProfileName ?? existing?.ProfileName ?? string.Empty);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[C.A.D.E.T] Failed to sync workspace status for job {job.JobGuid}: {ex.Message}");
            }
        }

        private static void PersistTerminalWorkspaceSummary(WorkspaceManager workspaceManager, BuildJobDefinition job, BuildJobStatus status)
        {
            if (workspaceManager == null || job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return;
            }

            string operationsSummary = string.Join(", ", GetOperations(job));
            string statusSummary = !string.IsNullOrWhiteSpace(operationsSummary)
                ? operationsSummary
                : null;
            string terminalMessage = !string.IsNullOrWhiteSpace(job.StatusDetail)
                ? job.StatusDetail
                : statusSummary;

            workspaceManager.UpdateTrackedStatusSnapshot(
                job.JobGuid,
                activeStatusDetail: statusSummary,
                completedOperationsSummary: status == BuildJobStatus.Completed ? operationsSummary : null,
                terminalMessage: terminalMessage,
                exitCode: status == BuildJobStatus.Completed ? 0 : (int?)null,
                updatedAtUtc: DateTime.UtcNow);

            workspaceManager.UpdateBuildStatus(job.JobGuid, status);
        }

        private static bool LooksLikeActiveStatusDetail(string statusDetail)
        {
            if (string.IsNullOrWhiteSpace(statusDetail))
            {
                return true;
            }

            return statusDetail.StartsWith("Executing ", StringComparison.OrdinalIgnoreCase) ||
                   statusDetail.StartsWith("Running operations:", StringComparison.OrdinalIgnoreCase) ||
                   statusDetail.StartsWith("Detached dist operation running", StringComparison.OrdinalIgnoreCase) ||
                   statusDetail.StartsWith("Build in progress", StringComparison.OrdinalIgnoreCase);
        }

        private void UpsertCompletedJob(BuildJobDefinition job)
        {
            if (job == null)
            {
                return;
            }

            int existingIndex = _state.CompletedJobs.FindIndex(existing => JobGuidEquals(existing?.JobGuid, job.JobGuid));
            if (existingIndex >= 0)
            {
                _state.CompletedJobs[existingIndex] = job;
            }
            else
            {
                _state.CompletedJobs.Add(job);
            }
        }

        private void UpsertActiveJob(BuildJobDefinition job)
        {
            if (job == null)
            {
                return;
            }

            int existingIndex = _state.ActiveJobs.FindIndex(existing => JobGuidEquals(existing?.JobGuid, job.JobGuid));
            if (existingIndex >= 0)
            {
                _state.ActiveJobs[existingIndex] = job;
            }
            else
            {
                _state.ActiveJobs.Add(job);
            }
        }

        private static void EnsureJobInitialized(BuildJobDefinition job)
        {
            if (job == null)
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(job.JobGuid))
            {
                job.JobGuid = Guid.NewGuid().ToString();
            }

            job.JobGuid = NormalizeGuid(job.JobGuid);
            job.ProfileGuid = NormalizeGuid(job.ProfileGuid);
            job.Status = NormalizeLegacyTerminalStatus(job, job.Status);

            job.OnStatusChanged ??= new UnityEvent<string>();
            job.ProfileName ??= string.Empty;
            job.StatusDetail ??= string.Empty;
        }

        private static BuildJobStatus NormalizeLegacyTerminalStatus(BuildJobDefinition job, BuildJobStatus status)
        {
            bool hasPublishOrNotarizeOps = (job?.RunPublishSteam ?? false) ||
                                           (job?.RunPublishEpic ?? false) ||
                                           (job?.RunNotarizeMac ?? false);

            if (!hasPublishOrNotarizeOps && status == BuildJobStatus.Publishing)
            {
                return BuildJobStatus.Completed;
            }

            if (!hasPublishOrNotarizeOps && status == BuildJobStatus.Notarizing)
            {
                return BuildJobStatus.Failed;
            }

            return status;
        }

        private BuildJobDefinition GetJobInternal(string jobGuid)
        {
             return _state.QueuedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid)) ??
                 _state.ActiveJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid)) ??
                 _state.CompletedJobs.FirstOrDefault(j => JobGuidEquals(j?.JobGuid, jobGuid));
        }

        private static BuildJobDefinition CloneJob(BuildJobDefinition source)
        {
            var clone = new BuildJobDefinition
            {
                JobGuid = source.JobGuid,
                ProfileGuid = source.ProfileGuid,
                WorkspacePath = source.WorkspacePath,
                ProcessId = source.ProcessId,
                Status = source.Status,
                ProfileName = source.ProfileName,
                RunUnityBuild = source.RunUnityBuild,
                RunNotarizeMac = source.RunNotarizeMac,
                RunPublishSteam = source.RunPublishSteam,
                RunPublishEpic = source.RunPublishEpic,
                ShowBlockingSyncDialog = source.ShowBlockingSyncDialog,
                StatusDetail = source.StatusDetail,
                StartTime = source.StartTime,
                CompletionTime = source.CompletionTime,
                OnStatusChanged = new UnityEvent<string>()
            };

            return clone;
        }

        private static void EnsureRetryableOperations(BuildJobDefinition tracked, BuildJobDefinition source)
        {
            if (tracked.RunUnityBuild || tracked.RunNotarizeMac || tracked.RunPublishSteam || tracked.RunPublishEpic)
            {
                return;
            }

            if (source != null)
            {
                tracked.RunUnityBuild = source.RunUnityBuild;
                tracked.RunNotarizeMac = source.RunNotarizeMac;
                tracked.RunPublishSteam = source.RunPublishSteam;
                tracked.RunPublishEpic = source.RunPublishEpic;
                tracked.ShowBlockingSyncDialog = source.ShowBlockingSyncDialog;
            }

            if (!tracked.RunUnityBuild && !tracked.RunNotarizeMac && !tracked.RunPublishSteam && !tracked.RunPublishEpic)
            {
                tracked.RunUnityBuild = true;
            }
        }

        private static void ResetJobForPendingCompatibilityTracking(BuildJobDefinition job)
        {
            EnsureJobInitialized(job);
            job.Status = BuildJobStatus.Queued;
            job.ProcessId = 0;
            job.WorkspacePath = null;
            job.StartTime = null;
            job.CompletionTime = null;
            job.StatusDetail = BuildPendingCompatibilityStatusDetail(job);
        }

        private static string BuildPendingCompatibilityStatusDetail(BuildJobDefinition job)
        {
            string operations = string.Join(", ", GetOperations(job));
            return string.IsNullOrWhiteSpace(operations)
                ? "Queued"
                : $"Queued operations: {operations}";
        }

        private bool HasConflictingLiveJob(BuildJobDefinition job)
        {
            string jobGuid = NormalizeGuid(job?.JobGuid);
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return false;
            }

            bool hasPendingCompatibilityConflict = _state.QueuedJobs.Any(existing => !ReferenceEquals(existing, job) && JobGuidEquals(existing?.JobGuid, jobGuid));
            bool hasActiveConflict = _state.ActiveJobs.Any(existing => !ReferenceEquals(existing, job) && JobGuidEquals(existing?.JobGuid, jobGuid));
            if (!hasPendingCompatibilityConflict && !hasActiveConflict)
            {
                return false;
            }

            LogDiagnosticWarning($"Skipping pending compatibility tracking for duplicate live job GUID '{jobGuid}'. pendingConflict={hasPendingCompatibilityConflict} activeConflict={hasActiveConflict}. {FormatCounts()}");
            return true;
        }

        private void RemoveCompletedDuplicates(string jobGuid)
        {
            if (string.IsNullOrWhiteSpace(jobGuid))
            {
                return;
            }

            int removed = _state.CompletedJobs.RemoveAll(existing => JobGuidEquals(existing?.JobGuid, jobGuid));
            if (removed > 0)
            {
                LogDiagnostic($"Removed {removed} completed duplicate record(s) for job '{jobGuid}'. {FormatCounts()}");
            }
        }

        private string FormatCounts()
        {
            return $"Counts queued={_state.QueuedJobs.Count} active={_state.ActiveJobs.Count} completed={_state.CompletedJobs.Count}";
        }

        private static void LogDiagnostic(string message)
        {
            EmitFiltered(DebugLevel, $"{DiagnosticsPrefix} {message}");
        }

        private static void LogDiagnosticWarning(string message)
        {
            EmitFiltered(WarnLevel, $"{DiagnosticsPrefix} {message}");
        }

        private static void EmitFiltered(int level, string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                return;
            }

            int minimum = GetMinimumLevel();
            if (level < minimum)
            {
                return;
            }

            if (level >= WarnLevel)
            {
                Debug.LogWarning(message);
                return;
            }

            Debug.Log(message);
        }

        private static int GetMinimumLevel()
        {
            try
            {
                _cachedMinimumLevel = EditorPrefs.GetInt(MinimumLevelEditorPrefsKey, _cachedMinimumLevel);
            }
            catch (Exception)
            {
                return _cachedMinimumLevel;
            }

            return _cachedMinimumLevel;
        }

        private static bool JobGuidEquals(string left, string right)
        {
            return string.Equals(NormalizeGuid(left), NormalizeGuid(right), StringComparison.OrdinalIgnoreCase);
        }

        private static bool ProfileGuidEquals(string left, string right)
        {
            return string.Equals(NormalizeGuid(left), NormalizeGuid(right), StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeGuid(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static IEnumerable<string> GetOperations(BuildJobDefinition job)
        {
            if (job == null)
            {
                yield break;
            }

            if (job.RunUnityBuild)
            {
                yield return "Unity Build";
            }

            if (job.RunNotarizeMac)
            {
                yield return "Notarize macOS";
            }

            if (job.RunPublishSteam)
            {
                yield return "Publish Steam";
            }

            if (job.RunPublishEpic)
            {
                yield return "Publish Epic";
            }
        }

        private static bool ShouldPersistWorkspaceRecord(BuildJobDefinition job, BuildJobStatus status, WorkspaceInfo existing)
        {
            if (status == BuildJobStatus.Queued)
            {
                return false;
            }

            if (status == BuildJobStatus.Cancelled && existing == null && string.IsNullOrWhiteSpace(job.WorkspacePath))
            {
                return false;
            }

            if (status == BuildJobStatus.Completed && existing == null && string.IsNullOrWhiteSpace(job.WorkspacePath))
            {
                return false;
            }

            if (status == BuildJobStatus.Failed && existing == null && string.IsNullOrWhiteSpace(job.WorkspacePath))
            {
                return false;
            }

            return true;
        }

        #region History Management

        /// <summary>
        /// Trim history to keep only the most recent N jobs
        /// </summary>
        public void TrimHistory(int maxHistoryCount)
        {
            if (_state.CompletedJobs.Count <= maxHistoryCount)
                return;

            // Sort by completion time and keep most recent
            var sortedJobs = _state.CompletedJobs
                .OrderByDescending(j => j.CompletionTime ?? DateTime.MinValue)
                .ToList();

            _state.CompletedJobs = sortedJobs.Take(maxHistoryCount).ToList();
        }

        /// <summary>
        /// Clear only completed jobs from history
        /// </summary>
        public void ClearCompleted()
        {
            _state.CompletedJobs.Clear();
        }

        /// <summary>
        /// Clear all jobs from all states
        /// </summary>
        public void ClearAll()
        {
            _state.QueuedJobs.Clear();
            _state.ActiveJobs.Clear();
            _state.CompletedJobs.Clear();
        }

        private sealed class RuntimeState
        {
            public List<BuildJobDefinition> QueuedJobs { get; set; } = new List<BuildJobDefinition>();
            public List<BuildJobDefinition> ActiveJobs { get; set; } = new List<BuildJobDefinition>();
            public List<BuildJobDefinition> CompletedJobs { get; set; } = new List<BuildJobDefinition>();
        }

        #endregion
    }

    /// <summary>
    /// Execution status summary across compatibility pending storage, active work, and history.
    /// </summary>
    public class BuildExecutionStatusSummary
    {
        public int PendingCompatibilityCount { get; set; }
        public int ActiveExecutionCount { get; set; }
        public int HistoryCount { get; set; }
        public int TotalCount { get; set; }

        /// <summary>
        /// Compatibility wrapper for legacy summary consumers.
        /// </summary>
        public int ActiveCount
        {
            get => ActiveExecutionCount;
            set => ActiveExecutionCount = value;
        }

        /// <summary>
        /// Compatibility wrapper for legacy summary consumers.
        /// </summary>
        public int CompletedCount
        {
            get => HistoryCount;
            set => HistoryCount = value;
        }
    }

    /// <summary>
    /// Compatibility wrapper for legacy queue-oriented summary consumers.
    /// </summary>
    public class QueueStatus
    {
        public int QueuedCount { get; set; }
        public int ActiveCount { get; set; }
        public int CompletedCount { get; set; }
        public int TotalCount { get; set; }
    }
}
