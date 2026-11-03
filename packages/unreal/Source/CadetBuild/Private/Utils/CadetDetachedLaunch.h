#pragma once

#include "CoreMinimal.h"

struct FCadetDetachedLaunchRequest
{
    FString BashPath;
    FString DistScriptPath;
    FString RuntimeProfilePath;
    FString VdfsDirectory;
    FString JobGuid;
    FString LaunchToken;
    FString StatusFilePath;
    FString CosmosBinPath;
    bool bRunBuild = true;
    bool bRunSteamPublish = true;
};

struct FCadetDetachedLaunchPlan
{
    FString LauncherPath;
    FString LauncherArgs;
    FString Script;           // raw PowerShell script content (before it is written to disk)
    FString ScriptFilePath;   // path where the script was written (empty = not written yet)
    FString StdOutLogPath;    // bash stdout will be redirected here
    FString StdErrLogPath;    // bash stderr will be redirected here
    bool bLaunchDetached = true;
    bool bLaunchHidden = true;
    bool bLaunchReallyHidden = true;
    bool bUsePipes = false;
};

bool BuildDetachedLaunchPlanWindows(const FCadetDetachedLaunchRequest& Request, FCadetDetachedLaunchPlan& OutPlan, FString& OutError);
