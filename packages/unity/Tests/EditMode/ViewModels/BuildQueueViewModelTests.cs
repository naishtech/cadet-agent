using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildJobOperationsSummaryServiceTests
    {
        [Test]
        public void GetSummary_NoOperations_ReturnsNone()
        {
            var job = new BuildJobDefinition("guid-1")
            {
                RunUnityBuild = false,
                RunNotarizeMac = false,
                RunPublishSteam = false,
                RunPublishEpic = false
            };

            string summary = BuildJobOperationsSummaryService.GetSummary(job);

            Assert.AreEqual("None", summary);
        }

        [Test]
        public void GetSummary_AllOperations_ListsAll()
        {
            var job = new BuildJobDefinition("guid-2")
            {
                RunUnityBuild = true,
                RunNotarizeMac = true,
                RunPublishSteam = true,
                RunPublishEpic = true
            };

            string summary = BuildJobOperationsSummaryService.GetSummary(job);

            StringAssert.Contains("Unity Build", summary);
            StringAssert.Contains("Notarize macOS", summary);
            StringAssert.Contains("Publish Steam", summary);
            StringAssert.Contains("Publish Epic", summary);
        }

        [Test]
        public void GetSummary_SteamOnly_ReturnsSteamOnly()
        {
            var job = new BuildJobDefinition("guid-3")
            {
                RunUnityBuild = false,
                RunNotarizeMac = false,
                RunPublishSteam = true,
                RunPublishEpic = false
            };

            string summary = BuildJobOperationsSummaryService.GetSummary(job);

            Assert.AreEqual("Publish Steam", summary);
        }

    }
}
