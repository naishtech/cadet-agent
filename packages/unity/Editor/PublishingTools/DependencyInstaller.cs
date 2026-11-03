using System;
using System.IO;
using System.IO.Compression;
using System.Threading.Tasks;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net;
using Covyne.CADET.Editor.Lite.Services;
using Covyne.CADET.Editor.Utilities;
using UnityEditor;

namespace Covyne.CADET.Editor.PublishingTools
{
    /// <summary>
    /// Handles downloading and installing dependencies
    /// </summary>
    public class DependencyInstaller
    {
        private string unityProjectPath;
        private string downloadScriptPath;

        public DependencyInstaller()
        {
            // unityProjectPath is F:/unity/projects/cadet/cadet-unity
            unityProjectPath = Path.GetDirectoryName(UnityEngine.Application.dataPath);
            // download_deps.sh is deployed to the Unity CLI directory
            downloadScriptPath = CadetLitePathService.GetCliPath(unityProjectPath, "Deps", "download_deps.sh");
        }

        /// <summary>
        /// Checks if a dependency is installed (either in user directory or custom path)
        /// </summary>
        public bool IsDependencyInstalled(string dependencyName, string customPath = "")
        {
            // If custom path is provided, check there first
            if (!string.IsNullOrEmpty(customPath))
            {
                if (File.Exists(customPath) || Directory.Exists(customPath))
                {
                    // For files, just check existence
                    if (File.Exists(customPath))
                        return true;
                    
                    // For directories (BuildPatchTool), check for executable inside
                    if (dependencyName.Contains("BuildPatchTool"))
                    {
                        string[] exeFiles = Directory.GetFiles(customPath, "BuildPatchTool.exe", SearchOption.AllDirectories);
                        if (exeFiles.Length > 0)
                            return true;
                        // Also check for Mac/Linux binary
                        string[] macBinaries = Directory.GetFiles(customPath, "BuildPatchTool", SearchOption.AllDirectories);
                        return macBinaries.Length > 0;
                    }
                    
                    return true;
                }
                return false;
            }
            
            // Check user directory
            if (dependencyName.Contains("SteamCMD") && dependencyName.Contains("Windows"))
            {
                string checkPath = Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.exe");
                return File.Exists(checkPath);
            }
            else if (dependencyName.Contains("SteamCMD") && dependencyName.Contains("macOS"))
            {
                string checkPath = Path.Combine(BuildToolsPathHelper.GetSteamCmdPath(), "steamcmd.sh");
                return File.Exists(checkPath);
            }
            else if (dependencyName.Contains("BuildPatchTool"))
            {
                string checkPath = BuildToolsPathHelper.GetBuildPatchToolPath();
                if (!Directory.Exists(checkPath))
                    return false;
                
                // Check for BuildPatchTool.exe in subdirectories (Windows)
                string[] exeFiles = Directory.GetFiles(checkPath, "BuildPatchTool.exe", SearchOption.AllDirectories);
                if (exeFiles.Length > 0)
                    return true;
                // Also check for Mac/Linux binary
                string[] macBinaries = Directory.GetFiles(checkPath, "BuildPatchTool", SearchOption.AllDirectories);
                return macBinaries.Length > 0;
            }
            else if (dependencyName.Contains("Cosmos Binaries") || dependencyName.Contains("Cosmos"))
            {
                // Check for Cosmos binaries - verify bash exists
                string cosmosBinDir = Path.Combine(BuildToolsPathHelper.GetCosmosBinariesPath(), "bin");
                string bashPath = Path.Combine(cosmosBinDir, "bash");
                return File.Exists(bashPath);
            }
            
            return false;
        }

