using Covyne.CADET.Editor.Utilities;
using NUnit.Framework;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class ProcessLaunchServiceTests
    {
        [Test]
        public void CreateDetachedStartInfo_Windows_DisablesShellExecute()
        {
            var startInfo = ProcessLaunchService.CreateDetachedStartInfo(
                RuntimePlatform.WindowsEditor,
                "unity.exe",
                "-batchmode",
                "C:/temp/project");

            Assert.IsFalse(startInfo.UseShellExecute);
            Assert.IsTrue(startInfo.CreateNoWindow);
            Assert.IsFalse(startInfo.RedirectStandardOutput);
            Assert.IsFalse(startInfo.RedirectStandardError);
        }

        [Test]
        public void CreateDetachedStartInfo_Mac_DisablesShellExecute()
        {
            var startInfo = ProcessLaunchService.CreateDetachedStartInfo(
                RuntimePlatform.OSXEditor,
                "/Applications/Unity/Unity.app/Contents/MacOS/Unity",
                "-batchmode",
                "/tmp/project");

            Assert.IsFalse(startInfo.UseShellExecute);
            Assert.IsFalse(startInfo.CreateNoWindow);
            Assert.IsFalse(startInfo.RedirectStandardOutput);
            Assert.IsFalse(startInfo.RedirectStandardError);
        }
    }
}