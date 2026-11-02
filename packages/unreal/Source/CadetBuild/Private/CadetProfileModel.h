#pragma once

#include "CoreMinimal.h"

struct FCadetProfileData
{
    struct FUnrealSettings
    {
        FString EngineRoot;
        FString ProjectPath;
        FString BuildOutputPath;
        FString ProjectName;
        FString BuildConfiguration;
        FString TargetPlatforms;
        FString ArchiveDirectory;

        /** Path to an .ini file that overrides DefaultEditorPerProjectUserSettings.ini
         *  in the synced cooker workspace immediately before build launch.
         *  Use this to disable auto-start servers (e.g. MCP on port 8000) that would
         *  conflict with the dev editor. Leave empty to keep the synced settings as-is. */
        FString CookerSettingsOverride;

        /** Path to an .ini file containing +MapsToCook / +DirectoriesToNeverCook
         *  entries to append to the workspace's DefaultGame.ini before cooking.
         *  Used to restrict cooked maps for demo/subset builds.
         *  Leave empty for full builds (all maps cooked). */
        FString PackagingIniOverride;
    };

    struct FSteamSettings
    {
        struct FSteamDepot
        {
            FString DepotId;
            FString Os;
            FString LocalPath;
            FString DepotPath;
            FString Recursive;
        };

        FString AppId;
        FString SteamCmdExe;
        bool bUseSentryFile = false;
        FString Description;
        FString SetLive;
        FString ContentRoot;
        FString BuildOutput;
        TArray<FSteamDepot> Depots;
    };

    FString ProfileName;
    FString Platform;
    FString Os;
    FUnrealSettings Unreal;
    FSteamSettings Steam;

    static FCadetProfileData MakeDefault(int32 Index = 1)
    {
        FCadetProfileData Data;
        Data.ProfileName = FString::Printf(TEXT("NewProfile-%d"), Index);
        Data.Platform = TEXT("steam");
        Data.Os = TEXT("windows");
        Data.Unreal.BuildConfiguration = TEXT("Shipping");
        Data.Unreal.TargetPlatforms = TEXT("Win64");
        Data.Steam.bUseSentryFile = false;
        return Data;
    }
};

class FCadetProfileStore
{
public:
    static FString GetProfilesDirectory();
    static bool EnsureProfilesDirectory();

    static TArray<FCadetProfileData> LoadAllProfiles();
    static bool SaveProfile(const FCadetProfileData& Profile, FString* OutError = nullptr, const FString* PreviousProfileName = nullptr);
    static bool DeleteProfileByName(const FString& ProfileName, FString* OutError = nullptr);
    static bool ExportProfile(const FCadetProfileData& Profile, FString* OutFilePath = nullptr, FString* OutError = nullptr);

    /** Model to JSON text, with the field names the shared schema defines. */
    static bool SerializeProfileToString(const FCadetProfileData& Profile, FString& OutJson, FString* OutError = nullptr);

    /** JSON text to model. Fails when the document has no profileName. */
    static bool DeserializeProfileFromString(const FString& JsonText, FCadetProfileData& OutProfile, FString* OutError = nullptr);

private:
    static FString MakeSafeProfileFileName(const FString& ProfileName);
};
