using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;
using Covyne.CADET.Editor.Lite.Models;

namespace Covyne.CADET.Editor.Lite.Services
{
    public class FileSyncService
    {
        private static bool _useDelayCall = true;

        /// <summary>
        /// Controls whether async callbacks are marshalled via EditorApplication.delayCall.
        /// Set to false in tests that block the main thread waiting for async completion;
        /// this causes callbacks to fire synchronously on the Task.Run thread instead.
        /// Defaults to true for normal editor operation.
        /// </summary>
        public static void SetUseDelayCall(bool useDelayCall) => _useDelayCall = useDelayCall;

        private readonly ConcurrentDictionary<string, CancellationTokenSource> _syncOperations = new ConcurrentDictionary<string, CancellationTokenSource>();

        public SyncResult SyncDirectory(string sourcePath, string targetPath, SyncOptions options)
        {
            return SyncDirectoryInternal(sourcePath, targetPath, options ?? SyncOptions.Default(), null, CancellationToken.None);
        }

        public SyncResult SyncDirectory(string sourcePath, string targetPath, SyncOptions options, Action<float> onProgress)
        {
            return SyncDirectoryInternal(sourcePath, targetPath, options ?? SyncOptions.Default(), onProgress, CancellationToken.None);
        }

        public SyncResult SyncDirectory(string sourcePath, string targetPath, SyncOptions options, CancellationToken cancellationToken)
        {
            return SyncDirectoryInternal(sourcePath, targetPath, options ?? SyncOptions.Default(), null, cancellationToken);
        }

        public SyncResult SyncDirectory(string sourcePath, string targetPath, SyncOptions options, Action<float> onProgress, CancellationToken cancellationToken)
        {
            return SyncDirectoryInternal(sourcePath, targetPath, options ?? SyncOptions.Default(), onProgress, cancellationToken);
        }

        public string SyncDirectoryAsync(
            string sourcePath,
            string targetPath,
            SyncOptions options,
            Action<float> onProgress,
            Action<SyncResult> onCompleted)
        {
            string token = Guid.NewGuid().ToString();
            var cts = new CancellationTokenSource();
            _syncOperations[token] = cts;

            // Wrap callbacks to marshal back to Unity main thread (skipped in test mode).
            Action<float> threadSafeProgress = onProgress != null
                ? (_useDelayCall
                    ? (Action<float>)((progress) => EditorApplication.delayCall += () => onProgress(progress))
                    : (Action<float>)(onProgress))
                : null;

            Action<SyncResult> threadSafeCompleted = onCompleted != null
                ? (_useDelayCall
                    ? (Action<SyncResult>)((result) => EditorApplication.delayCall += () => onCompleted(result))
                    : (Action<SyncResult>)(onCompleted))
                : null;

            Task.Run(() =>
            {
                SyncResult result;
                try
                {
                    result = SyncDirectoryInternal(sourcePath, targetPath, options ?? SyncOptions.Default(), threadSafeProgress, cts.Token);
                }
                catch (OperationCanceledException)
                {
                    result = new SyncResult
                    {
                        Success = false,
                        Cancelled = true,
                        ErrorMessage = "Sync cancelled"
                    };
                }
                catch (Exception ex)
                {
                    result = new SyncResult
                    {
                        Success = false,
                        Cancelled = false,
                        ErrorMessage = ex.Message
                    };
                }
                finally
                {
                    _syncOperations.TryRemove(token, out _);
                }

                threadSafeCompleted?.Invoke(result);
            });

            return token;
        }

        public void CancelSync(string token)
        {
            if (string.IsNullOrEmpty(token))
            {
                return;
            }

            if (_syncOperations.TryGetValue(token, out var cts))
            {
                cts.Cancel();
            }
        }

        public SyncManifest GenerateManifest(string sourcePath, SyncOptions options)
        {
            ValidatePaths(sourcePath, sourcePath); // second arg ignored for source checks
            options ??= SyncOptions.Default();

            var manifest = new SyncManifest();
            foreach (string file in Directory.GetFiles(sourcePath, "*", SearchOption.AllDirectories))
            {
                string relativePath = NormalizeRelativePath(sourcePath, file);
                if (IsExcluded(relativePath, options.ExcludePatterns))
                {
                    continue;
                }

                var info = new FileInfo(file);
                manifest.Entries.Add(new SyncManifestEntry
                {
                    RelativePath = relativePath,
                    FileSize = info.Length,
                    LastWriteUtc = info.LastWriteTimeUtc
                });
            }

            manifest.Entries = manifest.Entries.OrderBy(e => e.RelativePath).ToList();
            return manifest;
        }

