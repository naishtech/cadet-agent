using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;
using Covyne.CADET.Editor.ViewModels;
using UnityEngine;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Executes build/notarize operations and owns the common orchestration flow.
    /// </summary>
    public static class BuildOperationExecutionService
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";

        public readonly struct ExecutionResult
        {
            public ExecutionResult(bool success, bool detachedOperationActive, int exitCode = 0, string errorMessage = null)
            {
                Success = success;
                DetachedOperationActive = detachedOperationActive;
                ExitCode = exitCode;
                ErrorMessage = errorMessage;
            }

            public bool Success { get; }
            public bool DetachedOperationActive { get; }
            public int ExitCode { get; }
            public string ErrorMessage { get; }
        }

        private static int cancellationRequested;

        public class Request
        {
            public BuildProfile Profile { get; set; }
            public string ProfileGuid { get; set; }
            public BuildJobDefinition ActiveJob { get; set; }
            public string OperationName { get; set; }
            public string PlatformOverride { get; set; }
            public bool BuildOnly { get; set; }
            public bool PublishOnly { get; set; }
            public bool NotarizeOnly { get; set; }
            public bool ClearUnityLogsBeforeExecute { get; set; }
            public BuildExecutionStateViewModel ExecutionState { get; set; }
            public ActionButtonsViewModel ActionButtons { get; set; }
            public ConsoleOutputViewModel ConsoleOutput { get; set; }
            public ProgressBarViewModel ProgressBar { get; set; }
            public bool KeepConsoleMirroringAfterCompletion { get; set; }
            public bool ShowBlockingSyncDialog { get; set; }
            public Action OnBlockingSyncCancelRequested { get; set; }
            public Action Repaint { get; set; }
            public Func<string, string, string, string, bool, bool, bool, Action<string>, Action<BuildSyncStatus, string>, Action<float>, BuildJobDefinition, BuildResult> ExecuteDistScript { get; set; }
        }

        public static void RequestCancellation()
        {
            Interlocked.Exchange(ref cancellationRequested, 1);
        }

        public static bool IsCancellationRequested()
        {
            return Volatile.Read(ref cancellationRequested) == 1;
        }

        private static void ResetCancellationRequest()
        {
            Interlocked.Exchange(ref cancellationRequested, 0);
        }

        public static async Task<bool> ExecuteAsync(Request request)
        {
            ExecutionResult result = await ExecuteWithResultAsync(request);
            return result.Success;
        }

        public static async Task<ExecutionResult> ExecuteWithResultAsync(Request request)
        {
            ValidateRequest(request);
            ResetCancellationRequest();
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            long previousElapsedMs = 0;

            void LogTiming(string message)
            {
                long elapsedMs = stopwatch.ElapsedMilliseconds;
                long deltaMs = elapsedMs - previousElapsedMs;
                previousElapsedMs = elapsedMs;
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Timing operation='{request.OperationName}' profile='{request.Profile?.profileName ?? string.Empty}' " +
                    $"job='{request.ActiveJob?.JobGuid ?? string.Empty}' {message} +{deltaMs}ms total={elapsedMs}ms.");
            }

            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} Operation execute start job='{request.ActiveJob?.JobGuid ?? string.Empty}' operation='{request.OperationName}' profile='{request.Profile?.profileName ?? string.Empty}' " +
                $"platform='{request.PlatformOverride ?? string.Empty}' buildOnly={request.BuildOnly} publishOnly={request.PublishOnly} notarizeOnly={request.NotarizeOnly}.");
            LogTiming("entered ExecuteWithResultAsync");

            request.ExecutionState.BeginOperation(request.ActionButtons, request.ConsoleOutput);
            request.ProgressBar.Start($"{request.OperationName}: {request.Profile.profileName}");
            request.ConsoleOutput.AppendLine($"\n[LOG] Starting {request.OperationName} for profile: {request.Profile.profileName}", CadetConsoleMessageType.Log);
            InvokeRepaint(request, "Operation started");
            var context = CreateContext(request);
            LogTiming("UI state initialized");

            try
            {
                PrepareBuildProfile(request, context);
                LogTiming("Build profile prepared");

                context.TempJsonPath = ProfileJsonService.CreateTemporaryJsonFile(context.BuildProfile);
                request.ConsoleOutput.AppendLine($"[LOG] Created profile JSON: {context.TempJsonPath}", CadetConsoleMessageType.Log);
                LogTiming("Temporary profile JSON created");
                context.BlockingDialog.ShowIfNeeded();
                LogTiming("Blocking dialog shown if needed");

                if (request.ClearUnityLogsBeforeExecute)
                {
                    var unityLogPaths = BuildPathResolver.GetUnityLogFilePaths(request.Profile);
                    BuildPathResolver.ClearUnityLogFiles(unityLogPaths, (message, messageType) =>
                    {
                        request.ConsoleOutput.AppendLine(message, messageType);
                    });
                    LogTiming($"Unity logs cleared count={unityLogPaths.Count}");
                }
                InvokeRepaint(request, "Pre-build setup complete");
                LogTiming("Pre-build setup complete");

                BuildOperationBranchRunnerService.Result branchResult = await BuildOperationBranchRunnerService.ExecuteAsync(
                    new BuildOperationBranchRunnerService.Request
                    {
                        OperationRequest = request,
                        BuildProfile = context.BuildProfile,
                        TempJsonPath = context.TempJsonPath,
                        StatusPublisher = context.StatusPublisher,
                        BlockingDialog = context.BlockingDialog,
                        Repaint = reason => InvokeRepaint(request, reason)
                    });
                LogTiming("Branch runner returned");

                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Operation branch result job='{request.ActiveJob?.JobGuid ?? string.Empty}' buildResultNull={branchResult.BuildResult == null} " +
                    $"outputLength={branchResult.BuildResult?.Output?.Length ?? 0} success={branchResult.BuildResult?.Success ?? false} " +
                    $"detached={branchResult.BuildResult?.DetachedOperationActive ?? false} exitCode={branchResult.BuildResult?.ExitCode ?? 0} " +
                    $"error='{branchResult.BuildResult?.ErrorMessage ?? string.Empty}'.");

                context.MessageBatcher = branchResult.MessageBatcher;

                if (IsCancellationRequested())
                {
                    context.Success = false;
                    LogTiming("Cancellation observed after branch runner");
                    return new ExecutionResult(false, false);
                }

                ExecutionResult completionResult = BuildOperationCompletionService.ApplyResult(
                    new BuildOperationCompletionService.Request
                    {
                        OperationRequest = request,
                        BuildResult = branchResult.BuildResult,
                        Repaint = reason => InvokeRepaint(request, reason)
                    });
                context.Success = completionResult.Success;
                context.DetachedOperationActive = completionResult.DetachedOperationActive;
                LogTiming($"Completion applied success={completionResult.Success} detached={completionResult.DetachedOperationActive}");
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Operation completion result job='{request.ActiveJob?.JobGuid ?? string.Empty}' success={completionResult.Success} " +
                    $"detached={completionResult.DetachedOperationActive} exitCode={completionResult.ExitCode} error='{completionResult.ErrorMessage ?? string.Empty}'.");
            }
            catch (OperationCanceledException)
            {
                request.ConsoleOutput.AppendLine("[WARN] Operation cancelled by user", CadetConsoleMessageType.Warning);
                request.ProgressBar.Stop();
                context.Success = false;
                InvokeRepaint(request, "Operation cancelled");
                LogTiming("Operation cancelled");
            }
            catch (Exception ex)
            {
                request.ConsoleOutput.AppendLine($"[ERROR] {request.OperationName} failed: {ex.Message}", CadetConsoleMessageType.Error);
                Debug.LogError($"C.A.D.E.T {request.OperationName} execution failed: {ex}");
                request.ProgressBar.Stop();
                context.Success = false;
                InvokeRepaint(request, $"Operation exception: {ex.Message}");
                LogTiming($"Operation exception='{ex.Message}'");
            }
            finally
            {
                BuildOperationCleanupService.Execute(
                    new BuildOperationCleanupService.Request
                    {
                        BlockingDialog = context.BlockingDialog,
                        MessageBatcher = context.MessageBatcher,
                        TempJsonPath = context.TempJsonPath,
                        ExecutionState = request.ExecutionState,
                        ActionButtons = request.ActionButtons,
                        ConsoleOutput = request.ConsoleOutput,
                        KeepConsoleMirroringAfterCompletion = request.KeepConsoleMirroringAfterCompletion,
                        Repaint = () => InvokeRepaint(request, "Operation cleanup complete")
                    });
                LogTiming("Cleanup complete");
            }

            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} Operation execute end job='{request.ActiveJob?.JobGuid ?? string.Empty}' success={context.Success} detached={context.DetachedOperationActive}.");

            return new ExecutionResult(context.Success, context.DetachedOperationActive);
        }

        private sealed class OperationContext
        {
            public BuildProfile BuildProfile { get; set; }
            public string TempJsonPath { get; set; }
            public bool Success { get; set; }
            public bool DetachedOperationActive { get; set; }
            public MessageBatcher MessageBatcher { get; set; }
            public BuildOperationBlockingDialogService BlockingDialog { get; set; }
            public BuildOperationStatusPublisherService StatusPublisher { get; set; }
        }

        private static OperationContext CreateContext(Request request)
        {
            return new OperationContext
            {
                Success = false,
                DetachedOperationActive = false,
                MessageBatcher = null,
                TempJsonPath = null,
                BuildProfile = null,
                BlockingDialog = new BuildOperationBlockingDialogService(request),
                StatusPublisher = new BuildOperationStatusPublisherService(request.ActiveJob)
            };
        }

        private static void PrepareBuildProfile(Request request, OperationContext context)
        {
            BuildProfile buildProfile = JsonUtility.FromJson<BuildProfile>(JsonUtility.ToJson(request.Profile));
            if (!string.IsNullOrEmpty(request.PlatformOverride))
            {
                buildProfile.platform = request.PlatformOverride;
            }

            BuildPathResolver.PopulateSteamCmdPathsFromEditorPrefs(buildProfile);
            BuildPathResolver.PopulateEpicBuildPatchToolPathFromEditorPrefs(buildProfile);
            context.BuildProfile = buildProfile;
        }

        private static void ValidateRequest(Request request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.Profile == null) throw new ArgumentNullException(nameof(request.Profile));
            if (string.IsNullOrWhiteSpace(request.OperationName)) throw new ArgumentException("OperationName is required.", nameof(request));
            if (request.ExecutionState == null) throw new ArgumentNullException(nameof(request.ExecutionState));
            if (request.ActionButtons == null) throw new ArgumentNullException(nameof(request.ActionButtons));
            if (request.ConsoleOutput == null) throw new ArgumentNullException(nameof(request.ConsoleOutput));
            if (request.ProgressBar == null) throw new ArgumentNullException(nameof(request.ProgressBar));
#if !CADET_LITE
            if (request.ExecuteDistScript == null) throw new ArgumentNullException(nameof(request.ExecuteDistScript));
#endif
        }

        private static void InvokeRepaint(Request request, string reason)
        {
            string jobGuid = request?.ActiveJob?.JobGuid ?? "n/a";
            // Debug log removed per request
            request?.Repaint?.Invoke();
        }
    }
}
