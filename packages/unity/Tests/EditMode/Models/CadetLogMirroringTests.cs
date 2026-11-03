using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.ViewModels;

namespace Covyne.CADET.Editor.Tests.Models
{
    public class CadetLogMirroringTests
    {
        private sealed class FakeEmitter : ICadetUnityConsoleEmitter
        {
            public readonly List<(CadetUnityLogLevel Level, string Message)> Entries = new List<(CadetUnityLogLevel, string)>();

            public void Emit(CadetUnityLogLevel level, string message)
            {
                Entries.Add((level, message));
            }
        }

        [Test]
        public void Map_ConsoleMessageTypes_ToExpectedUnityLevels()
        {
            Assert.AreEqual(CadetUnityLogLevel.Info, CadetLogMirrorMapper.Map(CadetConsoleMessageType.Log));
            Assert.AreEqual(CadetUnityLogLevel.Info, CadetLogMirrorMapper.Map(CadetConsoleMessageType.Success));
            Assert.AreEqual(CadetUnityLogLevel.Info, CadetLogMirrorMapper.Map(CadetConsoleMessageType.Progress));
            Assert.AreEqual(CadetUnityLogLevel.Warn, CadetLogMirrorMapper.Map(CadetConsoleMessageType.Warning));
            Assert.AreEqual(CadetUnityLogLevel.Error, CadetLogMirrorMapper.Map(CadetConsoleMessageType.Error));
        }

        [Test]
        public void ShouldMirror_RespectsMinimumThreshold()
        {
            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Error, CadetUnityLogLevel.Error));
            Assert.IsFalse(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Warn, CadetUnityLogLevel.Error));

            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Warn, CadetUnityLogLevel.Warn));
            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Error, CadetUnityLogLevel.Warn));
            Assert.IsFalse(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Info, CadetUnityLogLevel.Warn));

            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Info, CadetUnityLogLevel.Info));
            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Warn, CadetUnityLogLevel.Info));
            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Error, CadetUnityLogLevel.Info));

            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Debug, CadetUnityLogLevel.Debug));
            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Info, CadetUnityLogLevel.Debug));
            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Warn, CadetUnityLogLevel.Debug));
            Assert.IsTrue(CadetLogMirrorMapper.ShouldMirror(CadetUnityLogLevel.Error, CadetUnityLogLevel.Debug));
        }

        [Test]
        public void AppendLine_DoesNotMirror_WhenMirroringDisabled()
        {
            var emitter = new FakeEmitter();
            var vm = new ConsoleOutputViewModel(emitter)
            {
                UnityConsoleMirroringEnabled = false,
                MinimumUnityConsoleLevel = CadetUnityLogLevel.Info
            };

            vm.AppendLine("mirror-disabled", CadetConsoleMessageType.Error);

            Assert.AreEqual(0, emitter.Entries.Count);
        }

        [Test]
        public void AppendLine_Mirrors_WhenEnabledAndLevelPasses()
        {
            var emitter = new FakeEmitter();
            var vm = new ConsoleOutputViewModel(emitter)
            {
                UnityConsoleMirroringEnabled = true,
                MinimumUnityConsoleLevel = CadetUnityLogLevel.Warn
            };

            vm.AppendLine("warn-message", CadetConsoleMessageType.Warning);
            vm.AppendLine("info-message", CadetConsoleMessageType.Log);
            vm.AppendLine("error-message", CadetConsoleMessageType.Error);

            Assert.AreEqual(2, emitter.Entries.Count);
            Assert.AreEqual(CadetUnityLogLevel.Warn, emitter.Entries[0].Level);
            Assert.AreEqual(CadetUnityLogLevel.Error, emitter.Entries[1].Level);
        }

        [Test]
        public void AppendLine_AlwaysWritesToFile_RegardlessOfMirrorState()
        {
            var emitter = new FakeEmitter();
            var vm = new ConsoleOutputViewModel(emitter)
            {
                UnityConsoleMirroringEnabled = false,
                MinimumUnityConsoleLevel = CadetUnityLogLevel.Error
            };

            string uniqueToken = Guid.NewGuid().ToString("N");
            vm.Clear();
            vm.AppendLine($"file-write-{uniqueToken}", CadetConsoleMessageType.Log);

            string logPath = vm.LogFilePath;
            string contents = File.ReadAllText(logPath);

            StringAssert.Contains(uniqueToken, contents);
            Assert.AreEqual(0, emitter.Entries.Count);
        }
    }
}
