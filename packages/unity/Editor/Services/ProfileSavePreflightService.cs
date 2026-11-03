using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Covyne.CADET.Editor.Models;
using Covyne.CADET.Editor.Lite.Models;
using Covyne.CADET.Editor.Lite.Services;

namespace Covyne.CADET.Editor.Services
{
    public enum ProjectSyncStatus
    {
        TargetMissing,
        OutOfSync,
        InSync
    }

    public class ProfileSavePreflightService
    {
        private readonly FileSyncService _syncService;

        public ProfileSavePreflightService(FileSyncService syncService = null)
        {
            _syncService = syncService ?? new FileSyncService();
        }

        /// <summary>
        /// Evaluates whether source and target project directories are in sync.
        /// Compares relative file paths and sizes — does not byte-compare.
        /// Does NOT perform any file copies.
        /// </summary>
        public ProjectSyncStatus CheckSyncStatus(string sourcePath, string targetPath, SyncOptions options)
        {
            return CheckSyncStatus(sourcePath, targetPath, options, null);
        }

        /// <summary>
        /// Evaluates whether source and target project directories are in sync and reports progress.
        /// Progress ranges from 0..1 across source scan, target scan, and entry comparison.
        /// </summary>
        public ProjectSyncStatus CheckSyncStatus(string sourcePath, string targetPath, SyncOptions options, Action<float> onProgress)
        {
            return CheckSyncStatus(sourcePath, targetPath, options, onProgress, null);
        }

        /// <summary>
        /// Evaluates whether source and target project directories are in sync and reports progress.
        /// Throws <see cref="OperationCanceledException"/> when cancellation is requested.
        /// </summary>
        public ProjectSyncStatus CheckSyncStatus(string sourcePath, string targetPath, SyncOptions options, Action<float> onProgress, Func<bool> isCancellationRequested)
        {
            if (!Directory.Exists(targetPath))
                return ProjectSyncStatus.TargetMissing;

            options ??= SyncOptions.Default();

            onProgress?.Invoke(0f);

            SyncManifest sourceManifest = GenerateManifestWithProgress(sourcePath, options, 0f, 0.45f, onProgress, isCancellationRequested);
            SyncManifest targetManifest = GenerateManifestWithProgress(targetPath, options, 0.45f, 0.9f, onProgress, isCancellationRequested);

            if (sourceManifest.Entries.Count != targetManifest.Entries.Count)
            {
                onProgress?.Invoke(1f);
                return ProjectSyncStatus.OutOfSync;
            }

            // Compare by relative path and file size (consistent with ShouldCopy heuristic;
            // File.Copy does not preserve timestamps so we avoid timestamp comparison here)
            var sourceDict = sourceManifest.Entries
                .ToDictionary(e => e.RelativePath, e => e.FileSize, StringComparer.OrdinalIgnoreCase);

            int totalToCompare = targetManifest.Entries.Count;
            for (int i = 0; i < targetManifest.Entries.Count; i++)
            {
                if (isCancellationRequested?.Invoke() == true)
                {
                    throw new OperationCanceledException("Sync status check cancelled by user.");
                }

                var entry = targetManifest.Entries[i];
                if (!sourceDict.TryGetValue(entry.RelativePath, out long srcSize) || srcSize != entry.FileSize)
                {
                    onProgress?.Invoke(1f);
                    return ProjectSyncStatus.OutOfSync;
                }

                float compareProgress = totalToCompare == 0 ? 1f : (float)(i + 1) / totalToCompare;
                onProgress?.Invoke(0.9f + compareProgress * 0.1f);
            }

            onProgress?.Invoke(1f);
            return ProjectSyncStatus.InSync;
        }

