#include "Utils/CadetDetachedLaunch.h"

namespace
{
    FString EscapePowerShellSingleQuoted(const FString& Value)
    {
        FString Escaped = Value;
        Escaped.ReplaceInline(TEXT("'"), TEXT("''"));
        return Escaped;
    }
}

bool BuildDetachedLaunchPlanWindows(const FCadetDetachedLaunchRequest& Request, FCadetDetachedLaunchPlan& OutPlan, FString& OutError)
{
    if (Request.BashPath.IsEmpty())
    {
        OutError = TEXT("BashPath is required for detached launch.");
        return false;
    }
    if (Request.DistScriptPath.IsEmpty())
    {
        OutError = TEXT("DistScriptPath is required for detached launch.");
        return false;
    }
    if (Request.RuntimeProfilePath.IsEmpty())
    {
        OutError = TEXT("RuntimeProfilePath is required for detached launch.");
        return false;
    }
    if (Request.VdfsDirectory.IsEmpty())
    {
        OutError = TEXT("VdfsDirectory is required for detached launch.");
        return false;
    }
    if (Request.JobGuid.IsEmpty())
    {
        OutError = TEXT("JobGuid is required for detached launch.");
        return false;
    }
    if (Request.LaunchToken.IsEmpty())
    {
        OutError = TEXT("LaunchToken is required for detached launch.");
        return false;
    }
    if (Request.StatusFilePath.IsEmpty())
    {
        OutError = TEXT("StatusFilePath is required for detached launch.");
        return false;
    }
    if (!Request.bRunBuild && !Request.bRunSteamPublish)
    {
        OutError = TEXT("At least one operation must be enabled (build and/or publish).");
        return false;
    }

    const FString DistScriptArg = EscapePowerShellSingleQuoted(Request.DistScriptPath);
    const FString RuntimeProfileArg = EscapePowerShellSingleQuoted(Request.RuntimeProfilePath);
    const FString VdfsDirectoryArg = EscapePowerShellSingleQuoted(Request.VdfsDirectory);
    const FString JobGuidArg = EscapePowerShellSingleQuoted(Request.JobGuid);
    const FString LaunchTokenArg = EscapePowerShellSingleQuoted(Request.LaunchToken);
    const FString StatusFileArg = EscapePowerShellSingleQuoted(Request.StatusFilePath);
    FString OperationFlagArg;
    if (Request.bRunBuild && !Request.bRunSteamPublish)
    {
        OperationFlagArg = TEXT("'--build-only',");
    }
    else if (!Request.bRunBuild && Request.bRunSteamPublish)
    {
        OperationFlagArg = TEXT("'--publish-only',");
    }

    // Build environment setup to pass COSMOS_BIN_DIR (contains jq)
    // Priority: configured Cosmos path from settings, then existing env var, then plugin fallback.
    const FString ConfiguredCosmosBinPath = EscapePowerShellSingleQuoted(Request.CosmosBinPath);
    const FString EnvSetup = FString::Printf(
        TEXT("$cosmosBinDir = '%s'; ")
        TEXT("if ([string]::IsNullOrEmpty($cosmosBinDir)) {$cosmosBinDir = $env:COSMOS_BIN_DIR} ")
        TEXT("if ([string]::IsNullOrEmpty($cosmosBinDir)) {")
            TEXT("$pluginsWin64 = Join-Path (Get-Location) 'Plugins/CadetBuild/Binaries/Win64'; ")
            TEXT("if (Test-Path $pluginsWin64) {$cosmosBinDir = $pluginsWin64} ")
            TEXT("else {")
                TEXT("$pluginsBinaries = Join-Path (Get-Location) 'Plugins/CadetBuild/Binaries'; ")
                TEXT("if (Test-Path $pluginsBinaries) {$cosmosBinDir = $pluginsBinaries} ")
            TEXT("}")
        TEXT("} ")
        TEXT("$env:COSMOS_BIN_DIR = $cosmosBinDir; "),
        *ConfiguredCosmosBinPath);

    // Derive log file paths alongside the status file (same dir, different suffix)
    const FString StatusFileDir = FPaths::GetPath(Request.StatusFilePath);
    const FString LogBase = FPaths::Combine(StatusFileDir, Request.JobGuid);
    const FString StdOutLogPath = LogBase + TEXT("-bash-stdout.log");
    const FString StdErrLogPath = LogBase + TEXT("-bash-stderr.log");
    const FString StdOutLogArg = EscapePowerShellSingleQuoted(StdOutLogPath);
    const FString StdErrLogArg = EscapePowerShellSingleQuoted(StdErrLogPath);

    const FString PowerShellScript = FString::Printf(
        TEXT("$ErrorActionPreference='Stop'; %s")
        TEXT("$statusFile = '%s'; ")
        TEXT("$stdoutLog = '%s'; ")
        TEXT("$stderrLog = '%s'; ")
        TEXT("$stdinRedirect = [System.IO.Path]::GetTempFileName(); ")
        TEXT("try { ")
            TEXT("$argList = @(")
                TEXT("'%s',")
                TEXT("'--engine=unreal',")
                TEXT("'--profile-json','%s',")
                TEXT("'--generated-vdfs-directory','%s',")
                TEXT("%s")
                TEXT("'--job-guid','%s',")
                TEXT("'--launch-token','%s',")
                TEXT("'--status-file','%s',")
                TEXT("'--mode=plugin'")
            TEXT("); ")
            // -NoNewWindow is required on Windows when using -RedirectStandardOutput/-Error.
            // Use a real temporary file for stdin redirection. 'NUL' is not accepted reliably by
            // Start-Process -RedirectStandardInput in all shells/working directories.
            TEXT("Start-Process -FilePath '%s' -ArgumentList $argList -UseNewEnvironment:$false -NoNewWindow ")
                TEXT("-RedirectStandardInput $stdinRedirect -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog | Out-Null; ")
        TEXT("} catch { ")
            TEXT("$msg = $_.Exception.Message; ")
            TEXT("$msg = $msg -replace '\\\\','\\\\\\\\'; ")
            TEXT("$msg = $msg -replace '\"','\\\"'; ")
            TEXT("$json = '{\"overallStatus\":\"failed\",\"status\":\"failed\",\"terminal\":true,\"exitCode\":-1,\"phase\":\"launch\",\"details\":\"Detached launcher failed: ' + $msg + '\"}'; ")
            TEXT("Set-Content -LiteralPath $statusFile -Value $json -Encoding UTF8 -Force; ")
            TEXT("throw; ")
        TEXT("} finally { ")
            TEXT("if (Test-Path -LiteralPath $stdinRedirect) { Remove-Item -LiteralPath $stdinRedirect -Force -ErrorAction SilentlyContinue } ")
        TEXT("}"),
        *EnvSetup,
        *StatusFileArg,
        *StdOutLogArg,
        *StdErrLogArg,
        *DistScriptArg,
        *RuntimeProfileArg,
        *VdfsDirectoryArg,
        *OperationFlagArg,
        *JobGuidArg,
        *LaunchTokenArg,
        *StatusFileArg,
        *EscapePowerShellSingleQuoted(Request.BashPath));

    OutPlan = FCadetDetachedLaunchPlan();
    OutPlan.LauncherPath = TEXT("powershell.exe");
    OutPlan.Script = PowerShellScript;
    OutPlan.StdOutLogPath = StdOutLogPath;
    OutPlan.StdErrLogPath = StdErrLogPath;
    // LauncherArgs is set to the inline -Command form as a fallback.
    // The caller should write OutPlan.Script to a .ps1 file and switch to -File for reliability.
    OutPlan.LauncherArgs = FString::Printf(
        TEXT("-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"%s\""),
        *PowerShellScript);

    OutError.Empty();
    return true;
}
