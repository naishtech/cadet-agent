using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildQueueJobExecutionServiceTests
    {
        private const string TempFolder = "Assets/Tests/Temp/QueueExecution";

        [SetUp]
        public void SetUp()
        {
            if (!AssetDatabase.IsValidFolder("Assets/Tests/Temp"))
            {
                AssetDatabase.CreateFolder("Assets/Tests", "Temp");
            }

            if (!AssetDatabase.IsValidFolder(TempFolder))
            {
                AssetDatabase.CreateFolder("Assets/Tests/Temp", "QueueExecution");
            }
        }

        [TearDown]
        public void TearDown()
        {
            if (AssetDatabase.IsValidFolder(TempFolder))
            {
                AssetDatabase.DeleteAsset(TempFolder);
            }
        }

        [Test]
        public void ExecuteAsync_InvalidGuid_LogsErrorAndReturnsFalse()
        {
            var queueManager = new BuildQueueManager();
            var job = new BuildJobDefinition("missing-guid")
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunUnityBuild = true
            };

            var messages = new List<string>();
            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Unity Build",
                ExecuteBuildOperation = (_, _, _, _, _, _) => Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false)),
                OnBuildSucceeded = () => { },
                Repaint = () => { },
                AppendOutput = (line, _) => messages.Add(line)
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsFalse(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
            Assert.AreEqual("Failed: profile asset path not found.", job.StatusDetail);
            Assert.IsTrue(messages.Exists(m => m.Contains("profile GUID could not be resolved", StringComparison.OrdinalIgnoreCase)));
        }

        [Test]
        public void ExecuteAsync_UnityBuildJob_ExecutesBuildAndMarksSuccess()
        {
            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueProfile", platform = "steam", os = "windows" };

            string assetPath = Path.Combine(TempFolder, "QueueProfile.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
            var job = new BuildJobDefinition(profileGuid)
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunUnityBuild = true,
                RunNotarizeMac = false,
                RunPublishSteam = false,
                RunPublishEpic = false
            };

            queueManager.TrackActiveJob(job);

            bool buildInvoked = false;
            int buildSuccessRefreshes = 0;
            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Unity Build",
                ExecuteBuildOperation = (profile, buildOnly, publishOnly, notarizeOnly, platform, activeJob) =>
                {
                    buildInvoked = true;
                    Assert.AreEqual("QueueProfile", profile.profileName);
                    Assert.IsTrue(buildOnly);
                    Assert.IsFalse(publishOnly);
                    Assert.IsFalse(notarizeOnly);
                    Assert.IsNull(platform);
                    Assert.AreEqual(job.JobGuid, activeJob.JobGuid);
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false));
                },
                OnBuildSucceeded = () => buildSuccessRefreshes++,
                Repaint = () => { },
                AppendOutput = (_, _) => { }
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsTrue(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
            Assert.IsTrue(buildInvoked);
            Assert.AreEqual(1, buildSuccessRefreshes);
            Assert.AreEqual("QueueProfile", job.ProfileName);
        }

        [Test]
        public void ExecuteAsync_UnityBuildAndSteamPublish_UsesSingleBuildAndPublishInvocation()
        {
            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueCombinedProfile", platform = "steam", os = "windows" };

            string assetPath = Path.Combine(TempFolder, "QueueCombinedProfile.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
            var job = new BuildJobDefinition(profileGuid)
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunUnityBuild = true,
                RunPublishSteam = true
            };

            queueManager.TrackActiveJob(job);

            int executeCallCount = 0;
            bool? buildOnlyArg = null;
            bool? publishOnlyArg = null;
            string platformArg = null;

            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Unity Build, Publish Steam",
                ExecuteBuildOperation = (_, buildOnly, publishOnly, notarizeOnly, platform, activeJob) =>
                {
                    executeCallCount++;
                    buildOnlyArg = buildOnly;
                    publishOnlyArg = publishOnly;
                    Assert.IsFalse(notarizeOnly);
                    platformArg = platform;
                    Assert.AreEqual(job.JobGuid, activeJob.JobGuid);
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false));
                },
                OnBuildSucceeded = () => { },
                Repaint = () => { },
                AppendOutput = (_, _) => { }
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsTrue(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
            Assert.AreEqual(1, executeCallCount);
            Assert.AreEqual(false, buildOnlyArg);
            Assert.AreEqual(false, publishOnlyArg);
            Assert.AreEqual("steam", platformArg);
        }

        [Test]
        public void ExecuteAsync_NotarizeOnlyJob_PassesJobDefinitionToNotarizeDelegate()
        {
            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueNotarizeProfile", platform = "steam", os = "mac" };

            string assetPath = Path.Combine(TempFolder, "QueueNotarizeProfile.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
            var job = new BuildJobDefinition(profileGuid)
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunNotarizeMac = true
            };

            queueManager.TrackActiveJob(job);

            BuildJobDefinition capturedJob = null;
            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Notarize macOS Build",
                ExecuteBuildOperation = (_, _, _, notarizeOnly, _, activeJob) =>
                {
                    Assert.IsTrue(notarizeOnly);
                    capturedJob = activeJob;
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false));
                },
                OnBuildSucceeded = () => { },
                Repaint = () => { },
                AppendOutput = (_, _) => { }
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsTrue(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
            Assert.AreSame(job, capturedJob);
            Assert.AreEqual("QueueNotarizeProfile", job.ProfileName);
        }

        [Test]
        public void ExecuteAsync_NotarizeOnlyJob_DetachedActive_ReturnsSuccessWithoutCallingOnBuildSucceeded()
        {
            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueDetachedNotarize", platform = "steam", os = "mac" };

            string assetPath = Path.Combine(TempFolder, "QueueDetachedNotarize.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
            var job = new BuildJobDefinition(profileGuid)
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunNotarizeMac = true
            };

            queueManager.TrackActiveJob(job);

            int buildSucceededCalls = 0;
            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Notarize macOS Build",
                ExecuteBuildOperation = (_, _, _, notarizeOnly, _, activeJob) =>
                {
                    Assert.IsTrue(notarizeOnly);
                    activeJob.ProcessId = 4242;
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, true));
                },
                OnBuildSucceeded = () => buildSucceededCalls++,
                Repaint = () => { },
                AppendOutput = (_, _) => { }
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsTrue(result.Success);
            Assert.IsTrue(result.DetachedOperationActive);
            Assert.AreEqual(0, buildSucceededCalls);
            Assert.AreEqual(4242, job.ProcessId);
        }

        [Test]
        public void ExecuteAsync_NotarizeOnlyJob_NonDetachedSuccess_DoesNotCallOnBuildSucceeded()
        {
            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueNotarizeSuccess", platform = "steam", os = "mac" };

            string assetPath = Path.Combine(TempFolder, "QueueNotarizeSuccess.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
            var job = new BuildJobDefinition(profileGuid)
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunNotarizeMac = true
            };

            queueManager.TrackActiveJob(job);

            int buildSucceededCalls = 0;
            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Notarize macOS Build",
                ExecuteBuildOperation = (_, _, _, notarizeOnly, _, _) =>
                {
                    Assert.IsTrue(notarizeOnly);
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false));
                },
                OnBuildSucceeded = () => buildSucceededCalls++,
                Repaint = () => { },
                AppendOutput = (_, _) => { }
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsTrue(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
            Assert.AreEqual(0, buildSucceededCalls);
        }

        [Test]
        public void ExecuteAsync_NotarizeOnlyJob_NonDetachedFailure_CapturesExitCodeInStatusDetail()
        {
            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueNotarizeFailure", platform = "steam", os = "mac" };

            string assetPath = Path.Combine(TempFolder, "QueueNotarizeFailure.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
            var job = new BuildJobDefinition(profileGuid)
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunNotarizeMac = true
            };

            queueManager.TrackActiveJob(job);

            string capturedOutput = "";
            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Notarize macOS Build",
                ExecuteBuildOperation = (_, _, _, notarizeOnly, _, _) =>
                {
                    Assert.IsTrue(notarizeOnly);
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(
                        false, // success
                        false, // detachedOperationActive
                        1,     // exitCode
                        "A required agreement is missing or has expired"));
                },
                OnBuildSucceeded = () => { },
                Repaint = () => { },
                AppendOutput = (line, _) => { capturedOutput += line + "\n"; }
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsFalse(result.Success);
            Assert.IsFalse(result.DetachedOperationActive);
            Assert.IsTrue(job.StatusDetail.StartsWith("Error Detected:"));
            Assert.IsTrue(capturedOutput.Contains("exit code 1"));
            Assert.IsTrue(capturedOutput.Contains("A required agreement is missing or has expired"));
        }

        [Test]
        public void ExecuteAsync_DetachedBuildWithoutPid_StillReturnsDetachedExecutionResult()
        {
            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueDetachedNoPid", platform = "steam", os = "windows" };

            string assetPath = Path.Combine(TempFolder, "QueueDetachedNoPid.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
            var job = new BuildJobDefinition(profileGuid)
            {
                JobGuid = Guid.NewGuid().ToString(),
                RunUnityBuild = true
            };

            queueManager.TrackActiveJob(job);

            var request = new BuildQueueJobExecutionService.Request
            {
                IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                GetJobOperationsSummary = _ => "Unity Build",
                ExecuteBuildOperation = (_, _, _, _, _, activeJob) =>
                {
                    activeJob.Status = BuildJobStatus.Building;
                    activeJob.StatusDetail = "Unity Build";
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, true));
                },
                OnBuildSucceeded = () => { },
                Repaint = () => { },
                AppendOutput = (_, _) => { }
            };

            BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

            Assert.IsTrue(result.Success);
            Assert.IsTrue(result.DetachedOperationActive);
            Assert.AreEqual(0, job.ProcessId, "This regression test covers detached handoff before PID persistence.");
            Assert.AreEqual(BuildJobStatus.Building, job.Status);
        }

        [Test]
        public void ExecuteAsync_SuccessWithInactiveCompletedWorkspace_DoesNotReportCancelled()
        {
            string tempRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", "queue-execution-success", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);

            string originalConfigPath = Environment.GetEnvironmentVariable("CADET_CONFIG_PATH", EnvironmentVariableTarget.Process);
            string configPath = Path.Combine(tempRoot, "config.json");
            Environment.SetEnvironmentVariable("CADET_CONFIG_PATH", configPath, EnvironmentVariableTarget.Process);

            var queueManager = new BuildQueueManager();
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile { profileName = "QueueCompletedWorkspace", platform = "steam", os = "windows" };

            string assetPath = Path.Combine(TempFolder, "QueueCompletedWorkspace.asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            try
            {
                CadetConfigService.Save(new CadetConfig { WorkspacesRoot = tempRoot, ProfilesRoot = tempRoot });
                WorkspaceManager workspaceManager = UnityBuildService.CreateWorkspaceManager(tempRoot);

                string profileGuid = AssetDatabase.AssetPathToGUID(assetPath);
                var job = new BuildJobDefinition(profileGuid)
                {
                    JobGuid = Guid.NewGuid().ToString(),
                    RunUnityBuild = true
                };

                queueManager.TrackActiveJob(job);

                var request = new BuildQueueJobExecutionService.Request
                {
                    IsTrackedJobActive = guid => queueManager.IsJobActive(guid),
                    GetJobOperationsSummary = _ => "Unity Build",
                    ExecuteBuildOperation = (_, _, _, _, _, activeJob) =>
                    {
                        workspaceManager.UpsertWorkspaceRecord(activeJob.JobGuid, activeJob.ProfileGuid, "profile.json", string.Empty, BuildJobStatus.Building, "QueueCompletedWorkspace");
                        workspaceManager.UpdateTrackedStatusSnapshot(
                            activeJob.JobGuid,
                            activeStatusDetail: "Unity Build",
                            completedOperationsSummary: "Unity Build",
                            terminalMessage: "Unity build completed successfully.",
                            exitCode: 0,
                            updatedAtUtc: DateTime.UtcNow);
                        workspaceManager.UpdateBuildStatus(activeJob.JobGuid, BuildJobStatus.Completed);
                        return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false));
                    },
                    OnBuildSucceeded = () => { },
                    Repaint = () => { },
                    AppendOutput = (_, _) => { }
                };

                BuildQueueJobExecutionService.ExecutionResult result = BuildQueueJobExecutionService.ExecuteAsync(request, job).GetAwaiter().GetResult();

                Assert.IsTrue(result.Success);
                Assert.IsFalse(result.DetachedOperationActive);
                Assert.AreNotEqual("Cancelled by user.", job.StatusDetail);
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
