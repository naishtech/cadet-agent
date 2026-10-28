#include "CadetSteamCmdInstaller.h"

#include "Async/Async.h"
#include "CadetCosmosInstaller.h"
#include "CadetDependencyManager.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "Math/UnrealMathUtility.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogCadetSteamCmdInstaller, Log, All);

namespace
{
    static const TCHAR* DownloadProgressPrefixSteam = TEXT("CADET_STEAMCMD_PROGRESS|");

    FString EscapePowerShellSingleQuotedSteam(const FString& Value)
    {
        FString Escaped = Value;
        Escaped.ReplaceInline(TEXT("'"), TEXT("''"));
        return Escaped;
    }

    FString FormatByteSizeSteam(int64 Bytes)
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

    bool ParseDownloadProgressLineSteam(const FString& InLine, int64& OutDownloaded, int64& OutTotal, double& OutPercent)
    {
        OutDownloaded = 0;
        OutTotal = -1;
        OutPercent = -1.0;

        FString Line = InLine;
        Line.ReplaceInline(TEXT("\r"), TEXT(""));
        Line.TrimStartAndEndInline();

        if (!Line.StartsWith(DownloadProgressPrefixSteam))
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

    FString ExecutePowerShellWithCaptureSteam(const FString& Command, int32& OutExitCode, TFunction<void(const FString&)> OnOutputLine = nullptr)
    {
        OutExitCode = -1;

        const FString FullScript = FString::Printf(
            TEXT("$ErrorActionPreference='Stop'; try { %s } catch { Write-Output \"ERROR: $_\"; exit 1 }"),
            *Command);

        void* PipeRead = nullptr;
        void* PipeWrite = nullptr;
        if (!FPlatformProcess::CreatePipe(PipeRead, PipeWrite))
        {
            UE_LOG(LogCadetSteamCmdInstaller, Error, TEXT("Failed to create pipes for PowerShell execution"));
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
            UE_LOG(LogCadetSteamCmdInstaller, Error, TEXT("Failed to start PowerShell process"));
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

        const FString RemainingLine = PendingLine.TrimStartAndEnd();
        if (OnOutputLine && !RemainingLine.IsEmpty())
        {
            OnOutputLine(RemainingLine);
        }

        int32 ExitCode = -1;
        FPlatformProcess::GetProcReturnCode(ProcessHandle, &ExitCode);
        OutExitCode = ExitCode;

        FPlatformProcess::CloseProc(ProcessHandle);
        FPlatformProcess::ClosePipe(PipeRead, PipeWrite);

        return Output;
    }
}

void FCadetSteamCmdInstaller::InstallAsync(
    const FCadetSteamCmdInstallRequest& Request,
    TFunction<void(const FCadetCosmosInstallProgress&)> OnProgress,
    TFunction<void(const FCadetSteamCmdInstallResult&)> OnComplete)
{
    const FCadetSteamCmdInstallRequest RequestCopy = Request;

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

            AsyncTask(ENamedThreads::GameThread, [OnProgress, Progress]()
            {
                OnProgress(Progress);
            });
        };

        auto ReportError = [&OnComplete](const FString& Error)
        {
            UE_LOG(LogCadetSteamCmdInstaller, Error, TEXT("Install failed: %s"), *Error);

            FCadetSteamCmdInstallResult Result;
            Result.bSuccess = false;
            Result.Error = Error;

            if (OnComplete)
            {
                AsyncTask(ENamedThreads::GameThread, [OnComplete, Result]() { OnComplete(Result); });
            }
        };

        FString TargetInstallPath = FPaths::ConvertRelativePathToFull(RequestCopy.TargetInstallPath);
        FPaths::NormalizeFilename(TargetInstallPath);

        if (TargetInstallPath.IsEmpty())
        {
            ReportError(TEXT("Target SteamCMD install path is empty."));
            return;
        }

#if PLATFORM_WINDOWS
        const FString DownloadUrl = RequestCopy.DownloadUrl.IsEmpty()
            ? TEXT("https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip")
            : RequestCopy.DownloadUrl;

        const FString ToolsRoot = FPaths::GetPath(TargetInstallPath);
        if (!IFileManager::Get().MakeDirectory(*ToolsRoot, true))
        {
            ReportError(FString::Printf(TEXT("Failed to create tools directory: %s"), *ToolsRoot));
            return;
        }

        const FString DownloadsDir = FPaths::Combine(ToolsRoot, TEXT("downloads~"));
        IFileManager::Get().MakeDirectory(*DownloadsDir, true);

        const FString TempZipPath = FPaths::Combine(DownloadsDir, TEXT("steamcmd.zip"));

        ReportProgress(ECadetDependencyState::Downloading, 0.05f, TEXT("Downloading SteamCMD binaries..."));

        bool bDownloadOk = false;
        FString DownloadError;

        for (int32 Attempt = 1; Attempt <= RequestCopy.MaxRetries; ++Attempt)
        {
            const FString DownloadScript = FString::Printf(
                TEXT("[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12; ")
                TEXT("Add-Type -AssemblyName System.Net.Http; ")
                TEXT("$ErrorActionPreference = 'Stop'; ")
                TEXT("$ProgressPreference = 'SilentlyContinue'; ")
                TEXT("$outFile = '%s'; ")
                TEXT("if (Test-Path $outFile) { Remove-Item $outFile -Force -ErrorAction SilentlyContinue; } ")
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
                            TEXT("Write-Output ('CADET_STEAMCMD_PROGRESS|' + $downloaded + '|' + $total + '|' + $pct); ")
                            TEXT("$lastTick = $now; ")
                        TEXT("} ")
                    TEXT("} ")
                    TEXT("if ($total -gt 0) { $finalPct = 100.0; } else { $finalPct = -1; } ")
                    TEXT("Write-Output ('CADET_STEAMCMD_PROGRESS|' + $downloaded + '|' + $total + '|' + $finalPct); ")
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
                *EscapePowerShellSingleQuotedSteam(TempZipPath),
                *EscapePowerShellSingleQuotedSteam(DownloadUrl));

            int32 DownloadExitCode = -1;
            FString DownloadOutput = ExecutePowerShellWithCaptureSteam(
                DownloadScript,
                DownloadExitCode,
                [&ReportProgress](const FString& OutputLine)
                {
                    int64 DownloadedBytes = 0;
                    int64 TotalBytes = -1;
                    double RawPercent = -1.0;
                    if (!ParseDownloadProgressLineSteam(OutputLine, DownloadedBytes, TotalBytes, RawPercent))
                    {
                        return;
                    }

                    const float NormalizedDownloadProgress = (RawPercent >= 0.0)
                        ? FMath::Clamp(static_cast<float>(RawPercent / 100.0), 0.0f, 1.0f)
                        : 0.0f;

                    const float UiProgress = 0.05f + (NormalizedDownloadProgress * 0.65f);
                    const FString TotalText = (TotalBytes > 0)
                        ? FormatByteSizeSteam(TotalBytes)
                        : FString(TEXT("unknown"));
                    const FString Message = FString::Printf(
                        TEXT("Downloading SteamCMD binaries... %s / %s"),
                        *FormatByteSizeSteam(DownloadedBytes),
                        *TotalText);

                    ReportProgress(ECadetDependencyState::Downloading, UiProgress, Message);
                });

            UE_LOG(LogCadetSteamCmdInstaller, Log, TEXT("Download attempt %d (exit %d) output:\n%s"), Attempt, DownloadExitCode, *DownloadOutput);

            if (DownloadExitCode == 0 && FPaths::FileExists(TempZipPath))
            {
                const int64 FileSize = IFileManager::Get().FileSize(*TempZipPath);
                if (FileSize > 0)
                {
                    bDownloadOk = true;
                    break;
                }
                DownloadError = TEXT("Download completed with a zero-byte file.");
            }
            else
            {
                DownloadError = FString::Printf(TEXT("Download failed (exit code %d): %s"), DownloadExitCode, *DownloadOutput);
            }
        }

        if (!bDownloadOk)
        {
            ReportError(FString::Printf(TEXT("Failed to download SteamCMD archive after %d attempts. Last error: %s"), RequestCopy.MaxRetries, *DownloadError));
            return;
        }

        ReportProgress(ECadetDependencyState::Extracting, 0.75f, TEXT("Extracting SteamCMD binaries..."));

        const FString ExtractScript = FString::Printf(
            TEXT("if (Test-Path '%s') { Remove-Item -LiteralPath '%s' -Recurse -Force -ErrorAction SilentlyContinue } ")
            TEXT("New-Item -ItemType Directory -Path '%s' -Force -ErrorAction Stop | Out-Null; ")
            TEXT("Write-Output 'Extracting SteamCMD zip'; ")
            TEXT("Expand-Archive -LiteralPath '%s' -DestinationPath '%s' -Force -ErrorAction Stop; ")
            TEXT("Write-Output 'Extraction complete'; ")
            TEXT("exit 0"),
            *EscapePowerShellSingleQuotedSteam(TargetInstallPath),
            *EscapePowerShellSingleQuotedSteam(TargetInstallPath),
            *EscapePowerShellSingleQuotedSteam(TargetInstallPath),
            *EscapePowerShellSingleQuotedSteam(TempZipPath),
            *EscapePowerShellSingleQuotedSteam(TargetInstallPath));

        int32 ExtractExitCode = -1;
        FString ExtractOutput = ExecutePowerShellWithCaptureSteam(ExtractScript, ExtractExitCode);
        UE_LOG(LogCadetSteamCmdInstaller, Log, TEXT("Extract (exit %d) output:\n%s"), ExtractExitCode, *ExtractOutput);

        IFileManager::Get().Delete(*TempZipPath, false, true, true);

        if (ExtractExitCode != 0)
        {
            ReportError(FString::Printf(TEXT("Failed to extract SteamCMD archive: %s"), *ExtractOutput));
            return;
        }
#else
        ReportError(TEXT("SteamCMD installer currently supports Windows only."));
        return;
#endif

        FString VerifyError;
        if (!VerifyInstall(TargetInstallPath, VerifyError))
        {
            ReportError(FString::Printf(TEXT("SteamCMD installation verification failed: %s"), *VerifyError));
            return;
        }

        ReportProgress(ECadetDependencyState::Installed, 1.0f, TEXT("SteamCMD installation complete."));

        FCadetSteamCmdInstallResult Result;
        Result.bSuccess = true;
        Result.InstallPath = TargetInstallPath;

        if (OnComplete)
        {
            AsyncTask(ENamedThreads::GameThread, [OnComplete, Result]() { OnComplete(Result); });
        }
    });
}

