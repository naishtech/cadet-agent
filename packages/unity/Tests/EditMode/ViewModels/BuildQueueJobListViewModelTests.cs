using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.ViewModels;
using NUnit.Framework;

namespace Covyne.CADET.Editor.Tests.ViewModels
{
    [TestFixture]
    public class BuildQueueJobListViewModelTests
    {
        [Test]
        public void BuildState_RenderLatestMode_TruncatesToMax()
        {
            var vm = new BuildQueueJobListViewModel();
            var jobs = new List<BuildJobDefinition>();
            for (int i = 0; i < 5; i++)
            {
                jobs.Add(new BuildJobDefinition("profile") { JobGuid = $"job-{i}" });
            }

            BuildQueueJobListState state = vm.BuildState(jobs, false, 3);

            Assert.AreEqual(5, state.TotalJobs);
            Assert.IsTrue(state.IsTruncated);
            Assert.AreEqual(3, state.VisibleJobs.Count);
        }

        [Test]
        public void BuildState_RenderAllMode_ReturnsAllJobs()
        {
            var vm = new BuildQueueJobListViewModel();
            var jobs = new List<BuildJobDefinition>
            {
                new BuildJobDefinition("profile") { JobGuid = "job-1" },
                new BuildJobDefinition("profile") { JobGuid = "job-2" }
            };

            BuildQueueJobListState state = vm.BuildState(jobs, true, 1);

            Assert.AreEqual(2, state.TotalJobs);
            Assert.IsFalse(state.IsTruncated);
            Assert.AreEqual(2, state.VisibleJobs.Count);
        }
    }
}
