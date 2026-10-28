using System;
using Covyne.CADET.Editor.Utilities;
using Covyne.CADET.Editor.ViewModels;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Owns operation cleanup responsibilities that must run from the finally block.
    /// </summary>
    public static class BuildOperationCleanupService
    {
        public sealed class Request
        {
            public BuildOperationBlockingDialogService BlockingDialog { get; set; }
            public MessageBatcher MessageBatcher { get; set; }
            public string TempJsonPath { get; set; }
            public BuildExecutionStateViewModel ExecutionState { get; set; }
            public ActionButtonsViewModel ActionButtons { get; set; }
            public ConsoleOutputViewModel ConsoleOutput { get; set; }
            public bool KeepConsoleMirroringAfterCompletion { get; set; }
            public Action Repaint { get; set; }
        }

        public static void Execute(Request request)
        {
            ValidateRequest(request);

            request.BlockingDialog?.ClearIfActive();
            request.MessageBatcher?.Dispose();

            if (!string.IsNullOrEmpty(request.TempJsonPath))
            {
                ProfileJsonService.CleanupTemporaryFile(request.TempJsonPath);
            }

            if (request.ExecutionState.IsRunning)
            {
                request.ExecutionState.CompleteOperation(
                    request.ActionButtons,
                    request.ConsoleOutput,
                    request.KeepConsoleMirroringAfterCompletion);
            }

            request.Repaint?.Invoke();
        }

        private static void ValidateRequest(Request request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.ExecutionState == null) throw new ArgumentNullException(nameof(request.ExecutionState));
            if (request.ActionButtons == null) throw new ArgumentNullException(nameof(request.ActionButtons));
            if (request.ConsoleOutput == null) throw new ArgumentNullException(nameof(request.ConsoleOutput));
        }
    }
}