        /// <summary>
        /// Downloads and installs a specific dependency or all dependencies
        /// </summary>
        /// <param name="dependencyName">The name of the dependency to install (e.g., "SteamCMD", "Epic BuildPatchTool", "Cosmos Binaries", or null for all)</param>
        public async Task<bool> InstallDependency(string dependencyName, Action<DependencyStatus> onProgress, Action<string> onComplete, Action<string> onError)
        {
            try
            {
                // Check if this is Cosmos Binaries - handle separately
                if (dependencyName != null && dependencyName.Contains("Cosmos Binaries"))
                {
                    return await InstallCosmosBinaries(onProgress, onComplete, onError);
                }
                
                if (!File.Exists(downloadScriptPath))
                {
                    if (onError != null)
                    {
                        EditorApplication.delayCall += () => onError($"Download script not found at: {downloadScriptPath}");
                    }
                    return false;
                }

                // Wrap callbacks to marshal back to Unity main thread
                Action<DependencyStatus> threadSafeProgress = onProgress != null
                    ? (status) => EditorApplication.delayCall += () => onProgress(status)
                    : null;

                Action<string> threadSafeComplete = onComplete != null
                    ? (msg) => EditorApplication.delayCall += () => onComplete(msg)
                    : null;

                Action<string> threadSafeError = onError != null
                    ? (err) => EditorApplication.delayCall += () => onError(err)
                    : null;

                // Update status to downloading
                var status = new DependencyStatus(dependencyName ?? "Dependencies", "", "");
                status.state = DependencyState.Downloading;
                status.downloadProgress = 0.1f;
                threadSafeProgress?.Invoke(status);

                // Execute with progress tracking
                string result = await Task.Run(() => ExecuteDownloadScriptWithProgress(dependencyName, status, threadSafeProgress));
                
                if (result.Contains("[ERR]") || result.Contains("error"))
                {
                    threadSafeError?.Invoke("Download failed. Check console for details.\n\n" + result);
                    return false;
                }

                // Set to complete (90% - will become 100% when marked as Installed)
                status.downloadProgress = 0.9f;
                threadSafeProgress?.Invoke(status);

                threadSafeComplete?.Invoke($"{dependencyName ?? "Dependencies"} installed successfully!");
                return true;
            }
            catch (Exception ex)
            {
                if (onError != null)
                {
                    EditorApplication.delayCall += () => onError($"Installation failed: {ex.Message}");
                }
                return false;
            }
        }

        private string ExecuteDownloadScriptWithProgress(string dependencyName, DependencyStatus status, Action<DependencyStatus> onProgress)
        {
            string output = ExecuteDownloadScript(dependencyName, (line) =>
            {
                // Update progress based on log output
                if (line.Contains("Downloading"))
                {
                    status.downloadProgress = 0.3f;
                    onProgress?.Invoke(status);
                }
                else if (line.Contains("Extracting"))
                {
                    status.state = DependencyState.Extracting;
                    status.downloadProgress = 0.6f;
                    onProgress?.Invoke(status);
                }
                else if (line.Contains("already present") || line.Contains("Done"))
                {
                    status.downloadProgress = 0.8f;
                    onProgress?.Invoke(status);
                }
            });
            
            return output;
        }

        private string ExecuteDownloadScript(string dependencyName, Action<string> onLineReceived = null)
        {
            try
            {
                // Ensure build tools directory exists
                BuildToolsPathHelper.EnsureBuildToolsDirectoryExists();
                
                // Map dependency name to script parameter
                string scriptArg = "all";
                if (dependencyName != null)
                {
                    if (dependencyName.Contains("SteamCMD") && dependencyName.Contains("Windows"))
                    {
                        scriptArg = "steamcmd-windows";
                    }
                    else if (dependencyName.Contains("SteamCMD") && dependencyName.Contains("macOS"))
                    {
                        scriptArg = "steamcmd-macos";
                    }
                    else if (dependencyName.Contains("BuildPatchTool"))
                    {
                        scriptArg = "buildpatchtool";
                    }
                }

                // Get user directory path and pass it to the script
                string installDir = BuildToolsPathHelper.GetBuildToolsDirectory();
                
                // Convert Windows path to Unix format for bash script (Windows only)
                string installDirForScript = installDir;
                #if UNITY_EDITOR_WIN
                    installDirForScript = ToUnixPath(installDir);
                #endif
                
                // Pass installation directory as environment variable or argument
                // The script should accept this and use it instead of default location
                string fullArguments = $"{scriptArg} \"{installDirForScript}\"";

                // Use ProcessExecutor for platform-agnostic script execution
                var result = ProcessExecutor.ExecuteScript(
                    scriptPath: downloadScriptPath,
                    arguments: fullArguments,
                    workingDirectory: unityProjectPath,
                    onOutputLine: (line) =>
                    {
                        onLineReceived?.Invoke(line);
                    },
                    timeoutMs: 120000
                );

                // Combine output and error for return value
                string combinedOutput = result.Output;
                if (!string.IsNullOrEmpty(result.Error))
                {
                    if (!string.IsNullOrEmpty(combinedOutput))
                        combinedOutput += "\n";
                    combinedOutput += result.Error;
                }

                // Check for errors
                if (!result.Success)
                {
                    if (string.IsNullOrEmpty(combinedOutput))
                    {
                        return $"[ERR] Download script failed with exit code {result.ExitCode}";
                    }
                    return $"[ERR] {combinedOutput}";
                }

                return combinedOutput;
            }
            catch (Exception ex)
            {
                return $"[ERR] {ex.Message}";
            }
        }

