using Covyne.CADET.Editor.Lite.ViewModels;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.ViewModels
{
    [TestFixture]
    public class BuildQueueDisplayViewModelTests
    {
        [Test]
        public void ShouldRepaintActive_WhenPastDueAndActive_ReturnsTrueAndAdvancesSchedule()
        {
            var vm = new BuildQueueDisplayViewModel();
            vm.Reset();

            bool repaint = vm.ShouldRepaintActive(5d, true, 0.2d);

            Assert.IsTrue(repaint);
            Assert.AreEqual(5.2d, vm.NextActiveRepaintAt, 0.0001d);
        }

        [Test]
        public void ToggleRenderMode_FlipsButtonLabel()
        {
            var vm = new BuildQueueDisplayViewModel();
            vm.Reset();

            Assert.AreEqual("Show All", vm.GetToggleButtonLabel());
            vm.ToggleRenderMode();
            Assert.AreEqual("Show Latest", vm.GetToggleButtonLabel());
        }
    }
}
