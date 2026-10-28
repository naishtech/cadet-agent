using System;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using Covyne.CADET.Editor.ViewModels;
using NUnit.Framework;
using UnityEngine.TestTools;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOperationCompletionServiceTests
    {
        private ProgressBarViewModel progressBar;
        private ConsoleOutputViewModel consoleOutput;
        private BuildOperationExecutionService.Request operationRequest;

        [SetUp]
        public void SetUp()
        {
            progressBar = new ProgressBarViewModel();
            progressBar.Start("Test operation");
            consoleOutput = new ConsoleOutputViewModel();

            operationRequest = new BuildOperationExecutionService.Request
            {
                OperationName = "Test Build",
                Profile = new BuildProfile { profileName = "TestProfile" },
                ConsoleOutput = consoleOutput,
                ProgressBar = progressBar,
                BuildOnly = true
            };
        }

        [Test]
        public void ApplyResult_SuccessPath_SetsProgressBarSuccessState()
        {
            var buildResult = new BuildResult
            {
                Success = true,
                Output = "",
                ErrorMessage = "",
                DetachedOperationActive = false
            };

            var result = BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
            {
                OperationRequest = operationRequest,
                BuildResult = buildResult,
                Repaint = _ => { }
            });

            Assert.IsTrue(progressBar.HasSuccess);
            Assert.IsFalse(progressBar.HasError);
            Assert.IsFalse(progressBar.IsRunning);
            Assert.IsTrue(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
        }

        [Test]
        public void ApplyResult_SuccessPath_StatusTextContainsProfileName()
        {
            var buildResult = new BuildResult
            {
                Success = true,
                Output = "",
                ErrorMessage = "",
                DetachedOperationActive = false
            };

            BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
            {
                OperationRequest = operationRequest,
                BuildResult = buildResult,
                Repaint = _ => { }
            });

            StringAssert.Contains("TestProfile", progressBar.StatusText);
        }

        [Test]
        public void ApplyResult_FailurePath_SetsProgressBarErrorState()
        {
            var buildResult = new BuildResult
            {
                Success = false,
                Output = "",
                ErrorMessage = "Script exited with code 1",
                DetachedOperationActive = false
            };

            LogAssert.Expect(UnityEngine.LogType.Error, new System.Text.RegularExpressions.Regex("C\\.A\\.D\\.E\\.T.*failed.*TestProfile"));

            var result = BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
            {
                OperationRequest = operationRequest,
                BuildResult = buildResult,
                Repaint = _ => { }
            });

            Assert.IsTrue(progressBar.HasError);
            Assert.IsFalse(progressBar.HasSuccess);
            Assert.IsFalse(progressBar.IsRunning);
            Assert.IsFalse(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
        }

        [Test]
        public void ApplyResult_FailurePath_StatusTextContainsErrorMessage()
        {
            var buildResult = new BuildResult
            {
                Success = false,
                Output = "",
                ErrorMessage = "Script exited with code 1",
                DetachedOperationActive = false
            };

            LogAssert.Expect(UnityEngine.LogType.Error, new System.Text.RegularExpressions.Regex("C\\.A\\.D\\.E\\.T.*failed.*TestProfile"));

            BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
            {
                OperationRequest = operationRequest,
                BuildResult = buildResult,
                Repaint = _ => { }
            });

            StringAssert.Contains("Script exited with code 1", progressBar.StatusText);
        }

        [Test]
        public void ApplyResult_DetachedPath_SetsSuccessStateAndReturnsDetached()
        {
            var buildResult = new BuildResult
            {
                Success = false,
                Output = "",
                ErrorMessage = "",
                DetachedOperationActive = true
            };

            var result = BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
            {
                OperationRequest = operationRequest,
                BuildResult = buildResult,
                Repaint = _ => { }
            });

            Assert.IsTrue(progressBar.HasSuccess);
            Assert.IsFalse(progressBar.HasError);
            Assert.IsFalse(progressBar.IsRunning);
            Assert.IsTrue(result.DetachedOperationActive);
        }

        [Test]
        public void ApplyResult_DetachedPath_StatusTextContainsDetachedMode()
        {
            var buildResult = new BuildResult
            {
                Success = false,
                Output = "",
                ErrorMessage = "",
                DetachedOperationActive = true
            };

            BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
            {
                OperationRequest = operationRequest,
                BuildResult = buildResult,
                Repaint = _ => { }
            });

            StringAssert.Contains("detached mode", progressBar.StatusText);
        }

        [Test]
        public void ApplyResult_WithMultilineOutput_DoesNotThrow()
        {
            var buildResult = new BuildResult
            {
                Success = true,
                Output = "line one\nline two\n   \nline three",
                ErrorMessage = "",
                DetachedOperationActive = false
            };

            Assert.DoesNotThrow(() =>
            {
                BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
                {
                    OperationRequest = operationRequest,
                    BuildResult = buildResult,
                    Repaint = _ => { }
                });
            });
        }

        [Test]
        public void ApplyResult_InvokesRepaintCallback()
        {
            int repaintCount = 0;
            var buildResult = new BuildResult { Success = true };

            BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
            {
                OperationRequest = operationRequest,
                BuildResult = buildResult,
                Repaint = _ => repaintCount++
            });

            Assert.AreEqual(1, repaintCount);
        }

        [Test]
        public void ApplyResult_NullRepaint_DoesNotThrow()
        {
            var buildResult = new BuildResult { Success = true };

            Assert.DoesNotThrow(() =>
            {
                BuildOperationCompletionService.ApplyResult(new BuildOperationCompletionService.Request
                {
                    OperationRequest = operationRequest,
                    BuildResult = buildResult,
                    Repaint = null
                });
            });
        }
    }
}
