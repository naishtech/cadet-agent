using System;
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using NUnit.Framework;
using UnityEngine;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class DetachedStatusManifestReaderTests
    {
        private string _testRoot;

        [SetUp]
        public void SetUp()
        {
            _testRoot = Path.Combine(Application.temporaryCachePath, "CADETTests", Guid.NewGuid().ToString());
            Directory.CreateDirectory(_testRoot);
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
        public void TryReadTrackedManifest_ValidIdentity_ReturnsManifest()
        {
            string manifestPath = Path.Combine(_testRoot, "job-1-launch-1-cadet.status.json");
            File.WriteAllText(manifestPath,
                "{" +
                "\"schemaVersion\":1," +
                "\"jobGuid\":\"job-1\"," +
                "\"launchToken\":\"launch-1\"," +
                "\"profileName\":\"Steam Public\"," +
                "\"startedAtUtc\":\"2026-03-22T18:15:30.0000000Z\"," +
                "\"updatedAtUtc\":\"2026-03-22T18:20:10.0000000Z\"," +
                "\"terminalAtUtc\":\"2026-03-22T18:20:12.0000000Z\"," +
                "\"overallStatus\":\"completed\"," +
                "\"currentOperation\":\"steam_publish\"," +
                "\"currentMessage\":\"Publishing Steam build\"," +
                "\"exitCode\":0," +
                "\"operations\":[{" +
                "\"id\":\"unity_build\",\"label\":\"Unity Build\",\"status\":\"completed\",\"message\":\"Artifacts ready\"}]," +
                "\"summary\":[\"Running: Publish Steam\",\"Completed: Unity Build\"]" +
                "}");

            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-1",
                ActiveStatusManifestPath = manifestPath,
                ActiveStatusLaunchToken = "launch-1"
            };

            bool success = DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out string errorMessage);

            Assert.IsTrue(success, errorMessage);
            Assert.IsNotNull(manifest);
            Assert.AreEqual("job-1", manifest.JobGuid);
            Assert.AreEqual(BuildJobStatus.Completed, DetachedStatusManifestReader.TryMapOverallStatus(manifest.OverallStatus));
            Assert.AreEqual("Running: Publish Steam | Completed: Unity Build", DetachedStatusManifestReader.BuildSummaryText(manifest));
        }

        [Test]
        public void TryReadTrackedManifest_MismatchedLaunchToken_FailsValidation()
        {
            string manifestPath = Path.Combine(_testRoot, "job-1-launch-1-cadet.status.json");
            File.WriteAllText(manifestPath,
                "{" +
                "\"schemaVersion\":1," +
                "\"jobGuid\":\"job-1\"," +
                "\"launchToken\":\"launch-2\"," +
                "\"overallStatus\":\"running\"," +
                "\"operations\":[]," +
                "\"summary\":[]" +
                "}");

            var workspace = new WorkspaceInfo
            {
                JobGuid = "job-1",
                ActiveStatusManifestPath = manifestPath,
                ActiveStatusLaunchToken = "launch-1"
            };

            bool success = DetachedStatusManifestReader.TryReadTrackedManifest(workspace, out DetachedStatusManifest manifest, out string errorMessage);

            Assert.IsFalse(success);
            Assert.IsNull(manifest);
            StringAssert.Contains("launch token", errorMessage);
        }
    }
}