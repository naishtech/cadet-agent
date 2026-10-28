using NUnit.Framework;
using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;

namespace Covyne.CADET.Editor.Tests.Services
{
    [TestFixture]
    public class IterationAnalyticsServiceTests
    {
        private IterationAnalyticsService _service;

        [SetUp]
        public void SetUp()
        {
            _service = new IterationAnalyticsService();
        }

        // ------------------------------------------------------------------
        // Helpers
        // ------------------------------------------------------------------

        private static BuildJobDefinition MakeFinishedJob(BuildJobStatus status, DateTime completionUtc, TimeSpan duration)
        {
            var job = new BuildJobDefinition("profile-test");
            job.StartTime = completionUtc - duration;
            job.CompletionTime = completionUtc;
            job.Status = status;
            return job;
        }

        private static BuildJobDefinition MakeRunningJob(DateTime startUtc)
        {
            var job = new BuildJobDefinition("profile-test");
            job.StartTime = startUtc;
            // CompletionTime intentionally left null — job is still running
            job.Status = BuildJobStatus.Building;
            return job;
        }

        // ------------------------------------------------------------------
        // Session detection
        // ------------------------------------------------------------------

        [Test]
        public void IsActiveSession_False_WhenFewerThanThresholdBuildsInWindow()
        {
            DateTime now = DateTime.UtcNow;
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(5), TimeSpan.FromSeconds(60)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromSeconds(60)),
                // Only 2 builds — below threshold of 3
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.IsFalse(result.IsActiveSession);
            Assert.AreEqual(2, result.SessionBuildCount);
        }

        [Test]
        public void IsActiveSession_True_WhenThresholdOrMoreBuildsInWindow()
        {
            DateTime now = DateTime.UtcNow;
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(5), TimeSpan.FromSeconds(60)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromSeconds(60)),
                MakeFinishedJob(BuildJobStatus.Failed,    now - TimeSpan.FromMinutes(15), TimeSpan.FromSeconds(45)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.IsTrue(result.IsActiveSession);
            Assert.AreEqual(3, result.SessionBuildCount);
        }

