#pragma once

#include "CoreMinimal.h"

enum class ECadetDependencyState : uint8
{
    Missing,
    Downloading,
    Extracting,
    Installed,
    Error
};

struct FCadetCosmosInstallRequest
{
    FString DownloadUrl;
    FString TargetInstallPath;
    int32 MaxRetries = 3;
    bool bAllowResume = true;
};

struct FCadetCosmosInstallProgress
{
    ECadetDependencyState State = ECadetDependencyState::Missing;
    int64 BytesDownloaded = 0;
    int64 TotalBytes = 0;
    float Percent = 0.0f;
    FString Message;
};

struct FCadetCosmosInstallResult
{
    bool bSuccess = false;
    FString InstallPath;
    FString Error;
};

class CADETBUILD_API FCadetCosmosInstaller
{
public:
    static void InstallAsync(
        const FCadetCosmosInstallRequest& Request,
        TFunction<void(const FCadetCosmosInstallProgress&)> OnProgress,
        TFunction<void(const FCadetCosmosInstallResult&)> OnComplete);

    static bool Uninstall(const FString& InstallPath, FString& OutError);

    static bool VerifyInstall(const FString& InstallPath, FString& OutError);
};
