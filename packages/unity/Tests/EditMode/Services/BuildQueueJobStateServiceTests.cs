using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;
using System.Collections.Generic;
using System;
using System.IO;
using UnityEngine;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueJobStateServiceTests
    {
        [Test]
        public void IsTerminalStatus_Completed_ReturnsTrue()
        {
            Assert.IsTrue(BuildQueueJobStateService.IsTerminalStatus(BuildJobStatus.Completed));
        }

        [Test]
        public void IsTerminalStatus_Building_ReturnsFalse()
        {
            Assert.IsFalse(BuildQueueJobStateService.IsTerminalStatus(BuildJobStatus.Building));
        }

        [Test]
        public void IsDirectorySyncInProgress_SyncingWithDirectorySyncProfile_ReturnsTrue()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                Status = BuildJobStatus.Syncing
            };

            bool result = BuildQueueJobStateService.IsDirectorySyncInProgress(
                job,
                workspace: null,
                profile: new BuildProfile { useGit = false });

            Assert.IsTrue(result);
        }

        [Test]
        public void IsDirectorySyncInProgress_SyncingWithGitSyncProfile_ReturnsFalse()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                Status = BuildJobStatus.Syncing
            };

            bool result = BuildQueueJobStateService.IsDirectorySyncInProgress(
                job,
                workspace: null,
                profile: new BuildProfile { useGit = true });

            Assert.IsFalse(result);
        }

        [Test]
        public void IsDirectorySyncInProgress_FallbackGitSyncStatusText_ReturnsFalse()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                Status = BuildJobStatus.Syncing,
                StatusDetail = "Git Syncing."
            };

            WorkspaceInfo workspace = new WorkspaceInfo
            {
                LastOperationSummary = "Git Syncing."
            };

            bool result = BuildQueueJobStateService.IsDirectorySyncInProgress(
                job,
                workspace,
                profile: null);

            Assert.IsFalse(result);
        }

        [Test]
        public void IsHistoryOnlyJob_WhenMissingFromQueue_ReturnsTrue()
        {
            BuildQueueManager queueManager = new BuildQueueManager();
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-123"
            };

            bool result = BuildQueueJobStateService.IsHistoryOnlyJob(job, guid => queueManager.GetJobByGuid(guid));

            Assert.IsTrue(result);
        }

        [Test]
        public void CanDeleteJob_TerminalStatus_ReturnsTrue()
        {
            BuildQueueManager queueManager = new BuildQueueManager();
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                Status = BuildJobStatus.Completed
            };

            bool result = BuildQueueJobStateService.CanDeleteJob(
                job,
                guid => queueManager.IsJobActive(guid),
                guid => queueManager.GetJobByGuid(guid));

            Assert.IsTrue(result);
        }

        [Test]
        public void CanDeleteJob_TrackedActiveJobWithoutWorkspaceAndRuntimeIdle_ReturnsTrue()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "delete-orphaned-job-state", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            runtimeState.Reset();

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });

                BuildQueueManager queueManager = new BuildQueueManager();
                BuildJobDefinition job = new BuildJobDefinition("profile-guid")
                {
                    JobGuid = $"job-{Guid.NewGuid():N}",
                    Status = BuildJobStatus.Building
                };

                queueManager.TrackActiveJob(job);

                bool result = BuildQueueJobStateService.CanDeleteJob(
                    job,
                    guid => queueManager.IsJobActive(guid),
                    guid => queueManager.GetJobByGuid(guid));

                Assert.IsTrue(result);
            }
            finally
            {
                runtimeState.Reset();
                Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void CanCancelJob_QueuedAndInQueue_ReturnsTrue()
        {
            BuildQueueManager queueManager = new BuildQueueManager();
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                Status = BuildJobStatus.Queued
            };
            queueManager.AddPendingJob(job);

            bool result = BuildQueueJobStateService.CanCancelJob(
                job,
                false,
                guid => queueManager.IsJobActive(guid),
                guid => queueManager.GetJobByGuid(guid));

            Assert.IsTrue(result);
        }

        [Test]
        public void IsCurrentlyExecutingJob_RuntimeActiveGuidMatch_ReturnsTrue()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-123"
            };

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            runtimeState.Reset();
            runtimeState.ActiveJobGuid = "job-123";
            runtimeState.ActiveStatusText = "Running";
            runtimeState.IsOperationRunning = true;

            bool result = BuildQueueJobStateService.IsCurrentlyExecutingJob(
                job,
                runtimeState,
                new Dictionary<string, BuildQueueJobStateService.ExecutingStateCacheEntry>(),
                0d,
                0.5d,
                _ => null,
                _ => false);

            Assert.IsTrue(result);
            runtimeState.Reset();
        }

        [Test]
        public void IsCurrentlyExecutingJob_RuntimeActiveGuidMatchButNotRunning_ReturnsFalse()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-123"
            };

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            runtimeState.Reset();
            runtimeState.ActiveJobGuid = "job-123";
            runtimeState.ActiveStatusText = "Running";
            runtimeState.IsOperationRunning = false;

            bool result = BuildQueueJobStateService.IsCurrentlyExecutingJob(
                job,
                runtimeState,
                new Dictionary<string, BuildQueueJobStateService.ExecutingStateCacheEntry>(),
                0d,
                0.5d,
                _ => null,
                _ => false);

            Assert.IsFalse(result);
            runtimeState.Reset();
        }

        [Test]
        public void IsCurrentlyExecutingJob_UsesCachedValueBeforeExpiry()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-123"
            };

            var cache = new Dictionary<string, BuildQueueJobStateService.ExecutingStateCacheEntry>
            {
                ["job-123"] = new BuildQueueJobStateService.ExecutingStateCacheEntry(true, 10d)
            };

            int workspaceCalls = 0;
            bool result = BuildQueueJobStateService.IsCurrentlyExecutingJob(
                job,
                null,
                cache,
                5d,
                0.5d,
                _ =>
                {
                    workspaceCalls++;
                    return null;
                },
                _ => false);

            Assert.IsTrue(result);
            Assert.AreEqual(0, workspaceCalls);
        }

        [Test]
        public void CanOpenBuildFolder_NonTerminalJob_ReturnsFalse()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-123",
                Status = BuildJobStatus.Building
            };

            bool result = BuildQueueJobStateService.CanOpenBuildFolder(
                job,
                new Dictionary<string, BuildQueueJobStateService.OpenBuildFolderCheckCacheEntry>(),
                0d,
                1d,
                _ => true);

            Assert.IsFalse(result);
        }

        [Test]
        public void CanOpenBuildFolder_UsesCachedValueBeforeExpiry()
        {
            BuildJobDefinition job = new BuildJobDefinition("profile-guid")
            {
                JobGuid = "job-123",
                Status = BuildJobStatus.Completed
            };

            var cache = new Dictionary<string, BuildQueueJobStateService.OpenBuildFolderCheckCacheEntry>
            {
                ["job-123"] = new BuildQueueJobStateService.OpenBuildFolderCheckCacheEntry(true, 10d)
            };

            int resolverCalls = 0;
            bool result = BuildQueueJobStateService.CanOpenBuildFolder(
                job,
                cache,
                5d,
                1d,
                _ =>
                {
                    resolverCalls++;
                    return false;
                });

            Assert.IsTrue(result);
            Assert.AreEqual(0, resolverCalls);
        }

        [Test]
        public void IsProfileBlockedForExecute_NoJobForProfile_ReturnsFalse()
        {
            BuildQueueManager queueManager = new BuildQueueManager();

            Assert.IsFalse(BuildQueueJobStateService.IsProfileBlockedForExecute("profile-1", guid => queueManager.HasJobInProgress(guid)));
        }

        [Test]
        public void IsProfileBlockedForExecute_QueuedJobNoWorkspace_ReturnsTrue()
        {
            BuildQueueManager queueManager = new BuildQueueManager();
            var job = new BuildJobDefinition("profile-1");
            queueManager.AddPendingJob(job);

            Assert.IsTrue(BuildQueueJobStateService.IsProfileBlockedForExecute("profile-1", guid => queueManager.HasJobInProgress(guid)));
        }

        [Test]
        public void IsProfileBlockedForExecute_QueuedJobWithTerminalWorkspace_ReturnsFalse()
        {
            string tempRoot = System.IO.Path.Combine(
                UnityEngine.Application.temporaryCachePath, "CADETTests", "jss-resolver",
                System.Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(tempRoot);

            string originalConfigPath = System.Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", System.EnvironmentVariableTarget.Process);
            string configPath = System.IO.Path.Combine(tempRoot, "config.json");
            System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, System.EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                BuildQueueManager queueManager = new BuildQueueManager();
                var job = new BuildJobDefinition("profile-1");
                queueManager.AddPendingJob(job);

                workspaceManager.CreateWorkspace(job.JobGuid, "profile-1", "profile.json");
                workspaceManager.UpdateBuildStatus(job.JobGuid, BuildJobStatus.Completed);
                workspaceManager.UpdateOperationState(
                    job.JobGuid,
                    isActive: false,
                    processId: 0,
                    processStartUtc: null,
                    statusDetail: "Done.",
                    logPath: System.IO.Path.Combine(tempRoot, "dist.log"));

                Assert.IsFalse(BuildQueueJobStateService.IsProfileBlockedForExecute("profile-1", guid => queueManager.HasJobInProgress(guid)),
                    "Terminal+inactive workspace should not block execute.");
            }
            finally
            {
                System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, System.EnvironmentVariableTarget.Process);
                if (System.IO.Directory.Exists(tempRoot))
                {
                    System.IO.Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void CanRetryJob_WhenProfileStillBlocked_ReturnsFalse()
        {
            BuildQueueManager queueManager = new BuildQueueManager();
            var activeJob = new BuildJobDefinition("profile-1");
            queueManager.TrackActiveJob(activeJob);

            // A separate completed job for the same profile should not be retryable
            // while another job for that profile is still in-progress.
            var completedJob = new BuildJobDefinition("profile-1")
            {
                Status = BuildJobStatus.Completed
            };

            Assert.IsFalse(
                BuildQueueJobStateService.CanRetryJob(
                    completedJob,
                    trackedJob => queueManager.CanRetryJob(trackedJob),
                    guid => queueManager.HasJobInProgress(guid)),
                "Retry should be blocked when the same profile already has a job in progress.");
        }
    }
}
