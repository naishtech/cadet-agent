using System.Diagnostics;
using Covyne.CADET.Editor.Utilities;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Utilities
{
    [TestFixture]
    public class ActiveBuildProcessTrackerTests
    {
        [Test]
        public void Register_SetsActiveProcess()
        {
            var tracker = new ActiveBuildProcessTracker();
            var process = new Process();

            tracker.Register(process);

            Assert.AreSame(process, tracker.ActiveProcess);
        }

        [Test]
        public void Clear_NullsActiveProcess()
        {
            var tracker = new ActiveBuildProcessTracker();
            tracker.Register(new Process());

            tracker.Clear();

            Assert.IsNull(tracker.ActiveProcess);
        }

        [Test]
        public void Register_Null_NullsActiveProcess()
        {
            var tracker = new ActiveBuildProcessTracker();
            tracker.Register(new Process());

            tracker.Register(null);

            Assert.IsNull(tracker.ActiveProcess);
        }

        [Test]
        public void KillAndClear_WithNoActiveProcess_DoesNotThrow()
        {
            var tracker = new ActiveBuildProcessTracker();

            Assert.DoesNotThrow(() => tracker.KillAndClear());
            Assert.IsNull(tracker.ActiveProcess);
        }

        [Test]
        public void KillAndClear_NullsActiveProcessAfterCall()
        {
            var tracker = new ActiveBuildProcessTracker();
            // Register a never-started Process; HasExited throws InvalidOperationException,
            // which KillAndClear catches and treats as "already gone".
            tracker.Register(new Process());

            Assert.DoesNotThrow(() => tracker.KillAndClear());
            Assert.IsNull(tracker.ActiveProcess);
        }
    }
}