        public void SaveManifest(SyncManifest manifest, string path)
        {
            if (manifest == null)
            {
                throw new ArgumentNullException(nameof(manifest));
            }

            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }

            File.WriteAllText(path, manifest.ToJson());
        }

        public SyncManifest LoadManifest(string path)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Manifest file not found", path);
            }

            return SyncManifest.FromJson(File.ReadAllText(path));
        }

        private SyncResult SyncDirectoryInternal(
            string sourcePath,
            string targetPath,
            SyncOptions options,
            Action<float> onProgress,
            CancellationToken cancellationToken)
        {
            ValidatePaths(sourcePath, targetPath);

            if (!Directory.Exists(targetPath))
            {
                Directory.CreateDirectory(targetPath);
            }

            var result = new SyncResult { Success = true };
            string[] files = Directory.GetFiles(sourcePath, "*", SearchOption.AllDirectories);
            var includedFiles = files
                .Select(path => new { FullPath = path, RelativePath = NormalizeRelativePath(sourcePath, path) })
                .Where(f => !IsExcluded(f.RelativePath, options.ExcludePatterns))
                .OrderBy(f => f.RelativePath)
                .ToList();

            int total = includedFiles.Count;
            int processed = 0;

            foreach (var file in includedFiles)
            {
                cancellationToken.ThrowIfCancellationRequested();

                string dest = Path.Combine(targetPath, file.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                string destDir = Path.GetDirectoryName(dest);
                if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
                {
                    Directory.CreateDirectory(destDir);
                }

                if (ShouldCopy(file.FullPath, dest, options))
                {
                    File.Copy(file.FullPath, dest, true);
                    result.FilesCopied++;
                }

                processed++;
                onProgress?.Invoke(total == 0 ? 1f : (float)processed / total);
            }

            if (options.DeleteExtraneousFiles)
            {
                var sourceRelativeSet = new HashSet<string>(includedFiles.Select(f => f.RelativePath), StringComparer.OrdinalIgnoreCase);
                foreach (string targetFile in Directory.GetFiles(targetPath, "*", SearchOption.AllDirectories))
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    string rel = NormalizeRelativePath(targetPath, targetFile);
                    if (IsExcluded(rel, options.ExcludePatterns))
                    {
                        continue;
                    }

                    if (!sourceRelativeSet.Contains(rel))
                    {
                        File.Delete(targetFile);
                        result.FilesDeleted++;
                    }
                }
            }

            onProgress?.Invoke(1f);
            return result;
        }

        private static void ValidatePaths(string sourcePath, string targetPath)
        {
            if (string.IsNullOrWhiteSpace(sourcePath) || string.IsNullOrWhiteSpace(targetPath))
            {
                throw new ArgumentException("Source and target paths are required.");
            }

            if (!Directory.Exists(sourcePath))
            {
                throw new DirectoryNotFoundException($"Source directory not found: {sourcePath}");
            }
        }

        private static bool ShouldCopy(string sourceFile, string targetFile, SyncOptions options)
        {
            if (!File.Exists(targetFile))
            {
                return true;
            }

            var sourceInfo = new FileInfo(sourceFile);
            var targetInfo = new FileInfo(targetFile);

            if (sourceInfo.Length != targetInfo.Length)
            {
                return true;
            }

            if (sourceInfo.LastWriteTimeUtc != targetInfo.LastWriteTimeUtc)
            {
                // If timestamp differs we copy because it's a clear change signal.
                return true;
            }

            // Most repeated sync runs should finish quickly when metadata matches.
            // Deep content compare is optional for stricter validation scenarios.
            if (options?.VerifyContentWhenMetadataMatches == true)
            {
                return !FilesAreEqual(sourceFile, targetFile);
            }

            return false;
        }

        private static bool FilesAreEqual(string sourceFile, string targetFile)
        {
            const int bufferSize = 1024 * 1024; // 1 MB
            byte[] sourceBuffer = new byte[bufferSize];
            byte[] targetBuffer = new byte[bufferSize];

            using var sourceStream = new FileStream(sourceFile, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var targetStream = new FileStream(targetFile, FileMode.Open, FileAccess.Read, FileShare.Read);

            while (true)
            {
                int sourceRead = sourceStream.Read(sourceBuffer, 0, sourceBuffer.Length);
                int targetRead = targetStream.Read(targetBuffer, 0, targetBuffer.Length);

                if (sourceRead != targetRead)
                {
                    return false;
                }

                if (sourceRead == 0)
                {
                    return true;
                }

                for (int i = 0; i < sourceRead; i++)
                {
                    if (sourceBuffer[i] != targetBuffer[i])
                    {
                        return false;
                    }
                }
            }
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
    }
}
