using NUnit.Framework;
using System;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class BuildExecutionPlannerTests
    {
        private sealed class FakeProfileJsonAdapter : IProfileJsonAdapter
        {
            public BuildProfile LastProfile;
            public string LastCleanupPath;
            public string TempPathToReturn = "C:/temp/cadet/test-profile.json";

            public string CreateTemporaryJsonFile(BuildProfile profile)
            {
                LastProfile = profile;
                return TempPathToReturn;
            }

            public void CleanupTemporaryFile(string filePath)
            {
                LastCleanupPath = filePath;
            }
        }

#if !CADET_LITE
        [Test]
        public void PrepareCicdExecution_DirectorySync_UsesWorkspacePathAndNoGitFlag()
        {
            var adapter = new FakeProfileJsonAdapter();
            var planner = new BuildExecutionPlanner(adapter);

            var profile = new BuildProfile();
            profile.useGit = false;
            profile.unity.projectPath = "F:/source/project";

            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = "F:/CADET/workspaces/job-1"
            };

            var request = planner.PrepareCicdExecution(job, profile, "F:/scripts/dist.sh");

            Assert.AreEqual(adapter.TempPathToReturn, request.ProfileJsonPath);
            Assert.AreEqual("F:/scripts/dist.sh", request.ScriptPath);
            Assert.IsFalse(request.UseGitSyncFlag);
            StringAssert.DoesNotContain("--git-sync", request.Arguments);
            StringAssert.Contains("--profile-json", request.Arguments);
            Assert.AreEqual("F:/CADET/workspaces/job-1", adapter.LastProfile.unity.projectPath);
            Assert.AreEqual("F:/source/project", profile.unity.projectPath, "Original profile must not be mutated");
        }

        [Test]
        public void PrepareCicdExecution_GitSync_UsesProfileProjectPathAndAddsGitFlag()
        {
            var adapter = new FakeProfileJsonAdapter();
            var planner = new BuildExecutionPlanner(adapter);

            var profile = new BuildProfile();
            profile.useGit = true;
            profile.unity.projectPath = "F:/source/project";

            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = null
            };

            var request = planner.PrepareCicdExecution(job, profile, "F:/scripts/dist.sh");

            Assert.IsTrue(request.UseGitSyncFlag);
            StringAssert.Contains("--git-sync", request.Arguments);
            Assert.AreEqual("F:/source/project", adapter.LastProfile.unity.projectPath);
        }

        [Test]
        public void PrepareCicdExecution_DirectorySyncWithoutWorkspace_Throws()
        {
            var adapter = new FakeProfileJsonAdapter();
            var planner = new BuildExecutionPlanner(adapter);

            var profile = new BuildProfile();
            profile.useGit = false;

            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = null
            };

            Assert.Throws<InvalidOperationException>(() =>
                planner.PrepareCicdExecution(job, profile, "F:/scripts/dist.sh"));
        }

        [Test]
        public void CleanupExecution_CallsProfileJsonCleanup()
        {
            var adapter = new FakeProfileJsonAdapter();
            var planner = new BuildExecutionPlanner(adapter);

            var request = new CicdExecutionRequest
            {
                ProfileJsonPath = "F:/temp/test.json"
            };

            planner.CleanupExecution(request);

            Assert.AreEqual("F:/temp/test.json", adapter.LastCleanupPath);
        }

        [Test]
        public void PrepareCicdExecution_NullInputs_ThrowArgumentNull()
        {
            var adapter = new FakeProfileJsonAdapter();
            var planner = new BuildExecutionPlanner(adapter);
            var profile = new BuildProfile();
            var job = new BuildJobDefinition("profile-guid");

            Assert.Throws<ArgumentNullException>(() => planner.PrepareCicdExecution(null, profile, "F:/scripts/dist.sh"));
            Assert.Throws<ArgumentNullException>(() => planner.PrepareCicdExecution(job, null, "F:/scripts/dist.sh"));
            Assert.Throws<ArgumentException>(() => planner.PrepareCicdExecution(job, profile, ""));
        }
#endif

        [Test]
        public void PrepareLocalExecution_UsesBatchModeAndExecuteMethod()
        {
            var planner = new BuildExecutionPlanner();
            var profile = new BuildProfile();
            profile.unity.editorPath = "F:/Unity/Editor/Unity.exe";
            profile.unity.projectPath = "F:/source/project";

            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = "F:/CADET/workspaces/job-local"
            };

            var request = planner.PrepareLocalExecution(job, profile, "Covyne.CADET.Editor.Lite.Build.LocalBuildEntryPoint.Execute");

            Assert.AreEqual("F:/Unity/Editor/Unity.exe", request.UnityEditorPath);
            Assert.AreEqual("F:/CADET/workspaces/job-local", request.ProjectPath);
            StringAssert.Contains("-batchmode", request.Arguments);
            StringAssert.Contains("-quit", request.Arguments);
            StringAssert.Contains("-projectPath", request.Arguments);
            StringAssert.Contains("-executeMethod Covyne.CADET.Editor.Lite.Build.LocalBuildEntryPoint.Execute", request.Arguments);
        }

        [Test]
        public void PrepareLocalExecution_WithoutWorkspace_Throws()
        {
            var planner = new BuildExecutionPlanner();
            var profile = new BuildProfile();
            profile.unity.editorPath = "F:/Unity/Editor/Unity.exe";
            profile.unity.projectPath = "F:/source/project";

            var job = new BuildJobDefinition("profile-guid")
            {
                WorkspacePath = null
            };

            Assert.Throws<InvalidOperationException>(() =>
                planner.PrepareLocalExecution(job, profile, "Covyne.CADET.Editor.Lite.Build.LocalBuildEntryPoint.Execute"));
        }

        [Test]
        public void PrepareLocalExecution_InvalidInputs_Throw()
        {
            var planner = new BuildExecutionPlanner();
            var profile = new BuildProfile();
            var job = new BuildJobDefinition("profile-guid");

            Assert.Throws<ArgumentNullException>(() => planner.PrepareLocalExecution(null, profile, "Method"));
            Assert.Throws<ArgumentNullException>(() => planner.PrepareLocalExecution(job, null, "Method"));
            Assert.Throws<ArgumentException>(() => planner.PrepareLocalExecution(job, profile, ""));

            profile.unity.editorPath = "";
            profile.unity.projectPath = "F:/source/project";
            Assert.Throws<InvalidOperationException>(() => planner.PrepareLocalExecution(job, profile, "Method"));

            profile.unity.editorPath = "F:/Unity/Editor/Unity.exe";
            profile.unity.projectPath = "";
            job.WorkspacePath = null;
            Assert.Throws<InvalidOperationException>(() => planner.PrepareLocalExecution(job, profile, "Method"));
        }
    }
}
