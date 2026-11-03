using System;
using System.Diagnostics;
using Covyne.CADET.Editor.Utilities;

namespace Covyne.CADET.Editor.ViewModels
{
    /// <summary>
    /// Owns execution state and process lifecycle for active build operations.
    /// </summary>
    public class BuildExecutionStateViewModel
    {
        private bool isRunning;

        public ActiveBuildProcessTracker ProcessTracker { get; } = new ActiveBuildProcessTracker();

        public bool IsRunning
        {
            get => isRunning;
            set
            {
                if (isRunning != value)
                {
                    isRunning = value;
                    IsRunningChanged?.Invoke(value);
                }
            }
        }

        public Process ActiveBuildProcess => ProcessTracker.ActiveProcess;

        public event Action<bool> IsRunningChanged;

        public void SetActiveProcess(Process process)
        {
            ProcessTracker.Register(process);
        }

        public void BeginOperation(ActionButtonsViewModel actionButtons, ConsoleOutputViewModel consoleOutput)
        {
            if (actionButtons == null)
            {
                throw new ArgumentNullException(nameof(actionButtons));
            }

            if (consoleOutput == null)
            {
                throw new ArgumentNullException(nameof(consoleOutput));
            }

            IsRunning = true;
            actionButtons.IsRunning = true;
            consoleOutput.UnityConsoleMirroringEnabled = true;
        }

        public void CompleteOperation(
            ActionButtonsViewModel actionButtons,
            ConsoleOutputViewModel consoleOutput,
            bool keepConsoleMirroring,
            bool clearActiveProcess = true)
        {
            if (actionButtons == null)
            {
                throw new ArgumentNullException(nameof(actionButtons));
            }

            if (consoleOutput == null)
            {
                throw new ArgumentNullException(nameof(consoleOutput));
            }

            if (clearActiveProcess)
            {
                ClearActiveProcess();
            }

            IsRunning = false;
            actionButtons.IsRunning = false;

            if (!keepConsoleMirroring)
            {
                consoleOutput.UnityConsoleMirroringEnabled = false;
            }
        }

        public void ClearActiveProcess()
        {
            ProcessTracker.Clear();
        }

        public void CleanupActiveBuildProcess()
        {
            ProcessTracker.KillAndClear();
        }
    }
}
