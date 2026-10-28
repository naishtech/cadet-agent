using System;

namespace Covyne.CADET.Editor.Lite.Models
{
    /// <summary>
    /// Represents the current status of a build job in the queue
    /// </summary>
    [Serializable]
    public enum BuildJobStatus
    {
        /// <summary>Job is waiting in queue</summary>
        Queued,
        
        /// <summary>Job is currently syncing workspace files</summary>
        Syncing,
        
        /// <summary>Job is currently building in Unity</summary>
        Building,
        
#if !CADET_LITE
        /// <summary>Job is publishing to Steam/Epic (CICD only - CADET FULL)</summary>
        Publishing,
        
        /// <summary>Job is notarizing macOS build (CICD only - CADET FULL)</summary>
        Notarizing,
#endif
        
        /// <summary>Job completed successfully</summary>
        Completed,
        
        /// <summary>Job failed with errors</summary>
        Failed,
        
        /// <summary>Job was cancelled by user</summary>
        Cancelled
    }
}
