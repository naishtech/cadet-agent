using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildExecutionSequenceServiceTests
    {
        private const string TempFolder = "Assets/Tests/Temp/ExecuteSequence";

        [SetUp]
        public void SetUp()
        {
            if (!AssetDatabase.IsValidFolder("Assets/Tests/Temp"))
            {
                AssetDatabase.CreateFolder("Assets/Tests", "Temp");
            }

            if (!AssetDatabase.IsValidFolder(TempFolder))
            {
                AssetDatabase.CreateFolder("Assets/Tests/Temp", "ExecuteSequence");
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
        public void ExecuteAsync_NoProfile_ReturnsNoProfile()
        {
            var result = BuildExecutionSequenceService.ExecuteAsync(new BuildExecutionSequenceService.Request
            {
                SelectedProfileAsset = null,
                IsBuildInProgressForProfile = _ => false,
                ExecuteBuildOperation = (_, _, _, _, _, _, _) => Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false)),
                OnBuildSucceeded = () => { },
                StopProgress = () => { },
                AppendOutput = (_, _) => { }
            }).GetAwaiter().GetResult();

            Assert.AreEqual(BuildExecutionSequenceService.ExecuteResultCode.NoProfile, result.Code);
        }

        [Test]
        public void ExecuteAsync_BuildInProgress_ReturnsBuildInProgress()
        {
            BuildProfileAsset profileAsset = CreateProfileAsset("BusyProfile");

            var result = BuildExecutionSequenceService.ExecuteAsync(new BuildExecutionSequenceService.Request
            {
                SelectedProfileAsset = profileAsset,
                IsBuildInProgressForProfile = _ => true,
                ExecuteBuildOperation = (_, _, _, _, _, _, _) => Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false)),
                OnBuildSucceeded = () => { },
                StopProgress = () => { },
                AppendOutput = (_, _) => { }
            }).GetAwaiter().GetResult();

            Assert.AreEqual(BuildExecutionSequenceService.ExecuteResultCode.BuildInProgress, result.Code);
            Assert.AreEqual("BusyProfile", result.ProfileName);
        }

        [Test]
        public void ExecuteAsync_PublishEpicMissingConfig_ReturnsEpicConfigMissing()
        {
            BuildProfileAsset profileAsset = CreateProfileAsset("EpicProfile");
            profileAsset.Profile.epic.buildPatchToolPath = string.Empty;

            var logs = new List<string>();
            var result = BuildExecutionSequenceService.ExecuteAsync(new BuildExecutionSequenceService.Request
            {
                SelectedProfileAsset = profileAsset,
                RunPublishEpic = true,
                IsBuildInProgressForProfile = _ => false,
                ExecuteBuildOperation = (_, _, _, _, _, _, _) => Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false)),
                OnBuildSucceeded = () => { },
                StopProgress = () => { },
                AppendOutput = (line, _) => logs.Add(line)
            }).GetAwaiter().GetResult();

            Assert.AreEqual(BuildExecutionSequenceService.ExecuteResultCode.EpicConfigMissing, result.Code);
            Assert.IsTrue(logs.Exists(l => l.Contains("Cannot publish to Epic", StringComparison.OrdinalIgnoreCase)));
        }

        [Test]
        public void ExecuteAsync_SelectedOperations_UsesCombinedDistPlan_AndReturnSuccess()
        {
            BuildProfileAsset profileAsset = CreateProfileAsset("SequenceProfile");
            profileAsset.Profile.epic.buildPatchToolPath = "F:/BPT";

            var order = new List<string>();
            int buildSuccessRefreshCount = 0;

            var result = BuildExecutionSequenceService.ExecuteAsync(new BuildExecutionSequenceService.Request
            {
                SelectedProfileAsset = profileAsset,
                RunUnityBuild = true,
                RunNotarizeMac = true,
                RunPublishSteam = true,
                IsBuildInProgressForProfile = _ => false,
                ExecuteBuildOperation = (_, buildOnly, publishOnly, notarizeOnly, platform, _, _) =>
                {
                    if (!buildOnly && !publishOnly && !notarizeOnly && platform == "steam")
                    {
                        order.Add("combined-steam");
                    }
                    else
                    {
                        order.Add("unexpected");
                    }
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false));
                },
                OnBuildSucceeded = () => buildSuccessRefreshCount++,
                StopProgress = () => { },
                AppendOutput = (_, _) => { }
            }).GetAwaiter().GetResult();

            Assert.AreEqual(BuildExecutionSequenceService.ExecuteResultCode.Success, result.Code);
            Assert.AreEqual(1, buildSuccessRefreshCount);
            CollectionAssert.AreEqual(new[] { "combined-steam" }, order);
        }

        [Test]
        public void ExecuteAsync_UnityBuildAndSteamPublish_UsesSingleBuildAndPublishInvocation()
        {
            BuildProfileAsset profileAsset = CreateProfileAsset("CombinedSequenceProfile");

            int executeCallCount = 0;
            bool? buildOnlyArg = null;
            bool? publishOnlyArg = null;
            string platformArg = null;

            var result = BuildExecutionSequenceService.ExecuteAsync(new BuildExecutionSequenceService.Request
            {
                SelectedProfileAsset = profileAsset,
                RunUnityBuild = true,
                RunPublishSteam = true,
                IsBuildInProgressForProfile = _ => false,
                ExecuteBuildOperation = (_, buildOnly, publishOnly, notarizeOnly, platform, _, _) =>
                {
                    executeCallCount++;
                    buildOnlyArg = buildOnly;
                    publishOnlyArg = publishOnly;
                    Assert.IsFalse(notarizeOnly);
                    platformArg = platform;
                    return Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, false));
                },
                OnBuildSucceeded = () => { },
                StopProgress = () => { },
                AppendOutput = (_, _) => { }
            }).GetAwaiter().GetResult();

            Assert.AreEqual(BuildExecutionSequenceService.ExecuteResultCode.Success, result.Code);
            Assert.AreEqual(1, executeCallCount);
            Assert.AreEqual(false, buildOnlyArg);
            Assert.AreEqual(false, publishOnlyArg);
            Assert.AreEqual("steam", platformArg);
        }

        [Test]
        public void ExecuteAsync_DetachedBuild_ReturnsDetachedOperationStarted()
        {
            BuildProfileAsset profileAsset = CreateProfileAsset("DetachedSequenceProfile");

            var result = BuildExecutionSequenceService.ExecuteAsync(new BuildExecutionSequenceService.Request
            {
                SelectedProfileAsset = profileAsset,
                RunUnityBuild = true,
                IsBuildInProgressForProfile = _ => false,
                ExecuteBuildOperation = (_, _, _, _, _, _, _) =>
                    Task.FromResult(new BuildOperationExecutionService.ExecutionResult(true, true)),
                OnBuildSucceeded = () => { },
                StopProgress = () => { },
                AppendOutput = (_, _) => { }
            }).GetAwaiter().GetResult();

            Assert.AreEqual(BuildExecutionSequenceService.ExecuteResultCode.DetachedOperationStarted, result.Code);
        }

        private static BuildProfileAsset CreateProfileAsset(string profileName)
        {
            var profileAsset = ScriptableObject.CreateInstance<BuildProfileAsset>();
            profileAsset.Profile = new BuildProfile
            {
                profileName = profileName,
                platform = "steam",
                os = "windows"
            };

            string assetPath = Path.Combine(TempFolder, profileName + ".asset").Replace("\\", "/");
            AssetDatabase.CreateAsset(profileAsset, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            return profileAsset;
        }
    }
}
