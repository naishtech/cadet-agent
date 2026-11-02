using UnityEngine;
using UnityEditor;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.ViewModels;
using Covyne.CADET.Editor.Models;
using UnityEngine.Events;

namespace Covyne.CADET.Editor.Lite.Windows
{
    /// <summary>
    /// Renders the build-execution history list.
    /// The legacy queue-oriented type name remains because it is still referenced across editor surfaces.
    /// </summary>
    public sealed class BuildQueuePanel : IDisposable
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";
        private const float ActivitySquareSize = 8f;
        private const float ActivitySquareSpacing = 4f;
        private const int ActivitySquareCount = 3;
        private const float JobStatusWidth = 120f;
        private const float JobActionButtonWidth = 195f;
        private static readonly Color ActivitySquareColor = new Color(0.2f, 0.8f, 0.2f, 1f);
        private const double ActiveRepaintIntervalSeconds = 0.2d;
        private const double WorkspaceHistoryRefreshIntervalSeconds = 5.0d;
        private const double WorkspaceInfoCacheSeconds = 10.0d;
        private const double UnityLogTargetsCacheSeconds = 5.0d;
        private const double BuildLogPathCacheSeconds = 5.0d;
        private const double FileExistsCacheSeconds = 2.0d;
        private const double OpenBuildFolderCheckCacheSeconds = 1.0d;
        private const double ExecutingStateCacheSeconds = 0.5d;
        private const double ProfileCacheSeconds = 10.0d;
        private const int MaxRenderedJobs = 50;
        private const float EmbeddedJobListHeight = 260f;

        private readonly Action repaintAction;

        private BuildQueueManager queueManager;
        private Vector2 scrollPosition = Vector2.zero;
        private GUIStyle headerStyle;
        private GUIStyle statusStyle;
        private GUIStyle subStatusStyle;
        private GUIStyle warningStatusStyle;
        private BuildQueueRuntimeState runtimeState;
        private static Texture2D whiteTexture;
        private static GUIContent warningIconContent;

        private readonly object uiRefreshLock = new object();
        private readonly HashSet<string> subscribedJobGuids = new HashSet<string>();
        private readonly BuildQueueWorkspaceContextService.WorkspaceHistoryCacheState workspaceHistoryCacheState = new BuildQueueWorkspaceContextService.WorkspaceHistoryCacheState();
        private readonly Dictionary<string, BuildQueueWorkspaceContextService.WorkspaceInfoCacheEntry> workspaceInfoCache = new Dictionary<string, BuildQueueWorkspaceContextService.WorkspaceInfoCacheEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, UnityLogTargetsCacheEntry> unityLogTargetsCache = new Dictionary<string, UnityLogTargetsCacheEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, BuildLogPathCacheEntry> buildLogPathCache = new Dictionary<string, BuildLogPathCacheEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, FileExistsCacheEntry> fileExistsCache = new Dictionary<string, FileExistsCacheEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, BuildQueueJobStateService.OpenBuildFolderCheckCacheEntry> openBuildFolderCheckCache = new Dictionary<string, BuildQueueJobStateService.OpenBuildFolderCheckCacheEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, BuildQueueJobStateService.ExecutingStateCacheEntry> executingStateCache = new Dictionary<string, BuildQueueJobStateService.ExecutingStateCacheEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, BuildQueueWorkspaceContextService.ProfileCacheEntry> profileCache = new Dictionary<string, BuildQueueWorkspaceContextService.ProfileCacheEntry>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, JobActionRenderSnapshot> jobActionSnapshots = new Dictionary<string, JobActionRenderSnapshot>(StringComparer.OrdinalIgnoreCase);
        private readonly BuildQueueDisplayViewModel displayViewModel = new BuildQueueDisplayViewModel();
        private readonly BuildQueueJobListViewModel jobListViewModel = new BuildQueueJobListViewModel();
        private BuildQueueJobListState cachedJobListState = new BuildQueueJobListState(new List<BuildJobDefinition>(), 0, false);
        private readonly IterationInsightsViewModel _iterationInsightsVM = new IterationInsightsViewModel();
        private readonly HashSet<string> _autoOpenedLogGuids = new HashSet<string>();

        public BuildQueuePanel(Action repaintAction)
        {
            this.repaintAction = repaintAction ?? throw new ArgumentNullException(nameof(repaintAction));
        }

        public void Initialize()
        {
            BuildQueueInteropService.EnsureInitialized();
            queueManager = BuildQueueManager.Instance;
            runtimeState = BuildQueueRuntimeState.Instance;

            if (whiteTexture == null)
            {
                whiteTexture = new Texture2D(1, 1);
                whiteTexture.SetPixel(0, 0, Color.white);
                whiteTexture.Apply();
            }

            RefreshDetachedState();
            workspaceHistoryCacheState.IsDirty = true;
            displayViewModel.Reset();
            workspaceHistoryCacheState.NextRefreshAt = 0d;
            EditorApplication.update += OnEditorUpdate;
        }

