using System;
using System.IO;
using System.Reflection;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOperationLivenessServiceTests
    {
        private static readonly MethodInfo ShouldTreatDetachedOperationAsRunningMethod =
            typeof(BuildOperationLivenessService).GetMethod(
                "ShouldTreatDetachedOperationAsRunning",
                BindingFlags.NonPublic | BindingFlags.Static);

        private static bool InvokeShouldTreatAsRunning(WorkspaceInfo workspace, DateTime nowUtc)
        {
            Assert.IsNotNull(ShouldTreatDetachedOperationAsRunningMethod,
                "ShouldTreatDetachedOperationAsRunning should exist via reflection.");
            return (bool)ShouldTreatDetachedOperationAsRunningMethod.Invoke(null, new object[] { workspace, nowUtc });
        }

        // ── Manifest expected but file not yet written ─────────────────────────────────

        [Test]
        public void ShouldTreatAsRunning_ManifestExpectedNotYetWritten_WithinGrace_ReturnsTrue()
        {
            // Pure C# process: manifest path configured, file doesn't exist yet (early startup after reload).
            // Started 5 seconds ago → within the 15s grace window.
            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-1",
                ProfileGuid = "profile-1",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = true,
                ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5),
                ActiveStatusManifestPath = Path.Combine(Path.GetTempPath(), $"nonexistent-{Guid.NewGuid():N}.status.json"),
                ActiveStatusLaunchToken = "token-abc"
            };

            bool result = InvokeShouldTreatAsRunning(workspace, DateTime.UtcNow);

            Assert.IsTrue(result,
                "Manifest-tracking process in grace window should be treated as running even when manifest not yet written.");
        }

        [Test]
        public void ShouldTreatAsRunning_ManifestExpectedNotYetWritten_AfterGrace_ReturnsFalse()
        {
            // Pure C# process started 20 seconds ago (beyond 15s grace), manifest never appeared.
            // No active log either — should not be treated as running.
            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-2",
                ProfileGuid = "profile-2",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = true,
                ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-20),
                ActiveStatusManifestPath = Path.Combine(Path.GetTempPath(), $"nonexistent-{Guid.NewGuid():N}.status.json"),
                ActiveStatusLaunchToken = "token-def",
                ActiveLogPath = string.Empty
            };

            bool result = InvokeShouldTreatAsRunning(workspace, DateTime.UtcNow);

            Assert.IsFalse(result,
                "Manifest-tracking process beyond grace window with no manifest and no log activity should not be treated as running.");
        }

        // ── Manifest readable + non-terminal ──────────────────────────────────────────

        [Test]
        public void ShouldTreatAsRunning_ManifestReadableNonTerminal_ReturnsTrue()
        {
            // Manifest file exists but has a non-terminal status (e.g. "building" or "running").
            // Process should be treated as still active.
            string manifestPath = CreateTempManifest("job-3", "token-3", "building", null);

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-3",
                    ProfileGuid = "profile-3",
                    LastBuildStatus = BuildJobStatus.Building,
                    IsOperationActive = true,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-60),
                    ActiveStatusManifestPath = manifestPath,
                    ActiveStatusLaunchToken = "token-3"
                };

                bool result = InvokeShouldTreatAsRunning(workspace, DateTime.UtcNow);

                Assert.IsTrue(result,
                    "Process with non-terminal manifest should be treated as running, even well past grace window.");
            }
            finally
            {
                DeleteIfExists(manifestPath);
            }
        }

        // ── Manifest readable + terminal ──────────────────────────────────────────────

        [Test]
        public void ShouldTreatAsRunning_ManifestReadableTerminalCompleted_ReturnsFalse()
        {
            string manifestPath = CreateTempManifest("job-4", "token-4", "completed", 0);

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-4",
                    ProfileGuid = "profile-4",
                    LastBuildStatus = BuildJobStatus.Building,
                    IsOperationActive = true,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5),
                    ActiveStatusManifestPath = manifestPath,
                    ActiveStatusLaunchToken = "token-4"
                };

                bool result = InvokeShouldTreatAsRunning(workspace, DateTime.UtcNow);

                Assert.IsFalse(result,
                    "Process with terminal manifest (completed) should not be treated as running.");
            }
            finally
            {
                DeleteIfExists(manifestPath);
            }
        }

        [Test]
        public void ShouldTreatAsRunning_ManifestReadableTerminalFailed_ReturnsFalse()
        {
            string manifestPath = CreateTempManifest("job-5", "token-5", "failed", 1);

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-5",
                    ProfileGuid = "profile-5",
                    LastBuildStatus = BuildJobStatus.Building,
                    IsOperationActive = true,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5),
                    ActiveStatusManifestPath = manifestPath,
                    ActiveStatusLaunchToken = "token-5"
                };

                bool result = InvokeShouldTreatAsRunning(workspace, DateTime.UtcNow);

                Assert.IsFalse(result,
                    "Process with terminal manifest (failed) should not be treated as running.");
            }
            finally
            {
                DeleteIfExists(manifestPath);
            }
        }

        // ── No manifest at all (legacy / non-manifest path) ───────────────────────────

        [Test]
        public void ShouldTreatAsRunning_NoManifestPath_WithinGrace_ReturnsTrue()
        {
            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-6",
                ProfileGuid = "profile-6",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = true,
                ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5),
                ActiveStatusManifestPath = string.Empty,
                ActiveStatusLaunchToken = string.Empty
            };

            bool result = InvokeShouldTreatAsRunning(workspace, DateTime.UtcNow);

            Assert.IsTrue(result,
                "Non-manifest-tracking process within grace window should still be treated as running.");
        }

        // ── Terminal workspace status ──────────────────────────────────────────────────

        [Test]
        public void ShouldTreatAsRunning_WorkspaceAlreadyCompletedStatus_ReturnsFalse()
        {
            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-7",
                ProfileGuid = "profile-7",
                LastBuildStatus = BuildJobStatus.Completed,
                IsOperationActive = true,
                ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
            };

            bool result = InvokeShouldTreatAsRunning(workspace, DateTime.UtcNow);

            Assert.IsFalse(result,
                "Workspace with terminal LastBuildStatus should not be treated as running.");
        }

        // ── Helpers ───────────────────────────────────────────────────────────────────

        private static string CreateTempManifest(string jobGuid, string launchToken, string overallStatus, int? exitCode)
        {
            string path = Path.Combine(Path.GetTempPath(), $"cadet-liveness-{Guid.NewGuid():N}.status.json");
            string exitCodeField = exitCode.HasValue ? $"{exitCode.Value}" : "null";
            string json = "{" +
                          "\"schemaVersion\":1," +
                          $"\"jobGuid\":\"{jobGuid}\"," +
                          $"\"launchToken\":\"{launchToken}\"," +
                          "\"profileName\":\"Test\"," +
                          $"\"startedAtUtc\":\"{DateTime.UtcNow.AddSeconds(-30):O}\"," +
                          $"\"updatedAtUtc\":\"{DateTime.UtcNow:O}\"," +
                          $"\"terminalAtUtc\":\"{DateTime.UtcNow:O}\"," +
                          $"\"overallStatus\":\"{overallStatus}\"," +
                          "\"currentOperation\":\"unity_build\"," +
                          "\"currentMessage\":\"test\"," +
                          $"\"exitCode\":{exitCodeField}," +
                          "\"operations\":[]," +
                          "\"summary\":[]" +
                          "}";

            File.WriteAllText(path, json);
            return path;
        }

        private static void DeleteIfExists(string path)
        {
            if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }
}