        /// <summary>
        /// Gets the version of an installed dependency
        /// </summary>
        public string GetDependencyVersion(string dependencyName)
        {
            if (dependencyName != null && dependencyName.Contains("Cosmos Binaries"))
            {
                if (IsDependencyInstalled(dependencyName))
                {
                    return "4.0.2";
                }
                return "";
            }
            
            // For now, return a placeholder
            // TODO: Parse version from actual executables
            if (IsDependencyInstalled(dependencyName))
            {
                return "installed";
            }
            return "";
        }

        /// <summary>
        /// Uninstalls a dependency by deleting its installation directory from user directory
        /// </summary>
        public bool UninstallDependency(string dependencyName, out string errorMessage)
        {
            errorMessage = "";
            
            try
            {
                string pathToDelete = "";
                
                // Get path from user directory
                if (dependencyName.Contains("SteamCMD"))
                {
                    pathToDelete = BuildToolsPathHelper.GetSteamCmdPath();
                }
                else if (dependencyName.Contains("BuildPatchTool"))
                {
                    pathToDelete = BuildToolsPathHelper.GetBuildPatchToolPath();
                }
                else if (dependencyName.Contains("Cosmos Binaries") || dependencyName.Contains("Cosmos"))
                {
                    pathToDelete = BuildToolsPathHelper.GetCosmosBinariesPath();
                }
                else
                {
                    errorMessage = $"Unknown dependency name: {dependencyName}";
                    return false;
                }
                
                // Check if directory exists
                if (string.IsNullOrEmpty(pathToDelete) || !Directory.Exists(pathToDelete))
                {
                    errorMessage = $"Installation directory not found: {pathToDelete}\n\n" +
                                   $"Expected location: {BuildToolsPathHelper.GetBuildToolsDirectory()}";
                    return false;
                }
                
                // Try to delete with retries and better error handling
                try
                {
                    DeleteDirectoryWithRetry(pathToDelete);
                    
                    // Verify the directory was actually deleted
                    if (Directory.Exists(pathToDelete))
                    {
                        errorMessage = $"Failed to delete directory: {pathToDelete}\n\n" +
                                      "The directory still exists after deletion attempt. " +
                                      "Please ensure no processes are using files in this directory.";
                        UnityEngine.Debug.LogError($"[CADET] Uninstall failed: Directory still exists after deletion attempt: {pathToDelete}");
                        return false;
                    }
                    
                    return true;
                }
                catch (Exception deleteEx)
                {
                    // Check if directory still exists
                    if (Directory.Exists(pathToDelete))
                    {
                        errorMessage = $"Failed to delete directory: {pathToDelete}\n\n" +
                                      $"Error: {deleteEx.Message}\n\n" +
                                      "Please ensure:\n" +
                                      "- The tool is not currently running\n" +
                                      "- No terminal/command prompt windows are open in that directory\n" +
                                      "- Close any file explorers viewing that directory";
                        UnityEngine.Debug.LogError($"[CADET] Uninstall error: {deleteEx}");
                        return false;
                    }
                    else
                    {
                        // Directory was deleted despite the exception (race condition or similar)
                        return true;
                    }
                }
            }
            catch (UnauthorizedAccessException ex)
            {
                errorMessage = "Access denied. The files may be in use.\n\n" +
                              "Please ensure:\n" +
                              "- The tool is not currently running\n" +
                              "- No terminal/command prompt windows are open in that directory\n" +
                              "- Close any file explorers viewing that directory\n\n" +
                              "Then try uninstalling again.";
                UnityEngine.Debug.LogError($"[CADET] Uninstall access denied: {ex}");
                return false;
            }
            catch (IOException ex)
            {
                errorMessage = $"File system error: {ex.Message}\n\n" +
                              "The files may be locked by another process.";
                UnityEngine.Debug.LogError($"[CADET] Uninstall IO error: {ex}");
                return false;
            }
            catch (Exception ex)
            {
                errorMessage = $"Failed to uninstall: {ex.Message}";
                UnityEngine.Debug.LogError($"[CADET] Uninstall error: {ex}");
                return false;
            }
        }

