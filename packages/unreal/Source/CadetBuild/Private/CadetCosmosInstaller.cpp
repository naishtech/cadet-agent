#include "CadetCosmosInstaller.h"

#include "Async/Async.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogCadetCosmosInstaller, Log, All);

namespace
{
    static const TCHAR* DownloadProgressPrefix = TEXT("CADET_DOWNLOAD_PROGRESS|");

    FString EscapePowerShellSingleQuotedCosmos(const FString& Value)
    {
        FString Escaped = Value;
        Escaped.ReplaceInline(TEXT("'"), TEXT("''"));
        return Escaped;
    }

    FString FormatByteSize(int64 Bytes)
    {
        if (Bytes < 0)
        {
            return TEXT("unknown");
        }

        const double BytesAsDouble = static_cast<double>(Bytes);
        if (BytesAsDouble >= 1024.0 * 1024.0 * 1024.0)
        {
            return FString::Printf(TEXT("%.2f GB"), BytesAsDouble / (1024.0 * 1024.0 * 1024.0));
        }
        if (BytesAsDouble >= 1024.0 * 1024.0)
        {
            return FString::Printf(TEXT("%.2f MB"), BytesAsDouble / (1024.0 * 1024.0));
        }
        if (BytesAsDouble >= 1024.0)
        {
            return FString::Printf(TEXT("%.2f KB"), BytesAsDouble / 1024.0);
        }

        return FString::Printf(TEXT("%lld B"), Bytes);
    }

    bool ParseDownloadProgressLine(const FString& InLine, int64& OutDownloaded, int64& OutTotal, double& OutPercent)
    {
        OutDownloaded = 0;
        OutTotal = -1;
        OutPercent = -1.0;

        FString Line = InLine;
        Line.ReplaceInline(TEXT("\r"), TEXT(""));
        Line.TrimStartAndEndInline();

        if (!Line.StartsWith(DownloadProgressPrefix))
        {
            return false;
        }

        TArray<FString> Parts;
        Line.ParseIntoArray(Parts, TEXT("|"), true);
        if (Parts.Num() != 4)
        {
            return false;
        }

        return LexTryParseString(OutDownloaded, *Parts[1])
            && LexTryParseString(OutTotal, *Parts[2])
            && LexTryParseString(OutPercent, *Parts[3]);
    }

    FString GetEnumValueAsString(ECadetDependencyState State)
    {
        switch (State)
        {
        case ECadetDependencyState::Missing:
            return TEXT("Missing");
        case ECadetDependencyState::Downloading:
            return TEXT("Downloading");
        case ECadetDependencyState::Extracting:
            return TEXT("Extracting");
        case ECadetDependencyState::Installed:
            return TEXT("Installed");
        case ECadetDependencyState::Error:
            return TEXT("Error");
        default:
            return TEXT("Unknown");
        }
    }