        [Test]
        public void IsActiveSession_False_WhenBuildsSpreadBeyondWindow()
        {
            DateTime now = DateTime.UtcNow;
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(5),  TimeSpan.FromSeconds(60)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromSeconds(60)),
                // Third build is outside the 30-min window
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(35), TimeSpan.FromSeconds(60)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            // Only 2 of 3 are in the window → not an active session
            Assert.IsFalse(result.IsActiveSession);
            Assert.AreEqual(2, result.SessionBuildCount);
        }

        [Test]
        public void CancelledJobs_NotCountedTowardSession()
        {
            DateTime now = DateTime.UtcNow;
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed,  now - TimeSpan.FromMinutes(5),  TimeSpan.FromSeconds(60)),
                MakeFinishedJob(BuildJobStatus.Cancelled,  now - TimeSpan.FromMinutes(8),  TimeSpan.FromSeconds(10)),
                MakeFinishedJob(BuildJobStatus.Cancelled,  now - TimeSpan.FromMinutes(11), TimeSpan.FromSeconds(10)),
                // 2 cancelled + 1 completed; only the completed counts
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.IsFalse(result.IsActiveSession);
            Assert.AreEqual(1, result.SessionBuildCount);
        }

        // ------------------------------------------------------------------
        // TotalWaitTimeToday
        // ------------------------------------------------------------------

        [Test]
        public void TotalWaitTimeToday_SumsOnlyFinishedJobsToday()
        {
            DateTime todayUtc = DateTime.Today.ToUniversalTime().AddHours(9); // 09:00 local today in UTC
            var duration1 = TimeSpan.FromMinutes(2);
            var duration2 = TimeSpan.FromMinutes(3);

            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc,                duration1),
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc + TimeSpan.FromMinutes(5), duration2),
                // Yesterday's job — should not count
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc - TimeSpan.FromDays(1), TimeSpan.FromMinutes(99)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.AreEqual(duration1 + duration2, result.TotalWaitTimeToday);
        }

        [Test]
        public void TotalWaitTimeToday_ExcludesInProgressBuilds()
        {
            DateTime todayUtc = DateTime.Today.ToUniversalTime().AddHours(10);
            var finishedDuration = TimeSpan.FromMinutes(2);

            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc, finishedDuration),
                MakeRunningJob(todayUtc + TimeSpan.FromMinutes(5)), // still running
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.AreEqual(finishedDuration, result.TotalWaitTimeToday);
        }

        // ------------------------------------------------------------------
        // BuildsToday
        // ------------------------------------------------------------------

        [Test]
        public void BuildsToday_CountsOnlyJobsStartedToday()
        {
            DateTime todayUtc    = DateTime.Today.ToUniversalTime().AddHours(9);
            DateTime yesterdayUtc = todayUtc - TimeSpan.FromDays(1);

            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc,     TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc + TimeSpan.FromHours(1), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, yesterdayUtc, TimeSpan.FromMinutes(1)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.AreEqual(2, result.BuildsToday);
        }

        [Test]
        public void BuildsToday_IncludesAllStatusesToday_NotJustFinished()
        {
            DateTime todayUtc = DateTime.Today.ToUniversalTime().AddHours(10);

            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc, TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Failed,    todayUtc + TimeSpan.FromHours(1), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Cancelled, todayUtc + TimeSpan.FromHours(2), TimeSpan.FromSeconds(10)),
                MakeRunningJob(todayUtc + TimeSpan.FromHours(3)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.AreEqual(4, result.BuildsToday);
        }

        // ------------------------------------------------------------------
        // AverageBuildDuration
        // ------------------------------------------------------------------

        [Test]
        public void AverageBuildDuration_AveragesTodaysFinishedJobs()
        {
            DateTime todayUtc = DateTime.Today.ToUniversalTime().AddHours(9);
            var d1 = TimeSpan.FromMinutes(2);
            var d2 = TimeSpan.FromMinutes(4);
            TimeSpan expected = TimeSpan.FromTicks((d1.Ticks + d2.Ticks) / 2);

            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc, d1),
                MakeFinishedJob(BuildJobStatus.Completed, todayUtc + TimeSpan.FromMinutes(5), d2),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.AreEqual(expected, result.AverageBuildDuration);
        }

        [Test]
        public void AverageBuildDuration_ReturnsZero_WhenNoFinishedJobs()
        {
            var jobs = new List<BuildJobDefinition>
            {
                MakeRunningJob(DateTime.UtcNow - TimeSpan.FromMinutes(5)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.AreEqual(TimeSpan.Zero, result.AverageBuildDuration);
        }

        // ------------------------------------------------------------------
        // Edge cases
        // ------------------------------------------------------------------

        [Test]
        public void ComputeInsights_ReturnsDefaults_WhenJobListIsNull()
        {
            IterationInsights result = _service.ComputeInsights(null);

            Assert.AreEqual(0, result.BuildsToday);
            Assert.AreEqual(TimeSpan.Zero, result.TotalWaitTimeToday);
            Assert.AreEqual(TimeSpan.Zero, result.AverageBuildDuration);
            Assert.IsFalse(result.IsActiveSession);
            Assert.AreEqual(0, result.SessionBuildCount);
        }

        [Test]
        public void ComputeInsights_ReturnsDefaults_WhenJobListIsEmpty()
        {
            IterationInsights result = _service.ComputeInsights(new List<BuildJobDefinition>());

            Assert.AreEqual(0, result.BuildsToday);
            Assert.IsFalse(result.IsActiveSession);
        }

        [Test]
        public void ComputeInsights_SkipsJobsWithNullStartTime()
        {
            var job = new BuildJobDefinition("profile-test");
            // StartTime intentionally not set
            job.Status = BuildJobStatus.Completed;

            IterationInsights result = _service.ComputeInsights(new List<BuildJobDefinition> { job });

            Assert.AreEqual(0, result.BuildsToday);
        }

        // ------------------------------------------------------------------
        // Cooldown
        // ------------------------------------------------------------------

        [Test]
        public void IsInCooldown_False_WhenFewerThanThreeSessionBuilds()
        {
            DateTime now = DateTime.UtcNow;
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(5),  TimeSpan.FromMinutes(1)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.IsFalse(result.IsInCooldown);
        }

        [Test]
        public void IsInCooldown_True_AfterThreeSessionBuilds_WithinCooldownWindow()
        {
            DateTime now = DateTime.UtcNow;
            // Third build completed 10 seconds ago — still within 30s cooldown
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(20), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromSeconds(10), TimeSpan.FromMinutes(1)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.IsTrue(result.IsInCooldown);
            Assert.Greater(result.CooldownEndsAt, now);
        }

        [Test]
        public void IsInCooldown_False_AfterCooldownWindowExpires()
        {
            DateTime now = DateTime.UtcNow;
            // Third build completed 40 seconds ago — beyond the 30s cooldown
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(20), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromSeconds(40), TimeSpan.FromMinutes(1)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.IsFalse(result.IsInCooldown);
        }

        [Test]
        public void CooldownDuration_DoublesOnSecondTrigger()
        {
            DateTime now = DateTime.UtcNow;
            // 6 session builds => triggerCount = 2 => cooldown = base * 2
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(25), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(20), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(5),  TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromSeconds(50), TimeSpan.FromMinutes(1)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            int expectedSeconds = IterationAnalyticsService.BaseCooldownSeconds * 2;
            Assert.IsTrue(result.IsInCooldown, $"{expectedSeconds}s cooldown should still be active 50s after 6th build");
            TimeSpan expectedDuration = TimeSpan.FromSeconds(expectedSeconds);
            DateTime expectedEndsAt = (now - TimeSpan.FromSeconds(50)) + expectedDuration;
            Assert.AreEqual(expectedEndsAt.ToString("O"), result.CooldownEndsAt.ToString("O"));
        }

        [Test]
        public void CooldownDuration_FirstTrigger_IsBaseCooldownSeconds()
        {
            DateTime now = DateTime.UtcNow;
            DateTime triggerTime = now - TimeSpan.FromSeconds(5);
            var jobs = new List<BuildJobDefinition>
            {
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(20), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, now - TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(1)),
                MakeFinishedJob(BuildJobStatus.Completed, triggerTime,                    TimeSpan.FromMinutes(1)),
            };

            IterationInsights result = _service.ComputeInsights(jobs);

            Assert.IsTrue(result.IsInCooldown);
            DateTime expectedEndsAt = triggerTime + TimeSpan.FromSeconds(IterationAnalyticsService.BaseCooldownSeconds);
            Assert.AreEqual(expectedEndsAt.ToString("O"), result.CooldownEndsAt.ToString("O"));
        }
    }
}
