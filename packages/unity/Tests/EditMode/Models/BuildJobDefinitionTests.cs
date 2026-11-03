using NUnit.Framework;
using System;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Tests.Models
{
    /// <summary>
    /// TDD tests for BuildJobDefinition - written BEFORE implementation
    /// Following RED-GREEN-REFACTOR methodology
    /// </summary>
    [TestFixture]
    public class BuildJobDefinitionTests
    {
        [SetUp]
        public void SetUp()
        {
            // Clean state before each test
        }

        [TearDown]
        public void TearDown()
        {
            // Cleanup after each test
        }

        #region Core Functionality Tests

        [Test]
        public void CreateJobDefinition_WithValidProfileGuid_SetsGuidAndStatus()
        {
            // Arrange
            string testProfileGuid = "test-profile-guid-123";

            // Act
            var job = new BuildJobDefinition(testProfileGuid);

            // Assert
            Assert.IsNotNull(job, "Job should be created");
            Assert.AreEqual(testProfileGuid, job.ProfileGuid, "Profile GUID should match");
            Assert.IsNotNull(job.JobGuid, "Job GUID should be generated");
            Assert.IsNotEmpty(job.JobGuid, "Job GUID should not be empty");
            Assert.AreEqual(BuildJobStatus.Queued, job.Status, "Initial status should be Queued");
        }

        [Test]
        public void CreateJobDefinition_GeneratesUniqueGuids()
        {
            // Arrange
            string profileGuid = "test-profile";

            // Act
            var job1 = new BuildJobDefinition(profileGuid);
            var job2 = new BuildJobDefinition(profileGuid);
            var job3 = new BuildJobDefinition(profileGuid);

            // Assert
            Assert.AreNotEqual(job1.JobGuid, job2.JobGuid, "Job1 and Job2 should have unique GUIDs");
            Assert.AreNotEqual(job2.JobGuid, job3.JobGuid, "Job2 and Job3 should have unique GUIDs");
            Assert.AreNotEqual(job1.JobGuid, job3.JobGuid, "Job1 and Job3 should have unique GUIDs");
        }

        [Test]
        public void SetWorkspacePath_WithValidPath_StoresCorrectly()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            string testPath = @"C:\cadet\workspaces\test-guid";

            // Act
            job.WorkspacePath = testPath;

            // Assert
            Assert.AreEqual(testPath, job.WorkspacePath, "Workspace path should be stored correctly");
        }

        [Test]
        public void UpdateStatus_ProgressesThroughValidStates()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            Assert.AreEqual(BuildJobStatus.Queued, job.Status);

            // Act & Assert - Valid progression
            job.Status = BuildJobStatus.Syncing;
            Assert.AreEqual(BuildJobStatus.Syncing, job.Status);

            job.Status = BuildJobStatus.Building;
            Assert.AreEqual(BuildJobStatus.Building, job.Status);

            job.Status = BuildJobStatus.Publishing;
            Assert.AreEqual(BuildJobStatus.Publishing, job.Status);

            job.Status = BuildJobStatus.Completed;
            Assert.AreEqual(BuildJobStatus.Completed, job.Status);
        }

        [Test]
        public void SetStartTime_StoresTimestamp()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            var beforeTime = DateTime.UtcNow;

            // Act
            job.StartTime = DateTime.UtcNow;
            var afterTime = DateTime.UtcNow;

            // Assert
            Assert.IsNotNull(job.StartTime, "Start time should be set");
            Assert.GreaterOrEqual(job.StartTime.Value, beforeTime, "Start time should be after or equal to before time");
            Assert.LessOrEqual(job.StartTime.Value, afterTime, "Start time should be before or equal to after time");
        }

        [Test]
        public void SetCompletionTime_StoresTimestamp()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            var completionTime = DateTime.UtcNow;

            // Act
            job.CompletionTime = completionTime;

            // Assert
            Assert.AreEqual(completionTime, job.CompletionTime, "Completion time should be stored");
        }

        [Test]
        public void SetProcessId_StoresCorrectly()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            int testProcessId = 12345;

            // Act
            job.ProcessId = testProcessId;

            // Assert
            Assert.AreEqual(testProcessId, job.ProcessId, "Process ID should be stored correctly");
        }

        #endregion

        #region Validation Tests

        [Test]
        public void CreateJobDefinition_WithNullProfileGuid_ThrowsException()
        {
            // Act & Assert
            Assert.Throws<ArgumentNullException>(() => new BuildJobDefinition(null),
                "Creating job with null profile GUID should throw ArgumentNullException");
        }

        [Test]
        public void CreateJobDefinition_WithEmptyProfileGuid_ThrowsException()
        {
            // Act & Assert
            Assert.Throws<ArgumentException>(() => new BuildJobDefinition(""),
                "Creating job with empty profile GUID should throw ArgumentException");
        }

        [Test]
        public void SetWorkspacePath_WithNullPath_AcceptsNull()
        {
            // Arrange - Git Sync mode uses null workspace path
            var job = new BuildJobDefinition("profile-guid");

            // Act
            job.WorkspacePath = null;

            // Assert
            Assert.IsNull(job.WorkspacePath, "Null workspace path should be accepted for Git Sync mode");
        }

        #endregion

        #region Serialization Tests

        [Test]
        public void SerializeToJson_AndDeserialize_PreservesAllFields()
        {
            // Arrange
            var originalJob = new BuildJobDefinition("test-profile-guid")
            {
                WorkspacePath = @"C:\cadet\workspaces\test-workspace",
                ProcessId = 9999,
                Status = BuildJobStatus.Building,
                StartTime = DateTime.UtcNow,
                CompletionTime = null
            };

            // Act
            string json = originalJob.ToJson();
            var deserializedJob = BuildJobDefinition.FromJson(json);

            // Assert
            Assert.IsNotNull(deserializedJob, "Deserialized job should not be null");
            Assert.AreEqual(originalJob.JobGuid, deserializedJob.JobGuid, "Job GUID should match");
            Assert.AreEqual(originalJob.ProfileGuid, deserializedJob.ProfileGuid, "Profile GUID should match");
            Assert.AreEqual(originalJob.WorkspacePath, deserializedJob.WorkspacePath, "Workspace path should match");
            Assert.AreEqual(originalJob.ProcessId, deserializedJob.ProcessId, "Process ID should match");
            Assert.AreEqual(originalJob.Status, deserializedJob.Status, "Status should match");
            Assert.AreEqual(originalJob.StartTime, deserializedJob.StartTime, "Start time should match");
            Assert.AreEqual(originalJob.CompletionTime, deserializedJob.CompletionTime, "Completion time should match");
        }

        [Test]
        public void ToJson_ProducesValidJson()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = @"C:\test\path",
                ProcessId = 1234,
                Status = BuildJobStatus.Queued
            };

            // Act
            string json = job.ToJson();

            // Assert
            Assert.IsNotNull(json, "JSON should not be null");
            Assert.IsNotEmpty(json, "JSON should not be empty");
            StringAssert.Contains("JobGuid", json, "JSON should contain JobGuid field");
            StringAssert.Contains("ProfileGuid", json, "JSON should contain ProfileGuid field");
            StringAssert.Contains("WorkspacePath", json, "JSON should contain WorkspacePath field");
        }

        [Test]
        public void FromJson_WithInvalidJson_ThrowsException()
        {
            // Arrange
            string invalidJson = "{ invalid json }";

            // Act & Assert
            Assert.Throws<ArgumentException>(() => BuildJobDefinition.FromJson(invalidJson),
                "Parsing invalid JSON should throw ArgumentException");
        }

        #endregion

        #region Property Tests

        [Test]
        public void ElapsedTime_BeforeCompletion_ReturnsCurrentDuration()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            job.StartTime = DateTime.UtcNow.AddSeconds(-10);
            job.Status = BuildJobStatus.Building;

            // Act
            var elapsed = job.ElapsedTime;

            // Assert
            Assert.IsNotNull(elapsed, "Elapsed time should not be null");
            Assert.GreaterOrEqual(elapsed.Value.TotalSeconds, 9, "Elapsed time should be at least 9 seconds");
            Assert.LessOrEqual(elapsed.Value.TotalSeconds, 11, "Elapsed time should be at most 11 seconds");
        }

        [Test]
        public void ElapsedTime_AfterCompletion_ReturnsFixedDuration()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            job.StartTime = DateTime.UtcNow.AddMinutes(-5);
            job.CompletionTime = DateTime.UtcNow;
            job.Status = BuildJobStatus.Completed;

            // Act
            var elapsed1 = job.ElapsedTime;
            System.Threading.Thread.Sleep(100);
            var elapsed2 = job.ElapsedTime;

            // Assert
            Assert.AreEqual(elapsed1, elapsed2, "Elapsed time should be fixed after completion");
        }

        [Test]
        public void ElapsedTime_BeforeStart_ReturnsNull()
        {
            // Arrange
            var job = new BuildJobDefinition("profile-guid");
            job.StartTime = null;

            // Act
            var elapsed = job.ElapsedTime;

            // Assert
            Assert.IsNull(elapsed, "Elapsed time should be null before job starts");
        }

        #endregion
    }
}
