#include "CadetProfileModel.h"

#include "HAL/FileManager.h"
#include "JsonObjectConverter.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"

namespace
{
    TSharedPtr<FJsonObject> ToJsonObject(const FCadetProfileData& Profile)
    {
        TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();
        Obj->SetStringField(TEXT("profileName"), Profile.ProfileName);
        Obj->SetStringField(TEXT("platform"), Profile.Platform);
        Obj->SetStringField(TEXT("os"), Profile.Os);

        TSharedPtr<FJsonObject> UnrealObj = MakeShared<FJsonObject>();
        UnrealObj->SetStringField(TEXT("engineRoot"), Profile.Unreal.EngineRoot);
        UnrealObj->SetStringField(TEXT("projectPath"), Profile.Unreal.ProjectPath);
        UnrealObj->SetStringField(TEXT("buildOutputPath"), Profile.Unreal.BuildOutputPath);
        UnrealObj->SetStringField(TEXT("projectName"), Profile.Unreal.ProjectName);
        UnrealObj->SetStringField(TEXT("buildConfiguration"), Profile.Unreal.BuildConfiguration);
        if (!Profile.Unreal.TargetPlatforms.IsEmpty())
        {
            TArray<TSharedPtr<FJsonValue>> Platforms;
            TArray<FString> SplitPlatforms;
            Profile.Unreal.TargetPlatforms.ParseIntoArray(SplitPlatforms, TEXT(","), true);
            for (FString Platform : SplitPlatforms)
            {
                Platform.TrimStartAndEndInline();
                if (!Platform.IsEmpty())
                {
                    Platforms.Add(MakeShared<FJsonValueString>(Platform));
                }
            }

            if (Platforms.Num() > 0)
            {
                UnrealObj->SetArrayField(TEXT("targetPlatforms"), Platforms);
            }
        }
        UnrealObj->SetStringField(TEXT("archiveDirectory"), Profile.Unreal.ArchiveDirectory);
        UnrealObj->SetStringField(TEXT("cookerSettingsOverride"), Profile.Unreal.CookerSettingsOverride);
        UnrealObj->SetStringField(TEXT("packagingIniOverride"), Profile.Unreal.PackagingIniOverride);
        Obj->SetObjectField(TEXT("unreal"), UnrealObj);

        TSharedPtr<FJsonObject> SteamObj = MakeShared<FJsonObject>();
        SteamObj->SetStringField(TEXT("appId"), Profile.Steam.AppId);
        SteamObj->SetStringField(TEXT("steamcmdExe"), Profile.Steam.SteamCmdExe);
        SteamObj->SetBoolField(TEXT("useSentryFile"), Profile.Steam.bUseSentryFile);
        SteamObj->SetStringField(TEXT("description"), Profile.Steam.Description);
        SteamObj->SetStringField(TEXT("setLive"), Profile.Steam.SetLive);
        SteamObj->SetStringField(TEXT("contentRoot"), Profile.Steam.ContentRoot);
        SteamObj->SetStringField(TEXT("buildOutput"), Profile.Steam.BuildOutput);

        if (Profile.Steam.Depots.Num() > 0)
        {
            TArray<TSharedPtr<FJsonValue>> DepotValues;
            for (const FCadetProfileData::FSteamSettings::FSteamDepot& Depot : Profile.Steam.Depots)
            {
                if (Depot.DepotId.IsEmpty())
                {
                    continue;
                }

                TSharedPtr<FJsonObject> DepotObj = MakeShared<FJsonObject>();
                DepotObj->SetStringField(TEXT("depotId"), Depot.DepotId);
                DepotObj->SetStringField(TEXT("os"), Depot.Os.IsEmpty() ? TEXT("windows") : Depot.Os);
                DepotObj->SetStringField(TEXT("localPath"), Depot.LocalPath.IsEmpty() ? TEXT("windows\\\\*") : Depot.LocalPath);
                DepotObj->SetStringField(TEXT("depotPath"), Depot.DepotPath.IsEmpty() ? TEXT(".") : Depot.DepotPath);
                DepotObj->SetStringField(TEXT("recursive"), Depot.Recursive.IsEmpty() ? TEXT("1") : Depot.Recursive);
                DepotValues.Add(MakeShared<FJsonValueObject>(DepotObj));
            }

            if (DepotValues.Num() > 0)
            {
                SteamObj->SetArrayField(TEXT("depots"), DepotValues);
            }
        }

        Obj->SetObjectField(TEXT("steam"), SteamObj);

        return Obj;
    }

