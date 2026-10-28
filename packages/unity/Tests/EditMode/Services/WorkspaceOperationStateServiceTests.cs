using System;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class WorkspaceOperationStateServiceTests
    {
        [Test]
        public void CancelDetachedOperation_PidAlreadyGone_WithExitCodeZero_DoesNotForceCancelled()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "workspace-ops", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            string jobGuid = "job-cancel-exited-ok";

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                workspaceManager.CreateWorkspace(jobGuid, "profile-1", "profile.json");
                workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Building);
                workspaceManager.UpdateTrackedStatusSnapshot(
                    jobGuid,
                    activeStatusDetail: "Unity Build",
                    completedOperationsSummary: "Unity Build",
                    terminalMessage: "Completed Unity build.",
                    exitCode: 0,
                    updatedAtUtc: DateTime.UtcNow);
                workspaceManager.UpdateOperationState(
                    jobGuid,
                    isActive: true,
                    processId: 999999,
                    processStartUtc: DateTime.UtcNow.AddMinutes(-2),
                    statusDetail: "Unity Build",
                    logPath: Path.Combine(tempRoot, "dist.log"));

                bool cancelled = WorkspaceOperationStateService.CancelDetachedOperation(jobGuid);
                Assert.IsTrue(cancelled, "Cancel request should be accepted for tracked detached operations.");

                WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(jobGuid);
                Assert.IsNotNull(workspace);
                Assert.AreEqual(BuildJobStatus.Completed, workspace.LastBuildStatus,
                    "PID-already-gone path should respect successful terminal evidence instead of forcing Cancelled.");
            }
            finally
            {
                Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }

        [Test]
        public void CancelDetachedOperation_PidAlreadyGone_WithNonZeroExitCode_MapsToFailed()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "workspace-ops", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            string jobGuid = "job-cancel-exited-fail";

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                workspaceManager.CreateWorkspace(jobGuid, "profile-1", "profile.json");
                workspaceManager.UpdateBuildStatus(jobGuid, BuildJobStatus.Building);
                workspaceManager.UpdateTrackedStatusSnapshot(
                    jobGuid,
                    activeStatusDetail: "Unity Build",
                    completedOperationsSummary: null,
                    terminalMessage: "Exited with code 7",
                    exitCode: 7,
                    updatedAtUtc: DateTime.UtcNow);
                workspaceManager.UpdateOperationState(
                    jobGuid,
                    isActive: true,
                    processId: 999998,
                    processStartUtc: DateTime.UtcNow.AddMinutes(-2),
                    statusDetail: "Unity Build",
                    logPath: Path.Combine(tempRoot, "dist.log"));

                bool cancelled = WorkspaceOperationStateService.CancelDetachedOperation(jobGuid);
                Assert.IsTrue(cancelled);

                WorkspaceInfo workspace = WorkspaceOperationStateService.GetWorkspace(jobGuid);
                Assert.IsNotNull(workspace);
                Assert.AreEqual(BuildJobStatus.Failed, workspace.LastBuildStatus,
                    "Non-zero exit code evidence should map to Failed instead of Cancelled.");
                StringAssert.Contains("Error Detected", workspace.LastTerminalMessage ?? string.Empty);
            }
            finally
            {
                Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", originalConfigPath, EnvironmentVariableTarget.Process);
                if (Directory.Exists(tempRoot))
                {
                    Directory.Delete(tempRoot, true);
                }
            }
        }
    }
}
