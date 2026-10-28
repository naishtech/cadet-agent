using NUnit.Framework;
using System.IO;
using UnityEngine;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Services;
using System;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// TDD tests for BuildQueueManager.
    /// Covers history persistence, active-job tracking, retry, cancellation, and cleanup behavior.
    /// </summary>
    [TestFixture]
    public class BuildQueueManagerTests
    {
        private BuildQueueManager _queueManager;
        private string _testConfigPath;

        [SetUp]
        public void SetUp()
        {
            // Create fresh queue manager for each test
            _queueManager = new BuildQueueManager();
            
            // Use temp path for test persistence
            _testConfigPath = Path.Combine(Application.temporaryCachePath, "CADETTests", "test-queue.json");
            
            // Clean up any existing test data
            if (File.Exists(_testConfigPath))
                File.Delete(_testConfigPath);
        }

        [TearDown]
        public void TearDown()
        {
            // Cleanup
            _queueManager?.ClearAll();
            
            if (File.Exists(_testConfigPath))
                File.Delete(_testConfigPath);
                
            var testDir = Path.GetDirectoryName(_testConfigPath);
            if (Directory.Exists(testDir))
                Directory.Delete(testDir, true);
        }

        #region Core Queue Operations

        [Test]
        public void AddPendingJob_AddsJobToCompatibilityBucket()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-1");

            // Act
            _queueManager.AddPendingJob(job);

            // Assert
            Assert.AreEqual(1, _queueManager.PendingCompatibilityCount, "Pending compatibility storage should have 1 job.");
            Assert.AreEqual(0, _queueManager.ActiveExecutionCount, "No jobs should be active.");
        }

        [Test]
        public void AddPendingJob_TerminalJob_RequeuesInsteadOfAddingToCompleted()
        {
            var job = new BuildJobDefinition("profile-1")
            {
                Status = BuildJobStatus.Completed,
                StatusDetail = "Completed successfully",
                WorkspacePath = "F:/CADET/workspaces/job-1"
            };

            _queueManager.AddPendingJob(job);

            Assert.AreEqual(1, _queueManager.PendingCompatibilityCount, "Terminal jobs passed to AddPendingJob should be returned to compatibility pending storage.");
            Assert.AreEqual(0, _queueManager.HistoryCount, "AddPendingJob should not inflate completed history.");
            Assert.AreEqual(BuildJobStatus.Queued, job.Status);
            Assert.IsNull(job.WorkspacePath, "Pending compatibility jobs should clear stale workspace state.");
        }

        [Test]
        public void AddPendingJob_DuplicateLiveJobGuid_DoesNotAddSecondLiveRecord()
        {
            var original = new BuildJobDefinition("profile-1")
            {
                JobGuid = "job-dup"
            };
            var duplicate = new BuildJobDefinition("profile-2")
            {
                JobGuid = " job-dup "
            };

            _queueManager.AddPendingJob(original);
            _queueManager.AddPendingJob(duplicate);

            Assert.AreEqual(1, _queueManager.PendingCompatibilityCount, "Duplicate live GUIDs should be rejected.");
            Assert.AreSame(original, _queueManager.GetJobByGuid("job-dup"));
        }

        [Test]
        public void GetExecutionStatusSummary_ReturnsCorrectCounts()
        {
            // Arrange
            _queueManager.AddPendingJob(new BuildJobDefinition("profile-1"));
            _queueManager.AddPendingJob(new BuildJobDefinition("profile-2"));
            
            var job3 = new BuildJobDefinition("profile-3");
            _queueManager.AddPendingJob(job3);
            _queueManager.TrackActiveJob(job3); // Move to active

            // Act
            var status = _queueManager.GetExecutionStatusSummary();

            // Assert
            Assert.AreEqual(2, status.PendingCompatibilityCount);
            Assert.AreEqual(1, status.ActiveExecutionCount);
            Assert.AreEqual(0, status.HistoryCount);
            Assert.AreEqual(3, status.TotalCount);
        }

        [Test]
        public void GetExecutionStatusSummary_CompletedListJobWithVerifiedActiveWorkspace_CountsAsActive()
        {
            string tempRoot = Path.Combine(
                Application.temporaryCachePath,
                "CADETTests",
                "queue-status-effective",
                System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = System.Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", System.EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, System.EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                var job = new BuildJobDefinition("profile-1")
                {
                    JobGuid = System.Guid.NewGuid().ToString()
                };

                _queueManager.TrackActiveJob(job);
                _queueManager.CompleteJob(job.JobGuid, BuildJobStatus.Completed);

                // Recreate active detached evidence for the same job GUID.
                if (workspaceManager.GetWorkspaceByJobGuid(job.JobGuid) == null)
                {
                    workspaceManager.CreateWorkspace(job.JobGuid, "profile-1", "profile.json");
                }
                workspaceManager.UpdateBuildStatus(job.JobGuid, BuildJobStatus.Building);
                workspaceManager.UpdateOperationState(
                    job.JobGuid,
                    isActive: true,
                    processId: 0,
                    processStartUtc: System.DateTime.UtcNow,
                    statusDetail: "Unity Build",
                    logPath: Path.Combine(tempRoot, "unity_build.log"),
                    cancelRequested: false,
                    manifestPath: string.Empty,
                    launchToken: string.Empty);

                BuildExecutionStatusSummary status = _queueManager.GetExecutionStatusSummary();

                Assert.AreEqual(0, status.PendingCompatibilityCount, "No jobs should remain pending in compatibility storage.");
                Assert.AreEqual(1, status.ActiveExecutionCount,
                    "Verified active workspace evidence must override stale completed queue membership.");
                Assert.AreEqual(0, status.HistoryCount,
                    "Header should not claim completed while workspace reports active detached operation.");
                Assert.AreEqual(1, status.TotalCount);
            }
            finally
            {
                System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, System.EnvironmentVariableTarget.Process);

                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        #endregion

        [Test]
        public void ExecuteImmediately_ActivatesAdditionalJob()
        {
            var job1 = new BuildJobDefinition("profile-1");
            _queueManager.TrackActiveJob(job1);

            var immediateJob = new BuildJobDefinition("immediate-profile");
            _queueManager.ExecuteImmediately(immediateJob);

            // Assert
            Assert.AreEqual(2, _queueManager.ActiveExecutionCount, "Should have 2 active jobs.");
            Assert.IsTrue(_queueManager.IsJobActive(immediateJob.JobGuid), "Immediate job should be active");
        }

        [Test]
        public void CompleteJob_CompletedLiteHistory_PersistsExecutedOperationsSummary()
        {
            string tempRoot = Path.Combine(
                Application.temporaryCachePath,
                "CADETTests",
                "queue-complete-summary",
                System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = System.Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", System.EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, System.EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                var job = new BuildJobDefinition("profile-1")
                {
                    RunUnityBuild = true,
                    StatusDetail = "Completed successfully"
                };

                _queueManager.TrackActiveJob(job);
                _queueManager.CompleteJob(job.JobGuid, BuildJobStatus.Completed);

                WorkspaceInfo workspace = workspaceManager.GetWorkspaceByJobGuid(job.JobGuid);
                Assert.IsNotNull(workspace);
                Assert.AreEqual(BuildJobStatus.Completed, workspace.LastBuildStatus);
                Assert.AreEqual("Unity Build", workspace.LastCompletedOperationsSummary);
                Assert.AreEqual("Unity Build", workspace.LastOperationSummary);
            }
            finally
            {
                System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, System.EnvironmentVariableTarget.Process);

                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        #region Cancellation

        [Test]
        public void CancelJob_Queued_RemovesFromQueue()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-1");
            _queueManager.AddPendingJob(job);
            Assert.AreEqual(1, _queueManager.PendingCompatibilityCount);

            // Act
            bool cancelled = _queueManager.CancelJob(job.JobGuid);

            // Assert
            Assert.IsTrue(cancelled, "Cancellation should succeed");
            Assert.AreEqual(0, _queueManager.PendingCompatibilityCount, "Job should be removed from pending compatibility storage.");
            Assert.AreEqual(BuildJobStatus.Cancelled, job.Status, "Job status should be Cancelled");
        }

        [Test]
        public void CancelJob_Running_TerminatesProcess()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-1");
            job.ProcessId = 12345; // Simulate running process
            _queueManager.TrackActiveJob(job);
            
            Assert.AreEqual(1, _queueManager.ActiveExecutionCount);

            // Act
            bool cancelled = _queueManager.CancelJob(job.JobGuid);

            // Assert
            Assert.IsTrue(cancelled, "Cancellation should succeed");
            Assert.AreEqual(0, _queueManager.ActiveExecutionCount, "Job should be removed from active execution tracking.");
            Assert.AreEqual(BuildJobStatus.Cancelled, job.Status, "Job status should be Cancelled");
        }

        [Test]
        public void CancelJob_Completed_ThrowsException()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-1");
            job.Status = BuildJobStatus.Completed;
            _queueManager.AddToHistory(job);

            // Act & Assert
            Assert.Throws<System.InvalidOperationException>(() => _queueManager.CancelJob(job.JobGuid),
                "Cannot cancel completed job");
        }

        [Test]
        public void CancelJob_NotFound_ReturnsFalse()
        {
            // Act
            bool cancelled = _queueManager.CancelJob("non-existent-guid");

            // Assert
            Assert.IsFalse(cancelled, "Should return false for non-existent job");
        }

        [Test]
        public void TrackActiveJob_CreatesBuildingWorkspaceRecord_WithoutMarkingOperationActive()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "queue-manager-start", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = System.Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", System.EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, System.EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                var job = new BuildJobDefinition("profile-start")
                {
                    JobGuid = Guid.NewGuid().ToString()
                };

                _queueManager.TrackActiveJob(job);

                WorkspaceInfo workspace = workspaceManager.GetWorkspaceByJobGuid(job.JobGuid);
                Assert.IsNotNull(workspace, "TrackActiveJob should create a workspace record for the active job.");
                Assert.AreEqual(BuildJobStatus.Building, workspace.LastBuildStatus);
                Assert.IsFalse(workspace.IsOperationActive, "TrackActiveJob should not mark the workspace active before a real detached PID exists.");
                Assert.AreEqual(0, workspace.ActiveProcessId);
            }
            finally
            {
                System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, System.EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void DeleteJobEntry_OrphanedActiveJobWithoutWorkspace_RemovesStaleRecord()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "delete-orphaned-manager", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            BuildQueueRuntimeState runtimeState = BuildQueueRuntimeState.Instance;
            runtimeState.Reset();

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });

                BuildJobDefinition job = new BuildJobDefinition("profile-delete")
                {
                    JobGuid = $"job-{Guid.NewGuid():N}",
                    Status = BuildJobStatus.Building
                };

                _queueManager.TrackActiveJob(job);

                bool removed = _queueManager.DeleteJobEntry(job.JobGuid, deleteProjectFolder: false);

                Assert.IsTrue(removed);
                Assert.IsNull(_queueManager.GetJobByGuid(job.JobGuid));
                Assert.AreEqual(0, _queueManager.ActiveExecutionCount);
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

        #endregion

        #region Job Completion

        [Test]
        public void OnJobComplete_Success_MovesToHistory()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-1");
            _queueManager.TrackActiveJob(job);
            Assert.AreEqual(1, _queueManager.ActiveExecutionCount);

            // Act
            _queueManager.CompleteJob(job.JobGuid, BuildJobStatus.Completed);

            // Assert
            Assert.AreEqual(0, _queueManager.ActiveExecutionCount, "Should remove from active execution tracking.");
            Assert.AreEqual(1, _queueManager.HistoryCount, "Should add to history.");
            Assert.AreEqual(BuildJobStatus.Completed, job.Status, "Status should be Completed");
            Assert.IsNotNull(job.CompletionTime, "Completion time should be set");
        }

        [Test]
        public void OnJobComplete_Failure_PreservesForInspection()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-1");
            _queueManager.TrackActiveJob(job);

            // Act
            _queueManager.CompleteJob(job.JobGuid, BuildJobStatus.Failed);

            // Assert
            Assert.AreEqual(0, _queueManager.ActiveExecutionCount, "Should remove from active execution tracking.");
            Assert.AreEqual(1, _queueManager.HistoryCount, "Should add to history.");
            Assert.AreEqual(BuildJobStatus.Completed, job.Status, "Non-catastrophic failures should normalize to Completed");
            Assert.AreEqual(
                BuildTerminalOutcomePolicy.BuildErrorDetectedDetail(BuildTerminalOutcomePolicy.ReasonLogFailureMarker),
                job.StatusDetail,
                "Failure diagnostics should be preserved in StatusDetail");
        }

        [Test]
        public void RetryJob_TerminalJob_ActivatesSameRecordImmediately()
        {
            var job = new BuildJobDefinition("profile-1")
            {
                RunUnityBuild = true,
                WorkspacePath = "F:/CADET/workspaces/job-1"
            };

            _queueManager.TrackActiveJob(job);
            _queueManager.CompleteJob(job.JobGuid, BuildJobStatus.Completed);

            bool retried = _queueManager.RetryJob(job);

            Assert.IsTrue(retried, "Retry should succeed for terminal jobs");
            Assert.AreEqual(0, _queueManager.PendingCompatibilityCount, "Retried job should not return to the compatibility pending bucket.");
            Assert.AreEqual(1, _queueManager.ActiveExecutionCount, "Retry should reactivate the job immediately.");
            Assert.AreEqual(0, _queueManager.HistoryCount, "Retry should remove the prior completed record.");

            BuildJobDefinition retriedJob = _queueManager.GetJobByGuid(job.JobGuid);
            Assert.IsNotNull(retriedJob, "Retried job should still be tracked");
            Assert.AreEqual(job.JobGuid, retriedJob.JobGuid, "Retry should reuse the same job GUID");
            Assert.AreEqual(BuildJobStatus.Building, retriedJob.Status, "Retry should reactivate the job as Building");
            Assert.IsNotNull(retriedJob.StartTime, "Retry should set a fresh start time");
            Assert.IsNull(retriedJob.CompletionTime, "Retry should clear the prior completion time");
            Assert.IsNull(retriedJob.WorkspacePath, "Retry should clear the prior workspace path");
        }

        [Test]
        public void RetryJob_WhenNoRecordedOperations_DefaultsToUnityBuild()
        {
            var terminalJob = new BuildJobDefinition("profile-legacy")
            {
                JobGuid = "legacy-job-guid",
                Status = BuildJobStatus.Failed,
                RunUnityBuild = false,
                RunNotarizeMac = false,
                RunPublishSteam = false,
                RunPublishEpic = false
            };

            _queueManager.AddToHistory(terminalJob);

            bool retried = _queueManager.RetryJob(terminalJob);

            Assert.IsTrue(retried, "Retry should succeed for legacy terminal jobs");
            BuildJobDefinition retriedJob = _queueManager.GetJobByGuid(terminalJob.JobGuid);
            Assert.IsNotNull(retriedJob);
            Assert.IsTrue(retriedJob.RunUnityBuild, "Legacy retry should default to Unity Build when prior operations are unknown");
            Assert.AreEqual(BuildJobStatus.Building, retriedJob.Status, "Compatibility retry should now follow the direct activation path.");
        }

        [Test]
        public void RetryJobDirect_TerminalJob_ActivatesSameRecordImmediately()
        {
            var job = new BuildJobDefinition("profile-1")
            {
                RunUnityBuild = true,
                WorkspacePath = "F:/CADET/workspaces/job-1"
            };

            _queueManager.TrackActiveJob(job);
            _queueManager.CompleteJob(job.JobGuid, BuildJobStatus.Completed);

            BuildJobDefinition retriedJob = _queueManager.RetryJobDirect(job);

            Assert.IsNotNull(retriedJob, "Direct retry should reactivate terminal jobs.");
            Assert.AreEqual(0, _queueManager.PendingCompatibilityCount, "Direct retry should not leave the job in compatibility pending storage.");
            Assert.AreEqual(1, _queueManager.ActiveExecutionCount, "Direct retry should reactivate the job immediately.");
            Assert.AreEqual(0, _queueManager.HistoryCount, "Direct retry should remove the prior completed record.");
            Assert.AreEqual(job.JobGuid, retriedJob.JobGuid, "Direct retry should reuse the same job GUID.");
            Assert.AreEqual(BuildJobStatus.Building, retriedJob.Status, "Direct retry should reactivate the job as Building.");
            Assert.IsNotNull(retriedJob.StartTime, "Direct retry should set a fresh start time.");
            Assert.IsNull(retriedJob.CompletionTime, "Direct retry should clear the prior completion time.");
            Assert.IsNull(retriedJob.WorkspacePath, "Direct retry should clear the prior workspace path.");
        }

        [Test]
        public void RetryJobDirect_SameProfileAlreadyActive_ReturnsNull()
        {
            var activeJob = new BuildJobDefinition("profile-1")
            {
                JobGuid = "active-job",
                RunUnityBuild = true
            };
            _queueManager.TrackActiveJob(activeJob);

            var completedJob = new BuildJobDefinition("profile-1")
            {
                JobGuid = "completed-job",
                Status = BuildJobStatus.Completed,
                RunUnityBuild = true
            };
            _queueManager.AddToHistory(completedJob);

            BuildJobDefinition retriedJob = _queueManager.RetryJobDirect(completedJob);

            Assert.IsNull(retriedJob, "Retry should be rejected while another job for the same profile is active.");
            Assert.AreEqual(1, _queueManager.ActiveExecutionCount);
            Assert.AreEqual(1, _queueManager.HistoryCount);
        }

        [Test]
        public void RetryJob_SameProfileAlreadyActive_ReturnsFalse()
        {
            var activeJob = new BuildJobDefinition("profile-1")
            {
                JobGuid = "active-job-2",
                RunUnityBuild = true
            };
            _queueManager.TrackActiveJob(activeJob);

            var completedJob = new BuildJobDefinition("profile-1")
            {
                JobGuid = "completed-job-2",
                Status = BuildJobStatus.Completed,
                RunUnityBuild = true
            };
            _queueManager.AddToHistory(completedJob);

            bool retried = _queueManager.RetryJob(completedJob);

            Assert.IsFalse(retried, "Retry should be rejected while another job for the same profile is active.");
        }

        #endregion

        #region Job Tracking

        [Test]
        public void GetJobByGuid_ReturnsCorrectJob()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-1");
            _queueManager.AddPendingJob(job);

            // Act
            var foundJob = _queueManager.GetJobByGuid(job.JobGuid);

            // Assert
            Assert.IsNotNull(foundJob, "Should find the job");
            Assert.AreEqual(job.JobGuid, foundJob.JobGuid, "Should return correct job");
        }

        [Test]
        public void GetJobByGuid_NotFound_ReturnsNull()
        {
            // Act
            var job = _queueManager.GetJobByGuid("non-existent-guid");

            // Assert
            Assert.IsNull(job, "Should return null for non-existent job");
        }

        [Test]
        public void GetAllJobs_ReturnsAllJobsAcrossAllStates()
        {
            // Arrange
            var job1 = new BuildJobDefinition("p1");
            var job2 = new BuildJobDefinition("p2");
            var job3 = new BuildJobDefinition("p3");
            
            _queueManager.AddPendingJob(job1);
            _queueManager.AddPendingJob(job2);
            _queueManager.TrackActiveJob(job2);
            
            job3.Status = BuildJobStatus.Completed;
            _queueManager.AddToHistory(job3);

            // Act
            var allJobs = _queueManager.GetAllJobs();

            // Assert
            Assert.AreEqual(3, allJobs.Count, "Should return all jobs");
        }

        [Test]
        public void ClearCompleted_RemovesOnlyCompletedJobs()
        {
            // Arrange
            var job1 = new BuildJobDefinition("p1");
            job1.Status = BuildJobStatus.Completed;
            _queueManager.AddToHistory(job1);
            
            var job2 = new BuildJobDefinition("p2");
            _queueManager.AddPendingJob(job2);

            Assert.AreEqual(1, _queueManager.HistoryCount);
            Assert.AreEqual(1, _queueManager.PendingCompatibilityCount);

            // Act
            _queueManager.ClearCompleted();

            // Assert
            Assert.AreEqual(0, _queueManager.HistoryCount, "Completed jobs should be cleared.");
            Assert.AreEqual(1, _queueManager.PendingCompatibilityCount, "Pending compatibility jobs should remain.");
        }

        [Test]
        public void ClearAll_RemovesAllJobs()
        {
            // Arrange
            _queueManager.AddPendingJob(new BuildJobDefinition("p1"));
            _queueManager.AddPendingJob(new BuildJobDefinition("p2"));
            
            var job3 = new BuildJobDefinition("p3");
            _queueManager.AddPendingJob(job3);
            _queueManager.TrackActiveJob(job3);

            // Act
            _queueManager.ClearAll();

            // Assert
            Assert.AreEqual(0, _queueManager.PendingCompatibilityCount);
            Assert.AreEqual(0, _queueManager.ActiveExecutionCount);
            Assert.AreEqual(0, _queueManager.HistoryCount);
        }

        #endregion

        #region History Management

        [Test]
        public void TrimHistory_KeepsLastNJobs()
        {
            // Arrange - Add 10 completed jobs
            for (int i = 0; i < 10; i++)
            {
                var job = new BuildJobDefinition($"profile-{i}");
                job.Status = BuildJobStatus.Completed;
                _queueManager.AddToHistory(job);
            }
            
            Assert.AreEqual(10, _queueManager.HistoryCount);

            // Act - Keep only last 5
            _queueManager.TrimHistory(maxHistoryCount: 5);

            // Assert
            Assert.AreEqual(5, _queueManager.HistoryCount, "Should keep only 5 most recent jobs.");
        }

        #endregion

        #region Duplicate Profile Prevention

        [Test]
        public void HasJobInProgress_EmptyQueue_ReturnsFalse()
        {
            Assert.IsFalse(_queueManager.HasJobInProgress("profile-1"));
        }

        [Test]
        public void HasJobInProgress_NullOrEmptyProfileGuid_ReturnsFalse()
        {
            Assert.IsFalse(_queueManager.HasJobInProgress(null));
            Assert.IsFalse(_queueManager.HasJobInProgress(string.Empty));
            Assert.IsFalse(_queueManager.HasJobInProgress("   "));
        }

        [Test]
        public void HasJobInProgress_JobInQueuedJobs_ReturnsTrue()
        {
            var job = new BuildJobDefinition("profile-1");
            _queueManager.AddPendingJob(job);

            Assert.IsTrue(_queueManager.HasJobInProgress("profile-1"));
        }

        [Test]
        public void HasJobInProgress_QueuedJobWithTerminalWorkspace_DoesNotBlock()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "queue-manager", System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = System.Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", System.EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, System.EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                var job = new BuildJobDefinition("profile-1");
                _queueManager.AddPendingJob(job);

                workspaceManager.CreateWorkspace(job.JobGuid, "profile-1", "profile.json");
                workspaceManager.UpdateBuildStatus(job.JobGuid, BuildJobStatus.Completed);
                workspaceManager.UpdateOperationState(
                    job.JobGuid,
                    isActive: false,
                    processId: 0,
                    processStartUtc: null,
                    statusDetail: "Completed Unity build.",
                    logPath: Path.Combine(tempRoot, "dist.log"));

                Assert.IsFalse(_queueManager.HasJobInProgress("profile-1"),
                    "Legacy pending jobs should not block when workspace state is already terminal and inactive.");
            }
            finally
            {
                System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, System.EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void HasJobInProgress_ProfileGuidComparison_IsCaseInsensitive()
        {
            var job = new BuildJobDefinition("PROFILE-1");
            _queueManager.AddPendingJob(job);

            Assert.IsTrue(_queueManager.HasJobInProgress(" profile-1 "));
        }

        [Test]
        public void HasJobInProgress_JobInActiveJobs_ReturnsTrue()
        {
            var job = new BuildJobDefinition("profile-1");
            _queueManager.TrackActiveJob(job);

            Assert.IsTrue(_queueManager.HasJobInProgress("profile-1"));
        }

        [Test]
        public void HasJobInProgress_StaleActiveWorkspace_DoesNotBlock()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "queue-manager", System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = System.Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", System.EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, System.EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                var job = new BuildJobDefinition("profile-1");
                _queueManager.TrackActiveJob(job);

                workspaceManager.UpdateOperationState(
                    job.JobGuid,
                    isActive: false,
                    processId: 0,
                    processStartUtc: null,
                    statusDetail: "Build in progress.",
                    logPath: Path.Combine(tempRoot, "dist.log"));

                Assert.IsFalse(_queueManager.HasJobInProgress("profile-1"),
                    "Active jobs with explicitly inactive workspace (stale process) should not block.");
            }
            finally
            {
                System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, System.EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void HasJobInProgress_ActiveJobWithTerminalInactiveWorkspace_DoesNotBlock()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "queue-manager", System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = System.Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", System.EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, System.EnvironmentVariableTarget.Process);

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                var job = new BuildJobDefinition("profile-1");
                _queueManager.TrackActiveJob(job);

                workspaceManager.UpsertWorkspaceRecord(job.JobGuid, "profile-1", "profile.json", string.Empty, BuildJobStatus.Building);
                workspaceManager.UpdateBuildStatus(job.JobGuid, BuildJobStatus.Completed);
                workspaceManager.UpdateOperationState(
                    job.JobGuid,
                    isActive: false,
                    processId: 0,
                    processStartUtc: null,
                    statusDetail: string.Empty,
                    logPath: string.Empty,
                    cancelRequested: false,
                    manifestPath: string.Empty,
                    launchToken: string.Empty);

                Assert.IsFalse(_queueManager.HasJobInProgress("profile-1"),
                    "Terminal inactive workspace state should not keep a profile blocked even if a stale active queue record exists.");
            }
            finally
            {
                System.Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, System.EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void HasJobInProgress_JobCompleted_ReturnsFalse()
        {
            var job = new BuildJobDefinition("profile-1");
            _queueManager.TrackActiveJob(job);
            _queueManager.CompleteJob(job.JobGuid, BuildJobStatus.Completed);

            Assert.IsFalse(_queueManager.HasJobInProgress("profile-1"), "Completed jobs should not block re-queuing");
        }

        [Test]
        public void HasJobInProgress_DifferentProfile_ReturnsFalse()
        {
            var job = new BuildJobDefinition("profile-1");
            _queueManager.AddPendingJob(job);

            Assert.IsFalse(_queueManager.HasJobInProgress("profile-2"), "Should not match a different profile");
        }

        #endregion
    }
}
