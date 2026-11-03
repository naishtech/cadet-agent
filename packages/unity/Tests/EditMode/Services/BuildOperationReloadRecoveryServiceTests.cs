using System;
using System.IO;
using System.Reflection;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildOperationReloadRecoveryServiceTests
    {
        private static MethodInfo TryReadDetachedLogStatusMethod =>
            typeof(BuildOperationReloadRecoveryService).GetMethod(
                "TryReadDetachedLogStatus",
                BindingFlags.NonPublic | BindingFlags.Static);

        private static MethodInfo DetermineDetachedFinalStatusMethod =>
            typeof(BuildOperationReloadRecoveryService).GetMethod(
                "DetermineDetachedFinalStatus",
                BindingFlags.NonPublic | BindingFlags.Static);

        private static MethodInfo ShouldDelayInactiveWorkspaceReconciliationMethod =>
            typeof(BuildOperationReloadRecoveryService).GetMethod(
                "ShouldDelayInactiveWorkspaceReconciliation",
                BindingFlags.NonPublic | BindingFlags.Static);

        private static MethodInfo ShouldDelayOrphanedWorkspaceNormalizationMethod =>
            typeof(BuildOperationReloadRecoveryService).GetMethod(
                "ShouldDelayOrphanedWorkspaceNormalization",
                BindingFlags.NonPublic | BindingFlags.Static);

        private static MethodInfo GetLastDetachedRecoveryDetailMethod =>
            typeof(BuildOperationReloadRecoveryService).GetMethod(
                "GetLastDetachedRecoveryDetail",
                BindingFlags.NonPublic | BindingFlags.Static);

        private static MethodInfo ResetRuntimeWhenNoActiveOperationMethod =>
            typeof(BuildOperationReloadRecoveryService).GetMethod(
                "ResetRuntimeWhenNoActiveOperation",
                BindingFlags.NonPublic | BindingFlags.Static);

        private static MethodInfo ReconcileStaleQueueActiveJobsMethod =>
            typeof(BuildOperationReloadRecoveryService).GetMethod(
                "ReconcileStaleQueueActiveJobs",
                BindingFlags.NonPublic | BindingFlags.Static);

        [Test]
        public void TryReadDetachedLogStatus_BuildFinishedSuccessMarker_ReturnsCompleted()
        {
            string logPath = CreateTempLog(
                "Some plugin line with the word Failed earlier",
                "Build Finished, Result: Success.");

            try
            {
                var workspace = new WorkspaceInfo
                {
                    ActiveLogPath = logPath,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
                };

                bool parsed = InvokeTryReadDetachedLogStatus(workspace, out BuildJobStatus status);

                Assert.IsTrue(parsed);
                Assert.AreEqual(BuildJobStatus.Completed, status);
            }
            finally
            {
                DeleteIfExists(logPath);
            }
        }

        [Test]
        public void TryReadDetachedLogStatus_BuildFinishedFailureMarker_ReturnsFailed()
        {
            string logPath = CreateTempLog(
                "Build pipeline running",
                "Build Finished, Result: Failure.");

            try
            {
                var workspace = new WorkspaceInfo
                {
                    ActiveLogPath = logPath,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
                };

                bool parsed = InvokeTryReadDetachedLogStatus(workspace, out BuildJobStatus status);

                Assert.IsTrue(parsed);
                Assert.AreEqual(BuildJobStatus.Failed, status);
            }
            finally
            {
                DeleteIfExists(logPath);
            }
        }

        [Test]
        public void TryReadDetachedLogStatus_PerformanceTailNoise_StillFindsSuccessMarker()
        {
            string[] noiseLines = new string[150];
            for (int i = 0; i < noiseLines.Length; i++)
            {
                noiseLines[i] = "[Performance] Application.Shutdown.CleanupMono";
            }

            string[] lines = new string[noiseLines.Length + 2];
            lines[0] = "DisplayProgressNotification: Build Successful";
            lines[1] = "Build Finished, Result: Success.";
            Array.Copy(noiseLines, 0, lines, 2, noiseLines.Length);

            string logPath = CreateTempLog(lines);

            try
            {
                var workspace = new WorkspaceInfo
                {
                    ActiveLogPath = logPath,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
                };

                bool parsed = InvokeTryReadDetachedLogStatus(workspace, out BuildJobStatus status);

                Assert.IsTrue(parsed);
                Assert.AreEqual(BuildJobStatus.Completed, status);
            }
            finally
            {
                DeleteIfExists(logPath);
            }
        }

        [Test]
        public void DetermineDetachedFinalStatus_ManifestFailureWithExitCodeZero_CompletesWithManifestReason()
        {
            string manifestPath = CreateTempManifest(
                "job-1",
                "launch-1",
                "failed",
                0,
                "Unity manifest marked this run failed.");

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-1",
                    ProfileGuid = "profile-1",
                    ActiveStatusManifestPath = manifestPath,
                    ActiveStatusLaunchToken = "launch-1",
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
                };

                BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);

                Assert.AreEqual(BuildJobStatus.Completed, status);
                Assert.AreEqual(
                    BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonManifestFailure),
                    InvokeGetLastDetachedRecoveryDetail());
            }
            finally
            {
                DeleteIfExists(manifestPath);
            }
        }

        [Test]
        public void DetermineDetachedFinalStatus_ManifestCompletedWithExitCodeZero_ReturnsCompleted()
        {
            string manifestPath = CreateTempManifest(
                "job-1b",
                "launch-1b",
                "completed",
                0,
                "Unity build completed successfully.");

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-1b",
                    ProfileGuid = "profile-1b",
                    ActiveStatusManifestPath = manifestPath,
                    ActiveStatusLaunchToken = "launch-1b",
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
                };

                BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);

                Assert.AreEqual(BuildJobStatus.Completed, status);
                Assert.IsTrue(string.IsNullOrWhiteSpace(InvokeGetLastDetachedRecoveryDetail()),
                    "Successful manifest terminal state should not synthesize an error detail.");
            }
            finally
            {
                DeleteIfExists(manifestPath);
            }
        }

        [Test]
        public void DetermineDetachedFinalStatus_ManifestCancelledWithExitCodeZero_WithoutCancelIntent_ReturnsCompleted()
        {
            string manifestPath = CreateTempManifest(
                "job-1c",
                "launch-1c",
                "cancelled",
                0,
                "Detached build was cancelled by the user.");

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-1c",
                    ProfileGuid = "profile-1c",
                    ActiveStatusManifestPath = manifestPath,
                    ActiveStatusLaunchToken = "launch-1c",
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
                };

                BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);

                Assert.AreEqual(BuildJobStatus.Completed, status);
            }
            finally
            {
                DeleteIfExists(manifestPath);
            }
        }

        [Test]
        public void DetermineDetachedFinalStatus_MissingExitCode_CompletesWithExitCodeUnavailableReason()
        {
            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-2",
                ProfileGuid = "profile-2",
                ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
            };

            BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);

            Assert.AreEqual(BuildJobStatus.Completed, status);
            Assert.AreEqual(
                BuildTerminalOutcomePolicy.BuildInferredDetail(BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable),
                InvokeGetLastDetachedRecoveryDetail());
        }

        [Test]
        public void DetermineDetachedFinalStatus_LogFailureMarkerWithExitCodeZero_CompletesWithLogReason()
        {
            string logPath = CreateTempLog(
                "Running build operations",
                "Build Finished, Result: Failure.");

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-3",
                    ProfileGuid = "profile-3",
                    ActiveLogPath = logPath,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5),
                    LastExitCode = 0
                };

                BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);

                Assert.AreEqual(BuildJobStatus.Completed, status);
                Assert.AreEqual(
                    BuildTerminalOutcomePolicy.BuildInferredDetail(BuildTerminalOutcomePolicy.ReasonLogFailureMarker),
                    InvokeGetLastDetachedRecoveryDetail());
            }
            finally
            {
                DeleteIfExists(logPath);
            }
        }

        [Test]
        public void DetermineDetachedFinalStatus_PublishFailureMarkerWithExitCodeZero_ReturnsFailedWithPublishReason()
        {
            string logPath = CreateTempLog(
                "[DIST][PUBLISH] Starting upload to Steam...",
                "[ERR] Steam publish failed with exit code 1",
                "[ERR] Steam build/publish failed");

            try
            {
                var workspace = new WorkspaceInfo
                {
                    JobGuid = "job-4",
                    ProfileGuid = "profile-4",
                    ActiveLogPath = logPath,
                    ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5),
                    LastExitCode = 0
                };

                BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);

                Assert.AreEqual(BuildJobStatus.Failed, status);
                Assert.AreEqual(
                    BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonPublishStepFailed),
                    InvokeGetLastDetachedRecoveryDetail());
            }
            finally
            {
                DeleteIfExists(logPath);
            }
        }

        [Test]
        public void DetermineDetachedFinalStatus_MissingWorkspaceIdentity_ReturnsFailed()
        {
            var workspace = new WorkspaceInfo
            {
                JobGuid = string.Empty,
                ProfileGuid = string.Empty,
                ActiveLogPath = string.Empty,
                ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-5)
            };

            BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);

            Assert.AreEqual(BuildJobStatus.Failed, status);
        }

        [Test]
        public void DetermineDetachedFinalStatus_PureCSharpWithManifestPathButRecentlyStarted_ShouldNotFinalizeYet()
        {
            // Simulate pure C# detached build: manifest path is configured but file hasn't been created yet
            // (still in early startup phase). Process started just 2 seconds ago.
            // Expected: Should NOT finalize the job; should recognize it's still in grace window.
            
            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-pure-csharp",
                ProfileGuid = "profile-csharp",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = true,
                ActiveProcessId = 9999,
                ActiveProcessStartedAtUtc = DateTime.UtcNow.AddSeconds(-2),
                ActiveStatusManifestPath = Path.Combine(Path.GetTempPath(), "cadet-recovery-nonexistent.status.json"),
                ActiveStatusLaunchToken = "launch-token-abc",
                ActiveLogPath = string.Empty
            };

            // This test documents the BUG: DetermineDetachedFinalStatus is being called even though
            // the process is still in grace window. It should not finalize.
            // Current behavior: Returns Completed (incorrectly)
            // Expected behavior after fix: Should NOT return a terminal status, OR should skip the call
            
            BuildJobStatus status = InvokeDetermineDetachedFinalStatus(workspace);
            
            // CURRENTLY FAILS - status returns Completed when it should not finalize
            // After fix, this should either:
            // - Return a non-terminal status, OR  
            // - Not be called in the first place (ShouldTreatDetachedOperationAsRunning should have caught it)
            Assert.AreNotEqual(BuildJobStatus.Completed, status, 
                "Pure C# process in grace window should not be finalized as Completed");
        }

        [Test]
        public void ShouldDelayInactiveWorkspaceReconciliation_FreshBuildingWorkspace_ReturnsTrueThenFalseAfterGrace()
        {
            Assert.IsNotNull(ShouldDelayInactiveWorkspaceReconciliationMethod, "ShouldDelayInactiveWorkspaceReconciliation method should exist.");

            string jobGuid = $"job-{Guid.NewGuid():N}";
            var workspace = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ProfileGuid = "profile-grace",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = false
            };

            bool first = (bool)ShouldDelayInactiveWorkspaceReconciliationMethod.Invoke(
                null,
                new object[] { jobGuid, workspace, DateTime.UtcNow });

            bool second = (bool)ShouldDelayInactiveWorkspaceReconciliationMethod.Invoke(
                null,
                new object[] { jobGuid, workspace, DateTime.UtcNow.AddSeconds(6) });

            Assert.IsTrue(first, "Fresh non-terminal inactive workspaces should get an activation grace window.");
            Assert.IsFalse(second, "Grace should expire so truly stale entries can be reconciled.");
        }

        [Test]
        public void ShouldDelayInactiveWorkspaceReconciliation_FreshBuildingWorkspaceByTimestamp_ReturnsTrue()
        {
            Assert.IsNotNull(ShouldDelayInactiveWorkspaceReconciliationMethod, "ShouldDelayInactiveWorkspaceReconciliation method should exist.");

            string jobGuid = $"job-{Guid.NewGuid():N}";
            DateTime nowUtc = DateTime.UtcNow;
            var workspace = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ProfileGuid = "profile-fresh",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = false,
                CreatedAtUtc = nowUtc.AddMinutes(-1),
                LastUpdatedAtUtc = nowUtc.AddSeconds(-2)
            };

            bool shouldDelay = (bool)ShouldDelayInactiveWorkspaceReconciliationMethod.Invoke(
                null,
                new object[] { jobGuid, workspace, nowUtc });

            Assert.IsTrue(shouldDelay);
        }

        [Test]
        public void ShouldDelayInactiveWorkspaceReconciliation_StaleBuildingWorkspaceByTimestamp_ReturnsFalse()
        {
            Assert.IsNotNull(ShouldDelayInactiveWorkspaceReconciliationMethod, "ShouldDelayInactiveWorkspaceReconciliation method should exist.");

            string jobGuid = $"job-{Guid.NewGuid():N}";
            DateTime nowUtc = DateTime.UtcNow;
            var workspace = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ProfileGuid = "profile-stale",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = false,
                CreatedAtUtc = nowUtc.AddMinutes(-1),
                LastUpdatedAtUtc = nowUtc.AddSeconds(-10)
            };

            bool shouldDelay = (bool)ShouldDelayInactiveWorkspaceReconciliationMethod.Invoke(
                null,
                new object[] { jobGuid, workspace, nowUtc });

            Assert.IsFalse(shouldDelay);
        }

        [Test]
        public void ShouldDelayInactiveWorkspaceReconciliation_InactiveTerminalRecord_ReturnsFalse()
        {
            Assert.IsNotNull(ShouldDelayInactiveWorkspaceReconciliationMethod, "ShouldDelayInactiveWorkspaceReconciliation method should exist.");

            string jobGuid = $"job-{Guid.NewGuid():N}";
            DateTime nowUtc = DateTime.UtcNow;
            var workspace = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ProfileGuid = "profile-terminal",
                LastBuildStatus = BuildJobStatus.Completed,
                IsOperationActive = false,
                CreatedAtUtc = nowUtc.AddMinutes(-1),
                LastUpdatedAtUtc = nowUtc.AddSeconds(-2)
            };

            bool shouldDelay = (bool)ShouldDelayInactiveWorkspaceReconciliationMethod.Invoke(
                null,
                new object[] { jobGuid, workspace, nowUtc });

            Assert.IsFalse(shouldDelay);
        }

        [Test]
        public void ShouldDelayInactiveWorkspaceReconciliation_RuntimeActiveJobMatch_ReturnsTrue()
        {
            Assert.IsNotNull(ShouldDelayInactiveWorkspaceReconciliationMethod, "ShouldDelayInactiveWorkspaceReconciliation method should exist.");

            string jobGuid = $"job-{Guid.NewGuid():N}";
            DateTime nowUtc = DateTime.UtcNow;
            var workspace = new WorkspaceInfo
            {
                JobGuid = jobGuid,
                ProfileGuid = "profile-runtime-active",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = false,
                CreatedAtUtc = nowUtc.AddMinutes(-1),
                LastUpdatedAtUtc = nowUtc.AddSeconds(-30)
            };

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            runtimeState.Reset();
            runtimeState.ActiveJobGuid = jobGuid;

            try
            {
                bool shouldDelay = (bool)ShouldDelayInactiveWorkspaceReconciliationMethod.Invoke(
                    null,
                    new object[] { jobGuid, workspace, nowUtc });

                Assert.IsTrue(shouldDelay,
                    "Recovery should defer while runtime state is still actively executing the same job, even if workspace state is temporarily inactive.");
            }
            finally
            {
                runtimeState.Reset();
            }
        }

        [Test]
        public void ShouldDelayOrphanedWorkspaceNormalization_FreshBuildingWorkspaceWithPid_ReturnsTrue()
        {
            Assert.IsNotNull(ShouldDelayOrphanedWorkspaceNormalizationMethod, "ShouldDelayOrphanedWorkspaceNormalization method should exist.");

            var workspace = new WorkspaceInfo
            {
                JobGuid = $"job-{Guid.NewGuid():N}",
                ProfileGuid = "profile-orphan-pid",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = false,
                ActiveProcessId = 4242,
                LastUpdatedAtUtc = DateTime.UtcNow
            };

            bool shouldDelay = (bool)ShouldDelayOrphanedWorkspaceNormalizationMethod.Invoke(
                null,
                new object[] { workspace, DateTime.UtcNow });

            Assert.IsTrue(shouldDelay, "A fresh orphaned workspace with a detached PID should not be normalized to Completed.");
        }

        [Test]
        public void ShouldDelayOrphanedWorkspaceNormalization_FreshBuildingWorkspaceWithoutPid_ReturnsTrueThenFalseAfterGrace()
        {
            Assert.IsNotNull(ShouldDelayOrphanedWorkspaceNormalizationMethod, "ShouldDelayOrphanedWorkspaceNormalization method should exist.");

            DateTime firstObservedUtc = DateTime.UtcNow;
            var workspace = new WorkspaceInfo
            {
                JobGuid = $"job-{Guid.NewGuid():N}",
                ProfileGuid = "profile-orphan-fresh",
                LastBuildStatus = BuildJobStatus.Building,
                IsOperationActive = false,
                ActiveProcessId = 0,
                LastUpdatedAtUtc = firstObservedUtc
            };

            bool first = (bool)ShouldDelayOrphanedWorkspaceNormalizationMethod.Invoke(
                null,
                new object[] { workspace, firstObservedUtc.AddSeconds(1) });

            bool second = (bool)ShouldDelayOrphanedWorkspaceNormalizationMethod.Invoke(
                null,
                new object[] { workspace, firstObservedUtc.AddSeconds(6) });

            Assert.IsTrue(first, "Fresh orphaned active-stage workspaces should get a handoff grace window.");
            Assert.IsFalse(second, "Grace should expire for truly stale orphaned workspaces.");
        }

        [Test]
        public void ResetRuntimeWhenNoActiveOperation_StaleDetachedRuntimeState_ClearsRuntime()
        {
            Assert.IsNotNull(ResetRuntimeWhenNoActiveOperationMethod, "ResetRuntimeWhenNoActiveOperation method should exist.");

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            runtimeState.Reset();
            runtimeState.ActiveJobGuid = $"job-{Guid.NewGuid():N}";
            runtimeState.ActiveStatusText = "Unity Build";
            runtimeState.IsOperationRunning = true;

            try
            {
                ResetRuntimeWhenNoActiveOperationMethod.Invoke(null, null);

                Assert.IsFalse(runtimeState.IsOperationRunning);
                Assert.IsNull(runtimeState.ActiveJobGuid);
                Assert.AreEqual(string.Empty, runtimeState.ActiveStatusText);
            }
            finally
            {
                runtimeState.Reset();
            }
        }

        [Test]
        public void ResetRuntimeWhenNoActiveOperation_TrackedActiveJob_PreservesRuntime()
        {
            Assert.IsNotNull(ResetRuntimeWhenNoActiveOperationMethod, "ResetRuntimeWhenNoActiveOperation method should exist.");

            string jobGuid = $"job-{Guid.NewGuid():N}";
            BuildQueueManager queueManager = BuildQueueManager.Instance;
            BuildJobDefinition job = new BuildJobDefinition("profile-reset")
            {
                JobGuid = jobGuid
            };

            queueManager.TrackActiveJob(job);

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            runtimeState.Reset();
            runtimeState.ActiveJobGuid = jobGuid;
            runtimeState.ActiveStatusText = "Running";
            runtimeState.IsOperationRunning = true;

            try
            {
                ResetRuntimeWhenNoActiveOperationMethod.Invoke(null, null);

                Assert.IsTrue(runtimeState.IsOperationRunning);
                Assert.AreEqual(jobGuid, runtimeState.ActiveJobGuid);
                Assert.AreEqual("Running", runtimeState.ActiveStatusText);
            }
            finally
            {
                queueManager.MarkJobTerminal(jobGuid, BuildJobStatus.Cancelled, "Test cleanup");
                runtimeState.Reset();
            }
        }

        [Test]
        public void ReconcileStaleQueueActiveJobs_MissingWorkspaceRecord_TerminalizesTrackedJob()
        {
            Assert.IsNotNull(ReconcileStaleQueueActiveJobsMethod, "ReconcileStaleQueueActiveJobs method should exist.");

            string tempRoot = Path.Combine(Path.GetTempPath(), $"cadet-recovery-missing-workspace-{Guid.NewGuid():N}");
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            BuildQueueManager queueManager = BuildQueueManager.Instance;
            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            queueManager.ClearAll();
            runtimeState.Reset();

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });

                string jobGuid = $"job-{Guid.NewGuid():N}";
                BuildJobDefinition job = new BuildJobDefinition("profile-recovery")
                {
                    JobGuid = jobGuid,
                    Status = BuildJobStatus.Building,
                    StatusDetail = "Detached dist operation running. Use Build Queue refresh to reconcile status."
                };

                queueManager.TrackActiveJob(job);

                bool reconciled = (bool)ReconcileStaleQueueActiveJobsMethod.Invoke(null, new object[] { DateTime.UtcNow.AddSeconds(10) });

                BuildJobDefinition tracked = queueManager.GetJobByGuid(jobGuid);
                Assert.IsTrue(reconciled);
                Assert.IsNotNull(tracked);
                Assert.AreEqual(BuildJobStatus.Completed, tracked.Status);
                Assert.IsFalse(queueManager.IsJobActive(jobGuid));
                Assert.AreEqual(
                    BuildTerminalOutcomePolicy.BuildInferredDetail(BuildTerminalOutcomePolicy.ReasonExitCodeUnavailable),
                    tracked.StatusDetail);
            }
            finally
            {
                queueManager.ClearAll();
                runtimeState.Reset();
                Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        private static bool InvokeTryReadDetachedLogStatus(WorkspaceInfo workspace, out BuildJobStatus status)
        {
            Assert.IsNotNull(TryReadDetachedLogStatusMethod, "TryReadDetachedLogStatus method should exist.");

            object[] args = { workspace, BuildJobStatus.Failed };
            bool result = (bool)TryReadDetachedLogStatusMethod.Invoke(null, args);
            status = (BuildJobStatus)args[1];
            return result;
        }

        private static BuildJobStatus InvokeDetermineDetachedFinalStatus(WorkspaceInfo workspace)
        {
            Assert.IsNotNull(DetermineDetachedFinalStatusMethod, "DetermineDetachedFinalStatus method should exist.");
            return (BuildJobStatus)DetermineDetachedFinalStatusMethod.Invoke(null, new object[] { workspace });
        }

        private static string InvokeGetLastDetachedRecoveryDetail()
        {
            Assert.IsNotNull(GetLastDetachedRecoveryDetailMethod, "GetLastDetachedRecoveryDetail method should exist.");
            return (string)GetLastDetachedRecoveryDetailMethod.Invoke(null, Array.Empty<object>());
        }

        private static string CreateTempLog(params string[] lines)
        {
            string path = Path.Combine(Path.GetTempPath(), $"cadet-recovery-{Guid.NewGuid():N}.log");
            File.WriteAllLines(path, lines);
            return path;
        }

        private static string CreateTempManifest(string jobGuid, string launchToken, string overallStatus, int exitCode, string message)
        {
            string path = Path.Combine(Path.GetTempPath(), $"cadet-recovery-{Guid.NewGuid():N}.status.json");
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
                          $"\"currentMessage\":\"{message}\"," +
                          $"\"exitCode\":{exitCode}," +
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
