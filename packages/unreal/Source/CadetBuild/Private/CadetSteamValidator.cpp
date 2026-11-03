#include "CadetSteamValidator.h"
#include "CadetDependencyManager.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

#define LOCTEXT_NAMESPACE "FCadetSteamValidator"

namespace SteamValidatorInternal
{
	static const FString CredentialsFileName = TEXT(".env_cadet_steam_credentials");
	static const FString LogSubPath = TEXT("logs/console_log.txt");

	static FString GetUserHomeDir()
	{
#if PLATFORM_WINDOWS
		FString Home = FPlatformMisc::GetEnvironmentVariable(TEXT("USERPROFILE"));
		if (Home.IsEmpty())
		{
			Home = FPlatformMisc::GetEnvironmentVariable(TEXT("HOMEDRIVE"))
				   + FPlatformMisc::GetEnvironmentVariable(TEXT("HOMEPATH"));
		}
		return Home;
#else
		FString Home = FPlatformMisc::GetEnvironmentVariable(TEXT("HOME"));
		return Home;
#endif
	}
}

FString FCadetSteamValidator::GetCredentialsFilePath()
{
	return FPaths::Combine(SteamValidatorInternal::GetUserHomeDir(), SteamValidatorInternal::CredentialsFileName);
}

bool FCadetSteamValidator::CredentialsFileExists()
{
	return FPaths::FileExists(GetCredentialsFilePath());
}

FCadetSteamCredentials FCadetSteamValidator::ReadCredentials()
{
	FCadetSteamCredentials Credentials;

	FString FilePath = GetCredentialsFilePath();
	if (!FPaths::FileExists(FilePath))
	{
		return Credentials;
	}

	TArray<FString> Lines;
	if (!FFileHelper::LoadFileToStringArray(Lines, *FilePath))
	{
		UE_LOG(LogTemp, Warning, TEXT("FCadetSteamValidator: Failed to read credentials file: %s"), *FilePath);
		return Credentials;
	}

	for (const FString& Line : Lines)
	{
		FString Trimmed = Line.TrimStartAndEnd();
		if (Trimmed.IsEmpty() || Trimmed.StartsWith(TEXT("#")))
		{
			continue;
		}

		int32 EqualsIdx;
		if (Trimmed.FindChar(TCHAR('='), EqualsIdx))
		{
			FString Key = Trimmed.Left(EqualsIdx).TrimStartAndEnd().ToUpper();
			FString Value = Trimmed.Mid(EqualsIdx + 1).TrimStartAndEnd();

			// Strip surrounding quotes
			if (Value.StartsWith(TEXT("\"")) && Value.EndsWith(TEXT("\"")))
			{
				Value = Value.Mid(1, Value.Len() - 2);
			}

			if (Key == TEXT("STEAM_USERNAME"))
			{
				Credentials.Username = Value;
			}
			else if (Key == TEXT("STEAM_PASSWORD"))
			{
				Credentials.Password = Value;
			}
			else if (Key == TEXT("STEAM_GUARD_CODE"))
			{
				Credentials.GuardCode = Value;
			}
		}
	}

	return Credentials;
}

