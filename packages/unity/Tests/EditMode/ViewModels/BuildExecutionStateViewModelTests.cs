using Covyne.CADET.Editor.ViewModels;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.ViewModels
{
    [TestFixture]
    public class BuildExecutionStateViewModelTests
    {
        [Test]
        public void IsRunning_WhenChanged_FiresEvent()
        {
            var vm = new BuildExecutionStateViewModel();
            bool? observed = null;
            vm.IsRunningChanged += value => observed = value;

            vm.IsRunning = true;

            Assert.AreEqual(true, observed);
        }

        [Test]
        public void SetAndClearActiveProcess_UpdatesReference()
        {
            var vm = new BuildExecutionStateViewModel();

            vm.SetActiveProcess(null);
            Assert.IsNull(vm.ActiveBuildProcess);

            vm.ClearActiveProcess();
            Assert.IsNull(vm.ActiveBuildProcess);
        }

        [Test]
        public void CleanupActiveBuildProcess_WithNoActiveProcess_DoesNotThrow()
        {
            var vm = new BuildExecutionStateViewModel();

            Assert.DoesNotThrow(() => vm.CleanupActiveBuildProcess());
            Assert.IsNull(vm.ActiveBuildProcess);
        }

        [Test]
        public void BeginOperation_SetsRunningAndMirroringFlags()
        {
            var vm = new BuildExecutionStateViewModel();
            var actionButtons = new ActionButtonsViewModel();
            var consoleOutput = new ConsoleOutputViewModel();

            vm.BeginOperation(actionButtons, consoleOutput);

            Assert.IsTrue(vm.IsRunning);
            Assert.IsTrue(actionButtons.IsRunning);
            Assert.IsTrue(consoleOutput.UnityConsoleMirroringEnabled);
        }

        [Test]
        public void CompleteOperation_WithKeepMirroringFalse_StopsRunningAndMirroring()
        {
            var vm = new BuildExecutionStateViewModel();
            var actionButtons = new ActionButtonsViewModel();
            var consoleOutput = new ConsoleOutputViewModel();

            vm.BeginOperation(actionButtons, consoleOutput);
            vm.CompleteOperation(actionButtons, consoleOutput, keepConsoleMirroring: false);

            Assert.IsFalse(vm.IsRunning);
            Assert.IsFalse(actionButtons.IsRunning);
            Assert.IsFalse(consoleOutput.UnityConsoleMirroringEnabled);
            Assert.IsNull(vm.ActiveBuildProcess);
        }

        [Test]
        public void CompleteOperation_WithKeepMirroringTrue_LeavesMirroringEnabled()
        {
            var vm = new BuildExecutionStateViewModel();
            var actionButtons = new ActionButtonsViewModel();
            var consoleOutput = new ConsoleOutputViewModel();

            vm.BeginOperation(actionButtons, consoleOutput);
            vm.CompleteOperation(actionButtons, consoleOutput, keepConsoleMirroring: true, clearActiveProcess: false);

            Assert.IsFalse(vm.IsRunning);
            Assert.IsFalse(actionButtons.IsRunning);
            Assert.IsTrue(consoleOutput.UnityConsoleMirroringEnabled);
        }
    }
}
