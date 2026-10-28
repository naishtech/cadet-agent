using System;
using System.Collections.Generic;
using UnityEditor;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Centralized event bus for build job status updates.
    /// Provides thread-safe event publishing with automatic marshalling to the editor thread via EditorApplication.delayCall.
    /// 
    /// Usage:
    /// 1. Subscribe: BuildStatusEventBus.SubscribeToJob(jobGuid, callback);
    /// 2. Publish: BuildStatusEventBus.PublishStatusChange(jobGuid, "Status text");
    /// 3. Cleanup: BuildStatusEventBus.UnsubscribeAllFromJob(jobGuid);
    /// 
    /// All callbacks are automatically marshalled to the editor thread, making this safe to call from background threads.
    /// </summary>
    public static class BuildStatusEventBus
    {
        private const string LogPrefix = "[C.A.D.E.T][BuildStatusEventBus]";

        private static Dictionary<string, List<Action<string>>> jobStatusSubscriptions = 
            new Dictionary<string, List<Action<string>>>();

        // Map from jobGuid to the job's OnStatusChanged UnityEvent for direct event invocation.
        // This allows build-history UI listeners on job.OnStatusChanged to receive published status updates.
        private static Dictionary<string, UnityEngine.Events.UnityEvent<string>> jobUnityEvents =
            new Dictionary<string, UnityEngine.Events.UnityEvent<string>>();

        // Map from jobGuid to a setter that persists the latest status on the active job model.
        private static Dictionary<string, Action<string>> jobStatusTargets =
            new Dictionary<string, Action<string>>();

        // Cache the latest published status so late subscribers can replay it.
        private static Dictionary<string, string> latestStatusesByJob =
            new Dictionary<string, string>();

        // Testing support: flag to bypass delayCall and invoke callbacks immediately
        private static bool useDelayCall = true;

        /// <summary>
        /// Sets whether to use EditorApplication.delayCall for callback marshalling.
        /// Set to false in unit tests to invoke callbacks immediately.
        /// </summary>
        public static void SetUseDelayCall(bool use)
        {
            useDelayCall = use;
        }

        /// <summary>
        /// Subscribes to status change events for a specific job.
        /// The callback will be invoked whenever PublishStatusChange is called for that job.
        /// Thread-safe: callback will execute on the editor thread even if published from background thread.
        /// </summary>
        /// <param name="jobGuid">Unique identifier for the job</param>
        /// <param name="callback">Action to invoke when status changes, receives status text as parameter</param>
        public static void SubscribeToJob(string jobGuid, Action<string> callback)
        {
            if (string.IsNullOrEmpty(jobGuid) || callback == null)
            {
                return;
            }

            if (!jobStatusSubscriptions.ContainsKey(jobGuid))
            {
                jobStatusSubscriptions[jobGuid] = new List<Action<string>>();
            }

            jobStatusSubscriptions[jobGuid].Add(callback);
            // ConsoleOutput.AppendLine($"{LogPrefix} Subscribed callback for job {jobGuid}. Callback count: {jobStatusSubscriptions[jobGuid].Count}", CadetConsoleMessageType.Info);
        }

        /// <summary>
        /// Unsubscribes a specific callback from a job's status change events.
        /// </summary>
        /// <param name="jobGuid">Unique identifier for the job</param>
        /// <param name="callback">The callback to remove</param>
        public static void UnsubscribeFromJob(string jobGuid, Action<string> callback)
        {
            if (string.IsNullOrEmpty(jobGuid) || !jobStatusSubscriptions.ContainsKey(jobGuid))
            {
                return;
            }

            jobStatusSubscriptions[jobGuid].Remove(callback);

            // Clean up empty entries
            if (jobStatusSubscriptions[jobGuid].Count == 0)
            {
                jobStatusSubscriptions.Remove(jobGuid);
            }
        }

        /// <summary>
        /// Publishes a status change for a job. All subscribed callbacks will be invoked with the new status.
        /// Also invokes the job's registered UnityEvent<string> OnStatusChanged event if available.
        /// Thread-safe: automatically marshals callbacks to the editor thread via EditorApplication.delayCall
        /// (unless SetUseDelayCall(false) is called for testing).
        /// Safe to call from background threads.
        /// </summary>
        /// <param name="jobGuid">Unique identifier for the job</param>
        /// <param name="statusText">The new status text to publish</param>
        public static void PublishStatusChange(string jobGuid, string statusText)
        {
            if (string.IsNullOrEmpty(jobGuid))
            {
                return;
            }

            latestStatusesByJob[jobGuid] = statusText;

            // Get subscribers and job event (may be null)
            var hasSubscribers = jobStatusSubscriptions.ContainsKey(jobGuid);
            var subscribers = hasSubscribers ? new List<Action<string>>(jobStatusSubscriptions[jobGuid]) : new List<Action<string>>();
            var jobEvent = jobUnityEvents.ContainsKey(jobGuid) ? jobUnityEvents[jobGuid] : null;
            var statusTarget = jobStatusTargets.ContainsKey(jobGuid) ? jobStatusTargets[jobGuid] : null;

            // ConsoleOutput.AppendLine($"{LogPrefix} Publish requested for job {jobGuid}. Status: {statusText}. Callback subscribers: {subscribers.Count}. Has job event: {jobEvent != null}. Has status target: {statusTarget != null}. useDelayCall={useDelayCall}", CadetConsoleMessageType.Info);

            if (!hasSubscribers && jobEvent == null && statusTarget == null)
            {
                // ConsoleOutput.AppendLine($"{LogPrefix} Publish ignored for job {jobGuid} because there are no subscribers and no registered job event. Status: {statusText}", CadetConsoleMessageType.Warning);
                return;
            }

            if (useDelayCall)
            {
                // Marshal callback invocations to the editor thread
                EditorApplication.delayCall += () =>
                {
                    // ConsoleOutput.AppendLine($"{LogPrefix} Executing delayed publish for job {jobGuid}. Status: {statusText}", CadetConsoleMessageType.Info);

                    if (statusTarget != null)
                    {
                        try
                        {
                            statusTarget(statusText);
                        }
                        catch (Exception)
                        {
                            // ConsoleOutput.AppendLine($"[BuildStatusEventBus] Error invoking status target: {ex.Message}\n{ex.StackTrace}", CadetConsoleMessageType.Error);
                        }
                    }

                    // Invoke the job's UnityEvent first
                    if (jobEvent != null)
                    {
                        try
                        {
                            jobEvent.Invoke(statusText);
                        }
                        catch (Exception)
                        {
                            // ConsoleOutput.AppendLine($"[BuildStatusEventBus] Error invoking UnityEvent: {ex.Message}\n{ex.StackTrace}", CadetConsoleMessageType.Error);
                        }
                    }

                    // Then invoke all callback subscribers
                    foreach (var callback in subscribers)
                    {
                        try
                        {
                            callback?.Invoke(statusText);
                        }
                        catch (Exception)
                        {
                            // ConsoleOutput.AppendLine($"[BuildStatusEventBus] Error invoking callback: {ex.Message}\n{ex.StackTrace}", CadetConsoleMessageType.Error);
                        }
                    }
                };
            }
            else
            {
                // Invoke immediately (for testing)
                if (statusTarget != null)
                {
                    try
                    {
                        statusTarget(statusText);
                    }
                    catch (Exception)
                    {
                        // ConsoleOutput.AppendLine($"[BuildStatusEventBus] Error invoking status target: {ex.Message}\n{ex.StackTrace}", CadetConsoleMessageType.Error);
                    }
                }

                // Invoke the job's UnityEvent first
                if (jobEvent != null)
                {
                    try
                    {
                        jobEvent.Invoke(statusText);
                    }
                    catch (Exception)
                    {
                        // ConsoleOutput.AppendLine($"[BuildStatusEventBus] Error invoking UnityEvent: {ex.Message}\n{ex.StackTrace}", CadetConsoleMessageType.Error);
                    }
                }

                // Then invoke all callback subscribers
                foreach (var callback in subscribers)
                {
                    try
                    {
                        callback?.Invoke(statusText);
                    }
                    catch (Exception)
                    {
                        // ConsoleOutput.AppendLine($"[BuildStatusEventBus] Error invoking callback: {ex.Message}\n{ex.StackTrace}", CadetConsoleMessageType.Error);
                    }
                }
            }
        }

        /// <summary>
        /// Registers a job's OnStatusChanged event for direct invocation when status is published.
        /// Called by BuildJobDefinition during construction so that build-history listeners on
        /// job.OnStatusChanged receive events published via BuildStatusEventBus.PublishStatusChange().
        /// </summary>
        /// <param name="jobGuid">Unique identifier for the job</param>
        /// <param name="statusEvent">The job's OnStatusChanged UnityEvent</param>
        public static void RegisterJobEvent(string jobGuid, UnityEngine.Events.UnityEvent<string> statusEvent)
        {
            RegisterJobEvent(jobGuid, statusEvent, null);
        }

        public static void RegisterJobEvent(string jobGuid, UnityEngine.Events.UnityEvent<string> statusEvent, Action<string> statusTarget)
        {
            if (string.IsNullOrEmpty(jobGuid) || statusEvent == null)
            {
                return;
            }

            jobUnityEvents[jobGuid] = statusEvent;
            if (statusTarget != null)
            {
                jobStatusTargets[jobGuid] = statusTarget;
            }

            // Debug log removed per request

            if (latestStatusesByJob.TryGetValue(jobGuid, out string latestStatus))
            {
                // ConsoleOutput.AppendLine($"{LogPrefix} Replaying cached status for job {jobGuid} on registration. Status: {latestStatus}", CadetConsoleMessageType.Info);

                if (statusTarget != null)
                {
                    statusTarget(latestStatus);
                }

                statusEvent.Invoke(latestStatus);
            }
        }

        public static bool TryGetLatestStatus(string jobGuid, out string statusText)
        {
            if (string.IsNullOrEmpty(jobGuid))
            {
                statusText = null;
                return false;
            }

            return latestStatusesByJob.TryGetValue(jobGuid, out statusText);
        }

        /// <summary>
        /// Unsubscribes all callbacks for a specific job and clears its registered event.
        /// Useful for cleanup when a job completes or is removed from the queue.
        /// </summary>
        /// <param name="jobGuid">Unique identifier for the job</param>
        public static void UnsubscribeAllFromJob(string jobGuid)
        {
            if (string.IsNullOrEmpty(jobGuid))
            {
                return;
            }

            if (jobStatusSubscriptions.ContainsKey(jobGuid))
            {
                jobStatusSubscriptions[jobGuid].Clear();
                jobStatusSubscriptions.Remove(jobGuid);
            }

            if (jobUnityEvents.ContainsKey(jobGuid))
            {
                jobUnityEvents.Remove(jobGuid);
            }

            if (jobStatusTargets.ContainsKey(jobGuid))
            {
                jobStatusTargets.Remove(jobGuid);
            }

            if (latestStatusesByJob.ContainsKey(jobGuid))
            {
                latestStatusesByJob.Remove(jobGuid);
            }
        }

        /// <summary>
        /// Clears all subscriptions. Useful for cleanup or testing.
        /// </summary>
        public static void ClearAll()
        {
            jobStatusSubscriptions.Clear();
            jobUnityEvents.Clear();
            jobStatusTargets.Clear();
            latestStatusesByJob.Clear();
        }
    }
}