    bool FromJsonObject(const TSharedPtr<FJsonObject>& Obj, FCadetProfileData& Out)
    {
        if (!Obj.IsValid())
        {
            return false;
        }

        FString Name;
        if (!Obj->TryGetStringField(TEXT("profileName"), Name) || Name.IsEmpty())
        {
            return false;
        }

        Out.ProfileName = Name;
        Out.Platform = Obj->GetStringField(TEXT("platform"));
        Out.Os = Obj->GetStringField(TEXT("os"));

        if (Out.Platform.IsEmpty())
        {
            Out.Platform = TEXT("steam");
        }
        if (Out.Os.IsEmpty())
        {
            Out.Os = TEXT("windows");
        }

        const TSharedPtr<FJsonObject>* UnrealObj = nullptr;
        if (Obj->TryGetObjectField(TEXT("unreal"), UnrealObj) && UnrealObj != nullptr && UnrealObj->IsValid())
        {
            (*UnrealObj)->TryGetStringField(TEXT("engineRoot"), Out.Unreal.EngineRoot);
            (*UnrealObj)->TryGetStringField(TEXT("projectPath"), Out.Unreal.ProjectPath);
            (*UnrealObj)->TryGetStringField(TEXT("buildOutputPath"), Out.Unreal.BuildOutputPath);
            (*UnrealObj)->TryGetStringField(TEXT("projectName"), Out.Unreal.ProjectName);
            (*UnrealObj)->TryGetStringField(TEXT("buildConfiguration"), Out.Unreal.BuildConfiguration);
            (*UnrealObj)->TryGetStringField(TEXT("archiveDirectory"), Out.Unreal.ArchiveDirectory);
            (*UnrealObj)->TryGetStringField(TEXT("cookerSettingsOverride"), Out.Unreal.CookerSettingsOverride);
            (*UnrealObj)->TryGetStringField(TEXT("packagingIniOverride"), Out.Unreal.PackagingIniOverride);

            const TArray<TSharedPtr<FJsonValue>>* TargetPlatforms = nullptr;
            if ((*UnrealObj)->TryGetArrayField(TEXT("targetPlatforms"), TargetPlatforms) && TargetPlatforms != nullptr)
            {
                TArray<FString> Values;
                for (const TSharedPtr<FJsonValue>& Entry : *TargetPlatforms)
                {
                    FString PlatformValue;
                    if (Entry.IsValid() && Entry->TryGetString(PlatformValue) && !PlatformValue.IsEmpty())
                    {
                        Values.Add(PlatformValue);
                    }
                }
                Out.Unreal.TargetPlatforms = FString::Join(Values, TEXT(", "));
            }
        }

        if (Out.Unreal.BuildConfiguration.IsEmpty())
        {
            Out.Unreal.BuildConfiguration = TEXT("Shipping");
        }
        if (Out.Unreal.TargetPlatforms.IsEmpty())
        {
            Out.Unreal.TargetPlatforms = TEXT("Win64");
        }

        const TSharedPtr<FJsonObject>* SteamObj = nullptr;
        if (Obj->TryGetObjectField(TEXT("steam"), SteamObj) && SteamObj != nullptr && SteamObj->IsValid())
        {
            (*SteamObj)->TryGetStringField(TEXT("appId"), Out.Steam.AppId);
            (*SteamObj)->TryGetStringField(TEXT("steamcmdExe"), Out.Steam.SteamCmdExe);
            (*SteamObj)->TryGetBoolField(TEXT("useSentryFile"), Out.Steam.bUseSentryFile);
            (*SteamObj)->TryGetStringField(TEXT("description"), Out.Steam.Description);
            (*SteamObj)->TryGetStringField(TEXT("setLive"), Out.Steam.SetLive);
            (*SteamObj)->TryGetStringField(TEXT("contentRoot"), Out.Steam.ContentRoot);
            (*SteamObj)->TryGetStringField(TEXT("buildOutput"), Out.Steam.BuildOutput);

            const TArray<TSharedPtr<FJsonValue>>* Depots = nullptr;
            if ((*SteamObj)->TryGetArrayField(TEXT("depots"), Depots) && Depots != nullptr)
            {
                Out.Steam.Depots.Reset();
                for (const TSharedPtr<FJsonValue>& Entry : *Depots)
                {
                    const TSharedPtr<FJsonObject>* DepotObj = nullptr;
                    if (!Entry.IsValid() || !Entry->TryGetObject(DepotObj) || DepotObj == nullptr || !DepotObj->IsValid())
                    {
                        continue;
                    }

                    FCadetProfileData::FSteamSettings::FSteamDepot Depot;
                    (*DepotObj)->TryGetStringField(TEXT("depotId"), Depot.DepotId);
                    (*DepotObj)->TryGetStringField(TEXT("os"), Depot.Os);
                    (*DepotObj)->TryGetStringField(TEXT("localPath"), Depot.LocalPath);
                    (*DepotObj)->TryGetStringField(TEXT("depotPath"), Depot.DepotPath);
                    (*DepotObj)->TryGetStringField(TEXT("recursive"), Depot.Recursive);

                    if (!Depot.DepotId.IsEmpty())
                    {
                        if (Depot.Os.IsEmpty())
                        {
                            Depot.Os = TEXT("windows");
                        }
                        if (Depot.LocalPath.IsEmpty())
                        {
                            Depot.LocalPath = TEXT("windows\\\\*");
                        }
                        if (Depot.DepotPath.IsEmpty())
                        {
                            Depot.DepotPath = TEXT(".");
                        }
                        if (Depot.Recursive.IsEmpty())
                        {
                            Depot.Recursive = TEXT("1");
                        }

                        Out.Steam.Depots.Add(Depot);
                    }
                }
            }
        }

        return true;
    }
}