bool FCadetSteamValidator::WriteCredentials(const FCadetSteamCredentials& Credentials)
{
	FString FilePath = GetCredentialsFilePath();

	TArray<FString> Lines;
	Lines.Add(TEXT("# CADET Steam Credentials"));
	Lines.Add(TEXT("# Auto-generated. Do not edit manually."));
	Lines.Add(TEXT(""));

	if (!Credentials.Username.IsEmpty())
	{
		Lines.Add(FString::Printf(TEXT("STEAM_USERNAME=%s"), *Credentials.Username));
	}
	if (!Credentials.Password.IsEmpty())
	{
		Lines.Add(FString::Printf(TEXT("STEAM_PASSWORD=%s"), *Credentials.Password));
	}
	if (!Credentials.GuardCode.IsEmpty())
	{
		Lines.Add(FString::Printf(TEXT("STEAM_GUARD_CODE=%s"), *Credentials.GuardCode));
	}

	FString Content = FString::Join(Lines, TEXT("\n")) + TEXT("\n");

	if (!FFileHelper::SaveStringToFile(Content, *FilePath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
	{
		UE_LOG(LogTemp, Error, TEXT("FCadetSteamValidator: Failed to write credentials file: %s"), *FilePath);
		return false;
	}

	return true;
}

bool FCadetSteamValidator::DeleteCredentials()
{
	FString FilePath = GetCredentialsFilePath();
	if (!FPaths::FileExists(FilePath))
	{
		return true;
	}
	return IFileManager::Get().Delete(*FilePath);
}

bool FCadetSteamValidator::LaunchVerification(const FString& Username, const FString& Password)
{
	FString SteamCmdDir = FCadetDependencyManager::GetSteamCmdPath();

#if PLATFORM_WINDOWS
	FString SteamCmdExe = FPaths::Combine(SteamCmdDir, TEXT("steamcmd.exe"));
#else
	FString SteamCmdExe = FPaths::Combine(SteamCmdDir, TEXT("steamcmd.sh"));
#endif

	if (!FPaths::FileExists(SteamCmdExe))
	{
		UE_LOG(LogTemp, Error, TEXT("FCadetSteamValidator: SteamCMD not found at: %s"), *SteamCmdExe);
		return false;
	}

	// Build log file path and truncate it for a clean read after login
	LogFilePath = FPaths::Combine(SteamCmdDir, SteamValidatorInternal::LogSubPath);
	FString LogDir = FPaths::GetPath(LogFilePath);
	IFileManager::Get().MakeDirectory(*LogDir, true);
	FFileHelper::SaveStringToFile(TEXT(""), *LogFilePath);

	// Launch SteamCMD in a visible console window
	FString Args = FString::Printf(TEXT("+login %s %s +quit"), *Username, *Password);

#if PLATFORM_WINDOWS
	// On Windows, CreateProc with bLaunchDetached=true opens a console window
	uint32 ProcessId = 0;
	ProcessHandle = FPlatformProcess::CreateProc(
		*SteamCmdExe,
		*Args,
		true,   // bLaunchDetached - shows console window
		false,  // bLaunchHidden
		false,  // bLaunchReallyHidden
		&ProcessId,
		0,
		*SteamCmdDir,
		nullptr
	);
#else
	// On Mac/Linux, wrap in a shell script and open in Terminal
	FString TempScript = FPaths::Combine(FPlatformProcess::UserTempDir(),
		FString::Printf(TEXT("cadet_steamcmd_%s.sh"), *FGuid::NewGuid().ToString()));

	FString ScriptContent = FString::Printf(
		TEXT("#!/bin/bash\ncd \"%s\"\n\"%s\" %s\n"),
		*SteamCmdDir, *SteamCmdExe, *Args);
	FFileHelper::SaveStringToFile(ScriptContent, *TempScript);

	// Make executable
	FPlatformProcess::ExecProcess(TEXT("/bin/chmod"), *FString::Printf(TEXT("+x \"%s\""), *TempScript), nullptr, nullptr, nullptr);

	uint32 ProcessId = 0;
	ProcessHandle = FPlatformProcess::CreateProc(
		TEXT("/bin/bash"),
		*FString::Printf(TEXT("\"%s\""), *TempScript),
		true,
		false,
		false,
		&ProcessId,
		0,
		*SteamCmdDir,
		nullptr
	);
#endif

	if (!ProcessHandle.IsValid())
	{
		UE_LOG(LogTemp, Error, TEXT("FCadetSteamValidator: Failed to launch SteamCMD process"));
		return false;
	}

	return true;
}

bool FCadetSteamValidator::IsProcessRunning() const
{
	if (!ProcessHandle.IsValid())
	{
		return false;
	}
	// IsProcRunning requires non-const handle - use a local copy
	FProcHandle HandleCopy = ProcessHandle;
	return FPlatformProcess::IsProcRunning(HandleCopy);
}

ECadetSteamValidationResult FCadetSteamValidator::CheckLogForResult() const
{
	if (!FPaths::FileExists(LogFilePath))
	{
		UE_LOG(LogTemp, Warning, TEXT("FCadetSteamValidator: Log file not found at: %s"), *LogFilePath);
		// Assume success - SteamCMD may not always write a log
		return ECadetSteamValidationResult::Success;
	}

	FString LogContent;
	if (!FFileHelper::LoadFileToString(LogContent, *LogFilePath))
	{
		UE_LOG(LogTemp, Warning, TEXT("FCadetSteamValidator: Failed to read SteamCMD log"));
		return ECadetSteamValidationResult::ConnectionFailed;
	}

	// Mirror Unity's log-checking logic
	if (LogContent.Contains(TEXT("ERROR (Invalid Password)")))
	{
		return ECadetSteamValidationResult::InvalidCredentials;
	}

	// Additional common failure patterns
	if (LogContent.Contains(TEXT("FAILED (Timeout)")) || LogContent.Contains(TEXT("Could not connect")))
	{
		return ECadetSteamValidationResult::ConnectionFailed;
	}

	// "Logged in OK" is explicit success; no error found also assumes success
	return ECadetSteamValidationResult::Success;
}

void FCadetSteamValidator::CancelProcess()
{
	if (ProcessHandle.IsValid())
	{
		FPlatformProcess::TerminateProc(ProcessHandle, true);
		FPlatformProcess::CloseProc(ProcessHandle);
	}
}

#undef LOCTEXT_NAMESPACE
