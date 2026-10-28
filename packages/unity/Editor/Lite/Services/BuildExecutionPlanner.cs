using System;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Services;

namespace Covyne.CADET.Editor.Lite.Services
{
    public interface IProfileJsonAdapter
    {
        string CreateTemporaryJsonFile(BuildProfile profile);
        void CleanupTemporaryFile(string filePath);
    }

    public sealed class ProfileJsonAdapter : IProfileJsonAdapter
    {
        public string CreateTemporaryJsonFile(BuildProfile profile)
        {
            return ProfileJsonService.CreateTemporaryJsonFile(profile);
        }

        public void CleanupTemporaryFile(string filePath)
        {
            ProfileJsonService.CleanupTemporaryFile(filePath);
        }
    }

    /// <summary>
    /// Prepares queue jobs for existing CICD script execution path.
    /// This keeps queue orchestration separate from process execution details.
    /// </summary>
    public class BuildExecutionPlanner
    {
        private readonly IProfileJsonAdapter _profileJsonAdapter;

        public BuildExecutionPlanner(IProfileJsonAdapter profileJsonAdapter = null)
        {
            _profileJsonAdapter = profileJsonAdapter ?? new ProfileJsonAdapter();
        }

#if !CADET_LITE
        /// <summary>
        /// Prepares CICD execution request for bash script execution.
        /// CADET FULL ONLY - excluded from Lite (Asset Store) package.
        /// </summary>
        public CicdExecutionRequest PrepareCicdExecution(BuildJobDefinition job, BuildProfile profile, string scriptPath)
        {
            if (job == null)
            {
                throw new ArgumentNullException(nameof(job));
            }

            if (profile == null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            if (string.IsNullOrWhiteSpace(scriptPath))
            {
                throw new ArgumentException("Script path is required", nameof(scriptPath));
            }

            BuildProfile executionProfile = CloneProfile(profile);
            bool useGitSync = executionProfile.useGit;

            if (!useGitSync)
            {
                if (string.IsNullOrWhiteSpace(job.WorkspacePath))
                {
                    throw new InvalidOperationException("DirectorySync job requires a workspace path.");
                }

                executionProfile.unity.projectPath = job.WorkspacePath;
            }

            string tempJsonPath = _profileJsonAdapter.CreateTemporaryJsonFile(executionProfile);
            string args = $"--profile-json \"{tempJsonPath}\"";
            if (useGitSync)
            {
                args += " --git-sync";
            }

            return new CicdExecutionRequest
            {
                ScriptPath = scriptPath,
                Arguments = args,
                WorkingDirectory = executionProfile.unity.projectPath,
                ProfileJsonPath = tempJsonPath,
                UseGitSyncFlag = useGitSync
            };
        }
#endif

        /// <summary>
        /// Prepares Local execution request for Unity batch mode.
        /// Available in both CADET Full and Lite versions.
        /// </summary>
        public LocalExecutionRequest PrepareLocalExecution(BuildJobDefinition job, BuildProfile profile, string executeMethod)
        {
            if (job == null)
            {
                throw new ArgumentNullException(nameof(job));
            }

            if (profile == null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            if (string.IsNullOrWhiteSpace(executeMethod))
            {
                throw new ArgumentException("Execute method is required", nameof(executeMethod));
            }

            if (string.IsNullOrWhiteSpace(profile.unity.editorPath))
            {
                throw new InvalidOperationException("Unity editor path is required for Local execution.");
            }

            if (string.IsNullOrWhiteSpace(job.WorkspacePath))
            {
                throw new InvalidOperationException("Local execution requires a workspace path. Sync the project into a workspace before building.");
            }

            string projectPath = job.WorkspacePath;

            if (string.IsNullOrWhiteSpace(projectPath))
            {
                throw new InvalidOperationException("Project path is required for Local execution.");
            }

            string args = $"-batchmode -quit -projectPath \"{projectPath}\" -executeMethod {executeMethod}";

            return new LocalExecutionRequest
            {
                UnityEditorPath = profile.unity.editorPath,
                ProjectPath = projectPath,
                Arguments = args,
                ExecuteMethod = executeMethod
            };
        }

#if !CADET_LITE
        /// <summary>
        /// Cleans up temporary files for CICD execution.
        /// CADET FULL ONLY - excluded from Lite (Asset Store) package.
        /// </summary>
        public void CleanupExecution(CicdExecutionRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.ProfileJsonPath))
            {
                return;
            }

            _profileJsonAdapter.CleanupTemporaryFile(request.ProfileJsonPath);
        }
#endif

        private static BuildProfile CloneProfile(BuildProfile profile)
        {
            if (profile == null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            // Reuse existing JSON serialization shape to avoid manual deep-copy drift.
            string json = ProfileJsonService.SerializeToJson(profile);
            BuildProfile clone = UnityEngine.JsonUtility.FromJson<BuildProfile>(json);
            clone.InitializeDefaults();
            return clone;
        }
    }

    [Serializable]
    public class LocalExecutionRequest
    {
        public string UnityEditorPath;
        public string ProjectPath;
        public string Arguments;
        public string ExecuteMethod;
    }
}