FString FCadetProfileStore::GetProfilesDirectory()
{
    return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Config"), TEXT("CadetBuild"), TEXT("Profiles"));
}

bool FCadetProfileStore::EnsureProfilesDirectory()
{
    return IFileManager::Get().MakeDirectory(*GetProfilesDirectory(), true);
}

TArray<FCadetProfileData> FCadetProfileStore::LoadAllProfiles()
{
    TArray<FCadetProfileData> Profiles;

    const FString ProfilesDir = GetProfilesDirectory();
    IFileManager& FileManager = IFileManager::Get();

    if (!FileManager.DirectoryExists(*ProfilesDir))
    {
        return Profiles;
    }

    TArray<FString> JsonFiles;
    FileManager.FindFiles(JsonFiles, *FPaths::Combine(ProfilesDir, TEXT("*.json")), true, false);

    JsonFiles.Sort();

    for (const FString& FileName : JsonFiles)
    {
        const FString FullPath = FPaths::Combine(ProfilesDir, FileName);

        FString JsonText;
        if (!FFileHelper::LoadFileToString(JsonText, *FullPath))
        {
            continue;
        }

        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonText);
        TSharedPtr<FJsonObject> Obj;
        if (!FJsonSerializer::Deserialize(Reader, Obj) || !Obj.IsValid())
        {
            continue;
        }

        FCadetProfileData Data;
        if (FromJsonObject(Obj, Data))
        {
            Profiles.Add(Data);
        }
    }

    return Profiles;
}

