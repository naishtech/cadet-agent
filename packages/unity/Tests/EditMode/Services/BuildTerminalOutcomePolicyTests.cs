using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildTerminalOutcomePolicyTests
    {
        [Test]
        public void NormalizeTerminalOutcome_PublishStepFailed_RemainsFailed()
        {
            BuildTerminalOutcomePolicy.NormalizeTerminalOutcome(
                BuildJobStatus.Failed,
                BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonPublishStepFailed),
                out BuildJobStatus normalizedStatus,
                out string normalizedDetail);

            Assert.AreEqual(BuildJobStatus.Failed, normalizedStatus);
            Assert.AreEqual(
                BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonPublishStepFailed),
                normalizedDetail);
        }

        [Test]
        public void NormalizeTerminalOutcome_ExitCodeUnavailable_CompletesWithInferredDetail()
        {
            BuildTerminalOutcomePolicy.NormalizeTerminalOutcome(
                BuildJobStatus.Failed,
                BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable),
                out BuildJobStatus normalizedStatus,
                out string normalizedDetail);

            Assert.AreEqual(BuildJobStatus.Completed, normalizedStatus);
            Assert.AreEqual(
                BuildTerminalOutcomePolicy.BuildInferredDetail(BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable),
                normalizedDetail);
        }
    }
}