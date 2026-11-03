using System;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class BuildTerminalOutcomePolicy
    {
        public const string ReasonNonZeroExitCode = "non-zero exit code";
        public const string ReasonExitCodeUnavailable = "exit code unavailable";
        public const string ReasonManifestFailure = "manifest indicates failure";
        public const string ReasonLogFailureMarker = "log failure marker detected";
        public const string ReasonPublishStepFailed = "publish step failed";
        public const string ReasonStateCorruption = "state corruption detected";
        public const string ReasonInternalException = "internal exception";

        public static string BuildErrorDetectedDetail(string reason)
        {
            string normalizedReason = string.IsNullOrWhiteSpace(reason)
                ? ReasonInternalException
                : reason.Trim();
            return $"Error Detected: {normalizedReason}";
        }

        public static string BuildInferredDetail(string reason)
        {
            string normalizedReason = string.IsNullOrWhiteSpace(reason)
                ? ReasonInternalException
                : reason.Trim();
            return $"Status inferred: {normalizedReason}";
        }

        public static bool IsCatastrophicReason(string reason)
        {
              return string.Equals(reason, ReasonPublishStepFailed, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(reason, ReasonNonZeroExitCode, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(reason, ReasonStateCorruption, StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(reason, ReasonInternalException, StringComparison.OrdinalIgnoreCase);
        }

        public static void NormalizeTerminalOutcome(
            BuildJobStatus requestedStatus,
            string statusDetail,
            out BuildJobStatus normalizedStatus,
            out string normalizedStatusDetail)
        {
            normalizedStatus = requestedStatus;
            normalizedStatusDetail = statusDetail;

            if (requestedStatus == BuildJobStatus.Cancelled)
            {
                return;
            }

            if (requestedStatus != BuildJobStatus.Failed)
            {
                return;
            }

            string reason = TryMapReasonFromDetail(statusDetail) ?? ReasonLogFailureMarker;
            if (IsCatastrophicReason(reason))
            {
                normalizedStatus = BuildJobStatus.Failed;
                normalizedStatusDetail = BuildErrorDetectedDetail(reason);
                return;
            }

            normalizedStatus = BuildJobStatus.Completed;
            normalizedStatusDetail = string.Equals(reason, ReasonExitCodeUnavailable, StringComparison.OrdinalIgnoreCase)
                ? BuildInferredDetail(reason)
                : BuildErrorDetectedDetail(reason);
        }

        private static string TryMapReasonFromDetail(string detail)
        {
            if (string.IsNullOrWhiteSpace(detail))
            {
                return null;
            }

            string lower = detail.ToLowerInvariant();
            if (lower.Contains(ReasonExitCodeUnavailable))
            {
                return ReasonExitCodeUnavailable;
            }

            if (lower.Contains(ReasonNonZeroExitCode) ||
                lower.Contains("exit code") &&
                !lower.Contains("exit code 0") &&
                !lower.Contains("exitcode 0"))
            {
                return ReasonNonZeroExitCode;
            }

            if (lower.Contains("manifest") && lower.Contains("fail"))
            {
                return ReasonManifestFailure;
            }

            if (lower.Contains("state corruption") ||
                lower.Contains("missing required workspace identity") ||
                lower.Contains("workspace state was not available") ||
                lower.Contains("invalid workspace identity"))
            {
                return ReasonStateCorruption;
            }

            if (lower.Contains("exception") || lower.Contains("stacktrace"))
            {
                return ReasonInternalException;
            }

            if ((lower.Contains("publish") || lower.Contains("steam") || lower.Contains("epic") || lower.Contains("notariz")) &&
                (lower.Contains("failed") || lower.Contains("failure") || lower.Contains("error") || lower.Contains("[err]")))
            {
                return ReasonPublishStepFailed;
            }

            if (lower.Contains("log marker") ||
                lower.Contains("build finished, result: failure") ||
                lower.Contains("aborting batchmode due to failure") ||
                lower.Contains("[err]"))
            {
                return ReasonLogFailureMarker;
            }

            return null;
        }
    }
}
