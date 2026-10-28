using System;
using System.Collections.Generic;
using System.Linq;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.ViewModels
{
    public readonly struct BuildQueueJobListState
    {
        public BuildQueueJobListState(IReadOnlyList<BuildJobDefinition> visibleJobs, int totalJobs, bool isTruncated)
        {
            VisibleJobs = visibleJobs;
            TotalJobs = totalJobs;
            IsTruncated = isTruncated;
        }

        public IReadOnlyList<BuildJobDefinition> VisibleJobs { get; }
        public int TotalJobs { get; }
        public bool IsTruncated { get; }
    }

    public class BuildQueueJobListViewModel
    {
        public BuildQueueJobListState BuildState(IReadOnlyList<BuildJobDefinition> jobs, bool renderAllJobs, int maxRenderedJobs)
        {
            if (jobs == null || jobs.Count == 0)
            {
                return new BuildQueueJobListState(new List<BuildJobDefinition>(), 0, false);
            }

            int totalJobs = jobs.Count;
            bool isTruncated = !renderAllJobs && totalJobs > maxRenderedJobs;
            IEnumerable<BuildJobDefinition> sortedJobs = jobs.OrderByDescending(j => j.StartTime ?? DateTime.MinValue);
            IReadOnlyList<BuildJobDefinition> visibleJobs = isTruncated
                ? sortedJobs.Take(maxRenderedJobs).ToList()
                : sortedJobs.ToList();

            return new BuildQueueJobListState(visibleJobs, totalJobs, isTruncated);
        }
    }
}
