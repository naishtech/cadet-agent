using System;
using System.Collections.Generic;
using System.Linq;

namespace Covyne.CADET.Editor.Tests.Mocks
{
    /// <summary>
    /// Mock for BuildStatusEventBus that captures all publish/subscribe calls for assertion.
    /// </summary>
    public class MockBuildStatusEventBus
    {
        private Dictionary<string, List<Action<string>>> subscriptions = new Dictionary<string, List<Action<string>>>();
        public List<(string JobGuid, string Status, bool FromBackground)> PublishHistory { get; } = new List<(string, string, bool)>();

        /// <summary>
        /// Simulates subscribing to a job's status changes.
        /// </summary>
        public void SubscribeToJob(string jobGuid, Action<string> callback)
        {
            if (!subscriptions.ContainsKey(jobGuid))
            {
                subscriptions[jobGuid] = new List<Action<string>>();
            }
            subscriptions[jobGuid].Add(callback);
        }

        /// <summary>
        /// Simulates unsubscribing from a job's status changes.
        /// </summary>
        public void UnsubscribeFromJob(string jobGuid, Action<string> callback)
        {
            if (subscriptions.ContainsKey(jobGuid))
            {
                subscriptions[jobGuid].Remove(callback);
            }
        }

        /// <summary>
        /// Simulates publishing a status change. Records it for assertion.
        /// </summary>
        public void PublishStatusChange(string jobGuid, string statusText, bool fromBackground = false)
        {
            PublishHistory.Add((jobGuid, statusText, fromBackground));
            
            if (subscriptions.ContainsKey(jobGuid))
            {
                foreach (var callback in subscriptions[jobGuid].ToList())
                {
                    callback?.Invoke(statusText);
                }
            }
        }

        /// <summary>
        /// Simulates unsubscribing all listeners from a job.
        /// </summary>
        public void UnsubscribeAllFromJob(string jobGuid)
        {
            if (subscriptions.ContainsKey(jobGuid))
            {
                subscriptions[jobGuid].Clear();
            }
        }

        /// <summary>
        /// Clears all recorded history and subscriptions.
        /// </summary>
        public void ClearAll()
        {
            PublishHistory.Clear();
            subscriptions.Clear();
        }

        /// <summary>
        /// Returns the number of active subscriptions for a job.
        /// </summary>
        public int GetSubscriberCount(string jobGuid)
        {
            return subscriptions.ContainsKey(jobGuid) ? subscriptions[jobGuid].Count : 0;
        }

        /// <summary>
        /// Checks if a specific status was published for a job.
        /// </summary>
        public bool WasStatusPublished(string jobGuid, string status)
        {
            return PublishHistory.Any(p => p.JobGuid == jobGuid && p.Status == status);
        }

        /// <summary>
        /// Gets all published statuses for a job in order.
        /// </summary>
        public List<string> GetPublishedStatuses(string jobGuid)
        {
            return PublishHistory.Where(p => p.JobGuid == jobGuid).Select(p => p.Status).ToList();
        }
    }
}