    FString ExecutePowerShellWithCapture(const FString& Command, int32& OutExitCode, TFunction<void(const FString&)> OnOutputLine = nullptr)
    {
        OutExitCode = -1;

        const FString TempOutputPath = FPaths::Combine(
            FPaths::ProjectSavedDir(),
            TEXT("Temp"),
            TEXT("CadetBuild"),
            TEXT("cosmos-ps-output.txt"));

        IFileManager::Get().MakeDirectory(*FPaths::GetPath(TempOutputPath), true);

        // PowerShell script that captures output and exit code
        const FString FullScript = FString::Printf(
            TEXT("$ErrorActionPreference='Stop'; try { %s } catch { Write-Output \"ERROR: $_\"; exit 1 }"),
            *Command);

        // Create temp file to capture output
        void* PipeRead = nullptr;
        void* PipeWrite = nullptr;
        if (!FPlatformProcess::CreatePipe(PipeRead, PipeWrite))
        {
            UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Failed to create pipes for PowerShell execution"));
            return TEXT("");
        }

        FProcHandle ProcessHandle = FPlatformProcess::CreateProc(
            TEXT("powershell.exe"),
            *FString::Printf(TEXT("-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"%s\""), *FullScript),
            false,
            true,
            true,
            nullptr,
            0,
            nullptr,
            PipeWrite,
            PipeWrite);

        if (!ProcessHandle.IsValid())
        {
            UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Failed to start PowerShell process"));
            FPlatformProcess::ClosePipe(PipeRead, PipeWrite);
            return TEXT("");
        }

        auto ProcessOutputChunk = [&OnOutputLine](const FString& Chunk, FString& PendingLine)
        {
            if (Chunk.IsEmpty())
            {
                return;
            }

            PendingLine += Chunk;

            int32 NewlineIndex = INDEX_NONE;
            while (PendingLine.FindChar(TEXT('\n'), NewlineIndex))
            {
                FString Line = PendingLine.Left(NewlineIndex);
                PendingLine.RightChopInline(NewlineIndex + 1, EAllowShrinking::No);
                Line.ReplaceInline(TEXT("\r"), TEXT(""));

                if (OnOutputLine)
                {
                    OnOutputLine(Line);
                }
            }
        };

        // Read output
        FString Output;
        FString PendingLine;
        while (FPlatformProcess::IsProcRunning(ProcessHandle))
        {
            const FString Chunk = FPlatformProcess::ReadPipe(PipeRead);
            Output += Chunk;
            ProcessOutputChunk(Chunk, PendingLine);
            FPlatformProcess::Sleep(0.01f);
        }

        const FString FinalChunk = FPlatformProcess::ReadPipe(PipeRead);
        Output += FinalChunk;
        ProcessOutputChunk(FinalChunk, PendingLine);

        if (OnOutputLine && !PendingLine.TrimStartAndEnd().IsEmpty())
        {
            OnOutputLine(PendingLine);
        }

        int32 ExitCode;
        FPlatformProcess::GetProcReturnCode(ProcessHandle, &ExitCode);
        OutExitCode = ExitCode;

        FPlatformProcess::CloseProc(ProcessHandle);
        FPlatformProcess::ClosePipe(PipeRead, PipeWrite);

        return Output;
    }
}

