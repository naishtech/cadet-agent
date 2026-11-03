using System;

namespace Covyne.CADET.Editor.Lite.Services
{
    /// <summary>
    /// Shared runtime state for build-execution history surfaces.
    /// The legacy queue-oriented type name remains because both Lite UI and the main editor assembly depend on it.
    /// </summary>
    public sealed class BuildQueueRuntimeState
    {
        private static readonly BuildQueueRuntimeState instance = new BuildQueueRuntimeState();

        public static BuildQueueRuntimeState Instance => instance;

        private BuildQueueRuntimeState()
        {
            Reset();
        }

        public string ActiveJobGuid { get; set; }
        public string ActiveStatusText { get; set; }
        public bool IsOperationRunning { get; set; }
        public bool HasError { get; set; }
        public bool HasSuccess { get; set; }
        public Action CancelActiveOperation { get; set; }

        public void Reset()
        {
            ActiveJobGuid = null;
            ActiveStatusText = string.Empty;
            IsOperationRunning = false;
            HasError = false;
            HasSuccess = false;
            CancelActiveOperation = null;
        }
    }
}