using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using Covyne.CADET.Editor.Utilities;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Covyne.CADET.Editor.Tests.Utilities
{
    [TestFixture]
    public class LogTailMonitorUtilityTests
    {
        private sealed class FakeStarter : ILogTailProcessStarter
        {
            private readonly Func<ProcessStartInfo, Process> start;

            public int CallCount { get; private set; }

            public FakeStarter(Func<ProcessStartInfo, Process> start)
            {
                this.start = start;
            }

            public Process Start(ProcessStartInfo psi)
            {
                CallCount++;
                return start(psi);
            }
        }

        [SetUp]
        public void SetUp()
        {
            LogTailMonitorUtility.ResetForTests();
        }

        [TearDown]
        public void TearDown()
        {
            LogTailMonitorUtility.ResetForTests();
        }

        [Test]
        public void BuildStartInfoForPlatform_Windows_UsesCmdTailLoop()
        {
            var psi = LogTailMonitorUtility.BuildStartInfoForPlatform(
                @"C:\logs\unity_build_windows.log",
                "Unity Log (Windows)",
                RuntimePlatform.WindowsEditor);

            Assert.AreEqual("cmd.exe", psi.FileName);
            StringAssert.Contains("powershell", psi.Arguments);
            StringAssert.Contains("Get-Content", psi.Arguments);
            StringAssert.Contains("-Tail 0 -Wait", psi.Arguments);
            Assert.IsTrue(psi.UseShellExecute);
        }

        [Test]
        public void BuildStartInfoForPlatform_Mac_UsesTerminalTailCommand()
        {
            var psi = LogTailMonitorUtility.BuildStartInfoForPlatform(
                "/Volumes/CORSAIR/Amethyst Lite/Logs/unity_build_macos.log",
                "Unity Log (macOS)",
                RuntimePlatform.OSXEditor);

            Assert.AreEqual("/usr/bin/osascript", psi.FileName);
            StringAssert.Contains("set logPath to", psi.Arguments);
            StringAssert.Contains("quoted form of logPath", psi.Arguments);
            StringAssert.Contains("tell application \\\"Terminal\\\" to do script tailCommand", psi.Arguments);
            StringAssert.Contains("Amethyst Lite/Logs/unity_build_macos.log", psi.Arguments);
        }

        [Test]
        public void OpenTailMonitorForPlatform_WithMissingFile_ReturnsFalse()
        {
            string missingPath = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".log");

            bool opened = LogTailMonitorUtility.OpenTailMonitorForPlatform(
                missingPath,
                "Unity Log",
                RuntimePlatform.WindowsEditor);

            Assert.IsFalse(opened);
        }

        [Test]
        public void OpenTailMonitorForPlatform_WhenStarterThrows_ReturnsFalse()
        {
            string logPath = CreateTempLogFile();
            var starter = new FakeStarter(_ => throw new InvalidOperationException("start failed"));
            LogTailMonitorUtility.SetProcessStarterForTests(starter);

            LogAssert.Expect(LogType.Error, new Regex("Failed to launch Windows log tail monitor"));

            bool opened = LogTailMonitorUtility.OpenTailMonitorForPlatform(
                logPath,
                "Unity Log",
                RuntimePlatform.WindowsEditor);

            Assert.IsFalse(opened);
            Assert.AreEqual(1, starter.CallCount);

            File.Delete(logPath);
        }

        [Test]
        public void OpenTailMonitorForPlatform_DedupesPerPath()
        {
            string logPath = CreateTempLogFile();
            var starter = new FakeStarter(_ => new Process());
            LogTailMonitorUtility.SetProcessStarterForTests(starter);

            bool first = LogTailMonitorUtility.OpenTailMonitorForPlatform(
                logPath,
                "Unity Log",
                RuntimePlatform.WindowsEditor);
            bool second = LogTailMonitorUtility.OpenTailMonitorForPlatform(
                logPath,
                "Unity Log",
                RuntimePlatform.WindowsEditor);

            Assert.IsTrue(first);
            Assert.IsFalse(second);
            Assert.AreEqual(1, starter.CallCount);

            File.Delete(logPath);
        }

        private static string CreateTempLogFile()
        {
            string path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".log");
            File.WriteAllText(path, "test");
            return path;
        }
    }
}