        /// <summary>
        /// Downloads and installs Cosmos binaries from https://github.com/jart/cosmopolitan/releases/download/4.0.2/cosmos-4.0.2.zip
        /// </summary>
        private async Task<bool> InstallCosmosBinaries(Action<DependencyStatus> onProgress, Action<string> onComplete, Action<string> onError)
        {
            // Determine the correct target directory (user directory) - declare at method start
            string targetCosmosDir = BuildToolsPathHelper.GetCosmosBinariesPath();
            BuildToolsPathHelper.EnsureBuildToolsDirectoryExists();
            
            try
            {
                // Create target directory for extraction (legacy - for downloads directory)
                string cosmosBaseDir = CadetLitePathService.GetCliPath(unityProjectPath);
                if (!Directory.Exists(cosmosBaseDir))
                {
                    Directory.CreateDirectory(cosmosBaseDir);
                }

                // Create downloads~ directory in user directory (Unity ignores folders ending with ~)
                string downloadsDir = Path.Combine(BuildToolsPathHelper.GetBuildToolsDirectory(), "downloads~");
                if (!Directory.Exists(downloadsDir))
                {
                    Directory.CreateDirectory(downloadsDir);
                }

                // Update status
                var status = new DependencyStatus("Cosmos Binaries", "", "");
                status.state = DependencyState.Downloading;
                status.downloadProgress = 0.0f;
                onProgress?.Invoke(status);

                string zipUrl = "https://github.com/jart/cosmopolitan/releases/download/4.0.2/cosmos-4.0.2.zip";
                string tempZipPath = Path.Combine(downloadsDir, "cosmos-4.0.2.zip");

                // Check if partial download exists for resume support
                long existingBytes = 0;
                bool isResuming = File.Exists(tempZipPath);
                if (isResuming)
                {
                    FileInfo fileInfo = new FileInfo(tempZipPath);
                    existingBytes = fileInfo.Length;
                }

                // Configure ServicePointManager once for optimal performance (outside retry loop)
                ServicePointManager.DefaultConnectionLimit = 20;
                ServicePointManager.Expect100Continue = false;
                ServicePointManager.UseNagleAlgorithm = false;
                
                // Download the ZIP file with progress tracking, retry logic, and resume support
                const int maxRetries = 3;
                int retryCount = 0;
                bool downloadSuccess = false;
                
                while (retryCount < maxRetries && !downloadSuccess)
                {
                    try
                    {
                        if (retryCount > 0)
                        {
                            // Re-check file size on retry (in case it was partially written)
                            if (File.Exists(tempZipPath))
                            {
                                FileInfo fileInfo = new FileInfo(tempZipPath);
                                existingBytes = fileInfo.Length;
                                isResuming = true;
                            }
                            await Task.Delay(1000 * retryCount); // Exponential backoff
                        }
                        
                        // Configure HttpClientHandler for optimal performance
                        HttpClientHandler handler = new HttpClientHandler()
                        {
                            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
                            AllowAutoRedirect = true,
                            MaxAutomaticRedirections = 5
                        };
                        
                        using (HttpClient client = new HttpClient(handler))
                        {
                            client.Timeout = TimeSpan.FromMinutes(10); // 10 minute timeout for ZIP download
                            
                            // Set headers to match browser behavior for optimal performance
                            client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                            client.DefaultRequestHeaders.Add("Accept", "*/*");
                            client.DefaultRequestHeaders.Add("Accept-Encoding", "gzip, deflate");
                            client.DefaultRequestHeaders.Add("Accept-Language", "en-US,en;q=0.9");
                            client.DefaultRequestHeaders.ConnectionClose = false; // Keep connections alive
                            
                            // Create request with Range header if resuming
                            HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, zipUrl);
                            if (isResuming && existingBytes > 0)
                            {
                                request.Headers.Range = new RangeHeaderValue(existingBytes, null);
                            }
                            
                            // Use SendAsync with ResponseHeadersRead to get stream immediately
                            HttpResponseMessage response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                            bool responseWasRedirected = false;
                            try
                            {
                                // Log the final URL after redirects (if any) - HttpClient should follow redirects automatically
                                string finalUrl = response.RequestMessage?.RequestUri?.ToString() ?? zipUrl;
                                
                                // Handle redirects manually if HttpClient didn't follow them automatically
                                // (This can happen if redirects exceed MaxAutomaticRedirections or if Range headers need special handling)
                                HttpResponseMessage finalResponse = response;
                                if (response.StatusCode == HttpStatusCode.Found || 
                                    response.StatusCode == HttpStatusCode.MovedPermanently ||
                                    response.StatusCode == HttpStatusCode.TemporaryRedirect)
                                {
                                    Uri redirectLocation = response.Headers.Location;
                                    if (redirectLocation != null)
                                    {
                                        // Handle relative redirects
                                        if (!redirectLocation.IsAbsoluteUri)
                                        {
                                            redirectLocation = new Uri(new Uri(zipUrl), redirectLocation);
                                        }
                                        
                                        string redirectUrl = redirectLocation.ToString();
                                        
                                        // Create new request to the redirect URL
                                        HttpRequestMessage redirectRequest = new HttpRequestMessage(HttpMethod.Get, redirectUrl);
                                        
                                        // Forward Range header if resuming (critical for resume support)
                                        if (isResuming && existingBytes > 0)
                                        {
                                            redirectRequest.Headers.Range = new RangeHeaderValue(existingBytes, null);
                                        }
                                        
                                        // Forward User-Agent and other important headers
                                        redirectRequest.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                                        redirectRequest.Headers.Add("Accept", "*/*");
                                        redirectRequest.Headers.Add("Accept-Encoding", "gzip, deflate");
                                        redirectRequest.Headers.Add("Accept-Language", "en-US,en;q=0.9");
                                        
                                        // Dispose old response and make new request to redirect URL
                                        response.Dispose();
                                        responseWasRedirected = true;
                                        
                                        // Make request to redirect URL
                                        finalResponse = await client.SendAsync(redirectRequest, HttpCompletionOption.ResponseHeadersRead);
                                        string redirectFinalUrl = finalResponse.RequestMessage?.RequestUri?.ToString() ?? redirectUrl;
                                        
                                        request.Dispose();
                                    }
                                }
                                
                                // Accept both 200 OK (full download) and 206 Partial Content (resume)
                                if (finalResponse.StatusCode != HttpStatusCode.OK && 
                                    finalResponse.StatusCode != HttpStatusCode.PartialContent)
                                {
                                    finalResponse.EnsureSuccessStatusCode();
                                }
                                
                                // Get content length from headers
                                long? contentLength = finalResponse.Content.Headers.ContentLength;
                                long totalBytes = contentLength ?? 0;
                                
                                // For resume, Content-Length is the remaining bytes, so adjust total
                                if (isResuming && finalResponse.StatusCode == HttpStatusCode.PartialContent)
                                {
                                    // Content-Range header format: "bytes start-end/total" or "bytes */total"
                                    var contentRange = response.Content.Headers.ContentRange;
                                    if (contentRange != null && contentRange.HasLength)
                                    {
                                        totalBytes = contentRange.Length.Value;
                                    }
                                    else if (contentLength.HasValue)
                                    {
                                        // Content-Length is the remaining bytes
                                        totalBytes = existingBytes + contentLength.Value;
                                    }
                                }
                                else if (totalBytes == 0 && isResuming)
                                {
                                    // If we can't determine total, estimate based on existing file
                                    UnityEngine.Debug.LogWarning($"[CADET] Could not determine total file size. Using existing file size as estimate.");
                                }
                                
                                // Download phase: 0% - 80% of overall progress
                                const float downloadProgressStart = 0.0f;
                                const float downloadProgressEnd = 0.8f;
                                const float downloadProgressRange = downloadProgressEnd - downloadProgressStart;
                                
                                long bytesDownloadedThisSession = 0;
                                float lastReportedProgress = -1.0f;
                                const float progressUpdateThreshold = 0.01f; // Update every 1%
                                
                                // Open file for appending if resuming, or create new if starting fresh
                                FileMode fileMode = isResuming ? FileMode.Append : FileMode.Create;
                                FileAccess fileAccess = FileAccess.Write;
                                
                                // Read stream in chunks with optimized buffer sizes for fast downloads
                                // Use larger buffers: 512KB for network read, 256KB for file write
                                using (Stream contentStream = await finalResponse.Content.ReadAsStreamAsync())
                                using (FileStream fileStream = new FileStream(tempZipPath, fileMode, fileAccess, FileShare.None, 262144, true))
                                {
                                    byte[] buffer = new byte[524288]; // 512KB buffer for faster downloads
                                    int bytesRead;
                                    
                                    while ((bytesRead = await contentStream.ReadAsync(buffer, 0, buffer.Length)) > 0)
                                    {
                                        await fileStream.WriteAsync(buffer, 0, bytesRead);
                                        bytesDownloadedThisSession += bytesRead;
                                        
                                        // Total bytes downloaded (existing + new)
                                        long totalBytesDownloaded = existingBytes + bytesDownloadedThisSession;
                                        
                                        // Calculate progress within download phase (0-80%)
                                        float downloadProgress;
                                        if (totalBytes > 0)
                                        {
                                            downloadProgress = (float)totalBytesDownloaded / totalBytes;
                                        }
                                        else
                                        {
                                            // Fallback: estimate progress based on bytes if Content-Length unavailable
                                            downloadProgress = Math.Min(0.95f, totalBytesDownloaded / 10000000f); // Estimate 10MB total
                                        }
                                        
                                    // Map download progress to overall progress (0-80%)
                                    float overallProgress = downloadProgressStart + (downloadProgress * downloadProgressRange);
                                    
                                    // Update bytes downloaded for progress display
                                    status.bytesDownloaded = totalBytesDownloaded;
                                    status.totalBytes = totalBytes;
                                    
                                    // Throttle progress updates to every 1% change
                                    if (Math.Abs(overallProgress - lastReportedProgress) >= progressUpdateThreshold || overallProgress >= downloadProgressEnd)
                                    {
                                        status.downloadProgress = overallProgress;
                                        onProgress?.Invoke(status);
                                        lastReportedProgress = overallProgress;
                                    }
                                    }
                                    
                                    // Verify we got all the data
                                    long finalSize = existingBytes + bytesDownloadedThisSession;
                                    if (totalBytes > 0 && finalSize != totalBytes)
                                    {
                                        throw new Exception($"Download incomplete: received {finalSize} bytes total ({bytesDownloadedThisSession} this session), expected {totalBytes} bytes");
                                    }
                                }
                                
                                // Ensure we're at 80% after download completes
                                status.downloadProgress = downloadProgressEnd;
                                onProgress?.Invoke(status);
                                downloadSuccess = true;
                                
                                // Dispose final response if it was a redirect (original response already disposed)
                                if (responseWasRedirected)
                                {
                                    finalResponse.Dispose();
                                }
                            }
                            finally
                            {
                                // Dispose response if it wasn't redirected (if redirected, already disposed above)
                                if (!responseWasRedirected && response != null)
                                {
                                    response.Dispose();
                                }
                            }
                        }
                    }
                    catch (HttpRequestException ex)
                    {
                        retryCount++;
                        UnityEngine.Debug.LogWarning($"[CADET] HTTP error downloading Cosmos ZIP (attempt {retryCount}/{maxRetries}): {ex.Message}");
                        
                        // On error, check if we have partial file for next retry
                        if (File.Exists(tempZipPath))
                        {
                            FileInfo fileInfo = new FileInfo(tempZipPath);
                            existingBytes = fileInfo.Length;
                            isResuming = true;
                        }
                        
                        if (retryCount >= maxRetries)
                        {
                            onError?.Invoke($"Error downloading Cosmos ZIP after {maxRetries} attempts: {ex.Message}\n\n" +
                                          "Possible causes:\n" +
                                          "- Network connection issues\n" +
                                          "- Server temporarily unavailable\n" +
                                          "- Firewall blocking the connection\n\n" +
                                          $"Partial download saved ({existingBytes} bytes). You can retry to resume the download.");
                            return false;
                        }
                    }
                    catch (TaskCanceledException ex)
                    {
                        retryCount++;
                        UnityEngine.Debug.LogWarning($"[CADET] Timeout downloading Cosmos ZIP (attempt {retryCount}/{maxRetries}): {ex.Message}");
                        
                        // On timeout, check if we have partial file for next retry
                        if (File.Exists(tempZipPath))
                        {
                            FileInfo fileInfo = new FileInfo(tempZipPath);
                            existingBytes = fileInfo.Length;
                            isResuming = true;
                        }
                        
                        if (retryCount >= maxRetries)
                        {
                            onError?.Invoke($"Download timeout after {maxRetries} attempts: {ex.Message}\n\n" +
                                          "The download is taking too long. Please check your internet connection and try again.\n\n" +
                                          $"Partial download saved ({existingBytes} bytes). You can retry to resume the download.");
                            return false;
                        }
                    }
                    catch (Exception ex)
                    {
                        retryCount++;
                        UnityEngine.Debug.LogWarning($"[CADET] Error downloading Cosmos ZIP (attempt {retryCount}/{maxRetries}): {ex.Message}");
                        
                        // On error, check if we have partial file for next retry
                        if (File.Exists(tempZipPath))
                        {
                            FileInfo fileInfo = new FileInfo(tempZipPath);
                            existingBytes = fileInfo.Length;
                            isResuming = true;
                        }
                        
                        if (retryCount >= maxRetries)
                        {
                            onError?.Invoke($"Error downloading Cosmos ZIP after {maxRetries} attempts: {ex.Message}\n\n" +
                                          $"Partial download saved ({existingBytes} bytes). You can retry to resume the download.");
                            return false;
                        }
                    }
                }
                
                if (!downloadSuccess)
                {
                    long finalBytes = File.Exists(tempZipPath) ? new FileInfo(tempZipPath).Length : 0;
                    onError?.Invoke($"Failed to download Cosmos ZIP after all retry attempts.\n\n" +
                                  $"Partial download saved ({finalBytes} bytes). You can retry to resume the download.");
                    return false;
                }

                // Extract the ZIP file
                // Extraction phase: 80% - 95% of overall progress
                try
                {
                    status.state = DependencyState.Extracting;
                    status.downloadProgress = 0.8f; // Start of extraction phase
                    onProgress?.Invoke(status);

                    // Extract to temporary location first
                    string tempExtractDir = Path.Combine(downloadsDir, "cosmos-extract-temp");
                    if (Directory.Exists(tempExtractDir))
                    {
                        Directory.Delete(tempExtractDir, true);
                    }
                    Directory.CreateDirectory(tempExtractDir);
                    
                    ZipFile.ExtractToDirectory(tempZipPath, tempExtractDir, true);
                    
                    // Check if ZIP contains a cosmos-4.0.2 folder or files directly
                    string extractedCosmosDir = Path.Combine(tempExtractDir, "cosmos-4.0.2");
                    if (Directory.Exists(extractedCosmosDir))
                    {
                        // ZIP contains cosmos-4.0.2 folder, move it to user directory (renamed to cosmos-4.0.2~)
                        if (Directory.Exists(targetCosmosDir))
                        {
                            Directory.Delete(targetCosmosDir, true);
                        }
                        Directory.Move(extractedCosmosDir, targetCosmosDir);
                    }
                    else
                    {
                        // ZIP contains files directly, create cosmos-4.0.2~ folder and move contents
                        if (Directory.Exists(targetCosmosDir))
                        {
                            Directory.Delete(targetCosmosDir, true);
                        }
                        Directory.CreateDirectory(targetCosmosDir);
                        
                        // Move all files and directories from temp extract to target
                        foreach (string entry in Directory.GetFileSystemEntries(tempExtractDir))
                        {
                            string dest = Path.Combine(targetCosmosDir, Path.GetFileName(entry));
                            if (File.Exists(entry))
                            {
                                File.Move(entry, dest);
                            }
                            else if (Directory.Exists(entry))
                            {
                                Directory.Move(entry, dest);
                            }
                        }
                    }
                    
                    // Clean up temp extract directory
                    if (Directory.Exists(tempExtractDir))
                    {
                        Directory.Delete(tempExtractDir, true);
                    }

                    status.downloadProgress = 0.95f; // End of extraction phase
                    onProgress?.Invoke(status);
                }
                catch (Exception ex)
                {
                    onError?.Invoke($"Error extracting Cosmos ZIP: {ex.Message}");
                    return false;
                }
                finally
                {
                    // Clean up temp ZIP file
                    if (File.Exists(tempZipPath))
                    {
                        try
                        {
                            File.Delete(tempZipPath);
                        }
                        catch
                        {
                            // Ignore cleanup errors
                        }
                    }
                }

                // Verify installation by checking for bash
                // Verification phase: 95% - 100% of overall progress
                string cosmosBinDir = Path.Combine(BuildToolsPathHelper.GetCosmosBinariesPath(), "bin");
                string bashPath = Path.Combine(cosmosBinDir, "bash");
                if (!File.Exists(bashPath))
                {
                    onError?.Invoke("Installation verification failed: bash binary not found after extraction");
                    return false;
                }

                status.downloadProgress = 1.0f; // Complete
                onProgress?.Invoke(status);

                onComplete?.Invoke("Cosmos Binaries installed successfully!");
                return true;
            }
            catch (Exception ex)
            {
                onError?.Invoke($"Installation failed: {ex.Message}");
                return false;
            }
        }
        
