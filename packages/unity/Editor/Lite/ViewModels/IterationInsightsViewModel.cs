using System;
using System.Collections.Generic;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;
using UnityEditor;

namespace Covyne.CADET.Editor.Lite.ViewModels
{
    public class IterationInsightsViewModel
    {
        // EditorPrefs key — persists the cooldown end time across log clears.
        private const string CooldownEndsAtPrefKey = "CADET.Lite.CooldownEndsAtTicks";

        private readonly IterationAnalyticsService _service = new IterationAnalyticsService();
        private IterationInsights _insights;

        public bool IsActiveSession => _insights.IsActiveSession;
        public int BuildsToday => _insights.BuildsToday;
        public int SessionBuildCount => _insights.SessionBuildCount;
        public string FormattedWaitTime => FormatTimeSpan(_insights.TotalWaitTimeToday);
        public string FormattedAvgDuration => FormatTimeSpan(_insights.AverageBuildDuration);

        public bool IsInCooldown
        {
            get
            {
                if (_insights.IsInCooldown) return true;
                // Also check the persisted end-time so deleting build logs can't bypass the cooldown.
                return DateTime.UtcNow < GetPersistedCooldownEndsAt();
            }
        }

        public string FormattedCooldownRemaining
        {
            get
            {
                DateTime endsAt = _insights.IsInCooldown
                    ? _insights.CooldownEndsAt
                    : GetPersistedCooldownEndsAt();
                TimeSpan remaining = endsAt - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero) return string.Empty;
                return $"{Math.Ceiling(remaining.TotalSeconds):0}s";
            }
        }

        public void Refresh(IReadOnlyList<BuildJobDefinition> jobs)
        {
            _insights = _service.ComputeInsights(jobs);

            // Persist the latest cooldown end-time so it survives build-log clears.
            if (_insights.IsInCooldown)
            {
                DateTime persisted = GetPersistedCooldownEndsAt();
                if (_insights.CooldownEndsAt > persisted)
                    EditorPrefs.SetString(CooldownEndsAtPrefKey, _insights.CooldownEndsAt.Ticks.ToString());
            }
        }

        private static DateTime GetPersistedCooldownEndsAt()
        {
            string raw = EditorPrefs.GetString(CooldownEndsAtPrefKey, "0");
            if (long.TryParse(raw, out long ticks) && ticks > 0)
                return new DateTime(ticks, DateTimeKind.Utc);
            return DateTime.MinValue;
        }

        private static string FormatTimeSpan(TimeSpan ts)
        {
            if (ts.TotalSeconds < 1)
                return "0s";
            if (ts.TotalMinutes < 1)
                return $"{(int)ts.TotalSeconds}s";
            if (ts.TotalHours < 1)
                return $"{(int)ts.TotalMinutes}m {ts.Seconds:D2}s";
            return $"{(int)ts.TotalHours}h {ts.Minutes:D2}m";
        }
    }
}