bool FCadetProfileStore::SaveProfile(const FCadetProfileData& Profile, FString* OutError, const FString* PreviousProfileName)
{
    if (Profile.ProfileName.IsEmpty())
    {
        if (OutError)
        {
            *OutError = TEXT("Profile name cannot be empty.");
        }
        return false;
    }

    if (!EnsureProfilesDirectory())
    {
        if (OutError)
        {
            *OutError = TEXT("Failed to create profiles directory.");
        }
        return false;
    }

    const TSharedPtr<FJsonObject> Obj = ToJsonObject(Profile);
    FString JsonText;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonText);
    if (!FJsonSerializer::Serialize(Obj.ToSharedRef(), Writer))
    {
        if (OutError)
        {
            *OutError = TEXT("Failed to serialize profile to JSON.");
        }
        return false;
    }

    const FString TargetPath = FPaths::Combine(GetProfilesDirectory(), MakeSafeProfileFileName(Profile.ProfileName) + TEXT(".json"));
    if (!FFileHelper::SaveStringToFile(JsonText, *TargetPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
    {
        if (OutError)
        {
            *OutError = FString::Printf(TEXT("Failed to write profile file: %s"), *TargetPath);
        }
        return false;
    }

    if (PreviousProfileName != nullptr && !PreviousProfileName->IsEmpty() && *PreviousProfileName != Profile.ProfileName)
    {
        const FString PreviousPath = FPaths::Combine(GetProfilesDirectory(), MakeSafeProfileFileName(*PreviousProfileName) + TEXT(".json"));
        if (FPaths::FileExists(PreviousPath))
        {
            IFileManager::Get().Delete(*PreviousPath, false, true, true);
        }
    }

    return true;
}

bool FCadetProfileStore::DeleteProfileByName(const FString& ProfileName, FString* OutError)
{
    const FString SafeName = MakeSafeProfileFileName(ProfileName);
    const FString Path = FPaths::Combine(GetProfilesDirectory(), SafeName + TEXT(".json"));

    if (!FPaths::FileExists(Path))
    {
        if (OutError)
        {
            *OutError = FString::Printf(TEXT("Profile file not found: %s"), *Path);
        }
        return false;
    }

    if (!IFileManager::Get().Delete(*Path, false, true, true))
    {
        if (OutError)
        {
            *OutError = FString::Printf(TEXT("Failed to delete profile file: %s"), *Path);
        }
        return false;
    }

    return true;
}

bool FCadetProfileStore::ExportProfile(const FCadetProfileData& Profile, FString* OutFilePath, FString* OutError)
{
    const FString ExportsDir = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Config"), TEXT("CadetBuild"), TEXT("Exports"));
    IFileManager::Get().MakeDirectory(*ExportsDir, true);

    const FString ExportPath = FPaths::Combine(ExportsDir, MakeSafeProfileFileName(Profile.ProfileName) + TEXT(".json"));

    const TSharedPtr<FJsonObject> Obj = ToJsonObject(Profile);
    FString JsonText;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonText);
    if (!FJsonSerializer::Serialize(Obj.ToSharedRef(), Writer))
    {
        if (OutError)
        {
            *OutError = TEXT("Failed to serialize profile for export.");
        }
        return false;
    }

    if (!FFileHelper::SaveStringToFile(JsonText, *ExportPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
    {
        if (OutError)
        {
            *OutError = FString::Printf(TEXT("Failed to write export file: %s"), *ExportPath);
        }
        return false;
    }

    if (OutFilePath)
    {
        *OutFilePath = ExportPath;
    }

    return true;
}

bool FCadetProfileStore::SerializeProfileToString(const FCadetProfileData& Profile, FString& OutJson, FString* OutError)
{
    const TSharedPtr<FJsonObject> Obj = ToJsonObject(Profile);
    const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutJson);
    if (!FJsonSerializer::Serialize(Obj.ToSharedRef(), Writer))
    {
        if (OutError)
        {
            *OutError = TEXT("Failed to serialize profile to JSON.");
        }
        return false;
    }

    return true;
}

bool FCadetProfileStore::DeserializeProfileFromString(const FString& JsonText, FCadetProfileData& OutProfile, FString* OutError)
{
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonText);
    TSharedPtr<FJsonObject> Obj;
    if (!FJsonSerializer::Deserialize(Reader, Obj) || !Obj.IsValid())
    {
        if (OutError)
        {
            *OutError = TEXT("Failed to parse profile JSON.");
        }
        return false;
    }

    if (!FromJsonObject(Obj, OutProfile))
    {
        if (OutError)
        {
            *OutError = TEXT("Profile JSON has no profileName.");
        }
        return false;
    }

    return true;
}

FString FCadetProfileStore::MakeSafeProfileFileName(const FString& ProfileName)
{
    FString Safe = ProfileName;
    Safe.TrimStartAndEndInline();

    if (Safe.IsEmpty())
    {
        Safe = TEXT("Profile");
    }

    const TCHAR Forbidden[] = { '\\', '/', ':', '*', '?', '"', '<', '>', '|', '\0' };
    for (int32 Index = 0; Forbidden[Index] != '\0'; ++Index)
    {
        const TCHAR Search[2] = { Forbidden[Index], '\0' };
        Safe.ReplaceInline(Search, TEXT("_"));
    }

    return Safe;
}
