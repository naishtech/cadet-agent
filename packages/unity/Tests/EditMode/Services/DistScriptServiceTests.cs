#if !CADET_LITE
using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class DistScriptServiceTests
    {
        [Test]
        public void Execute_MissingDistScript_ReturnsFailed()
        {
            // Use a temp directory that does NOT contain dist.sh
            string fakeProjectPath = Path.Combine(Path.GetTempPath(), "cadet_test_no_dist_sh");
            Directory.CreateDirectory(fakeProjectPath);
            string profileJsonPath = CreateTempProfileJson();

            BuildResult result = DistScriptService.Execute(
                projectPath: fakeProjectPath,
                profileJsonPath: profileJsonPath,
                buildOnly: true,
                publishOnly: false);

            Assert.IsFalse(result.Success);
            StringAssert.Contains("dist.sh not found", result.Output);

            File.Delete(profileJsonPath);
        }

        [Test]
        public void Execute_MissingDistScript_ExitCodeIsMinusOne()
        {
            string fakeProjectPath = Path.Combine(Path.GetTempPath(), "cadet_test_no_dist_sh_exit");
            Directory.CreateDirectory(fakeProjectPath);
            string profileJsonPath = CreateTempProfileJson();

            BuildResult result = DistScriptService.Execute(
                projectPath: fakeProjectPath,
                profileJsonPath: profileJsonPath,
                buildOnly: false,
                publishOnly: true);

            Assert.AreEqual(-1, result.ExitCode);

            File.Delete(profileJsonPath);
        }

        [Test]
        public void Execute_MissingDistScript_WithActiveJob_DoesNotMutateProcessId()
        {
            string fakeProjectPath = Path.Combine(Path.GetTempPath(), "cadet_test_no_dist_sh_active_job");
            Directory.CreateDirectory(fakeProjectPath);
            string profileJsonPath = CreateTempProfileJson();
            var activeJob = new BuildJobDefinition("profile-guid")
            {
                JobGuid = System.Guid.NewGuid().ToString()
            };

            BuildResult result = DistScriptService.Execute(
                projectPath: fakeProjectPath,
                profileJsonPath: profileJsonPath,
                buildOnly: false,
                publishOnly: false,
                activeJob: activeJob);

            Assert.IsFalse(result.Success);
            Assert.AreEqual(0, activeJob.ProcessId);

            File.Delete(profileJsonPath);
        }

        private static string CreateTempProfileJson()
        {
            string profileJsonPath = Path.Combine(Path.GetTempPath(), $"cadet_profile_{System.Guid.NewGuid()}.json");
            File.WriteAllText(profileJsonPath, "{}");
            return profileJsonPath;
        }
    }
}
#endif
