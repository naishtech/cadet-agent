using System;
using System.Collections;
using System.Threading;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Utilities
{
    /// <summary>
    /// Helper utilities for testing thread marshalling and editor thread behavior.
    /// </summary>
    public static class EditorThreadTestHelper
    {
        /// <summary>
        /// Waits for EditorApplication.delayCall callbacks to execute.
        /// Since delayCall executes on the next editor update, this yields multiple frames to be safe.
        /// </summary>
        public static IEnumerator WaitForDelayCall()
        {
            // delayCall may execute at different times depending on editor state
            // Yield multiple frames to ensure it has time to run
            yield return null;
            yield return null;
            yield return null;
        }

        /// <summary>
        /// Asserts that the current thread is the editor's main thread.
        /// </summary>
        public static void AssertIsEditorThread()
        {
            Assert.IsFalse(Thread.CurrentThread.IsThreadPoolThread, "Expected editor thread, but running on thread pool");
        }

        /// <summary>
        /// Asserts that the current thread is a background/worker thread.
        /// </summary>
        public static void AssertIsBackgroundThread()
        {
            Assert.IsTrue(Thread.CurrentThread.IsThreadPoolThread, "Expected background thread, but running on editor thread");
        }

        /// <summary>
        /// Generates a unique job GUID for testing.
        /// </summary>
        public static string GenerateTestJobGuid()
        {
            return $"test-job-{Guid.NewGuid():N}";
        }
    }
}
