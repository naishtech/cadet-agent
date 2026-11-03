using System;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Services
{
    /// <summary>
    /// Integration tests for BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation.
    /// These tests write to the workspace registry isolated by ServicesWorkspacesIsolationSetUpFixture.
    /// </summary>
    [TestFixture]
    public class BuildQueueWorkspaceContextServiceFolderInUseTests
    {
        private WorkspaceManager _workspaceManager;
        private string _testRoot;
        private string _jobGuidA;
        private string _jobGuidB;

        [SetUp]
        public void SetUp()
        {
            string workspacesRoot = Path.GetFullPath(
                CadetLitePathService.GetWorkspacesRoot()
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            string registryPath = Path.Combine(workspacesRoot, "workspaces.json");
            Directory.CreateDirectory(workspacesRoot);
            _workspaceManager = new WorkspaceManager(workspacesRoot, registryPath);

            _testRoot = Path.Combine(workspacesRoot, "folder-in-use-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_testRoot);

            _jobGuidA = Guid.NewGuid().ToString("N");
            _jobGuidB = Guid.NewGuid().ToString("N");
        }

        [TearDown]
        public void TearDown()
        {
            _workspaceManager?.RemoveWorkspaceRecord(_jobGuidA);
            _workspaceManager?.RemoveWorkspaceRecord(_jobGuidB);

            if (!string.IsNullOrWhiteSpace(_testRoot) && Directory.Exists(_testRoot))
            {
                try { Directory.Delete(_testRoot, true); } catch { /* best effort */ }
            }
        }

        [Test]
        public void IsFolderInUseByActiveOperation_NoActiveOperations_ReturnsFalse()
        {
            string targetPath = Path.Combine(_testRoot, "ws-a");

            WorkspaceInfo target = new WorkspaceInfo
            {
                JobGuid = _jobGuidA,
                WorkspacePath = targetPath
            };

            // _jobGuidA has no registry record, so no active operations exist for it.
            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(target);
            Assert.IsFalse(result);
        }

        [Test]
        public void IsFolderInUseByActiveOperation_ActiveOperationOnSamePath_ReturnsTrue()
        {
            string sharedPath = Path.Combine(_testRoot, "ws-shared");

            // jobB is running and owns sharedPath.
            _workspaceManager.UpsertWorkspaceRecord(_jobGuidB, "profile", "profile.json", sharedPath, BuildJobStatus.Building);
            _workspaceManager.UpdateOperationState(
                _jobGuidB,
                isActive: true,
                processId: 9001,
                processStartUtc: DateTime.UtcNow,
                statusDetail: "building",
                logPath: null);

            // jobA (finished) targets the same folder.
            WorkspaceInfo target = new WorkspaceInfo
            {
                JobGuid = _jobGuidA,
                WorkspacePath = sharedPath
            };

            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(target, excludeJobGuid: _jobGuidA);
            Assert.IsTrue(result);
        }

        [Test]
        public void IsFolderInUseByActiveOperation_ActiveOperationExcludedBySameJobGuid_ReturnsFalse()
        {
            string sharedPath = Path.Combine(_testRoot, "ws-self");

            // jobA is marked active and owns the path — but we exclude its own guid.
            _workspaceManager.UpsertWorkspaceRecord(_jobGuidA, "profile", "profile.json", sharedPath, BuildJobStatus.Building);
            _workspaceManager.UpdateOperationState(
                _jobGuidA,
                isActive: true,
                processId: 9002,
                processStartUtc: DateTime.UtcNow,
                statusDetail: "building",
                logPath: null);

            WorkspaceInfo target = new WorkspaceInfo
            {
                JobGuid = _jobGuidA,
                WorkspacePath = sharedPath
            };

            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(target, excludeJobGuid: _jobGuidA);
            Assert.IsFalse(result);
        }

        [Test]
        public void IsFolderInUseByActiveOperation_ActiveOperationOnDifferentPath_ReturnsFalse()
        {
            string pathA = Path.Combine(_testRoot, "ws-a");
            string pathB = Path.Combine(_testRoot, "ws-b");

            // jobB is active but on a different path.
            _workspaceManager.UpsertWorkspaceRecord(_jobGuidB, "profile", "profile.json", pathB, BuildJobStatus.Building);
            _workspaceManager.UpdateOperationState(
                _jobGuidB,
                isActive: true,
                processId: 9003,
                processStartUtc: DateTime.UtcNow,
                statusDetail: "building",
                logPath: null);

            WorkspaceInfo target = new WorkspaceInfo
            {
                JobGuid = _jobGuidA,
                WorkspacePath = pathA
            };

            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(target, excludeJobGuid: _jobGuidA);
            Assert.IsFalse(result);
        }

        [Test]
        public void IsFolderInUseByActiveOperation_PathComparisonIsCaseInsensitive()
        {
            string canonicalPath = Path.Combine(_testRoot, "ws-case");

            _workspaceManager.UpsertWorkspaceRecord(_jobGuidB, "profile", "profile.json", canonicalPath, BuildJobStatus.Building);
            _workspaceManager.UpdateOperationState(
                _jobGuidB,
                isActive: true,
                processId: 9004,
                processStartUtc: DateTime.UtcNow,
                statusDetail: "building",
                logPath: null);

            // Pass the target path in a different case to verify OrdinalIgnoreCase comparison.
            string differentCasePath = canonicalPath.ToUpperInvariant();
            WorkspaceInfo target = new WorkspaceInfo
            {
                JobGuid = _jobGuidA,
                WorkspacePath = differentCasePath
            };

            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(target, excludeJobGuid: _jobGuidA);
            Assert.IsTrue(result);
        }

        [Test]
        public void IsFolderInUseByActiveOperation_InactiveOperationOnSamePath_ReturnsFalse()
        {
            string sharedPath = Path.Combine(_testRoot, "ws-inactive");

            // jobB registered but NOT marked active (IsOperationActive stays false).
            _workspaceManager.UpsertWorkspaceRecord(_jobGuidB, "profile", "profile.json", sharedPath, BuildJobStatus.Completed);

            WorkspaceInfo target = new WorkspaceInfo
            {
                JobGuid = _jobGuidA,
                WorkspacePath = sharedPath
            };

            bool result = BuildQueueWorkspaceContextService.IsFolderInUseByActiveOperation(target, excludeJobGuid: _jobGuidA);
            Assert.IsFalse(result);
        }
    }
}
