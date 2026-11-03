using NUnit.Framework;
using System;
using System.IO;
using System.Linq;
using UnityEngine;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// RED phase tests for WorkspaceManager.
    /// Defines workspace lifecycle, registry persistence, and cleanup behavior.
    /// </summary>
    [TestFixture]
    public class WorkspaceManagerTests
    {
        private string _testRoot;
        private string _workspacesRoot;
        private string _registryPath;
        private WorkspaceManager _workspaceManager;

        [SetUp]
        public void SetUp()
        {
            _testRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", Guid.NewGuid().ToString());
            _workspacesRoot = Path.Combine(_testRoot, "workspaces");
            _registryPath = Path.Combine(_workspacesRoot, "workspaces.json");

            Directory.CreateDirectory(_workspacesRoot);
            _workspaceManager = new WorkspaceManager(_workspacesRoot, _registryPath);
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(_testRoot))
            {
                Directory.Delete(_testRoot, true);
            }
        }

        [Test]
        public void CreateWorkspace_GeneratesValidPath()
        {
            string jobGuid = Guid.NewGuid().ToString();

            WorkspaceInfo info = _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json");

            Assert.IsNotNull(info);
            Assert.AreEqual(jobGuid, info.JobGuid);
            Assert.IsTrue(Directory.Exists(info.WorkspacePath));
            StringAssert.Contains(jobGuid, info.WorkspacePath);
        }

        [Test]
        public void CreateWorkspace_AddsToRegistry()
        {
            string jobGuid = Guid.NewGuid().ToString();

            WorkspaceInfo info = _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json");
            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();

            Assert.AreEqual(1, registry.Workspaces.Count);
            Assert.AreEqual(jobGuid, registry.Workspaces[0].JobGuid);
            Assert.AreEqual(info.WorkspacePath, registry.Workspaces[0].WorkspacePath);
        }

        [Test]
        public void CreateWorkspace_WritesProfileJsonPathToRegistry()
        {
            string jobGuid = Guid.NewGuid().ToString();
            string profileJsonPath = "C:/Users/User/CADET/Profiles/profile-guid.json";

            _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", profileJsonPath);
            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();

            Assert.AreEqual(1, registry.Workspaces.Count);
            Assert.AreEqual(profileJsonPath, registry.Workspaces[0].ProfileJsonPath);
        }

        [Test]
        public void CreateWorkspace_WritesProfileNameToRegistry()
        {
            string jobGuid = Guid.NewGuid().ToString();

            _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json", profileName: "Release Profile");
            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();

            Assert.AreEqual(1, registry.Workspaces.Count);
            Assert.AreEqual("Release Profile", registry.Workspaces[0].ProfileName);
        }

        [Test]
        public void DeleteWorkspace_RemovesFromRegistryAndDisk()
        {
            string jobGuid = Guid.NewGuid().ToString();
            WorkspaceInfo info = _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json");

            bool deleted = _workspaceManager.DeleteWorkspace(jobGuid);

            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();
            Assert.IsTrue(deleted);
            Assert.IsFalse(Directory.Exists(info.WorkspacePath));
            Assert.IsFalse(registry.Workspaces.Any(w => w.JobGuid == jobGuid));
        }

        [Test]
        public void GetWorkspaceByJobGuid_ReturnsCorrectWorkspace()
        {
            string jobA = Guid.NewGuid().ToString();
            string jobB = Guid.NewGuid().ToString();

            _workspaceManager.CreateWorkspace(jobA, "profile-a", "a.json");
            WorkspaceInfo b = _workspaceManager.CreateWorkspace(jobB, "profile-b", "b.json");

            WorkspaceInfo found = _workspaceManager.GetWorkspaceByJobGuid(jobB);

            Assert.IsNotNull(found);
            Assert.AreEqual(b.JobGuid, found.JobGuid);
            Assert.AreEqual("profile-b", found.ProfileGuid);
        }

        [Test]
        public void SaveRegistry_ThenLoadRegistry_PreservesAllFields()
        {
            var registry = new WorkspaceRegistry();
            registry.Workspaces.Add(new WorkspaceInfo
            {
                JobGuid = "job-1",
                ProfileGuid = "profile-1",
                ProfileJsonPath = "profile-1.json",
                WorkspacePath = Path.Combine(_workspacesRoot, "job-1"),
                CreatedAtUtc = DateTime.UtcNow,
                LastBuildStatus = BuildJobStatus.Completed,
                DiskUsageMB = 123
            });

            _workspaceManager.SaveRegistry(registry);
            WorkspaceRegistry loaded = _workspaceManager.LoadRegistry();

            Assert.AreEqual(1, loaded.Workspaces.Count);
            Assert.AreEqual("job-1", loaded.Workspaces[0].JobGuid);
            Assert.AreEqual("profile-1", loaded.Workspaces[0].ProfileGuid);
            Assert.AreEqual(string.Empty, loaded.Workspaces[0].ProfileName);
            Assert.AreEqual("profile-1.json", loaded.Workspaces[0].ProfileJsonPath);
            Assert.AreEqual(123, loaded.Workspaces[0].DiskUsageMB);
        }

        [Test]
        public void LoadRegistry_LegacyEntriesWithoutProfileJsonPath_StillLoad()
        {
            string legacyJson = "{\"Workspaces\":[{\"JobGuid\":\"legacy-job\",\"ProfileGuid\":\"legacy-profile\",\"WorkspacePath\":\"C:/legacy/path\",\"LastBuildStatus\":0,\"DiskUsageMB\":0,\"_createdAtUtcString\":\"2026-03-16T00:00:00.0000000Z\"}]}";
            File.WriteAllText(_registryPath, legacyJson);

            WorkspaceRegistry loaded = _workspaceManager.LoadRegistry();

            Assert.AreEqual(1, loaded.Workspaces.Count);
            Assert.AreEqual("legacy-job", loaded.Workspaces[0].JobGuid);
            Assert.AreEqual("legacy-profile", loaded.Workspaces[0].ProfileGuid);
            Assert.IsTrue(string.IsNullOrEmpty(loaded.Workspaces[0].ProfileJsonPath));
        }

        [Test]
        public void LoadRegistry_LegacyWithoutProfilesField_StillLoads()
        {
            string legacyJson = "{\"Workspaces\":[{\"JobGuid\":\"job-1\",\"ProfileGuid\":\"profile-1\",\"WorkspacePath\":\"C:/legacy/path\",\"LastBuildStatus\":0,\"DiskUsageMB\":0,\"_createdAtUtcString\":\"2026-03-16T00:00:00.0000000Z\"}]}";
            File.WriteAllText(_registryPath, legacyJson);

            WorkspaceRegistry loaded = _workspaceManager.LoadRegistry();

            Assert.IsNotNull(loaded);
            Assert.IsNotNull(loaded.Workspaces);
            Assert.AreEqual(1, loaded.Workspaces.Count);
        }

        [Test]
        public void CleanupOldWorkspaces_KeepsLastNPerProfile()
        {
            string profileGuid = "profile-keep-last";

            var w1 = _workspaceManager.CreateWorkspace("job-1", profileGuid, "p1.json");
            var w2 = _workspaceManager.CreateWorkspace("job-2", profileGuid, "p2.json");
            var w3 = _workspaceManager.CreateWorkspace("job-3", profileGuid, "p3.json");
            var w4 = _workspaceManager.CreateWorkspace("job-4", profileGuid, "p4.json");

            _workspaceManager.UpdateBuildStatus("job-1", BuildJobStatus.Completed);
            _workspaceManager.UpdateBuildStatus("job-2", BuildJobStatus.Completed);
            _workspaceManager.UpdateBuildStatus("job-3", BuildJobStatus.Completed);
            _workspaceManager.UpdateBuildStatus("job-4", BuildJobStatus.Completed);

            _workspaceManager.CleanupOldWorkspaces(profileGuid, 2);

            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();
            var kept = registry.Workspaces.Where(w => w.ProfileGuid == profileGuid).ToList();

            Assert.AreEqual(2, kept.Count);
            Assert.IsTrue(kept.Any(w => w.JobGuid == "job-4"));
            Assert.IsTrue(kept.Any(w => w.JobGuid == "job-3"));
            Assert.IsFalse(Directory.Exists(w1.WorkspacePath));
            Assert.IsFalse(Directory.Exists(w2.WorkspacePath));
        }

        [Test]
        public void CleanupOldWorkspaces_PreservesFailedBuilds()
        {
            string profileGuid = "profile-failed";

            _workspaceManager.CreateWorkspace("job-ok-1", profileGuid, "ok1.json");
            _workspaceManager.CreateWorkspace("job-fail", profileGuid, "fail.json");
            _workspaceManager.CreateWorkspace("job-ok-2", profileGuid, "ok2.json");

            _workspaceManager.UpdateBuildStatus("job-ok-1", BuildJobStatus.Completed);
            _workspaceManager.UpdateBuildStatus("job-fail", BuildJobStatus.Failed);
            _workspaceManager.UpdateBuildStatus("job-ok-2", BuildJobStatus.Completed);

            _workspaceManager.CleanupOldWorkspaces(profileGuid, 1);

            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();
            Assert.IsTrue(registry.Workspaces.Any(w => w.JobGuid == "job-fail"), "Failed workspace must be preserved");
        }

        [Test]
        public void CleanupOldWorkspaces_ByProfile_OnlyAffectsMatchingProfile()
        {
            _workspaceManager.CreateWorkspace("a1", "profile-a", "a1.json");
            _workspaceManager.CreateWorkspace("a2", "profile-a", "a2.json");
            _workspaceManager.CreateWorkspace("b1", "profile-b", "b1.json");

            _workspaceManager.UpdateBuildStatus("a1", BuildJobStatus.Completed);
            _workspaceManager.UpdateBuildStatus("a2", BuildJobStatus.Completed);
            _workspaceManager.UpdateBuildStatus("b1", BuildJobStatus.Completed);

            _workspaceManager.CleanupOldWorkspaces("profile-a", 1);

            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();
            Assert.AreEqual(1, registry.Workspaces.Count(w => w.ProfileGuid == "profile-a"));
            Assert.AreEqual(1, registry.Workspaces.Count(w => w.ProfileGuid == "profile-b"));
        }

        [Test]
        public void DeleteWorkspace_NonExistent_ReturnsFalse()
        {
            bool deleted = _workspaceManager.DeleteWorkspace("missing-job");
            Assert.IsFalse(deleted);
        }

        [Test]
        public void RemoveWorkspaceRecord_JobGuidMatch_IsCaseInsensitive()
        {
            _workspaceManager.CreateWorkspace("ABC-Job-Guid", "profile-guid", "profile.json");

            bool removed = _workspaceManager.RemoveWorkspaceRecord("abc-job-guid", deleteProjectFolder: false);

            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();
            Assert.IsTrue(removed);
            Assert.IsFalse(registry.Workspaces.Any(w => w.JobGuid == "ABC-Job-Guid"));
        }

        [Test]
        public void RemoveWorkspaceRecord_WhenJobGuidMissing_FallsBackToWorkspacePath()
        {
            WorkspaceInfo info = _workspaceManager.CreateWorkspace("job-guid-a", "profile-guid", "profile.json");

            bool removed = _workspaceManager.RemoveWorkspaceRecord(
                "job-guid-b",
                deleteProjectFolder: false,
                workspacePathOverride: info.WorkspacePath,
                profileGuidOverride: info.ProfileGuid);

            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();
            Assert.IsTrue(removed);
            Assert.IsFalse(registry.Workspaces.Any(w => w.WorkspacePath == info.WorkspacePath));
        }

        [Test]
        public void CreateWorkspace_DuplicateJobGuid_ThrowsException()
        {
            string jobGuid = "job-dup";
            _workspaceManager.CreateWorkspace(jobGuid, "profile", "profile.json");

            Assert.Throws<InvalidOperationException>(() =>
                _workspaceManager.CreateWorkspace(jobGuid, "profile", "profile.json"));
        }

        [Test]
        public void ValidateWorkspacePath_ChecksWriteAccessAndExists()
        {
            bool valid = _workspaceManager.ValidateWorkspaceRoot();
            Assert.IsTrue(valid);
            Assert.IsTrue(Directory.Exists(_workspacesRoot));
        }

        [Test]
        public void CreateWorkspace_WithMissingRoot_CreatesRootThenWorkspace()
        {
            Directory.Delete(_workspacesRoot, true);

            WorkspaceInfo info = _workspaceManager.CreateWorkspace("job-create-root", "profile", "profile.json");

            Assert.IsTrue(Directory.Exists(_workspacesRoot));
            Assert.IsTrue(Directory.Exists(info.WorkspacePath));
        }

        [Test]
        public void CreateWorkspace_WithRootOverride_UsesOverrideForWorkspacePath()
        {
            string overrideRoot = Path.Combine(_testRoot, "target-root");

            WorkspaceInfo info = _workspaceManager.CreateWorkspace("job-target", "profile", "profile.json", overrideRoot);

            StringAssert.Contains("target-root", info.WorkspacePath);
            StringAssert.Contains("job-target", info.WorkspacePath);
            Assert.IsTrue(Directory.Exists(Path.Combine(overrideRoot, "job-target")));
        }

        [Test]
        public void CreateWorkspace_DoesNotDependOnBuildProfileWorkspaceRootField()
        {
            WorkspaceInfo info = _workspaceManager.CreateWorkspace("job-no-workspace-field", "profile", "profile.json");

            Assert.IsNotNull(info);
            Assert.IsTrue(Directory.Exists(info.WorkspacePath));
        }

        [Test]
        public void UpsertWorkspaceRecord_InsertsThenUpdatesWorkspace()
        {
            _workspaceManager.UpsertWorkspaceRecord(
                "job-upsert",
                "profile-1",
                "C:/Users/User/CADET/Profiles/profile-1.json",
                "F:/unity/projects/test-cadet",
                BuildJobStatus.Syncing);

            WorkspaceRegistry inserted = _workspaceManager.LoadRegistry();
            Assert.AreEqual(1, inserted.Workspaces.Count);
            Assert.AreEqual(BuildJobStatus.Syncing, inserted.Workspaces[0].LastBuildStatus);

            _workspaceManager.UpsertWorkspaceRecord(
                "job-upsert",
                "profile-1",
                "C:/Users/User/CADET/Profiles/profile-1-v2.json",
                "F:/unity/projects/test-cadet",
                BuildJobStatus.Building,
                "Release Candidate");

            WorkspaceRegistry updated = _workspaceManager.LoadRegistry();
            Assert.AreEqual(1, updated.Workspaces.Count);
            Assert.AreEqual("C:/Users/User/CADET/Profiles/profile-1-v2.json", updated.Workspaces[0].ProfileJsonPath);
            Assert.AreEqual("Release Candidate", updated.Workspaces[0].ProfileName);
            Assert.AreEqual(BuildJobStatus.Building, updated.Workspaces[0].LastBuildStatus);
        }

        [Test]
        public void UpsertWorkspaceRecord_WithoutNewProfileName_PreservesExistingProfileName()
        {
            _workspaceManager.UpsertWorkspaceRecord(
                "job-upsert-preserve",
                "profile-1",
                "C:/Users/User/CADET/Profiles/profile-1.json",
                "F:/unity/projects/test-cadet",
                BuildJobStatus.Syncing,
                "Release Profile");

            _workspaceManager.UpsertWorkspaceRecord(
                "job-upsert-preserve",
                "profile-1",
                "C:/Users/User/CADET/Profiles/profile-1-v2.json",
                "F:/unity/projects/test-cadet",
                BuildJobStatus.Building);

            WorkspaceRegistry updated = _workspaceManager.LoadRegistry();
            Assert.AreEqual("Release Profile", updated.Workspaces[0].ProfileName);
        }

        [Test]
        public void UpsertWorkspaceRecord_DoesNotCalculateDiskUsageForExistingWorkspace()
        {
            string existingWorkspacePath = Path.Combine(_testRoot, "existing-workspace");
            Directory.CreateDirectory(existingWorkspacePath);
            File.WriteAllText(Path.Combine(existingWorkspacePath, "payload.bin"), new string('x', 4096));

            _workspaceManager.UpsertWorkspaceRecord(
                "job-upsert-disk-usage",
                "profile-1",
                "C:/Users/User/CADET/Profiles/profile-1.json",
                existingWorkspacePath,
                BuildJobStatus.Building,
                "Release Profile");

            WorkspaceRegistry registry = _workspaceManager.LoadRegistry();
            Assert.AreEqual(1, registry.Workspaces.Count);
            Assert.AreEqual(0, registry.Workspaces[0].DiskUsageMB);
        }

        [Test]
        public void SaveProfileConfig_PersistsSourceProjectPath()
        {
            var config = new ProfileWorkspaceConfig
            {
                ProfileGuid = "profile-guid",
                SourceProjectPath = "F:/unity/projects/cadet-unity"
            };

            _workspaceManager.SaveProfileConfig(config);

            ProfileWorkspaceConfig loaded = _workspaceManager.GetProfileConfig("profile-guid");
            Assert.AreEqual("profile-guid", loaded.ProfileGuid);
            Assert.AreEqual("F:/unity/projects/cadet-unity", loaded.SourceProjectPath);

            string profileConfigPath = Path.Combine(_workspacesRoot, "profile-workspace-config.json");
            Assert.IsTrue(File.Exists(profileConfigPath));

            string profileConfigJson = File.ReadAllText(profileConfigPath);
            Assert.IsTrue(profileConfigJson.Contains("\"Profiles\""));
        }

        [Test]
        public void UpdateOperationState_PersistsTrackedStatusIdentity()
        {
            string jobGuid = Guid.NewGuid().ToString();
            string manifestPath = "C:/temp/logs/job-launch-cadet.status.json";
            string launchToken = "launch-token-123";

            _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json");
            _workspaceManager.UpdateOperationState(
                jobGuid,
                isActive: true,
                processId: 42,
                processStartUtc: DateTime.UtcNow,
                statusDetail: "Running detached dist operation.",
                logPath: "C:/temp/logs/dist.log",
                cancelRequested: false,
                manifestPath: manifestPath,
                launchToken: launchToken);

            WorkspaceInfo workspace = _workspaceManager.GetWorkspaceByJobGuid(jobGuid);

            Assert.AreEqual(manifestPath, workspace.ActiveStatusManifestPath);
            Assert.AreEqual(launchToken, workspace.ActiveStatusLaunchToken);
        }

        [Test]
        public void UpdateBuildStatus_TerminalTransition_ClearsActiveStateButRetainsTrackedSummary()
        {
            string jobGuid = Guid.NewGuid().ToString();
            _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json");

            _workspaceManager.UpdateOperationState(
                jobGuid,
                isActive: true,
                processId: 77,
                processStartUtc: DateTime.UtcNow,
                statusDetail: "Running: Publish Steam | Completed: Unity Build",
                logPath: "C:/temp/logs/dist.log",
                cancelRequested: false,
                manifestPath: "C:/temp/logs/job-launch-cadet.status.json",
                launchToken: "launch-token-456");

            _workspaceManager.UpdateTrackedStatusSnapshot(
                jobGuid,
                activeStatusDetail: "Completed: Unity Build, Publish Steam",
                completedOperationsSummary: "Unity Build, Publish Steam",
                terminalMessage: "Completed: Unity Build, Publish Steam",
                exitCode: 0,
                updatedAtUtc: DateTime.UtcNow);

            _workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Completed);

            WorkspaceInfo workspace = _workspaceManager.GetWorkspaceByJobGuid(jobGuid);

            Assert.IsFalse(workspace.IsOperationActive);
            Assert.AreEqual(0, workspace.ActiveProcessId);
            Assert.IsEmpty(workspace.ActiveStatusManifestPath);
            Assert.IsEmpty(workspace.ActiveStatusLaunchToken);
            Assert.AreEqual("Completed: Unity Build, Publish Steam", workspace.LastOperationSummary);
            Assert.AreEqual("Unity Build, Publish Steam", workspace.LastCompletedOperationsSummary);
            Assert.AreEqual("Completed: Unity Build, Publish Steam", workspace.LastTerminalMessage);
            Assert.AreEqual(0, workspace.LastExitCode);
        }

        [Test]
        public void UpdateBuildStatus_Completed_ReplacesStaleCrashTerminalMessage()
        {
            string jobGuid = Guid.NewGuid().ToString();
            _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json");

            _workspaceManager.UpdateOperationState(
                jobGuid,
                isActive: true,
                processId: 99,
                processStartUtc: DateTime.UtcNow,
                statusDetail: "Complete",
                logPath: "C:/temp/logs/dist.log",
                cancelRequested: false,
                manifestPath: "C:/temp/logs/job-launch-cadet.status.json",
                launchToken: "launch-token-stale");

            _workspaceManager.UpdateTrackedStatusSnapshot(
                jobGuid,
                activeStatusDetail: "Complete",
                completedOperationsSummary: "Unity Build",
                terminalMessage: "Process not found - likely crashed. Click Delete to remove this job.",
                exitCode: 0,
                updatedAtUtc: DateTime.UtcNow);

            _workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Completed);

            WorkspaceInfo workspace = _workspaceManager.GetWorkspaceByJobGuid(jobGuid);
            Assert.AreEqual(BuildJobStatus.Completed, workspace.LastBuildStatus);
            Assert.AreEqual("Unity Build", workspace.LastTerminalMessage);
            Assert.AreEqual("Unity Build", workspace.LastCompletedOperationsSummary);
        }

        [Test]
        public void GetActiveOperations_StaleActiveRecord_IsClearedAndNotReturned()
        {
            string jobGuid = Guid.NewGuid().ToString();
            string oldLogPath = Path.Combine(_testRoot, "stale-dist.log");
            File.WriteAllText(oldLogPath, "old log");
            File.SetLastWriteTimeUtc(oldLogPath, DateTime.UtcNow.AddMinutes(-5));

            _workspaceManager.CreateWorkspace(jobGuid, "profile-guid", "profile.json");
            _workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Building);
            _workspaceManager.UpdateOperationState(
                jobGuid,
                isActive: true,
                processId: 12345,
                processStartUtc: DateTime.UtcNow.AddMinutes(-5),
                statusDetail: "Detached dist operation running.",
                logPath: oldLogPath,
                cancelRequested: false,
                manifestPath: "",
                launchToken: "");

            var active = _workspaceManager.GetActiveOperations();

            Assert.AreEqual(0, active.Count, "Stale active records should not be reported as active operations.");

            WorkspaceInfo workspace = _workspaceManager.GetWorkspaceByJobGuid(jobGuid);
            Assert.IsNotNull(workspace);
            Assert.IsFalse(workspace.IsOperationActive, "Stale active flag should be cleared when active operations are queried.");
            Assert.AreEqual(0, workspace.ActiveProcessId, "Stale process id should be cleared.");
        }

        [Test]
        public void GetProfileConfig_ReturnsStoredEntry()
        {
            var config = new ProfileWorkspaceConfig
            {
                ProfileGuid = "profile-stored",
                SourceProjectPath = "F:/unity/projects/cadet-unity"
            };

            _workspaceManager.SaveProfileConfig(config);

            ProfileWorkspaceConfig loaded = _workspaceManager.GetProfileConfig("profile-stored");
            Assert.AreEqual("profile-stored", loaded.ProfileGuid);
            Assert.AreEqual("F:/unity/projects/cadet-unity", loaded.SourceProjectPath);
        }

        [Test]
        public void GetProfileConfig_UnknownGuid_ReturnsDefault()
        {
            ProfileWorkspaceConfig config = _workspaceManager.GetProfileConfig("missing-profile");

            Assert.IsNotNull(config);
            Assert.AreEqual("missing-profile", config.ProfileGuid);
            Assert.AreEqual(string.Empty, config.SourceProjectPath);
        }
    }
}