        private static SyncManifest GenerateManifestWithProgress(
            string sourcePath,
            SyncOptions options,
            float startProgress,
            float endProgress,
            Action<float> onProgress,
            Func<bool> isCancellationRequested)
        {
            options ??= SyncOptions.Default();

            string[] files = Directory.GetFiles(sourcePath, "*", SearchOption.AllDirectories);
            int totalFiles = files.Length;
            var entries = new List<SyncManifestEntry>(Math.Max(totalFiles, 0));

            if (totalFiles == 0)
            {
                onProgress?.Invoke(endProgress);
                return new SyncManifest { Entries = entries };
            }

            for (int i = 0; i < totalFiles; i++)
            {
                if (isCancellationRequested?.Invoke() == true)
                {
                    throw new OperationCanceledException("Manifest generation cancelled by user.");
                }

                string file = files[i];
                string relativePath = NormalizeRelativePath(sourcePath, file);
                if (!IsExcluded(relativePath, options.ExcludePatterns))
                {
                    var info = new FileInfo(file);
                    entries.Add(new SyncManifestEntry
                    {
                        RelativePath = relativePath,
                        FileSize = info.Length,
                        LastWriteUtc = info.LastWriteTimeUtc
                    });
                }

                float phaseProgress = (float)(i + 1) / totalFiles;
                onProgress?.Invoke(startProgress + (endProgress - startProgress) * phaseProgress);
            }

            entries = entries.OrderBy(e => e.RelativePath).ToList();
            return new SyncManifest { Entries = entries };
        }

        private static bool IsExcluded(string relativePath, string[] patterns)
        {
            if (patterns == null || patterns.Length == 0)
            {
                return false;
            }

            string normalized = relativePath.Replace('\\', '/');
            foreach (string rawPattern in patterns)
            {
                if (string.IsNullOrWhiteSpace(rawPattern))
                {
                    continue;
                }

                string pattern = rawPattern.Replace('\\', '/').Trim();
                if (pattern.EndsWith("/"))
                {
                    if (normalized.StartsWith(pattern, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
                else if (normalized.Equals(pattern, StringComparison.OrdinalIgnoreCase) ||
                         normalized.StartsWith(pattern + "/", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        private static string NormalizeRelativePath(string rootPath, string fullPath)
        {
            string relative = Path.GetRelativePath(rootPath, fullPath);
            return relative.Replace('\\', '/');
        }

        /// <summary>
        /// Synchronises source to target using the same options as the build-time sync.
        /// </summary>
        public SyncResult Synchronize(string sourcePath, string targetPath, SyncOptions options)
        {
            return _syncService.SyncDirectory(sourcePath, targetPath, options);
        }

        /// <summary>
        /// Asynchronously synchronises source to target and reports progress on the Unity main thread.
        /// Returns an operation token that can be used to cancel the sync.
        /// </summary>
        public string SynchronizeAsync(
            string sourcePath,
            string targetPath,
            SyncOptions options,
            Action<float> onProgress,
            Action<SyncResult> onCompleted)
        {
            return _syncService.SyncDirectoryAsync(sourcePath, targetPath, options, onProgress, onCompleted);
        }

        /// <summary>
        /// Cancels a running synchronization operation by token.
        /// </summary>
        public void CancelSynchronization(string token)
        {
            _syncService.CancelSync(token);
        }

        /// <summary>
        /// Builds SyncOptions from a source path and profile, mirroring
        /// CadetWindow.CreateWorkspaceSyncOptions().
        /// </summary>
        public static SyncOptions BuildSyncOptions(string sourcePath, BuildProfile profile)
        {
            var excludePatterns = new List<string>
            {
                "Library/",
                "Temp/",
                "Logs/",
                "obj/",
                ".vs/",
                "UserSettings/",
                "Build/"
            };

            if (!string.IsNullOrWhiteSpace(sourcePath) && profile?.unity != null)
            {
                string relativeBuildOutput = TryGetRelativeChildPath(
                    sourcePath, profile.unity.buildOutputPath);

                if (!string.IsNullOrEmpty(relativeBuildOutput))
                {
                    excludePatterns.Add(relativeBuildOutput.EndsWith("/")
                        ? relativeBuildOutput
                        : relativeBuildOutput + "/");
                }
            }

            return new SyncOptions
            {
                ExcludePatterns = excludePatterns.ToArray(),
                DeleteExtraneousFiles = true
            };
        }

        private static string TryGetRelativeChildPath(string rootPath, string childPath)
        {
            if (string.IsNullOrWhiteSpace(rootPath) || string.IsNullOrWhiteSpace(childPath))
                return null;

            string normalizedRoot = Path.GetFullPath(rootPath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;

            string normalizedChild = Path.GetFullPath(childPath);

            if (normalizedChild.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
                return normalizedChild.Substring(normalizedRoot.Length)
                    .Replace(Path.DirectorySeparatorChar, '/');

            return null;
        }
    }
}
