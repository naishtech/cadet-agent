using System;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    /// <summary>
    /// Lite-side bridge for queue actions that are implemented in the editor assembly.
    /// </summary>
    public static class BuildQueueInteropService
    {
        public static Action EnsureInitializedAction { get; set; }
        public static Func<BuildJobDefinition, bool> RetryJobFunc { get; set; }

        public static void EnsureInitialized()
        {
            EnsureInitializedAction?.Invoke();
        }

        public static bool RetryJob(BuildJobDefinition job)
        {
            return RetryJobFunc != null && RetryJobFunc(job);
        }
    }
}