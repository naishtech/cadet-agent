using System;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.ViewModels;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOperationCleanupServiceTests
    {
        [Test]
        public void Execute_WhenExecutionRunning_CompletesStateAndTriggersRepaint()
        {
            var executionState = new BuildExecutionStateViewModel();
            var actionButtons = new ActionButtonsViewModel();
            var consoleOutput = new ConsoleOutputViewModel();

            executionState.BeginOperation(actionButtons, consoleOutput);

            int repaintCount = 0;

            BuildOperationCleanupService.Execute(
                new BuildOperationCleanupService.Request
                {
                    BlockingDialog = null,
                    MessageBatcher = null,
                    TempJsonPath = null,
                    ExecutionState = executionState,
                    ActionButtons = actionButtons,
                    ConsoleOutput = consoleOutput,
                    KeepConsoleMirroringAfterCompletion = false,
                    Repaint = () => repaintCount++
                });

            Assert.IsFalse(executionState.IsRunning);
            Assert.IsFalse(actionButtons.IsRunning);
            Assert.AreEqual(1, repaintCount);
        }

        [Test]
        public void Execute_WhenExecutionNotRunning_IsStillSafeAndRepaints()
        {
            var executionState = new BuildExecutionStateViewModel();
            var actionButtons = new ActionButtonsViewModel();
            var consoleOutput = new ConsoleOutputViewModel();

            int repaintCount = 0;

            BuildOperationCleanupService.Execute(
                new BuildOperationCleanupService.Request
                {
                    BlockingDialog = null,
                    MessageBatcher = null,
                    TempJsonPath = null,
                    ExecutionState = executionState,
                    ActionButtons = actionButtons,
                    ConsoleOutput = consoleOutput,
                    KeepConsoleMirroringAfterCompletion = false,
                    Repaint = () => repaintCount++
                });

            Assert.IsFalse(executionState.IsRunning);
            Assert.AreEqual(1, repaintCount);
        }

        [Test]
        public void Execute_NullOptionalFields_IsIdempotent()
        {
            var executionState = new BuildExecutionStateViewModel();
            var actionButtons = new ActionButtonsViewModel();
            var consoleOutput = new ConsoleOutputViewModel();

            // NullReferenceException must not be thrown when BlockingDialog,
            // MessageBatcher, TempJsonPath, and Repaint are all null.
            Assert.DoesNotThrow(() =>
            {
                BuildOperationCleanupService.Execute(
                    new BuildOperationCleanupService.Request
                    {
                        BlockingDialog = null,
                        MessageBatcher = null,
                        TempJsonPath = null,
                        ExecutionState = executionState,
                        ActionButtons = actionButtons,
                        ConsoleOutput = consoleOutput,
                        KeepConsoleMirroringAfterCompletion = false,
                        Repaint = null
                    });
            });

            Assert.IsFalse(executionState.IsRunning);
        }
    }
}