        public void Dispose()
        {
            EditorApplication.update -= OnEditorUpdate;
            subscribedJobGuids.Clear();
            workspaceInfoCache.Clear();
            unityLogTargetsCache.Clear();
            buildLogPathCache.Clear();
            fileExistsCache.Clear();
            openBuildFolderCheckCache.Clear();
            executingStateCache.Clear();
            profileCache.Clear();
            jobActionSnapshots.Clear();
            _autoOpenedLogGuids.Clear();
        }

        public void DrawWindowContents()
        {
            DrawInternal(limitJobListHeight: false);
        }

        public void DrawEmbeddedContents()
        {
            DrawInternal(limitJobListHeight: true);
        }

        public void RefreshFromBackgroundThread()
        {
            EditorApplication.delayCall += () => LogAndRepaint("Background thread refresh request");
        }

        public string GetProfileNameForJob(BuildJobDefinition job)
        {
            if (!string.IsNullOrWhiteSpace(job?.ProfileName))
            {
                return job.ProfileName.Trim();
            }

            BuildProfile profile = GetProfileForJob(job);
            if (!string.IsNullOrWhiteSpace(profile?.profileName))
            {
                return profile.profileName.Trim();
            }

            WorkspaceInfo workspaceInfo = GetWorkspaceInfo(job?.JobGuid);
            if (!string.IsNullOrWhiteSpace(workspaceInfo?.ProfileName))
            {
                return workspaceInfo.ProfileName.Trim();
            }

            if (!string.IsNullOrWhiteSpace(workspaceInfo?.ProfileGuid))
            {
                BuildProfile workspaceProfile = GetProfileForJob(new BuildJobDefinition
                {
                    ProfileGuid = workspaceInfo.ProfileGuid
                });
                if (!string.IsNullOrWhiteSpace(workspaceProfile?.profileName))
                {
                    return workspaceProfile.profileName.Trim();
                }
            }

            if (!string.IsNullOrWhiteSpace(workspaceInfo?.ProfileJsonPath))
            {
                string snapshotProfileName = TryReadProfileNameFromSnapshot(workspaceInfo.ProfileJsonPath);
                if (!string.IsNullOrWhiteSpace(snapshotProfileName))
                {
                    return snapshotProfileName;
                }

                string profileFileName = Path.GetFileNameWithoutExtension(workspaceInfo.ProfileJsonPath);
                if (!string.IsNullOrWhiteSpace(profileFileName) && !LooksLikeGuid(profileFileName))
                {
                    return profileFileName.Trim();
                }
            }

            if (!string.IsNullOrWhiteSpace(job?.ProfileGuid))
            {
                return job.ProfileGuid.Trim();
            }

            if (!string.IsNullOrWhiteSpace(workspaceInfo?.ProfileGuid))
            {
                return workspaceInfo.ProfileGuid.Trim();
            }

            if (!string.IsNullOrWhiteSpace(job?.JobGuid))
            {
                return job.JobGuid.Trim();
            }

            return "Unknown Profile";
        }

