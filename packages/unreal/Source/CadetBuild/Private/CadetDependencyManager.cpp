#include "CadetDependencyManager.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Json.h"
#include "JsonUtilities.h"

namespace
{
	const TCHAR* CadetSettingsRelativePath = TEXT("Config/CadetBuild/CadetBuildSettings.json");
	const TCHAR* SteamCmdPathKey = TEXT("SteamCmdPath");
	const TCHAR* CosmosPathKey = TEXT("CosmosPath");

	FString GetCadetSettingsFilePath()
	{
		return FPaths::ProjectSavedDir() / CadetSettingsRelativePath;
	}

	TSharedPtr<FJsonObject> LoadCadetSettingsJson()
	{
		TSharedPtr<FJsonObject> Json = MakeShareable(new FJsonObject());
		const FString SettingsFile = GetCadetSettingsFilePath();
		if (!FPaths::FileExists(SettingsFile))
		{
			return Json;
		}

		FString Existing;
		if (!FFileHelper::LoadFileToString(Existing, *SettingsFile))
		{
			return Json;
		}

		TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Existing);
		TSharedPtr<FJsonObject> Parsed;
		if (FJsonSerializer::Deserialize(Reader, Parsed) && Parsed.IsValid())
		{
			return Parsed;
		}

		return Json;
	}

	bool SaveCadetSettingsJson(const TSharedPtr<FJsonObject>& Json)
	{
		const FString SettingsDir = FPaths::ProjectSavedDir() / TEXT("Config/CadetBuild");
		const FString SettingsFile = SettingsDir / TEXT("CadetBuildSettings.json");

		IFileManager::Get().MakeDirectory(*SettingsDir, true);

		FString JsonString;
		TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonString);
		FJsonSerializer::Serialize(Json.ToSharedRef(), Writer);

		return FFileHelper::SaveStringToFile(JsonString, *SettingsFile);
	}
}

FCadetDependencyManager::FCadetDependencyManager()
{
}

bool FCadetDependencyManager::IsDependencyInstalled(const FString& DependencyName)
{
	if (DependencyName.Contains(TEXT("SteamCMD")) && DependencyName.Contains(TEXT("Windows")))
	{
		return IsSteamCmdWindowsInstalled();
	}
	else if (DependencyName.Contains(TEXT("SteamCMD")) && DependencyName.Contains(TEXT("macOS")))
	{
		return IsSteamCmdMacInstalled();
	}
	else if (DependencyName.Contains(TEXT("Cosmos")))
	{
		return IsCosmosInstalled();
	}

	return false;
}

bool FCadetDependencyManager::IsSteamCmdWindowsInstalled()
{
	FString SteamCmdPath = GetSteamCmdPath();
	FString SteamCmdExe = FPaths::Combine(SteamCmdPath, TEXT("steamcmd.exe"));
	return FPaths::FileExists(SteamCmdExe);
}

bool FCadetDependencyManager::IsSteamCmdMacInstalled()
{
	FString SteamCmdPath = GetSteamCmdPath();
	FString SteamCmdSh = FPaths::Combine(SteamCmdPath, TEXT("steamcmd.sh"));
	return FPaths::FileExists(SteamCmdSh);
}

FString FCadetDependencyManager::GetSteamCmdPath()
{
	// Check for a user-saved override in the plugin settings file first
	const TSharedPtr<FJsonObject> Json = LoadCadetSettingsJson();
	if (Json.IsValid())
	{
		FString SavedPath;
		if (Json->TryGetStringField(SteamCmdPathKey, SavedPath) && !SavedPath.IsEmpty())
		{
			return SavedPath;
		}
	}

	// Fall back to platform default only when that location exists
	return GetPlatformSteamCmdPath();
}

bool FCadetDependencyManager::SetSteamCmdPath(const FString& NewPath)
{
	const TSharedPtr<FJsonObject> Json = LoadCadetSettingsJson();
	Json->SetStringField(SteamCmdPathKey, NewPath);
	return SaveCadetSettingsJson(Json);
}

bool FCadetDependencyManager::IsCosmosInstalled()
{
	FString Error;
	return ValidateCosmosPath(GetCosmosPath(), Error);
}

FString FCadetDependencyManager::GetCosmosPath()
{
	const TSharedPtr<FJsonObject> Json = LoadCadetSettingsJson();
	if (Json.IsValid())
	{
		FString SavedPath;
		if (Json->TryGetStringField(CosmosPathKey, SavedPath) && !SavedPath.IsEmpty())
		{
			return SavedPath;
		}
	}

	const FString DefaultPath = GetDefaultCosmosInstallPath();
	return FPaths::DirectoryExists(DefaultPath) ? DefaultPath : FString();
}

bool FCadetDependencyManager::SetCosmosPath(const FString& NewPath)
{
	const TSharedPtr<FJsonObject> Json = LoadCadetSettingsJson();
	Json->SetStringField(CosmosPathKey, NewPath);
	return SaveCadetSettingsJson(Json);
}