bool FCadetSteamCmdInstaller::Uninstall(const FString& InstallPath, FString& OutError)
{
    OutError.Empty();

    if (InstallPath.IsEmpty())
    {
        OutError = TEXT("SteamCMD install path is empty.");
        return false;
    }

    FString Normalized = FPaths::ConvertRelativePathToFull(InstallPath);
    FPaths::NormalizeFilename(Normalized);

    if (!FPaths::DirectoryExists(Normalized))
    {
        return true;
    }

    if (!IFileManager::Get().DeleteDirectory(*Normalized, false, true))
    {
        OutError = FString::Printf(TEXT("Failed to delete SteamCMD install directory: %s"), *Normalized);
        return false;
    }

    return true;
}

bool FCadetSteamCmdInstaller::VerifyInstall(const FString& InstallPath, FString& OutError)
{
    OutError.Empty();

    if (InstallPath.IsEmpty())
    {
        OutError = TEXT("SteamCMD install path is empty.");
        return false;
    }

    FString Normalized = FPaths::ConvertRelativePathToFull(InstallPath);
    FPaths::NormalizeFilename(Normalized);

    if (!FPaths::DirectoryExists(Normalized))
    {
        OutError = FString::Printf(TEXT("SteamCMD directory does not exist: %s"), *Normalized);
        return false;
    }

#if PLATFORM_WINDOWS
    const FString SteamCmdExe = FPaths::Combine(Normalized, TEXT("steamcmd.exe"));
    if (!FPaths::FileExists(SteamCmdExe))
    {
        OutError = FString::Printf(TEXT("SteamCMD executable is missing: %s"), *SteamCmdExe);
        return false;
    }
#else
    const FString SteamCmdSh = FPaths::Combine(Normalized, TEXT("steamcmd.sh"));
    if (!FPaths::FileExists(SteamCmdSh))
    {
        OutError = FString::Printf(TEXT("SteamCMD script is missing: %s"), *SteamCmdSh);
        return false;
    }
#endif

    return true;
}