        private void DrawInternal(bool limitJobListHeight)
        {
            InitializeStyles();
            List<BuildJobDefinition> allJobs = GetJobsForDisplay();

            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                DrawHeader();
                DrawIterationInsightsSection(allJobs);
                DrawJobsList(limitJobListHeight);
            }
        }

        private void OnEditorUpdate()
        {
            bool hasActiveOperations = queueManager != null &&
                (queueManager.ActiveExecutionCount > 0 || (runtimeState != null && runtimeState.IsOperationRunning));

            bool needsRepaint = hasActiveOperations;
            if (displayViewModel.ShouldRepaintActive(EditorApplication.timeSinceStartup, needsRepaint, ActiveRepaintIntervalSeconds))
            {
                repaintAction();
            }
        }

        private void InitializeStyles()
        {
            if (headerStyle == null)
            {
                headerStyle = new GUIStyle(EditorStyles.largeLabel)
                {
                    fontStyle = FontStyle.Bold,
                    fontSize = 14
                };
            }

            if (statusStyle == null)
            {
                statusStyle = new GUIStyle(EditorStyles.label)
                {
                    alignment = TextAnchor.MiddleLeft
                };
            }

            if (subStatusStyle == null)
            {
                subStatusStyle = new GUIStyle(EditorStyles.miniLabel)
                {
                    wordWrap = true
                };
            }

            if (warningStatusStyle == null)
            {
                warningStatusStyle = new GUIStyle(EditorStyles.miniLabel)
                {
                    wordWrap = true,
                    normal = { textColor = new Color(0.95f, 0.75f, 0.2f, 1f) }
                };
            }

            if (warningIconContent == null)
            {
                warningIconContent = EditorGUIUtility.IconContent("console.warnicon");
            }
        }

        private void DrawHeader()
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.LabelField("Build History", headerStyle);
                GUILayout.FlexibleSpace();

                if (GUILayout.Button("Delete All", GUILayout.Width(90)))
                {
                    DeleteAllJobs();
                }

                if (GUILayout.Button("Refresh", GUILayout.Width(80)))
                {
                    RefreshDetachedState();
                    LogAndRepaint("Manual refresh button");
                }
            }

            EditorGUILayout.Space();
        }

        private void DrawIterationInsightsSection(List<BuildJobDefinition> allJobs)
        {
            // Only refresh during Layout so control counts are identical in Layout and Repaint.
            if (Event.current?.type == EventType.Layout)
                _iterationInsightsVM.Refresh(allJobs);

            if (_iterationInsightsVM.BuildsToday > 0)
            {
                EditorGUILayout.LabelField(
                    $"Today: {_iterationInsightsVM.BuildsToday} builds \u00b7 {_iterationInsightsVM.FormattedWaitTime} saved",
                    EditorStyles.miniLabel);
            }

            if (_iterationInsightsVM.IsActiveSession)
            {
                EditorGUILayout.LabelField(
                    $"Active iteration session \u00b7 {_iterationInsightsVM.SessionBuildCount} builds",
                    EditorStyles.miniLabel);
            }
        }

        private void DrawJobsList(bool limitJobListHeight)
        {
            lock (uiRefreshLock)
            {
                if (queueManager == null)
                {
                    EditorGUILayout.HelpBox("Build history is not available.", MessageType.Info);
                    return;
                }

                BuildQueueJobListState listState = GetJobListStateForCurrentEvent();

                if (listState.VisibleJobs.Count == 0)
                {
                    EditorGUILayout.HelpBox("No build history yet.", MessageType.Info);
                    return;
                }

                if (displayViewModel.ShouldShowRenderToggle(listState.TotalJobs, MaxRenderedJobs))
                {
                    string mode = displayViewModel.GetRenderModeLabel(MaxRenderedJobs);
                    EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
                    EditorGUILayout.LabelField($"Rendering {mode} jobs ({listState.TotalJobs} total).", EditorStyles.miniLabel);
                    GUILayout.FlexibleSpace();
                    if (GUILayout.Button(displayViewModel.GetToggleButtonLabel(), GUILayout.Width(90)))
                    {
                        displayViewModel.ToggleRenderMode();
                        repaintAction();
                    }
                    EditorGUILayout.EndHorizontal();
                }

                if (limitJobListHeight)
                {
                    using (var scroll = new EditorGUILayout.ScrollViewScope(scrollPosition, GUILayout.Height(EmbeddedJobListHeight)))
                    {
                        scrollPosition = scroll.scrollPosition;

                        foreach (var job in listState.VisibleJobs)
                        {
                            DrawJobItem(job);
                        }
                    }
                }
                else
                {
                    using (var scroll = new EditorGUILayout.ScrollViewScope(scrollPosition))
                    {
                        scrollPosition = scroll.scrollPosition;

                        foreach (var job in listState.VisibleJobs)
                        {
                            DrawJobItem(job);
                        }
                    }
                }
            }
        }

        private BuildQueueJobListState GetJobListStateForCurrentEvent()
        {
            EventType eventType = Event.current?.type ?? EventType.Ignore;
            if (eventType == EventType.Layout || cachedJobListState.VisibleJobs == null)
            {
                var jobs = GetJobsForDisplay();
                cachedJobListState = jobListViewModel.BuildState(jobs, displayViewModel.RenderAllJobs, MaxRenderedJobs);
            }

            return cachedJobListState;
        }

        private void DrawJobItem(BuildJobDefinition job)
        {
            if (job == null)
            {
                return;
            }

            job.OnStatusChanged ??= new UnityEngine.Events.UnityEvent<string>();

            if (!subscribedJobGuids.Contains(job.JobGuid))
            {
                // invalidateWorkspaceHistory: true forces a fresh disk-load so job.Status
                // reflects the new value (Completed/Failed) on the very next repaint,
                // not only after the 5-second workspace-history cache expires.
                UnityAction<string> statusChangedListener = status =>
                    LogAndRepaint("Job status changed", job, status, invalidateWorkspaceHistory: true, invalidateLookupCaches: true);

                job.OnStatusChanged.AddListener(statusChangedListener);

                BuildJobDefinition liveJob = queueManager?.GetJobByGuid(job.JobGuid);
                if (liveJob != null)
                {
                    liveJob.OnStatusChanged ??= new UnityEngine.Events.UnityEvent<string>();
                    if (!ReferenceEquals(liveJob, job))
                    {
                        liveJob.OnStatusChanged.AddListener(statusChangedListener);
                    }
                }

                subscribedJobGuids.Add(job.JobGuid);
            }

            if (job.Status == BuildJobStatus.Building && !_autoOpenedLogGuids.Contains(job.JobGuid))
            {
                _autoOpenedLogGuids.Add(job.JobGuid);
                List<BuildQueueLogTarget> autoLogTargets = GetCachedUnityLogTargets(job);
                if (autoLogTargets.Count > 0)
                {
                    string autoLogPath = autoLogTargets[0].Path;
                    EditorApplication.delayCall += () => OpenUnityLog(autoLogPath);
                }
            }

            JobActionRenderSnapshot actionSnapshot;
            string profileName;
            string statusLabel;
            string operationsText;
            bool isExecuting = IsCurrentlyExecutingJob(job);

            actionSnapshot = GetJobActionSnapshot(job, isExecuting);

            try
            {
                profileName = GetProfileNameForJob(job);
                statusLabel = GetExecutedStatusLabel(job);
                operationsText = GetExecutedOperationsText(job);
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to prepare build history row metadata for job '{job.JobGuid ?? "<missing>"}': {ex.Message}");
                profileName = !string.IsNullOrWhiteSpace(job.ProfileName)
                    ? job.ProfileName.Trim()
                    : (!string.IsNullOrWhiteSpace(job.JobGuid) ? job.JobGuid.Trim() : "Unknown Profile");
                statusLabel = BuildQueueStatusTextService.GetRowStatusLabel(job);
                operationsText = BuildQueueStatusTextService.GetOperationsText(job);
            }

            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    DrawJobStatusLabel(statusLabel, isExecuting);

                    GUILayout.FlexibleSpace();

                    using (new EditorGUILayout.VerticalScope(GUILayout.Width(JobActionButtonWidth)))
                    {
                        foreach (JobActionButtonDefinition action in actionSnapshot.Actions)
                        {
                            DrawActionButton(action.Label, action.OnClick);
                        }
                    }
                }

                EditorGUILayout.LabelField($"Profile: {profileName}", EditorStyles.miniLabel);
                EditorGUILayout.LabelField(operationsText, subStatusStyle);
            }
        }

        private void DrawJobStatusLabel(string statusLabel, bool isExecuting)
        {
            // Always allocate BOTH layout slots unconditionally so the control count is
            // identical in Layout and Repaint regardless of isExecuting changing mid-frame.
            // Only the drawing inside the squares rect is conditional.
            float squaresWidth = ActivitySquareSize * ActivitySquareCount + ActivitySquareSpacing * (ActivitySquareCount - 1);
            float textWidth = JobStatusWidth - squaresWidth - 4f;

            GUILayout.Label(statusLabel, statusStyle, GUILayout.Width(textWidth));

            Rect squaresRect = GUILayoutUtility.GetRect(
                squaresWidth, EditorGUIUtility.singleLineHeight,
                GUILayout.Width(squaresWidth));

            if (isExecuting)
            {
                BuildQueueRenderHelperService.DrawActivitySquares(
                    squaresRect,
                    squaresWidth,
                    ActivitySquareCount,
                    ActivitySquareSize,
                    ActivitySquareSpacing,
                    ActivitySquareColor,
                    whiteTexture);
            }
        }

        private JobActionRenderSnapshot GetJobActionSnapshot(BuildJobDefinition job, bool isExecuting)
        {
            string cacheKey = GetJobCacheKey(job);
            EventType eventType = Event.current?.type ?? EventType.Ignore;
            bool hasCachedSnapshot = jobActionSnapshots.TryGetValue(cacheKey, out JobActionRenderSnapshot snapshot);

            if (eventType != EventType.Layout && hasCachedSnapshot)
            {
                return snapshot;
            }

            try
            {
                snapshot = BuildJobActionSnapshot(job, isExecuting);
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[C.A.D.E.T] Failed to build action buttons for job '{job?.JobGuid ?? "<missing>"}': {ex.Message}");
                snapshot = hasCachedSnapshot
                    ? snapshot
                    : new JobActionRenderSnapshot(new List<JobActionButtonDefinition>());
            }

            jobActionSnapshots[cacheKey] = snapshot;
            return snapshot;
        }

        private JobActionRenderSnapshot BuildJobActionSnapshot(BuildJobDefinition job, bool isExecuting)
        {
            List<JobActionButtonDefinition> actions = new List<JobActionButtonDefinition>();
            List<BuildQueueLogTarget> logTargets = GetCachedUnityLogTargets(job);
            bool canCancel = CanCancelJob(job, isExecuting);
            bool canOpenBuildFolder = CanOpenBuildFolder(job);
            bool canRetry = CanRetryJob(job);
            bool canDelete = CanDeleteJob(job);

            foreach (BuildQueueLogTarget target in logTargets)
            {
                string monitorPath = target.Path;
                string targetLabel = target.Label;
                actions.Add(new JobActionButtonDefinition(
                    $"Monitor Unity Log ({targetLabel})",
                    () =>
                    {
                        string logPath = monitorPath;
                        EditorApplication.delayCall += () => OpenUnityLog(logPath);
                    }));

                string openPath = target.Path;
                string openTargetLabel = target.Label;
                actions.Add(new JobActionButtonDefinition(
                    $"Open Unity Log ({openTargetLabel})",
                    () =>
                    {
                        string logPath = openPath;
                        EditorApplication.delayCall += () => OpenBuildLogFile(logPath);
                    }));
            }

            if (canCancel)
            {
                actions.Add(new JobActionButtonDefinition(
                    "Cancel",
                    () => CancelJob(job)));
            }

            if (canOpenBuildFolder)
            {
                actions.Add(new JobActionButtonDefinition(
                    "Open Build Folder",
                    () => OpenJobBuildOutputDirectory(job)));
            }

            if (canRetry)
            {
                actions.Add(new JobActionButtonDefinition(
                    "Retry",
                    () => RetryJob(job)));
            }

            if (canDelete)
            {
                actions.Add(new JobActionButtonDefinition(
                    "Delete",
                    () => DeleteJob(job)));
            }

            return new JobActionRenderSnapshot(actions);
        }

        private void DrawActionButton(string label, Action onClick)
        {
            GUILayoutOption[] layoutOptions =
            {
                GUILayout.Width(JobActionButtonWidth),
                GUILayout.Height(EditorGUIUtility.singleLineHeight)
            };

            if (GUILayout.Button(label, layoutOptions))
            {
                EditorApplication.delayCall += () => onClick?.Invoke();
            }
        }

        private void CancelJob(BuildJobDefinition job)
        {
            if (job == null)
            {
                return;
            }

            if (IsCurrentlyExecutingJob(job))
            {
                if (runtimeState?.CancelActiveOperation == null)
                {
                    bool cancelled = BuildQueueActionService.TryCancelDetachedActiveJob(
                        job,
                        WorkspaceOperationStateService.CancelDetachedOperation,
                        guid => queueManager != null && queueManager.GetJobByGuid(guid) != null,
                        guid => queueManager != null && queueManager.CancelJob(guid));
                    if (cancelled)
                    {
                        if (runtimeState != null)
                        {
                            runtimeState.ActiveStatusText = "Cancelled by user.";
                            runtimeState.IsOperationRunning = false;
                            runtimeState.ActiveJobGuid = null;
                        }

                        LogAndRepaint("Cancel detached active job", job, invalidateLookupCaches: true);
                        return;
                    }

                    if (TryResolveStaleActiveJobAsCancelled(job))
                    {
                        return;
                    }

                    ShowProcessNotFoundDialog();
                    return;
                }

                runtimeState.CancelActiveOperation();
                return;
            }

            try
            {
                bool cancelled = queueManager != null && queueManager.CancelJob(job.JobGuid);
                if (cancelled)
                {
                    LogAndRepaint("Cancel pending job", job, invalidateLookupCaches: true);
                    return;
                }
            }
            catch (InvalidOperationException)
            {
                // Show a simplified runtime guard rather than surfacing queue-specific state errors.
            }

            ShowProcessNotFoundDialog();
        }

        private bool TryResolveStaleActiveJobAsCancelled(BuildJobDefinition job)
        {
            BuildQueueActionService.StaleCancelResolution resolution = BuildQueueActionService.TryResolveStaleActiveJobAsCancelled(
                job,
                GetWorkspaceInfo,
                NormalizeWorkspaceStatus,
                IsTerminalStatus,
                GetWorkspaceStatusDetail,
                (guid, status, detail) => queueManager != null && queueManager.MarkJobTerminal(guid, status, detail),
                guid => queueManager != null && queueManager.CancelJob(guid));

            if (!resolution.IsResolved)
            {
                return false;
            }

            if (runtimeState != null)
            {
                runtimeState.ActiveStatusText = resolution.Detail;
                runtimeState.IsOperationRunning = false;
                runtimeState.ActiveJobGuid = null;
            }

            LogAndRepaint(resolution.RepaintReason, job, invalidateLookupCaches: true);
            return true;
        }

        private void DeleteJob(BuildJobDefinition job)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.JobGuid))
            {
                return;
            }

            WorkspaceInfo workspaceInfo = ResolveDeleteTarget(job);
            bool canDeleteProjectFolder = CanDeleteProjectFolder(workspaceInfo);
            BuildQueueActionService.DeleteJobPrompt prompt = BuildQueueActionService.BuildDeleteJobPrompt(job, workspaceInfo, canDeleteProjectFolder);

            int complexChoice = EditorUtility.DisplayDialogComplex(
                "Delete Job",
                prompt.Message,
                "Delete Job Only",
                "Delete Job + Folder",
                "Cancel");

            if (!BuildQueueActionService.TryResolveDeleteJobSelection(canDeleteProjectFolder, complexChoice, simpleConfirmed: null, out bool deleteProjectFolder))
            {
                return;
            }

            if (deleteProjectFolder && BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(workspaceInfo, job.JobGuid))
            {
                EditorUtility.DisplayDialog("Delete Job", "There is currently an active operation using this folder. Cannot delete.", "OK");
                return;
            }

            EditorApplication.delayCall += () =>
            {
                BuildQueueActionService.ExecuteDeleteJob(
                    job,
                    deleteProjectFolder,
                    workspaceInfo,
                    (jobGuid, deleteFolder, workspacePath, profileGuid) =>
                        queueManager.DeleteJobEntry(jobGuid, deleteFolder, workspacePath, profileGuid));
                LogAndRepaint("Delete job entry", job, invalidateWorkspaceHistory: true, invalidateLookupCaches: true);
            };
        }

        private void DeleteAllJobs()
        {
            List<BuildJobDefinition> allJobs = GetJobsForDisplay();
            bool CanDeleteFolderSafe(WorkspaceInfo wi) =>
                CanDeleteProjectFolder(wi) && !BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(wi, wi?.JobGuid);
            BuildQueueActionService.DeleteAllEvaluation evaluation = BuildQueueActionService.EvaluateDeleteAllCandidates(
                allJobs,
                CanDeleteJob,
                ResolveDeleteTarget,
                CanDeleteFolderSafe);
            List<BuildJobDefinition> deletableJobs = evaluation.DeletableJobs;

            if (deletableJobs.Count == 0)
            {
                EditorUtility.DisplayDialog(
                    "Delete All Jobs",
                    "No deletable jobs were found. Active or pending jobs must be completed/cancelled before deletion.",
                    "OK");
                return;
            }

            int jobsWithFolderDeleteAvailable = evaluation.JobsWithFolderDeleteAvailable;

            string message =
                $"Delete {deletableJobs.Count} deletable jobs from build history and the workspace registry?\n\n" +
                $"Jobs with removable project folders: {jobsWithFolderDeleteAvailable}\n\n" +
                "Delete All + Folders removes only folders that pass CADET safety checks.";

            int choice = EditorUtility.DisplayDialogComplex(
                "Delete All Jobs",
                message,
                "Delete Jobs Only",
                "Delete All + Folders",
                "Cancel");

            if (choice == 2)
            {
                return;
            }

            bool deleteFoldersWhenAllowed = choice == 1;
            EditorApplication.delayCall += () =>
            {
                BuildQueueActionService.DeleteAllExecutionResult result = BuildQueueActionService.ExecuteDeleteAll(
                    deletableJobs,
                    deleteFoldersWhenAllowed,
                    ResolveDeleteTarget,
                    CanDeleteFolderSafe,
                    (jobGuid, deleteFolder, workspacePath, profileGuid) =>
                        queueManager.DeleteJobEntry(jobGuid, deleteFolder, workspacePath, profileGuid));

                if (result.RemovedCount > 0)
                {
                    string summary = deleteFoldersWhenAllowed
                        ? $"Deleted {result.RemovedCount} jobs ({result.RemovedWithFolderCount} with project folders)."
                        : $"Deleted {result.RemovedCount} jobs.";
                    LogAndRepaint(summary, invalidateWorkspaceHistory: true, invalidateLookupCaches: true);
                    return;
                }

                EditorUtility.DisplayDialog(
                    "Delete All Jobs",
                    "No jobs were deleted. They may have already been removed or changed state.",
                    "OK");
            };
        }

        private void OpenJobBuildOutputDirectory(BuildJobDefinition job)
        {
            TryResolveOpenableBuildOutputDirectory(job, out string directory);
            bool opened = BuildQueueActionService.TryOpenBuildOutputDirectory(
                directory,
                Application.platform == RuntimePlatform.WindowsEditor || Application.platform == RuntimePlatform.OSXEditor,
                path =>
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = path,
                        UseShellExecute = true,
                        Verb = "open"
                    });
                },
                EditorUtility.RevealInFinder,
                out string error);

            if (!opened)
            {
                EditorUtility.DisplayDialog(
                    "Open Build Folder",
                    error,
                    "OK");
            }
        }

        private bool CanOpenBuildFolder(BuildJobDefinition job)
        {
            return BuildQueueJobStateService.CanOpenBuildFolder(
                job,
                openBuildFolderCheckCache,
                EditorApplication.timeSinceStartup,
                OpenBuildFolderCheckCacheSeconds,
                candidate => TryResolveOpenableBuildOutputDirectory(candidate, out _));
        }

        private bool TryResolveOpenableBuildOutputDirectory(BuildJobDefinition job, out string directory)
        {
            BuildProfile profile = GetProfileForJob(job);
            return BuildQueueArtifactResolverService.TryResolveOpenableBuildOutputDirectory(job, profile, out directory);
        }

        private WorkspaceInfo ResolveDeleteTarget(BuildJobDefinition job)
        {
            return BuildQueueWorkspaceContextService.ResolveDeleteTarget(job, GetWorkspaceInfo, GetProfileForJob);
        }

        private WorkspaceInfo GetWorkspaceInfo(string jobGuid)
        {
            return BuildQueueWorkspaceContextService.GetWorkspaceInfo(
                jobGuid,
                workspaceInfoCache,
                EditorApplication.timeSinceStartup,
                WorkspaceInfoCacheSeconds);
        }

        private void RefreshDetachedState()
        {
            BuildOperationReloadRecoveryService.RefreshNow();
            workspaceHistoryCacheState.IsDirty = true;
            workspaceInfoCache.Clear();
            unityLogTargetsCache.Clear();
            buildLogPathCache.Clear();
            fileExistsCache.Clear();
            openBuildFolderCheckCache.Clear();
            executingStateCache.Clear();
            profileCache.Clear();
        }

        private bool CanDeleteProjectFolder(WorkspaceInfo workspaceInfo)
        {
            return BuildQueueWorkspaceContextService.CanDeleteProjectFolder(workspaceInfo);
        }

        private bool IsCurrentlyExecutingJob(BuildJobDefinition job)
        {
            return BuildQueueJobStateService.IsCurrentlyExecutingJob(
                job,
                runtimeState,
                executingStateCache,
                EditorApplication.timeSinceStartup,
                ExecutingStateCacheSeconds,
                WorkspaceOperationStateService.GetWorkspace,
                WorkspaceOperationStateService.IsProcessAlive);
        }

        private bool CanCancelJob(BuildJobDefinition job, bool isExecuting)
        {
            if (IsDirectorySyncInProgress(job))
            {
                return false;
            }

            return BuildQueueJobStateService.CanCancelJob(
                job,
                isExecuting,
                guid => queueManager != null && queueManager.IsJobActive(guid),
                guid => queueManager?.GetJobByGuid(guid));
        }

        private bool CanRetryJob(BuildJobDefinition job)
        {
            return BuildQueueJobStateService.CanRetryJob(
                job,
                trackedJob => queueManager != null && queueManager.CanRetryJob(trackedJob),
                profileGuid => queueManager != null && queueManager.HasJobInProgress(profileGuid));
        }

        private static string GetExecutedStatusLabel(BuildJobDefinition job)
        {
            return BuildQueueStatusTextService.GetRowStatusLabel(job);
        }

        private static void ShowProcessNotFoundDialog()
        {
            EditorUtility.DisplayDialog(
                "Process not found",
                "No running process was found for this build.",
                "OK");
        }

        private void RetryJob(BuildJobDefinition job)
        {
            if (job == null)
            {
                return;
            }

            EditorApplication.delayCall += () =>
            {
                bool retried = BuildQueueActionService.TryRetryJob(job, BuildQueueInteropService.RetryJob);
                if (!retried)
                {
                    EditorUtility.DisplayDialog("Retry Job", "The selected job could not be retried.", "OK");
                    return;
                }

                LogAndRepaint("Retry job", job, invalidateLookupCaches: true);
            };
        }

        private static bool IsTerminalStatus(BuildJobStatus status)
        {
            return BuildQueueJobStateService.IsTerminalStatus(status);
        }

        private bool CanDeleteJob(BuildJobDefinition job)
        {
            if (IsDirectorySyncInProgress(job))
            {
                return false;
            }

            return BuildQueueJobStateService.CanDeleteJob(
                job,
                guid => queueManager != null && queueManager.IsJobActive(guid),
                guid => queueManager?.GetJobByGuid(guid));
        }

        private bool IsDirectorySyncInProgress(BuildJobDefinition job)
        {
            return BuildQueueJobStateService.IsDirectorySyncInProgress(
                job,
                GetWorkspaceInfo(job?.JobGuid),
                GetProfileForJob(job));
        }

        private string GetExecutedOperationsText(BuildJobDefinition job)
        {
            WorkspaceInfo workspaceInfo = GetWorkspaceInfo(job?.JobGuid);
            return BuildQueueStatusTextService.GetOperationsText(job, workspaceInfo);
        }

        private static bool LooksLikeGuid(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return false;
            }

            return Guid.TryParse(value, out _) ||
                   (value.Length == 32 && System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-fA-F0-9]{32}$"));
        }

        private static string TryReadProfileNameFromSnapshot(string profileJsonPath)
        {
            if (string.IsNullOrWhiteSpace(profileJsonPath) || !File.Exists(profileJsonPath))
            {
                return string.Empty;
            }

            try
            {
                string json = File.ReadAllText(profileJsonPath);
                if (string.IsNullOrWhiteSpace(json))
                {
                    return string.Empty;
                }

                BuildProfile profile = JsonUtility.FromJson<BuildProfile>(json);
                return profile?.profileName?.Trim() ?? string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        private void OpenUnityLog(string logPath)
        {
            BuildQueueLogRoutingService.OpenUnityLogMonitor(logPath);
        }

        private void OpenBuildLogFile(string logPath)
        {
            BuildQueueLogRoutingService.OpenLogFile(logPath);
        }

        private string ResolveBuildLogPath(BuildJobDefinition job)
        {
            BuildProfile profile = GetProfileForJob(job);
            WorkspaceInfo workspaceInfo = GetWorkspaceInfo(job?.JobGuid);
            return BuildQueueLogRoutingService.ResolveBuildLogPath(job, profile, workspaceInfo);
        }

        private string ResolveBuildLogPathCached(BuildJobDefinition job)
        {
            string cacheKey = GetJobCacheKey(job);
            double now = EditorApplication.timeSinceStartup;

            if (buildLogPathCache.TryGetValue(cacheKey, out BuildLogPathCacheEntry cached) && now < cached.ExpiresAt)
            {
                return cached.Path;
            }

            string path = ResolveBuildLogPath(job);
            buildLogPathCache[cacheKey] = new BuildLogPathCacheEntry(path, now + BuildLogPathCacheSeconds);
            return path;
        }

        private List<BuildQueueLogTarget> GetCachedUnityLogTargets(BuildJobDefinition job)
        {
            string cacheKey = GetJobCacheKey(job);
            double now = EditorApplication.timeSinceStartup;

            if (unityLogTargetsCache.TryGetValue(cacheKey, out UnityLogTargetsCacheEntry cached) && now < cached.ExpiresAt)
            {
                return cached.Targets;
            }

            WorkspaceInfo workspaceInfo = GetWorkspaceInfo(job?.JobGuid);
            BuildProfile profile = GetProfileForJob(job);
            List<BuildQueueLogTarget> targets = BuildQueueLogRoutingService.GetUnityLogTargets(job, profile, workspaceInfo);
            unityLogTargetsCache[cacheKey] = new UnityLogTargetsCacheEntry(targets, now + UnityLogTargetsCacheSeconds);
            return targets;
        }

        private bool CachedFileExists(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return false;
            }

            string cacheKey = path.Replace('/', '\\');
            double now = EditorApplication.timeSinceStartup;
            if (fileExistsCache.TryGetValue(cacheKey, out FileExistsCacheEntry cached) && now < cached.ExpiresAt)
            {
                return cached.Exists;
            }

            bool exists = File.Exists(path);
            fileExistsCache[cacheKey] = new FileExistsCacheEntry(exists, now + FileExistsCacheSeconds);
            return exists;
        }

        private static string GetJobCacheKey(BuildJobDefinition job)
        {
            if (!string.IsNullOrWhiteSpace(job?.JobGuid))
            {
                return job.JobGuid;
            }

            return string.Concat("job-", job != null ? job.GetHashCode().ToString() : "none");
        }

        private BuildProfile GetProfileForJob(BuildJobDefinition job)
        {
            return BuildQueueWorkspaceContextService.GetProfileForJob(
                job,
                profileCache,
                EditorApplication.timeSinceStartup,
                ProfileCacheSeconds);
        }

        private List<BuildJobDefinition> GetJobsForDisplay()
        {
            return GetCachedWorkspaceHistoryJobs();
        }

        private List<BuildJobDefinition> GetCachedWorkspaceHistoryJobs()
        {
            return BuildQueueWorkspaceContextService.GetCachedWorkspaceHistoryJobs(
                workspaceHistoryCacheState,
                EditorApplication.timeSinceStartup,
                WorkspaceHistoryRefreshIntervalSeconds,
                LoadWorkspaceHistoryJobs);
        }

        private List<BuildJobDefinition> LoadWorkspaceHistoryJobs()
        {
            return BuildQueueWorkspaceContextService.LoadWorkspaceHistoryJobs(
                () =>
                {
                    string workspacesRoot = Path.GetFullPath(CadetLitePathService.GetWorkspacesRoot())
                        .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
                    WorkspaceManager workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);
                    return workspaceManager.LoadRegistry();
                },
                NormalizeWorkspaceStatus,
                GetWorkspaceStatusDetail);
        }

        private static string GetWorkspaceStatusDetail(WorkspaceInfo workspace)
        {
            return BuildQueueStatusTextService.GetWorkspaceStatusDetail(workspace);
        }

        private static BuildJobStatus NormalizeWorkspaceStatus(WorkspaceInfo workspace)
        {
            return BuildQueueStatusTextService.NormalizeWorkspaceStatus(workspace);
        }

        private void LogAndRepaint(
            string reason,
            BuildJobDefinition job = null,
            string statusText = null,
            bool invalidateWorkspaceHistory = false,
            bool invalidateLookupCaches = false)
        {
            if (job != null && !string.IsNullOrWhiteSpace(statusText))
            {
                job.StatusDetail = statusText;
            }

            if (invalidateWorkspaceHistory)
            {
                workspaceHistoryCacheState.IsDirty = true;
            }

            if (invalidateLookupCaches)
            {
                if (job != null && !string.IsNullOrWhiteSpace(job.JobGuid))
                {
                    string jobCacheKey = GetJobCacheKey(job);
                    workspaceInfoCache.Remove(job.JobGuid);
                    unityLogTargetsCache.Remove(jobCacheKey);
                    buildLogPathCache.Remove(jobCacheKey);
                    openBuildFolderCheckCache.Remove(job.JobGuid);
                    executingStateCache.Remove(job.JobGuid);
                    if (!string.IsNullOrWhiteSpace(job.ProfileGuid))
                    {
                        profileCache.Remove(job.ProfileGuid);
                    }
                }
                else
                {
                    workspaceInfoCache.Clear();
                    unityLogTargetsCache.Clear();
                    buildLogPathCache.Clear();
                    fileExistsCache.Clear();
                    openBuildFolderCheckCache.Clear();
                    executingStateCache.Clear();
                    profileCache.Clear();
                }
            }

            repaintAction();
        }

        private readonly struct UnityLogTargetsCacheEntry
        {
            public UnityLogTargetsCacheEntry(List<BuildQueueLogTarget> targets, double expiresAt)
            {
                Targets = targets ?? new List<BuildQueueLogTarget>();
                ExpiresAt = expiresAt;
            }

            public List<BuildQueueLogTarget> Targets { get; }
            public double ExpiresAt { get; }
        }

        private readonly struct JobActionButtonDefinition
        {
            public JobActionButtonDefinition(string label, Action onClick)
            {
                Label = label;
                OnClick = onClick;
            }

            public string Label { get; }
            public Action OnClick { get; }
        }

        private readonly struct JobActionRenderSnapshot
        {
            public JobActionRenderSnapshot(List<JobActionButtonDefinition> actions)
            {
                Actions = actions ?? new List<JobActionButtonDefinition>();
            }

            public List<JobActionButtonDefinition> Actions { get; }
        }

        private readonly struct BuildLogPathCacheEntry
        {
            public BuildLogPathCacheEntry(string path, double expiresAt)
            {
                Path = path;
                ExpiresAt = expiresAt;
            }

            public string Path { get; }
            public double ExpiresAt { get; }
        }

        private readonly struct FileExistsCacheEntry
        {
            public FileExistsCacheEntry(bool exists, double expiresAt)
            {
                Exists = exists;
                ExpiresAt = expiresAt;
            }

            public bool Exists { get; }
            public double ExpiresAt { get; }
        }
    }
}