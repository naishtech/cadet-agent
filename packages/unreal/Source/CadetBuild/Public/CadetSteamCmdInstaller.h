#pragma once

#include "CoreMinimal.h"

struct FCadetCosmosInstallProgress;

struct FCadetSteamCmdInstallRequest
{
    FString DownloadUrl;
    FString TargetInstallPath;
    int32 MaxRetries = 3;
};

struct FCadetSteamCmdInstallResult
{
    bool bSuccess = false;
    FString InstallPath;
    FString Error;
};

class CADETBUILD_API FCadetSteamCmdInstaller
{
public:
    static void InstallAsync(
        const FCadetSteamCmdInstallRequest& Request,
        TFunction<void(const FCadetCosmosInstallProgress&)> OnProgress,
        TFunction<void(const FCadetSteamCmdInstallResult&)> OnComplete);

    static bool Uninstall(const FString& InstallPath, FString& OutError);

    static bool VerifyInstall(const FString& InstallPath, FString& OutError);
};
