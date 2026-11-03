using System;
using Covyne.CADET.Editor.Localization;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Applies BuildResult output and terminal UI state updates for an executed build operation.
    /// </summary>
    public static class BuildOperationCompletionService
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";

        public sealed class Request
        {
            public BuildOperationExecutionService.Request OperationRequest { get; set; }
            public BuildResult BuildResult { get; set; }
            public Action<string> Repaint { get; set; }
        }

        public static BuildOperationExecutionService.ExecutionResult ApplyResult(Request request)
        {
            ValidateRequest(request);

            if (!string.IsNullOrEmpty(request.BuildResult.Output))
            {
                string[] lines = request.BuildResult.Output.Split('\n');
                foreach (string line in lines)
                {
                    if (!string.IsNullOrWhiteSpace(line))
                    {
                        string trimmedLine = line.TrimEnd();
                        CadetConsoleMessageType type = BuildOutputFormatter.DetermineMessageType(trimmedLine);
                        request.OperationRequest.ConsoleOutput.AppendLine(trimmedLine, type);
                    }
                }
            }

            bool success = request.BuildResult.Success;
            bool detachedOperationActive = request.BuildResult.DetachedOperationActive;

            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} Operation ApplyResult job='{request.OperationRequest.ActiveJob?.JobGuid ?? string.Empty}' operation='{request.OperationRequest.OperationName}' " +
                $"success={success} detached={detachedOperationActive} exitCode={request.BuildResult.ExitCode} " +
                $"error='{request.BuildResult.ErrorMessage ?? string.Empty}' outputLength={request.BuildResult.Output?.Length ?? 0}.");

            if (detachedOperationActive)
            {
                string startedMessage = $"{request.OperationRequest.OperationName} started in detached mode for profile: {request.OperationRequest.Profile.profileName}";
                request.OperationRequest.ProgressBar.StopWithSuccess(startedMessage);
                request.OperationRequest.ConsoleOutput.AppendLine($"[LOG] {startedMessage}", CadetConsoleMessageType.Log);
            }
            else if (!success)
            {
                string errorMessageWithLogs = string.IsNullOrEmpty(request.BuildResult.ErrorMessage)
                    ? CadetLocalization.GetString("Window.Cadet.Messages.CheckLogsForDetails")
                    : $"{request.BuildResult.ErrorMessage}. {CadetLocalization.GetString("Window.Cadet.Messages.CheckLogsForDetails")}";
                request.OperationRequest.ProgressBar.StopWithError(errorMessageWithLogs);
                request.OperationRequest.ConsoleOutput.AppendLine($"[ERROR] {request.OperationRequest.OperationName} failed for profile: {request.OperationRequest.Profile.profileName}", CadetConsoleMessageType.Error);
                if (!string.IsNullOrEmpty(request.BuildResult.ErrorMessage))
                {
                    request.OperationRequest.ConsoleOutput.AppendLine($"[ERROR] {request.BuildResult.ErrorMessage}", CadetConsoleMessageType.Error);
                }

                UnityEngine.Debug.LogError($"C.A.D.E.T {request.OperationRequest.OperationName} failed for profile '{request.OperationRequest.Profile.profileName}': {request.BuildResult.ErrorMessage}");
            }
            else
            {
                string successMessage = $"{request.OperationRequest.OperationName} completed successfully for profile: {request.OperationRequest.Profile.profileName}";
                request.OperationRequest.ProgressBar.StopWithSuccess(successMessage);
                request.OperationRequest.ConsoleOutput.AppendLine($"[SUCCESS] {request.OperationRequest.OperationName} completed for profile: {request.OperationRequest.Profile.profileName}", CadetConsoleMessageType.Success);
            }

            request.Repaint?.Invoke($"Operation completed. Success={success}");
            return new BuildOperationExecutionService.ExecutionResult(
                success,
                detachedOperationActive,
                request.BuildResult.ExitCode,
                request.BuildResult.ErrorMessage);
        }

        private static void ValidateRequest(Request request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.OperationRequest == null) throw new ArgumentNullException(nameof(request.OperationRequest));
            if (request.BuildResult == null) throw new ArgumentNullException(nameof(request.BuildResult));
        }
    }
}
