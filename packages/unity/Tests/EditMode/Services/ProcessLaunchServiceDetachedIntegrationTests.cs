using System;
using System.Collections;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Utilities;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class ProcessLaunchServiceDetachedIntegrationTests
    {
        private string _testRoot;

        [SetUp]
        public void SetUp()
        {
            if (Application.platform != RuntimePlatform.WindowsEditor)
            {
                Assert.Ignore("Detached watcher integration tests are Windows-only.");
            }

            _testRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_testRoot);
        }

        [TearDown]
        public void TearDown()
        {
            if (!string.IsNullOrWhiteSpace(_testRoot) && Directory.Exists(_testRoot))
            {
                Directory.Delete(_testRoot, true);
            }
        }

        [UnityTest]
        public IEnumerator TryStartDetached_CommandExitZero_WritesCompletedManifest()
        {
            string jobGuid = "job-exit-zero";
            string launchToken = Guid.NewGuid().ToString("N");
            string manifestPath = Path.Combine(_testRoot, "status-exit-zero.json");
            string scriptLogPath = Path.Combine(_testRoot, "status-exit-zero.ps.log");

            string script =
                "$logPath = '" + EscapeForSingleQuotedPowerShell(scriptLogPath) + "'\n" +
                "[System.IO.File]::AppendAllText($logPath, [DateTime]::UtcNow.ToString('o') + ' start' + [Environment]::NewLine, [System.Text.Encoding]::UTF8)\n" +
                "Start-Sleep -Seconds 2\n" +
                "[System.IO.File]::AppendAllText($logPath, [DateTime]::UtcNow.ToString('o') + ' success path' + [Environment]::NewLine, [System.Text.Encoding]::UTF8)\n" +
                "exit 0\n";
            string scriptPath = CreatePowerShellScriptFile("status-exit-zero.ps1", script);

            bool started = ProcessLaunchService.TryStartDetached(
                "powershell.exe",
                BuildPowerShellFileArguments(scriptPath),
                _testRoot,
                manifestPath,
                jobGuid,
                launchToken,
                out int processId,
                out DateTime processStartUtc,
                out string errorMessage);

            Assert.IsTrue(started, errorMessage);
            Assert.Greater(processId, 0);
            Assert.LessOrEqual(processStartUtc, DateTime.UtcNow);

            var workspace = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ActiveStatusManifestPath = manifestPath,
                ActiveStatusLaunchToken = launchToken
            };

            yield return WaitForTerminalManifest(workspace, 10f);

            bool read = DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out string readError);
            Assert.IsTrue(read, readError);
            string diagnostics = ReadDiagnostics(manifestPath, scriptLogPath);
            Assert.AreEqual(BuildJobStatus.Completed, DetachedStatusManifestReader.TryMapOverallStatus(manifest.OverallStatus), diagnostics);
            Assert.AreEqual(0, manifest.ExitCode, diagnostics);
        }

        [UnityTest]
        public IEnumerator TryStartDetached_CommandExitNonZero_WritesFailedManifestWithExitCode()
        {
            string jobGuid = "job-exit-failure";
            string launchToken = Guid.NewGuid().ToString("N");
            string manifestPath = Path.Combine(_testRoot, "status-exit-failure.json");
            string scriptLogPath = Path.Combine(_testRoot, "status-exit-failure.ps.log");

            string script =
                "$logPath = '" + EscapeForSingleQuotedPowerShell(scriptLogPath) + "'\n" +
                "[System.IO.File]::AppendAllText($logPath, [DateTime]::UtcNow.ToString('o') + ' start' + [Environment]::NewLine, [System.Text.Encoding]::UTF8)\n" +
                "Start-Sleep -Seconds 2\n" +
                "[System.IO.File]::AppendAllText($logPath, [DateTime]::UtcNow.ToString('o') + ' about-to-run-native-fail' + [Environment]::NewLine, [System.Text.Encoding]::UTF8)\n" +
                "cmd.exe /d /c \"exit 7\"\n" +
                "[System.IO.File]::AppendAllText($logPath, [DateTime]::UtcNow.ToString('o') + ' native-last-exit=' + $LASTEXITCODE + [Environment]::NewLine, [System.Text.Encoding]::UTF8)\n" +
                "[System.IO.File]::AppendAllText($logPath, [DateTime]::UtcNow.ToString('o') + ' about-to-environment-exit=' + $LASTEXITCODE + [Environment]::NewLine, [System.Text.Encoding]::UTF8)\n" +
                "[System.Environment]::Exit([int]$LASTEXITCODE)\n";
            string scriptPath = CreatePowerShellScriptFile("status-exit-failure.ps1", script);

            bool started = ProcessLaunchService.TryStartDetached(
                "powershell.exe",
                BuildPowerShellFileArguments(scriptPath),
                _testRoot,
                manifestPath,
                jobGuid,
                launchToken,
                out int processId,
                out DateTime processStartUtc,
                out string errorMessage);

            Assert.IsTrue(started, errorMessage);
            Assert.Greater(processId, 0);
            Assert.LessOrEqual(processStartUtc, DateTime.UtcNow);

            var workspace = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ActiveStatusManifestPath = manifestPath,
                ActiveStatusLaunchToken = launchToken
            };

            yield return WaitForTerminalManifest(workspace, 10f);

            bool read = DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out string readError);
            Assert.IsTrue(read, readError);
            string diagnostics = ReadDiagnostics(manifestPath, scriptLogPath);
            Assert.AreEqual(BuildJobStatus.Failed, DetachedStatusManifestReader.TryMapOverallStatus(manifest.OverallStatus), diagnostics);
            Assert.AreNotEqual(0, manifest.ExitCode, diagnostics);
        }

        private static IEnumerator WaitForTerminalManifest(WorkspaceInfo workspace, float timeoutSeconds)
        {
            float deadline = Time.realtimeSinceStartup + timeoutSeconds;
            while (Time.realtimeSinceStartup < deadline)
            {
                if (DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out _) &&
                    DetachedStatusManifestReader.IsTerminal(manifest.OverallStatus))
                {
                    yield break;
                }

                yield return null;
            }
            string manifestPath = workspace?.ActiveStatusManifestPath;
            string scriptLogPath = string.IsNullOrWhiteSpace(manifestPath)
                ? string.Empty
                : Path.ChangeExtension(manifestPath, ".ps.log");
            Assert.Fail($"Timed out waiting for terminal detached manifest state. {ReadDiagnostics(manifestPath, scriptLogPath)}");
        }

        

        private static string ReadDiagnostics(string manifestPath, string scriptLogPath)
        {
            string manifestJson = File.Exists(manifestPath)
                ? File.ReadAllText(manifestPath)
                : "<manifest missing>";

            string watcherLogPath = manifestPath + ".watcher.log";
            string watcherLog = File.Exists(watcherLogPath)
                ? File.ReadAllText(watcherLogPath)
                : "<watcher log missing>";

            string scriptLog = File.Exists(scriptLogPath)
                ? File.ReadAllText(scriptLogPath)
                : "<script log missing>";

            return $"Manifest Path: {manifestPath}{Environment.NewLine}" +
                   $"Watcher Log Path: {watcherLogPath}{Environment.NewLine}" +
                   $"Script Log Path: {scriptLogPath}{Environment.NewLine}" +
                   $"Manifest JSON:{Environment.NewLine}{manifestJson}{Environment.NewLine}" +
                   $"Watcher Log:{Environment.NewLine}{watcherLog}{Environment.NewLine}" +
                   $"Script Log:{Environment.NewLine}{scriptLog}";
        }

        private static string BuildPowerShellFileArguments(string scriptPath)
        {
            return "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + scriptPath + "\"";
        }

        private static string EscapeForSingleQuotedPowerShell(string value)
        {
            return (value ?? string.Empty).Replace("'", "''");
        }

        private string CreatePowerShellScriptFile(string fileName, string script)
        {
            string path = Path.Combine(_testRoot, fileName);
            File.WriteAllText(path, script ?? string.Empty);
            return path;
        }
    }
}
