using System;
using System.Collections.Generic;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Utilities
{
    /// <summary>
    /// Batches messages from background threads and flushes them to the main thread via EditorApplication.delayCall.
    /// This is the ONLY place where EditorApplication.delayCall is used for console output updates,
    /// making it easy to isolate and debug threading issues.
    /// </summary>
    public class MessageBatcher : IDisposable
    {
        private readonly Action<List<string>> onFlush;
        private readonly List<string> buffer;
        private readonly object bufferLock = new object();
        private readonly Timer flushTimer;
        private readonly int maxBatchSize;
        private volatile bool disposed = false;
        
        /// <summary>
        /// Creates a new MessageBatcher
        /// </summary>
        /// <param name="onFlush">Callback that receives batched lines (called on main thread via delayCall)</param>
        /// <param name="maxBatchSize">Maximum number of lines to batch before flushing (default: 15)</param>
        /// <param name="flushIntervalMs">Interval in milliseconds for periodic flushing (default: 75ms)</param>
        public MessageBatcher(Action<List<string>> onFlush, int maxBatchSize = 15, int flushIntervalMs = 75)
        {
            this.onFlush = onFlush ?? throw new ArgumentNullException(nameof(onFlush));
            this.maxBatchSize = maxBatchSize;
            this.buffer = new List<string>();
            
            // Start periodic flush timer
            flushTimer = new Timer(OnTimerFlush, null, flushIntervalMs, flushIntervalMs);
        }
        
        /// <summary>
        /// Adds a line to the batch (thread-safe, can be called from any thread)
        /// </summary>
        public void AddLine(string line)
        {
            if (disposed || string.IsNullOrWhiteSpace(line))
                return;
            
            bool shouldFlush = false;
            lock (bufferLock)
            {
                buffer.Add(line.TrimEnd());
                shouldFlush = buffer.Count >= maxBatchSize;
            }
            
            // Flush immediately if batch size reached
            if (shouldFlush)
            {
                Flush();
            }
        }
        
        /// <summary>
        /// Flushes all buffered messages immediately (thread-safe)
        /// </summary>
        public void Flush()
        {
            if (disposed)
                return;
            
            List<string> linesToFlush;
            lock (bufferLock)
            {
                if (buffer.Count == 0)
                    return;
                
                linesToFlush = new List<string>(buffer);
                buffer.Clear();
            }
            
            // Marshal to main thread via delayCall (this is the ONLY place we use delayCall for console output)
            EditorApplication.delayCall += () =>
            {
                if (!disposed && linesToFlush.Count > 0)
                {
                    onFlush(linesToFlush);
                }
            };
        }
        
        private void OnTimerFlush(object state)
        {
            if (!disposed)
            {
                Flush();
            }
        }
        
        public void Dispose()
        {
            if (disposed)
                return;
            
            disposed = true;
            
            // Stop timer
            flushTimer?.Dispose();
            
            // Final flush of any remaining messages
            Flush();
        }
    }

    /// <summary>
    /// Thread-safe editor progress dialog wrapper that keeps a blocking progress bar visible
    /// while background work updates its latest status and progress.
    /// </summary>
    public static class BlockingProgressDialog
    {
        private static readonly object SyncRoot = new object();

        private static bool isVisible;
        private static bool updateRegistered;
        private static string title = string.Empty;
        private static string info = string.Empty;
        private static float progress;
        private static int refreshQueued;
        private static Action onCancelRequested;
        private static bool cancelRequestQueued;

        public static void Show(string dialogTitle, string dialogInfo, float dialogProgress = 0f, Action onCancel = null)
        {
            lock (SyncRoot)
            {
                title = string.IsNullOrWhiteSpace(dialogTitle) ? "Working..." : dialogTitle;
                info = dialogInfo ?? string.Empty;
                progress = Mathf.Clamp01(dialogProgress);
                isVisible = true;
                onCancelRequested = onCancel;
                cancelRequestQueued = false;
            }

            // Paint once immediately on the caller thread so very fast sync lifecycles
            // cannot clear the dialog before the first delayed refresh executes.
            Render();
            QueueRefresh();
        }

        public static void Update(string dialogInfo, float dialogProgress)
        {
            lock (SyncRoot)
            {
                if (!isVisible)
                {
                    return;
                }

                info = dialogInfo ?? string.Empty;
                progress = Mathf.Clamp01(dialogProgress);
            }

            QueueRefresh();
        }

        public static void Clear()
        {
            lock (SyncRoot)
            {
                isVisible = false;
                info = string.Empty;
                progress = 0f;
                onCancelRequested = null;
                cancelRequestQueued = false;
            }

            QueueRefresh();
        }

        private static void QueueRefresh()
        {
            if (Interlocked.Exchange(ref refreshQueued, 1) == 1)
            {
                return;
            }

            EditorApplication.delayCall += FlushRefresh;
        }

        private static void FlushRefresh()
        {
            Interlocked.Exchange(ref refreshQueued, 0);

            if (!updateRegistered)
            {
                EditorApplication.update += Render;
                updateRegistered = true;
            }

            Render();
        }

        private static void Render()
        {
            bool visibleSnapshot;
            string titleSnapshot;
            string infoSnapshot;
            float progressSnapshot;

            lock (SyncRoot)
            {
                visibleSnapshot = isVisible;
                titleSnapshot = title;
                infoSnapshot = info;
                progressSnapshot = progress;
            }

            if (visibleSnapshot)
            {
                bool cancelled = EditorUtility.DisplayCancelableProgressBar(titleSnapshot, infoSnapshot, progressSnapshot);
                if (cancelled)
                {
                    RequestCancel();
                }
                return;
            }

            EditorUtility.ClearProgressBar();

            if (updateRegistered)
            {
                EditorApplication.update -= Render;
                updateRegistered = false;
            }
        }

        private static void RequestCancel()
        {
            Action cancelAction = null;

            lock (SyncRoot)
            {
                if (!isVisible || cancelRequestQueued)
                {
                    return;
                }

                cancelAction = onCancelRequested;
                if (cancelAction == null)
                {
                    return;
                }

                cancelRequestQueued = true;
            }

            EditorApplication.delayCall += () =>
            {
                try
                {
                    cancelAction();
                }
                finally
                {
                    lock (SyncRoot)
                    {
                        cancelRequestQueued = false;
                    }

                    QueueRefresh();
                }
            };
        }
    }
}