void FCadetCosmosInstaller::InstallAsync(
    const FCadetCosmosInstallRequest& Request,
    TFunction<void(const FCadetCosmosInstallProgress&)> OnProgress,
    TFunction<void(const FCadetCosmosInstallResult&)> OnComplete)
{
    const FCadetCosmosInstallRequest RequestCopy = Request;

    Async(EAsyncExecution::ThreadPool, [RequestCopy, OnProgress = MoveTemp(OnProgress), OnComplete = MoveTemp(OnComplete)]() mutable
    {
        auto ReportProgress = [&OnProgress](ECadetDependencyState State, float Percent, const FString& Message)
        {
            if (!OnProgress)
            {
                return;
            }

            FCadetCosmosInstallProgress Progress;
            Progress.State = State;
            Progress.Percent = Percent;
            Progress.Message = Message;

            UE_LOG(LogCadetCosmosInstaller, Log, TEXT("[Progress] %s (%.0f%%) - %s"),
                *GetEnumValueAsString(State),
                Percent * 100.0f,
                *Message);

            AsyncTask(ENamedThreads::GameThread, [OnProgress, Progress]()
            {
                OnProgress(Progress);
            });
        };

        auto ReportError = [&OnComplete](const FString& Error)
        {
            UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Install failed: %s"), *Error);

            FCadetCosmosInstallResult Result;
            Result.bSuccess = false;
            Result.Error = Error;

            if (OnComplete)
            {
                AsyncTask(ENamedThreads::GameThread, [OnComplete, Result]() { OnComplete(Result); });
            }
        };

        FCadetCosmosInstallResult Result;
        Result.InstallPath = RequestCopy.TargetInstallPath;

        FString TargetInstallPath = FPaths::ConvertRelativePathToFull(RequestCopy.TargetInstallPath);
        FPaths::NormalizeFilename(TargetInstallPath);

        if (TargetInstallPath.IsEmpty())
        {
            ReportError(TEXT("Target Cosmos install path is empty."));
            return;
        }

        UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Starting Cosmos installation to: %s"), *TargetInstallPath);

        const FString ToolsRoot = FPaths::GetPath(TargetInstallPath);
        if (!IFileManager::Get().MakeDirectory(*ToolsRoot, true))
        {
            ReportError(FString::Printf(TEXT("Failed to create tools directory: %s"), *ToolsRoot));
            return;
        }

        const FString DownloadsDir = FPaths::Combine(ToolsRoot, TEXT("downloads~"));
        IFileManager::Get().MakeDirectory(*DownloadsDir, true);

        const FString DownloadUrl = RequestCopy.DownloadUrl.IsEmpty()
            ? TEXT("https://github.com/jart/cosmopolitan/releases/download/4.0.2/cosmos-4.0.2.zip")
            : RequestCopy.DownloadUrl;

        UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Download URL: %s"), *DownloadUrl);
        UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Max retries: %d, Allow resume: %s"),
            RequestCopy.MaxRetries,
            RequestCopy.bAllowResume ? TEXT("true") : TEXT("false"));

        const FString TempZipPath = FPaths::Combine(DownloadsDir, TEXT("cosmos-4.0.2.zip"));
        const FString TempExtractDir = FPaths::Combine(DownloadsDir, TEXT("cosmos-extract-temp"));

        ReportProgress(ECadetDependencyState::Downloading, 0.1f, TEXT("Downloading Cosmos binaries..."));

#if PLATFORM_WINDOWS
        // Attempt download with retries
        bool bDownloadOk = false;
        FString DownloadError;

        for (int32 Attempt = 1; Attempt <= RequestCopy.MaxRetries; ++Attempt)
        {
            UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Download attempt %d of %d"), Attempt, RequestCopy.MaxRetries);

            // Streamed download with explicit progress output lines for UI updates.
            const FString DownloadScript = FString::Printf(
                TEXT("[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12; ")
                TEXT("Add-Type -AssemblyName System.Net.Http; ")
                TEXT("$ErrorActionPreference = 'Stop'; ")
                TEXT("$ProgressPreference = 'SilentlyContinue'; ")
                TEXT("$outFile = '%s'; ")
                TEXT("if (Test-Path $outFile) { Remove-Item $outFile -Force -ErrorAction SilentlyContinue; Write-Output 'Removed existing incomplete file'; } ")
                TEXT("$handler = New-Object System.Net.Http.HttpClientHandler; ")
                TEXT("$handler.AllowAutoRedirect = $true; ")
                TEXT("$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate; ")
                TEXT("$client = New-Object System.Net.Http.HttpClient($handler); ")
                TEXT("$client.Timeout = [TimeSpan]::FromMinutes(10); ")
                TEXT("$client.DefaultRequestHeaders.UserAgent.ParseAdd('CadetBuild/1.0'); ")
                TEXT("try { ")
                    TEXT("$response = $client.GetAsync('%s', [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult(); ")
                    TEXT("if (-not $response.IsSuccessStatusCode) { throw ('HTTP status: ' + [int]$response.StatusCode + ' ' + $response.ReasonPhrase); } ")
                    TEXT("$total = $response.Content.Headers.ContentLength; if (-not $total) { $total = -1; } ")
                    TEXT("$stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); ")
                    TEXT("$fileStream = [System.IO.File]::Open($outFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None); ")
                    TEXT("$buffer = New-Object byte[] 65536; $downloaded = [int64]0; $lastTick = [DateTime]::UtcNow; ")
                    TEXT("while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) { ")
                        TEXT("$fileStream.Write($buffer, 0, $read); ")
                        TEXT("$downloaded += $read; ")
                        TEXT("$now = [DateTime]::UtcNow; ")
                        TEXT("if (($now - $lastTick).TotalMilliseconds -ge 250) { ")
                            TEXT("if ($total -gt 0) { $pct = [Math]::Round(($downloaded * 100.0) / $total, 2); } else { $pct = -1; } ")
                            TEXT("Write-Output ('CADET_DOWNLOAD_PROGRESS|' + $downloaded + '|' + $total + '|' + $pct); ")
                            TEXT("$lastTick = $now; ")
                        TEXT("} ")
                    TEXT("} ")
                    TEXT("if ($total -gt 0) { $finalPct = 100.0; } else { $finalPct = -1; } ")
                    TEXT("Write-Output ('CADET_DOWNLOAD_PROGRESS|' + $downloaded + '|' + $total + '|' + $finalPct); ")
                    TEXT("$fileStream.Flush(); $fileStream.Dispose(); $stream.Dispose(); $response.Dispose(); ")
                    TEXT("Write-Output ('Download complete. Final size: ' + $downloaded + ' bytes'); ")
                TEXT("} catch { ")
                    TEXT("Write-Output ('Download exception type: ' + $_.Exception.GetType().FullName); ")
                    TEXT("Write-Output ('Download exception message: ' + $_.Exception.Message); ")
                    TEXT("if ($_.Exception.InnerException) { Write-Output ('Download inner exception: ' + $_.Exception.InnerException.Message); } ")
                    TEXT("throw; ")
                TEXT("} finally { ")
                    TEXT("if ($fileStream) { $fileStream.Dispose(); } ")
                    TEXT("if ($stream) { $stream.Dispose(); } ")
                    TEXT("if ($response) { $response.Dispose(); } ")
                    TEXT("if ($client) { $client.Dispose(); } ")
                    TEXT("if ($handler) { $handler.Dispose(); } ")
                TEXT("} ")
                TEXT("exit 0"),
                *EscapePowerShellSingleQuotedCosmos(TempZipPath),
                *EscapePowerShellSingleQuotedCosmos(DownloadUrl));

            int32 DownloadExitCode;
            FString DownloadOutput = ExecutePowerShellWithCapture(
                DownloadScript,
                DownloadExitCode,
                [&ReportProgress](const FString& OutputLine)
                {
                    int64 DownloadedBytes = 0;
                    int64 TotalBytes = -1;
                    double RawPercent = -1.0;
                    if (!ParseDownloadProgressLine(OutputLine, DownloadedBytes, TotalBytes, RawPercent))
                    {
                        return;
                    }

                    const float NormalizedDownloadProgress = (RawPercent >= 0.0)
                        ? FMath::Clamp(static_cast<float>(RawPercent / 100.0), 0.0f, 1.0f)
                        : 0.0f;

                    const float UiProgress = 0.1f + (NormalizedDownloadProgress * 0.55f);
                    const FString DownloadedText = FormatByteSize(DownloadedBytes);
                    const FString TotalText = (TotalBytes > 0) ? FormatByteSize(TotalBytes) : TEXT("unknown");
                    const FString Message = FString::Printf(
                        TEXT("Downloading Cosmos binaries... %s / %s"),
                        *DownloadedText,
                        *TotalText);
                    ReportProgress(ECadetDependencyState::Downloading, UiProgress, Message);
                });
            UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Download attempt %d (exit %d) output:\n%s"), Attempt, DownloadExitCode, *DownloadOutput);

            if (DownloadExitCode == 0 && FPaths::FileExists(TempZipPath))
            {
                int64 FileSize = IFileManager::Get().FileSize(*TempZipPath);
                if (FileSize > 0)
                {
                    UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Download successful, zip file size: %lld bytes"), FileSize);
                    bDownloadOk = true;
                    break;
                }

                DownloadError = TEXT("Download completed with a zero-byte file.");
                UE_LOG(LogCadetCosmosInstaller, Warning, TEXT("Download attempt %d produced a zero-byte file"), Attempt);
            }
            else
            {
                DownloadError = FString::Printf(TEXT("Download failed (exit code %d): %s"), DownloadExitCode, *DownloadOutput);
                UE_LOG(LogCadetCosmosInstaller, Warning, TEXT("Download attempt %d failed: %s"), Attempt, *DownloadError);
            }
        }

        if (!bDownloadOk)
        {
            ReportError(FString::Printf(TEXT("Failed to download Cosmos archive after %d attempts. Last error: %s"), 
                RequestCopy.MaxRetries, *DownloadError));
            return;
        }

        ReportProgress(ECadetDependencyState::Extracting, 0.7f, TEXT("Extracting Cosmos binaries..."));

        // Remove existing target before extraction
        const FString RemoveTargetScript = FString::Printf(
            TEXT("if (Test-Path '%s') { Write-Output 'Removing existing installation'; Remove-Item -LiteralPath '%s' -Recurse -Force -ErrorAction Stop; Write-Output 'Removal complete' } else { Write-Output 'No existing installation to remove' }"),
            *EscapePowerShellSingleQuotedCosmos(TargetInstallPath),
            *EscapePowerShellSingleQuotedCosmos(TargetInstallPath));

        int32 RemoveExitCode;
        FString RemoveOutput = ExecutePowerShellWithCapture(RemoveTargetScript, RemoveExitCode);
        UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Remove target (exit %d): %s"), RemoveExitCode, *RemoveOutput);

        // Extract archive
        const FString ExtractScript = FString::Printf(
            TEXT("if (Test-Path '%s') { Remove-Item -LiteralPath '%s' -Recurse -Force -ErrorAction SilentlyContinue } ")
            TEXT("New-Item -ItemType Directory -Path '%s' -Force -ErrorAction Stop | Out-Null; ")
            TEXT("Write-Output 'Extracting zip to temp location'; ")
            TEXT("Expand-Archive -LiteralPath '%s' -DestinationPath '%s' -Force -ErrorAction Stop; ")
            TEXT("Write-Output 'Zip extracted successfully'; ")
            TEXT("New-Item -ItemType Directory -Path '%s' -Force -ErrorAction Stop | Out-Null; ")
            TEXT("if (Test-Path '%s/cosmos-4.0.2') { ")
                TEXT("Write-Output 'Found cosmos-4.0.2 subfolder, moving its contents to target'; ")
                TEXT("Get-ChildItem -LiteralPath '%s/cosmos-4.0.2' -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination (Join-Path '%s' $_.Name) -Force -ErrorAction Stop }; ")
            TEXT("} else { ")
                TEXT("Write-Output 'No subfolder found, moving contents directly into target'; ")
                TEXT("Get-ChildItem -LiteralPath '%s' -Force | ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination (Join-Path '%s' $_.Name) -Force -ErrorAction Stop }; ")
            TEXT("} ")
            TEXT("Remove-Item -LiteralPath '%s' -Recurse -Force -ErrorAction SilentlyContinue; ")
            TEXT("Write-Output 'Extraction complete'; ")
            TEXT("exit 0"),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir),
            *EscapePowerShellSingleQuotedCosmos(TempZipPath),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir),
            *EscapePowerShellSingleQuotedCosmos(TargetInstallPath),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir),
            *EscapePowerShellSingleQuotedCosmos(TargetInstallPath),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir),
            *EscapePowerShellSingleQuotedCosmos(TargetInstallPath),
            *EscapePowerShellSingleQuotedCosmos(TempExtractDir));

        int32 ExtractExitCode;
        FString ExtractOutput = ExecutePowerShellWithCapture(ExtractScript, ExtractExitCode);
        UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Extract (exit %d) output:\n%s"), ExtractExitCode, *ExtractOutput);

        IFileManager::Get().Delete(*TempZipPath, false, true, true);
        IFileManager::Get().DeleteDirectory(*TempExtractDir, false, true);

        if (ExtractExitCode != 0)
        {
            ReportError(FString::Printf(TEXT("Failed to extract Cosmos archive: %s"), *ExtractOutput));
            return;
        }