bool FCadetDependencyManager::ValidateCosmosPath(const FString& CandidatePath, FString& OutError)
{
	OutError.Empty();

	if (CandidatePath.IsEmpty())
	{
		OutError = TEXT("Cosmos path is empty.");
		return false;
	}

	FString NormalizedRoot = FPaths::ConvertRelativePathToFull(CandidatePath);
	FPaths::NormalizeFilename(NormalizedRoot);

	if (!FPaths::DirectoryExists(NormalizedRoot))
	{
		OutError = FString::Printf(TEXT("Cosmos directory does not exist: %s"), *NormalizedRoot);
		return false;
	}

	const FString BinDir = FPaths::Combine(NormalizedRoot, TEXT("bin"));
	FString ResolvedBinDir = BinDir;
	if (!FPaths::DirectoryExists(ResolvedBinDir))
	{
		// Some installs may be nested one level deeper; check immediate child folders.
		TArray<FString> ChildDirs;
		IFileManager::Get().FindFiles(ChildDirs, *(NormalizedRoot / TEXT("*")), false, true);
		bool bFoundNestedBin = false;
		for (const FString& ChildDirName : ChildDirs)
		{
			const FString CandidateBin = FPaths::Combine(NormalizedRoot, ChildDirName, TEXT("bin"));
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
			return false;
		}
	}

	const FString BashPath = FPaths::Combine(ResolvedBinDir, TEXT("bash"));
	const FString BashExePath = FPaths::Combine(ResolvedBinDir, TEXT("bash.exe"));
	if (!FPaths::FileExists(BashPath) && !FPaths::FileExists(BashExePath))
	{
		OutError = FString::Printf(TEXT("Cosmos bash binary was not found under: %s"), *ResolvedBinDir);
		return false;
	}

	return true;
}

FString FCadetDependencyManager::GetDefaultCadetToolsRoot()
{
#if PLATFORM_WINDOWS
	const FString AppDataPath = FPlatformMisc::GetEnvironmentVariable(TEXT("APPDATA"));
	return FPaths::Combine(AppDataPath, TEXT("CADET"), TEXT("Tools"));
#elif PLATFORM_MAC
	const FString HomePath = FPlatformMisc::GetEnvironmentVariable(TEXT("HOME"));
	return FPaths::Combine(HomePath, TEXT("Library"), TEXT("Application Support"), TEXT("CADET"), TEXT("Tools"));
#else
	const FString HomePath = FPlatformMisc::GetEnvironmentVariable(TEXT("HOME"));
	return FPaths::Combine(HomePath, TEXT(".local"), TEXT("bin"), TEXT("CADET"), TEXT("Tools"));
#endif
}

FString FCadetDependencyManager::GetDefaultCosmosInstallPath()
{
	return FPaths::Combine(GetDefaultCadetToolsRoot(), TEXT("cosmos-4.0.2~"));
}

TArray<FCadetDependencyStatus> FCadetDependencyManager::GetAvailableDependencies()
{
	TArray<FCadetDependencyStatus> Dependencies;

	const FString CosmosPath = GetCosmosPath();
	const FString CosmosCheckPath = CosmosPath.IsEmpty()
		? FString()
		: FPaths::Combine(CosmosPath, TEXT("bin"), TEXT("bash"));

	Dependencies.Add(FCadetDependencyStatus(
		TEXT("Cosmos Binaries"),
		TEXT("Cosmos shell/tooling required for detached CADET execution and dependency scripts."),
		CosmosCheckPath,
		true
	));

	// Add SteamCMD for this platform
#if PLATFORM_WINDOWS
	const FString SteamPath = GetSteamCmdPath();
	const FString SteamCheckPath = SteamPath.IsEmpty()
		? FString()
		: FPaths::Combine(SteamPath, TEXT("steamcmd.exe"));

	Dependencies.Add(FCadetDependencyStatus(
		TEXT("SteamCMD (Windows)"),
		TEXT("Valve's command-line utility for uploading builds to SteamPipe. Required for Steam deployments."),
		SteamCheckPath,
		true
	));
#elif PLATFORM_MAC
	const FString SteamPath = GetSteamCmdPath();
	const FString SteamCheckPath = SteamPath.IsEmpty()
		? FString()
		: FPaths::Combine(SteamPath, TEXT("steamcmd.sh"));

	Dependencies.Add(FCadetDependencyStatus(
		TEXT("SteamCMD (macOS)"),
		TEXT("Valve's command-line utility for uploading builds to SteamPipe. Required for Steam deployments."),
		SteamCheckPath,
		true
	));
#endif

	RefreshDependencyStatuses(Dependencies);
	return Dependencies;
}

void FCadetDependencyManager::RefreshDependencyStatuses(TArray<FCadetDependencyStatus>& OutDependencies)
{
	for (FCadetDependencyStatus& Dep : OutDependencies)
	{
		if (Dep.CheckPath.IsEmpty())
		{
			Dep.bIsInstalled = false;
			continue;
		}

		Dep.bIsInstalled = FPaths::FileExists(Dep.CheckPath) || FPaths::DirectoryExists(Dep.CheckPath);
	}
}

FString FCadetDependencyManager::GetPlatformSteamCmdPath()
{
	// Platform-specific default SteamCMD location
#if PLATFORM_WINDOWS
	const FString AppDataPath = FPlatformMisc::GetEnvironmentVariable(TEXT("APPDATA"));
	const FString CadetSteamCmdPath = FPaths::Combine(AppDataPath, TEXT("CADET"), TEXT("Tools"), TEXT("steamcmd"));
	if (FPaths::DirectoryExists(CadetSteamCmdPath))
	{
		return CadetSteamCmdPath;
	}

	// No valid default path on Windows unless the CADET tools directory exists.
	return TEXT("");
#elif PLATFORM_MAC
	FString HomePath = FPlatformMisc::GetEnvironmentVariable(TEXT("HOME"));
	return FPaths::Combine(HomePath, TEXT("steamcmd"));
#else
	return TEXT("");
#endif
}
