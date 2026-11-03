using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueRenderHelperServiceTests
    {
        [Test]
        public void GetStatusIcon_Completed_ReturnsCheckmark()
        {
            string icon = BuildQueueRenderHelperService.GetStatusIcon(BuildJobStatus.Completed);

            Assert.AreEqual("✅", icon);
        }

        [Test]
        public void GetStatusIcon_Failed_ReturnsCrossMark()
        {
            string icon = BuildQueueRenderHelperService.GetStatusIcon(BuildJobStatus.Failed);

            Assert.AreEqual("❌", icon);
        }
    }
}
