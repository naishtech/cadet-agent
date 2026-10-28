using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Services
{
    /// <summary>
    /// Orchestrates top-level execute sequencing for the selected profile.
    /// </summary>
    public static class BuildExecutionSequenceService
    {
        private const string DiagnosticsPrefix = "[C.A.D.E.T][QueueDiag]";

        public enum ExecuteResultCode
        {
            Success,
            DetachedOperationStarted,
            Failed,
            NoProfile,
            BuildInProgress,
            EpicConfigMissing
        }

        public sealed class Request
        {
            public BuildProfileAsset SelectedProfileAsset { get; set; }
            public string SelectedProfileGuid { get; set; }
            public bool RunUnityBuild { get; set; }
            public bool RunNotarizeMac { get; set; }
            public bool RunPublishSteam { get; set; }
            public bool RunPublishEpic { get; set; }
            public Func<string, bool> IsBuildInProgressForProfile { get; set; }
            public Func<BuildProfile, bool, bool, bool, string, string, BuildJobDefinition, Task<BuildOperationExecutionService.ExecutionResult>> ExecuteBuildOperation { get; set; }
            public Action OnBuildSucceeded { get; set; }
            public Action StopProgress { get; set; }
            public Action<string, CadetConsoleMessageType> AppendOutput { get; set; }
        }

        public sealed class Result
        {
            public ExecuteResultCode Code { get; set; }
            public string ProfileName { get; set; }
        }

        public static async Task<Result> ExecuteAsync(Request request)
        {
            ValidateRequest(request);
            Stopwatch stopwatch = Stopwatch.StartNew();
            long previousElapsedMs = 0;

            void LogTiming(string message)
            {
                long elapsedMs = stopwatch.ElapsedMilliseconds;
                long deltaMs = elapsedMs - previousElapsedMs;
                previousElapsedMs = elapsedMs;
                CadetFilteredLogger.Debug($"{DiagnosticsPrefix} Timing {message} +{deltaMs}ms total={elapsedMs}ms.");
            }

            LogTiming("ExecuteAsync entered");

            BuildProfileAsset profileAsset = request.SelectedProfileAsset;
            if (profileAsset == null || profileAsset.Profile == null)
            {
                LogTiming("ExecuteAsync exiting: no profile selected");
                return new Result { Code = ExecuteResultCode.NoProfile };
            }

            string profileAssetPath = UnityEditor.AssetDatabase.GetAssetPath(profileAsset);
            string profileGuid = !string.IsNullOrWhiteSpace(request.SelectedProfileGuid)
                ? request.SelectedProfileGuid.Trim()
                : (string.IsNullOrWhiteSpace(profileAssetPath)
                    ? string.Empty
                    : UnityEditor.AssetDatabase.AssetPathToGUID(profileAssetPath));

            if (!string.IsNullOrWhiteSpace(profileGuid) && request.IsBuildInProgressForProfile(profileGuid))
            {
                LogTiming($"ExecuteAsync exiting: profile '{profileAsset.Profile.profileName}' already in progress");
                return new Result
                {
                    Code = ExecuteResultCode.BuildInProgress,
                    ProfileName = profileAsset.Profile.profileName
                };
            }

            BuildProfile profile = profileAsset.Profile;
            string profileName = profile.profileName;

            request.StopProgress();

            var operations = new List<string>();
            if (request.RunUnityBuild) operations.Add("Unity Build");
            if (request.RunNotarizeMac) operations.Add("Notarize macOS Build");
            if (request.RunPublishSteam) operations.Add("Publish to Steam");
            if (request.RunPublishEpic) operations.Add("Publish to Epic");

            request.AppendOutput($"[LOG] Execute requested for profile: {profileName}", CadetConsoleMessageType.Log);
            request.AppendOutput($"[LOG] Operations: {string.Join(", ", operations)}", CadetConsoleMessageType.Log);
            LogTiming($"ExecuteAsync prepared operations for profile '{profileName}'");

            if (request.RunPublishEpic && string.IsNullOrEmpty(profile.epic?.buildPatchToolPath))
            {
                request.AppendOutput("[ERROR] Cannot publish to Epic: BuildPatchTool Path is required. Please configure it in Publishing Tools or the profile editor.", CadetConsoleMessageType.Error);
                request.AppendOutput($"[ERROR] Operations stopped due to failure for profile: {profileName}", CadetConsoleMessageType.Error);
                LogTiming($"ExecuteAsync exiting: Epic config missing for profile '{profileName}'");
                return new Result
                {
                    Code = ExecuteResultCode.EpicConfigMissing,
                    ProfileName = profileName
                };
            }

            bool success = true;
            bool detachedOperationStarted = false;
            bool hasDistPlan = DistExecutionPlanService.TryCreatePlan(
                request.RunUnityBuild,
                request.RunNotarizeMac,
                request.RunPublishSteam,
                request.RunPublishEpic,
                out DistExecutionPlanService.Plan plan);
            CadetFilteredLogger.Debug(
                $"{DiagnosticsPrefix} Sequence plan profile='{profileName}' hasPlan={hasDistPlan} " +
                $"build={request.RunUnityBuild} notarize={request.RunNotarizeMac} steam={request.RunPublishSteam} epic={request.RunPublishEpic}.");
            LogTiming($"Dist execution plan created for profile '{profileName}' hasPlan={hasDistPlan}");

            if (hasDistPlan)
            {
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Sequence launching dist operation profile='{profileName}' " +
                    $"buildOnly={plan.BuildOnly} publishOnly={plan.PublishOnly} notarizeOnly={plan.NotarizeOnly} platform='{plan.Platform ?? "<none>"}'.");
                request.AppendOutput($"[LOG] {plan.LogText}", CadetConsoleMessageType.Log);
                LogTiming($"About to execute build operation for profile '{profileName}'");
                BuildOperationExecutionService.ExecutionResult operationResult = await request.ExecuteBuildOperation(profile, plan.BuildOnly, plan.PublishOnly, plan.NotarizeOnly, plan.Platform, profileGuid, null);
                LogTiming($"Build operation returned for profile '{profileName}' success={operationResult.Success} detached={operationResult.DetachedOperationActive}");
                success = operationResult.Success;
                detachedOperationStarted |= operationResult.DetachedOperationActive;
                CadetFilteredLogger.Debug(
                    $"{DiagnosticsPrefix} Sequence dist result profile='{profileName}' success={success} detached={operationResult.DetachedOperationActive}.");
                if (success && request.RunUnityBuild && !operationResult.DetachedOperationActive)
                {
                    request.OnBuildSucceeded();
                }

                if (detachedOperationStarted)
                {
                    request.AppendOutput($"[LOG] Detached operation started for profile: {profileName}", CadetConsoleMessageType.Log);
                    LogTiming($"ExecuteAsync exiting: detached operation started for profile '{profileName}'");
                    return new Result { Code = ExecuteResultCode.DetachedOperationStarted, ProfileName = profileName };
                }

                if (!success)
                {
                    request.AppendOutput($"[ERROR] Operations stopped due to failure for profile: {profileName}", CadetConsoleMessageType.Error);
                    LogTiming($"ExecuteAsync exiting: failure for profile '{profileName}'");
                    return new Result { Code = ExecuteResultCode.Failed, ProfileName = profileName };
                }

                request.AppendOutput($"[SUCCESS] All operations completed successfully for profile: {profileName}", CadetConsoleMessageType.Success);
                LogTiming($"ExecuteAsync exiting: success for profile '{profileName}'");
                return new Result { Code = ExecuteResultCode.Success, ProfileName = profileName };
            }

            if (success)
            {
                request.AppendOutput($"[SUCCESS] All operations completed successfully for profile: {profileName}", CadetConsoleMessageType.Success);
                LogTiming($"ExecuteAsync exiting without dist plan: success for profile '{profileName}'");
                return new Result { Code = ExecuteResultCode.Success, ProfileName = profileName };
            }

            request.AppendOutput($"[ERROR] Operations stopped due to failure for profile: {profileName}", CadetConsoleMessageType.Error);
            LogTiming($"ExecuteAsync exiting without dist plan: failure for profile '{profileName}'");
            return new Result { Code = ExecuteResultCode.Failed, ProfileName = profileName };
        }

        private static void ValidateRequest(Request request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.IsBuildInProgressForProfile == null) throw new ArgumentNullException(nameof(request.IsBuildInProgressForProfile));
            if (request.ExecuteBuildOperation == null) throw new ArgumentNullException(nameof(request.ExecuteBuildOperation));
            if (request.OnBuildSucceeded == null) throw new ArgumentNullException(nameof(request.OnBuildSucceeded));
            if (request.StopProgress == null) throw new ArgumentNullException(nameof(request.StopProgress));
            if (request.AppendOutput == null) throw new ArgumentNullException(nameof(request.AppendOutput));
        }
    }
}
