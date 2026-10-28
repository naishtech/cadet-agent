using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public readonly struct IterationInsights
    {
        public int BuildsToday { get; }
        public TimeSpan TotalWaitTimeToday { get; }
        public TimeSpan AverageBuildDuration { get; }
        public bool IsActiveSession { get; }
        public int SessionBuildCount { get; }
        public bool IsInCooldown { get; }
        public DateTime CooldownEndsAt { get; }

        public IterationInsights(
            int buildsToday,
            TimeSpan totalWaitTimeToday,
            TimeSpan averageBuildDuration,
            bool isActiveSession,
            int sessionBuildCount,
            bool isInCooldown = false,
            DateTime cooldownEndsAt = default)
        {
            BuildsToday = buildsToday;
            TotalWaitTimeToday = totalWaitTimeToday;
            AverageBuildDuration = averageBuildDuration;
            IsActiveSession = isActiveSession;
            SessionBuildCount = sessionBuildCount;
            IsInCooldown = isInCooldown;
            CooldownEndsAt = cooldownEndsAt;
        }
    }

    public class IterationAnalyticsService
    {
        public const int SessionWindowMinutes = 30;
        public const int SessionThreshold = 3;
        public const int CooldownEveryNBuilds = 3;
        public const int BaseCooldownSeconds = 300;

        public IterationInsights ComputeInsights(IReadOnlyList<BuildJobDefinition> jobs)
        {
            if (jobs == null || jobs.Count == 0)
                return new IterationInsights(0, TimeSpan.Zero, TimeSpan.Zero, false, 0);

            DateTime nowUtc = DateTime.UtcNow;
            DateTime sessionWindowStart = nowUtc - TimeSpan.FromMinutes(SessionWindowMinutes);
            DateTime todayLocal = DateTime.Today;

            int buildsToday = 0;
            TimeSpan totalWaitToday = TimeSpan.Zero;
            int finishedTodayCount = 0;
            var sessionBuilds = new List<DateTime>(); // CompletionTimes of finished session builds

            foreach (BuildJobDefinition job in jobs)
            {
                if (job == null || !job.StartTime.HasValue)
                    continue;

                bool isToday = job.StartTime.Value.ToLocalTime().Date == todayLocal;
                bool isFinished = job.CompletionTime.HasValue;
                bool isFinishedStatus = job.Status == BuildJobStatus.Completed || job.Status == BuildJobStatus.Failed;

                if (isToday)
                    buildsToday++;

                if (isToday && isFinished && isFinishedStatus)
                {
                    totalWaitToday += job.CompletionTime.Value - job.StartTime.Value;
                    finishedTodayCount++;
                }

                // Session: Completed/Failed jobs whose CompletionTime falls within the rolling window.
                // Cancelled jobs are excluded — abandoned builds are not iteration work.
                if (isFinishedStatus && isFinished && job.CompletionTime.Value >= sessionWindowStart)
                    sessionBuilds.Add(job.CompletionTime.Value);
            }

            int sessionCount = sessionBuilds.Count;
            TimeSpan avgDuration = finishedTodayCount > 0
                ? TimeSpan.FromTicks(totalWaitToday.Ticks / finishedTodayCount)
                : TimeSpan.Zero;

            // Cooldown: every CooldownEveryNBuilds completed session builds, impose a wait.
            // Duration doubles each successive cooldown within the session: 5m, 10m, 20m, ...
            bool isInCooldown = false;
            DateTime cooldownEndsAt = default;
            int triggerCount = sessionCount / CooldownEveryNBuilds;
            if (triggerCount > 0)
            {
                sessionBuilds.Sort();
                int triggerIndex = triggerCount * CooldownEveryNBuilds - 1; // 0-based index of trigger build
                DateTime triggerTime = sessionBuilds[triggerIndex];
                int shiftCapped = Math.Min(triggerCount - 1, 10); // cap exponent to avoid overflow
                int cooldownSeconds = BaseCooldownSeconds * (1 << shiftCapped);
                cooldownEndsAt = triggerTime + TimeSpan.FromSeconds(cooldownSeconds);
                isInCooldown = nowUtc < cooldownEndsAt;
            }

            return new IterationInsights(
                buildsToday,
                totalWaitToday,
                avgDuration,
                isActiveSession: sessionCount >= SessionThreshold,
                sessionBuildCount: sessionCount,
                isInCooldown: isInCooldown,
                cooldownEndsAt: cooldownEndsAt);
        }
    }
}
