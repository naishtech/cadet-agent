using System;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Collapses compatible UI selections into a single dist-script invocation.
    /// </summary>
    public static class DistExecutionPlanService
    {
        public sealed class Plan
        {
            public bool BuildOnly { get; set; }
            public bool PublishOnly { get; set; }
            public bool NotarizeOnly { get; set; }
            public string Platform { get; set; }
            public string StatusText { get; set; }
            public string LogText { get; set; }
        }

        public static bool TryCreatePlan(bool runUnityBuild, bool runNotarizeMac, bool runPublishSteam, bool runPublishEpic, out Plan plan)
        {
            plan = null;

            bool hasPublish = runPublishSteam || runPublishEpic;
            bool notarizeOnly = runNotarizeMac && !runUnityBuild && !hasPublish;
            if (!runUnityBuild && !hasPublish && !runNotarizeMac)
            {
                return false;
            }

            string platform = null;
            if (runPublishSteam && runPublishEpic)
            {
                platform = "both";
            }
            else if (runPublishSteam)
            {
                platform = "steam";
            }
            else if (runPublishEpic)
            {
                platform = "epic";
            }

            bool buildOnly = runUnityBuild && !hasPublish;
            bool publishOnly = !runUnityBuild && hasPublish;

            string statusText;
            string logText;
            if (notarizeOnly)
            {
                statusText = "Running macOS Notarization...";
                logText = "Starting Notarize macOS Build...";
            }
            else if (buildOnly)
            {
                statusText = runNotarizeMac
                    ? "Running Unity Build + macOS Notarization..."
                    : "Running Unity Build...";
                logText = runNotarizeMac
                    ? "Starting Unity Build + macOS Notarization..."
                    : "Starting Unity Build...";
            }
            else if (publishOnly)
            {
                statusText = BuildPublishStatusText(platform, publishOnly: true, runNotarizeMac);
                logText = BuildPublishLogText(platform, publishOnly: true, runNotarizeMac);
            }
            else
            {
                statusText = BuildPublishStatusText(platform, publishOnly: false, runNotarizeMac);
                logText = BuildPublishLogText(platform, publishOnly: false, runNotarizeMac);
            }

            plan = new Plan
            {
                BuildOnly = buildOnly,
                PublishOnly = publishOnly,
                NotarizeOnly = notarizeOnly,
                Platform = platform,
                StatusText = statusText,
                LogText = logText
            };

            return true;
        }

        private static string BuildPublishStatusText(string platform, bool publishOnly, bool includeNotarize)
        {
            string target = platform switch
            {
                "steam" => "Steam",
                "epic" => "Epic",
                "both" => "Steam + Epic",
                _ => "selected targets"
            };

            if (publishOnly)
            {
                return includeNotarize
                    ? $"Running {target} Publish + macOS Notarization..."
                    : $"Running {target} Publish...";
            }

            return includeNotarize
                ? $"Running Build + {target} Publish + macOS Notarization..."
                : $"Running Build + {target} Publish...";
        }

        private static string BuildPublishLogText(string platform, bool publishOnly, bool includeNotarize)
        {
            string target = platform switch
            {
                "steam" => "Steam",
                "epic" => "Epic",
                "both" => "Steam + Epic",
                _ => "selected targets"
            };

            if (publishOnly)
            {
                return includeNotarize
                    ? $"Starting {target} Publish + macOS Notarization..."
                    : $"Starting {target} Publish...";
            }

            return includeNotarize
                ? $"Starting Build + {target} Publish + macOS Notarization..."
                : $"Starting Build + {target} Publish...";
        }
    }
}