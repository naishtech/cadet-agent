using System;

namespace Covyne.CADET.Editor.Lite.ViewModels
{
    public class BuildQueueDisplayViewModel
    {
        public bool RenderAllJobs { get; private set; }
        public double NextActiveRepaintAt { get; private set; }

        public void Reset()
        {
            RenderAllJobs = false;
            NextActiveRepaintAt = 0d;
        }

        public bool ShouldRepaintActive(double now, bool hasActiveOperations, double intervalSeconds)
        {
            if (!hasActiveOperations)
            {
                return false;
            }

            if (now < NextActiveRepaintAt)
            {
                return false;
            }

            NextActiveRepaintAt = now + Math.Max(0d, intervalSeconds);
            return true;
        }

        public bool ShouldShowRenderToggle(int totalJobs, int maxRenderedJobs)
        {
            return totalJobs > maxRenderedJobs;
        }

        public string GetRenderModeLabel(int maxRenderedJobs)
        {
            return RenderAllJobs ? "all" : $"latest {maxRenderedJobs}";
        }

        public string GetToggleButtonLabel()
        {
            return RenderAllJobs ? "Show Latest" : "Show All";
        }

        public void ToggleRenderMode()
        {
            RenderAllJobs = !RenderAllJobs;
        }
    }
}
