using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOutputFormatterTests
    {
        [Test]
        public void DetermineMessageType_EmptyLine_ReturnsLog()
        {
            CadetConsoleMessageType result = BuildOutputFormatter.DetermineMessageType(string.Empty);

            Assert.AreEqual(CadetConsoleMessageType.Log, result);
        }

        [Test]
        public void DetermineMessageType_ErrorTag_ReturnsError()
        {
            CadetConsoleMessageType result = BuildOutputFormatter.DetermineMessageType("[ERROR] Build failed");

            Assert.AreEqual(CadetConsoleMessageType.Error, result);
        }

        [Test]
        public void DetermineMessageType_ExitCodeZero_ReturnsLog()
        {
            CadetConsoleMessageType result = BuildOutputFormatter.DetermineMessageType("Process exited with code: 0");

            Assert.AreEqual(CadetConsoleMessageType.Log, result);
        }

        [Test]
        public void DetermineMessageType_ExitCodeNonZero_ReturnsError()
        {
            CadetConsoleMessageType result = BuildOutputFormatter.DetermineMessageType("Process exited with code: 7");

            Assert.AreEqual(CadetConsoleMessageType.Error, result);
        }

        [Test]
        public void DetectBuildFailure_ExitCodeNonZero_ReturnsTrue()
        {
            bool result = BuildOutputFormatter.DetectBuildFailure("", 1);

            Assert.IsTrue(result);
        }

        [Test]
        public void DetectBuildFailure_FailureLine_ReturnsTrue()
        {
            bool result = BuildOutputFormatter.DetectBuildFailure("[12:00:00] unity build failed", 0);

            Assert.IsTrue(result);
        }

        [Test]
        public void DetectBuildFailure_NoFailureAndZeroExitCode_ReturnsFalse()
        {
            bool result = BuildOutputFormatter.DetectBuildFailure("Build completed successfully", 0);

            Assert.IsFalse(result);
        }

        [Test]
        public void ExtractErrorMessage_ExitCodeOnly_ReturnsExitCodeMessage()
        {
            string result = BuildOutputFormatter.ExtractErrorMessage("", 23, true);

            Assert.AreEqual("Build process exited with code 23", result);
        }

        [Test]
        public void ExtractErrorMessage_KilledProcessLine_ReturnsKilledMessage()
        {
            string output = "[12:00:00] Process was terminated (killed externally)";

            string result = BuildOutputFormatter.ExtractErrorMessage(output, -1, true);

            Assert.AreEqual("Build process was terminated (killed externally)", result);
        }

        [Test]
        public void ExtractErrorMessage_RemovesTimestampFromFailureLine()
        {
            string output = "[10:52:43] Steam build failed due to bad credentials";

            string result = BuildOutputFormatter.ExtractErrorMessage(output, 0, true);

            Assert.AreEqual("Steam build failed due to bad credentials", result);
        }
    }
}
