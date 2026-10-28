#pragma once

#include <CoreMinimal.h>
#include "HAL/PlatformProcess.h"

/** Result type for Steam credential validation */
enum class ECadetSteamValidationResult : uint8
{
	Success,
	InvalidCredentials,
	RequiresGuardCode,
	ConnectionFailed
};

/** Steam credentials data */
struct FCadetSteamCredentials
{
	FString Username;
	FString Password;
	FString GuardCode;

	bool HasBasicCredentials() const
	{
		return !Username.IsEmpty() && !Password.IsEmpty();
	}
};

/**
 * Manages Steam credential storage and SteamCMD-based verification.
 *
 * Credentials are stored in ~/.env_cadet_steam_credentials as KEY=VALUE lines,
 * matching the convention used by the CADET Unity project.
 *
 * Verification launches SteamCMD in a visible console window (+login +quit),
 * then reads steamcmd/logs/console_log.txt to determine the outcome.
 */
class CADETBUILD_API FCadetSteamValidator
{
public:
	/** Path to the credentials env file in the user's home directory */
	static FString GetCredentialsFilePath();

	/** Returns true if the credentials file exists and is non-empty */
	static bool CredentialsFileExists();

	/** Reads credentials from the env file. Returns empty struct if not found. */
	static FCadetSteamCredentials ReadCredentials();

	/** Writes credentials to the env file. Returns false on failure. */
	static bool WriteCredentials(const FCadetSteamCredentials& Credentials);

	/** Deletes the credentials env file */
	static bool DeleteCredentials();

	/**
	 * Launch SteamCMD in a visible console window to verify the given credentials.
	 * Truncates the SteamCMD console log before launching so we get a clean read.
	 * @param Username  Steam account username
	 * @param Password  Steam account password
	 * @return false if SteamCMD was not found or failed to launch
	 */
	bool LaunchVerification(const FString& Username, const FString& Password);

	/** Returns true while the SteamCMD process is still running */
	bool IsProcessRunning() const;

	/**
	 * After IsProcessRunning() returns false, reads the SteamCMD log to determine outcome.
	 * Call only once per launched verification.
	 */
	ECadetSteamValidationResult CheckLogForResult() const;

	/** Terminates any active SteamCMD process */
	void CancelProcess();

private:
	FProcHandle ProcessHandle;
	FString LogFilePath;
};
