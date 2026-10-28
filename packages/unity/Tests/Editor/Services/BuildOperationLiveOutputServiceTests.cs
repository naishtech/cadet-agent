using System;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOperationLiveOutputServiceTests
    {
        [Test]
        public void Enqueue_WithScheduler_DefersOutputUntilScheduledCallbackRuns()
        {
            Action scheduled = null;
            int appendCount = 0;
            int repaintCount = 0;
            string outputText = null;

            BuildOperationLiveOutputService.Enqueue(
                "line from worker",
                CadetConsoleMessageType.Log,
                (text, _) =>
                {
                    appendCount++;
                    outputText = text;
                },
                () => repaintCount++,
                callback => scheduled = callback);

            Assert.AreEqual(0, appendCount);
            Assert.AreEqual(0, repaintCount);
            Assert.IsNotNull(scheduled);

            scheduled.Invoke();

            Assert.AreEqual(1, appendCount);
            Assert.AreEqual(1, repaintCount);
            Assert.AreEqual("line from worker", outputText);
        }

        [Test]
        public void Enqueue_BlankLine_DoesNotScheduleOrAppend()
        {
            bool schedulerCalled = false;
            int appendCount = 0;
            int repaintCount = 0;

            BuildOperationLiveOutputService.Enqueue(
                "   ",
                CadetConsoleMessageType.Log,
                (_, _) => appendCount++,
                () => repaintCount++,
                _ => schedulerCalled = true);

            Assert.IsFalse(schedulerCalled);
            Assert.AreEqual(0, appendCount);
            Assert.AreEqual(0, repaintCount);
        }
    }
}
