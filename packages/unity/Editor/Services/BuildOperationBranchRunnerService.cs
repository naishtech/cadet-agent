using System;
using System.IO;
using System.Threading.Tasks;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Utilities;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Executes platform-specific build operation branches while preserving common tracking semantics.
    /// </summary>
    public static class BuildOperationBranchRunnerService
    {
        public sealed class Request
        {
            public BuildOperationExecutionService.Request OperationRequest { get; set; }
            public BuildProfile BuildProfile { get; set; }
            public string TempJsonPath { get; set; }
            public BuildOperationStatusPublisherService StatusPublisher { get; set; }
            public BuildOperationBlockingDialogService BlockingDialog { get; set; }
            public Action<string> Repaint { get; set; }
        }

        public sealed class Result
        {
            public BuildResult BuildResult { get; set; }
            public MessageBatcher MessageBatcher { get; set; }
        }

        public static async Task<Result> ExecuteAsync(Request request)
        {
            ValidateRequest(request);

            if (request.OperationRequest.BuildOnly && request.OperationRequest.ActiveJob != null)
            {
                BuildOperationStatusPublisherService.RegisterActiveJobTracking(request.OperationRequest.ActiveJob);
            }

#if CADET_LITE
            return await ExecuteLiteAsync(request);
#else
            return await ExecuteProAsync(request);
#endif
        }

#if !CADET_LITE
        private static async Task<Result> ExecuteProAsync(Request request)
        {
            string projectPath = Path.GetDirectoryName(Application.dataPath);
            MessageBatcher messageBatcher = null;

            BuildResult result = await Task.Run(() =>
            {
                messageBatcher = new MessageBatcher((batchedLines) =>
                {
                    foreach (string line in batchedLines)
                    {
                        if (!string.IsNullOrWhiteSpace(line))
                        {
                            CadetConsoleMessageType type = BuildOutputFormatter.DetermineMessageType(line);
                            request.OperationRequest.ConsoleOutput.AppendLine(line, type);
                        }
                    }
                });

                return request.OperationRequest.ExecuteDistScript(
                    projectPath,
                    request.TempJsonPath,
                    request.OperationRequest.Profile.profileName,
                    request.OperationRequest.ProfileGuid,
                    request.OperationRequest.BuildOnly,
                    request.OperationRequest.PublishOnly,
                    request.OperationRequest.NotarizeOnly,
                    line => messageBatcher.AddLine(line),
                    (status, text) =>
                    {
                        request.StatusPublisher.PublishIfChanged(text);
                        request.BlockingDialog.Update(status, text);
                    },
                    request.BlockingDialog.UpdateProgress,
                    request.OperationRequest.ActiveJob);
            });

            return new Result
            {
                BuildResult = result,
                MessageBatcher = messageBatcher
            };
        }
#else
        private static async Task<Result> ExecuteLiteAsync(Request request)
        {
            BuildResult result;

            if (request.OperationRequest.PublishOnly)
            {
                string platformName = request.OperationRequest.PlatformOverride ?? "unknown";
                request.OperationRequest.ConsoleOutput.AppendLine($"[ERROR] {platformName} publishing is not supported in CADET Lite", CadetConsoleMessageType.Error);
                result = new BuildResult("", false, -1, $"{platformName} publishing requires CADET Pro.");
            }
            else if (request.OperationRequest.NotarizeOnly)
            {
                request.OperationRequest.ConsoleOutput.AppendLine("[ERROR] macOS Notarization is a Pro feature", CadetConsoleMessageType.Error);
                result = new BuildResult("macOS Notarization is a Pro feature", false, -1, "Notarization requires CADET Pro");
            }
            else if (request.OperationRequest.BuildOnly)
            {
                request.OperationRequest.ConsoleOutput.AppendLine("[LOG] Starting Unity batch mode build...", CadetConsoleMessageType.Log);
                string persistentProfileJsonPath = UnityBuildService.PersistProfileSnapshot(request.BuildProfile, request.OperationRequest.ActiveJob, request.OperationRequest.ProfileGuid);

                result = await Task.Run(() => UnityBuildService.Execute(
                    profile: request.BuildProfile,
                    activeJob: request.OperationRequest.ActiveJob,
                    resolvedProfileGuid: request.OperationRequest.ProfileGuid,
                    profileJsonPath: persistentProfileJsonPath,
                    isCancellationRequested: BuildOperationExecutionService.IsCancellationRequested,
                    onStatusChange: (status, text) =>
                    {
                        request.StatusPublisher.PublishIfChanged(text);
                        request.BlockingDialog.Update(status, text);
                    },
                    onSyncProgress: request.BlockingDialog.UpdateProgress,
                    liveOutput: (line, type) =>
                    {
                        BuildOperationLiveOutputService.Enqueue(
                            line,
                            type,
                            (normalizedLine, messageType) => request.OperationRequest.ConsoleOutput.AppendLine(normalizedLine, messageType),
                            () => request.Repaint?.Invoke($"Live output received: {line?.TrimEnd()}"));
                    },
                    repaint: () => request.Repaint?.Invoke("UnityBuildService repaint callback"),
                    processTracker: request.OperationRequest.ExecutionState.ProcessTracker));
            }
            else
            {
                request.OperationRequest.ConsoleOutput.AppendLine("[ERROR] Build & Publish is not supported in CADET Lite", CadetConsoleMessageType.Error);
                result = new BuildResult("", false, -1, "Build & Publish requires CADET Pro (uses bash scripts).");
            }

            return new Result
            {
                BuildResult = result,
                MessageBatcher = null
            };
        }
#endif

        private static void ValidateRequest(Request request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.OperationRequest == null) throw new ArgumentNullException(nameof(request.OperationRequest));
            if (request.BuildProfile == null) throw new ArgumentNullException(nameof(request.BuildProfile));
            if (request.StatusPublisher == null) throw new ArgumentNullException(nameof(request.StatusPublisher));
            if (request.BlockingDialog == null) throw new ArgumentNullException(nameof(request.BlockingDialog));
        }
    }
}