#else
        ReportError(TEXT("Cosmos installer currently supports Windows only."));
        return;
#endif

        FString VerifyError;
        if (!VerifyInstall(TargetInstallPath, VerifyError))
        {
            ReportError(FString::Printf(TEXT("Cosmos installation verification failed: %s"), *VerifyError));
            return;
        }

        ReportProgress(ECadetDependencyState::Installed, 1.0f, TEXT("Cosmos installation complete."));

        Result.bSuccess = true;
        Result.InstallPath = TargetInstallPath;

        UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Cosmos installation succeeded at: %s"), *TargetInstallPath);

        if (OnComplete)
        {
            AsyncTask(ENamedThreads::GameThread, [OnComplete, Result]() { OnComplete(Result); });
        }
    });
}

bool FCadetCosmosInstaller::Uninstall(const FString& InstallPath, FString& OutError)
{
    OutError.Empty();

    if (InstallPath.IsEmpty())
    {
        OutError = TEXT("Cosmos install path is empty.");
        UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Uninstall failed: %s"), *OutError);
        return false;
    }

    FString Normalized = FPaths::ConvertRelativePathToFull(InstallPath);
    FPaths::NormalizeFilename(Normalized);

    UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Attempting to uninstall Cosmos from: %s"), *Normalized);

    if (!FPaths::DirectoryExists(Normalized))
    {
        UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Installation directory does not exist, nothing to uninstall"));
        return true;
    }

    if (!IFileManager::Get().DeleteDirectory(*Normalized, false, true))
    {
        OutError = FString::Printf(TEXT("Failed to delete Cosmos install directory: %s"), *Normalized);
        UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Uninstall failed: %s"), *OutError);
        return false;
    }

    UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Cosmos uninstall successful"));
    return true;
}