        private void DeleteDirectoryWithRetry(string path)
        {
            // First pass: Remove read-only attributes
            DirectoryInfo di = new DirectoryInfo(path);
            foreach (FileInfo file in di.GetFiles("*", SearchOption.AllDirectories))
            {
                try
                {
                    file.Attributes = FileAttributes.Normal;
                }
                catch
                {
                    // Ignore errors on individual files
                }
            }
            
            // Second pass: Try to delete
            int maxRetries = 3;
            for (int i = 0; i < maxRetries; i++)
            {
                try
                {
                    Directory.Delete(path, true);
                    return; // Success!
                }
                catch (UnauthorizedAccessException) when (i < maxRetries - 1)
                {
                    // Wait a bit and retry
                    System.Threading.Thread.Sleep(100);
                }
                catch (IOException) when (i < maxRetries - 1)
                {
                    // Wait a bit and retry
                    System.Threading.Thread.Sleep(100);
                }
            }
            
            // If we get here, final attempt will throw the exception
            Directory.Delete(path, true);
        }
        
        /// <summary>
        /// Convert Windows path to Unix-style path for bash scripts.
        /// Converts "C:\path" or "C:/path" to "/c/path"
        /// </summary>
        private string ToUnixPath(string winPath)
        {
            if (string.IsNullOrEmpty(winPath)) return winPath;
            winPath = winPath.Replace('\\', '/');
            if (winPath.Length >= 2 && winPath[1] == ':')
            {
                return "/" + char.ToLower(winPath[0]) + winPath.Substring(2);
            }
            return winPath;
        }
    }
}

