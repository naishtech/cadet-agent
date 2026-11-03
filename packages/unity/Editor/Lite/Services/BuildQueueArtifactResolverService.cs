using System.IO;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public static class BuildQueueArtifactResolverService
    {
        public static bool TryResolveOpenableBuildOutputDirectory(BuildJobDefinition job, BuildProfile profile, out string directory)
        {
            directory = ResolveJobBuildOutputDirectory(job, profile);
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            {
                return false;
            }

            if (IsNonUnityOutputRun(job))
            {
                return true;
            }

            return HasPrimaryArtifact(profile, directory);
        }

        public static bool IsNonUnityOutputRun(BuildJobDefinition job)
        {
            if (job == null)
            {
                return false;
            }

            bool hasDownstreamOps = job.RunNotarizeMac || job.RunPublishSteam || job.RunPublishEpic;
            return !job.RunUnityBuild && hasDownstreamOps;
        }

        public static bool HasPrimaryArtifact(BuildProfile profile, string outputRoot)
        {
            if (profile?.unity == null)
            {
                return false;
            }

            string projectName = string.IsNullOrWhiteSpace(profile.unity.projectName) ? "Build" : profile.unity.projectName;
            string os = profile.os?.ToLowerInvariant() ?? "windows";

            bool needsWindows = os == "windows" || os == "both";
            bool needsMacos = os == "mac" || os == "macos" || os == "both";

            if (needsWindows && ArtifactExists(
                    Path.Combine(outputRoot, "Bin", "windows", $"{projectName}.exe"),
                    Path.Combine(outputRoot, "windows", $"{projectName}.exe")))
            {
                return true;
            }

            if (needsMacos && ArtifactExists(
                    Path.Combine(outputRoot, "Bin", "macos", $"{projectName}.app"),
                    Path.Combine(outputRoot, "macos", $"{projectName}.app")))
            {
                return true;
            }

            return false;
        }

        public static bool ArtifactExists(params string[] candidatePaths)
        {
            if (candidatePaths == null)
            {
                return false;
            }

            for (int i = 0; i < candidatePaths.Length; i++)
            {
                string path = candidatePaths[i];
                if (string.IsNullOrWhiteSpace(path))
                {
                    continue;
                }

                if (File.Exists(path) || Directory.Exists(path))
                {
                    return true;
                }
            }

            return false;
        }

        public static string ResolveJobBuildOutputDirectory(BuildJobDefinition job, BuildProfile profile)
        {
            string rawPath = profile?.unity?.buildOutputPath;
            if (string.IsNullOrWhiteSpace(rawPath))
            {
                return null;
            }

            string normalized = rawPath.Trim().Trim('"');
            if (!Path.IsPathRooted(normalized))
            {
                string projectPath = !string.IsNullOrWhiteSpace(job?.WorkspacePath)
                    ? job.WorkspacePath
                    : profile?.unity?.projectPath;
                string projectRoot = !string.IsNullOrWhiteSpace(projectPath)
                    ? projectPath
                    : Path.GetDirectoryName(UnityEngine.Application.dataPath);
                normalized = Path.GetFullPath(Path.Combine(projectRoot ?? string.Empty, normalized));
            }

            return normalized;
        }

        public static string ResolveExpectedBuildArtifactPath(BuildProfile profile)
        {
            if (profile?.unity == null || string.IsNullOrWhiteSpace(profile.unity.buildOutputPath))
            {
                return string.Empty;
            }

            string projectName = string.IsNullOrWhiteSpace(profile.unity.projectName) ? "Build" : profile.unity.projectName;
            string outputRoot = profile.unity.buildOutputPath.Trim().Trim('"');
            if (!Path.IsPathRooted(outputRoot))
            {
                string projectRoot = Path.GetDirectoryName(UnityEngine.Application.dataPath) ?? string.Empty;
                outputRoot = Path.GetFullPath(Path.Combine(projectRoot, outputRoot));
            }

            string os = profile.os?.ToLowerInvariant() ?? "windows";
            if (os == "mac" || os == "macos")
            {
                return Path.Combine(outputRoot, "Bin", "macos", $"{projectName}.app");
            }

            return Path.Combine(outputRoot, "Bin", "windows", $"{projectName}.exe");
        }
    }
}