bool FCadetCosmosInstaller::VerifyInstall(const FString& InstallPath, FString& OutError)
{
    OutError.Empty();

    if (InstallPath.IsEmpty())
    {
        OutError = TEXT("Cosmos install path is empty.");
        UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Verify failed: %s"), *OutError);
        return false;
    }

    FString Normalized = FPaths::ConvertRelativePathToFull(InstallPath);
    FPaths::NormalizeFilename(Normalized);

    UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Verifying Cosmos installation at: %s"), *Normalized);

    if (!FPaths::DirectoryExists(Normalized))
    {
        OutError = FString::Printf(TEXT("Cosmos directory does not exist: %s"), *Normalized);
        UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Verify failed: %s"), *OutError);
        return false;
    }

    const FString BinDir = FPaths::Combine(Normalized, TEXT("bin"));
    FString ResolvedBinDir = BinDir;
    if (!FPaths::DirectoryExists(ResolvedBinDir))
    {
        TArray<FString> ChildDirs;
        IFileManager::Get().FindFiles(ChildDirs, *(Normalized / TEXT("*")), false, true);
        bool bFoundNestedBin = false;
        for (const FString& ChildDirName : ChildDirs)
        {
            const FString CandidateBin = FPaths::Combine(Normalized, ChildDirName, TEXT("bin"));
            if (FPaths::DirectoryExists(CandidateBin))
            {
                ResolvedBinDir = CandidateBin;
                bFoundNestedBin = true;
                break;
            }
        }

        if (!bFoundNestedBin)
        {
            OutError = FString::Printf(TEXT("Cosmos bin directory is missing: %s"), *BinDir);
            UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Verify failed: %s"), *OutError);
            return false;
        }
    }

    const FString BashPath = FPaths::Combine(ResolvedBinDir, TEXT("bash"));
    const FString BashExePath = FPaths::Combine(ResolvedBinDir, TEXT("bash.exe"));
    if (!FPaths::FileExists(BashPath) && !FPaths::FileExists(BashExePath))
    {
        OutError = FString::Printf(TEXT("Cosmos bash binary not found in: %s"), *ResolvedBinDir);
        UE_LOG(LogCadetCosmosInstaller, Error, TEXT("Verify failed: %s"), *OutError);
        return false;
    }

    UE_LOG(LogCadetCosmosInstaller, Log, TEXT("Cosmos verification successful - bash binary found"));
    return true;
}

