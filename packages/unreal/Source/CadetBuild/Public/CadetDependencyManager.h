#pragma once

#include "CoreMinimal.h"
#include "Containers/Array.h"

/**
 * Dependency status tracking for publishing tools
 */
struct FCadetDependencyStatus
{
	FString Name;
	FString Description;
	FString CheckPath;
	bool bIsInstalled;
	bool bIsRequired;

	FCadetDependencyStatus(const FString& InName, const FString& InDescription, const FString& InCheckPath, bool bInRequired = true)
		: Name(InName), Description(InDescription), CheckPath(InCheckPath), bIsInstalled(false), bIsRequired(bInRequired)
	{
	}
};

/**
 * Manages dependency checking and installation status for CADET publishing tools
 */
class CADETBUILD_API FCadetDependencyManager
{
public:
	FCadetDependencyManager();

	/**
	 * Check if a specific dependency is installed
	 * @param DependencyName Name of the dependency (e.g., "SteamCMD")
	 * @return true if installed, false otherwise
	 */
	static bool IsDependencyInstalled(const FString& DependencyName);

	/**
	 * Check if SteamCMD (Windows) is installed
	 * @return true if steamcmd.exe exists at expected path
	 */
	static bool IsSteamCmdWindowsInstalled();

	/**
	 * Check if SteamCMD (macOS) is installed
	 * @return true if steamcmd.sh exists at expected path
	 */
	static bool IsSteamCmdMacInstalled();

	/**
	 * Check if Cosmos binaries are installed at the configured or default path.
	 * @return true if required Cosmos binaries are present
	 */
	static bool IsCosmosInstalled();

	/**
	 * Get the configured SteamCMD directory path.
	 * Returns the user-saved path if set, otherwise the platform default (~/steamcmd).
	 */
	static FString GetSteamCmdPath();

	/**
	 * Save a custom SteamCMD directory path to the plugin settings file.
	 * @param NewPath  Absolute path to the directory containing steamcmd.exe / steamcmd.sh
	 * @return true on success
	 */
	static bool SetSteamCmdPath(const FString& NewPath);

	/**
	 * Get the configured Cosmos directory path.
	 * Returns the user-saved path if set, otherwise the default tools location when present.
	 */
	static FString GetCosmosPath();

	/**
	 * Save a custom Cosmos directory path to the plugin settings file.
	 * @param NewPath Absolute path to the Cosmos root directory (containing bin/)
	 * @return true on success
	 */
	static bool SetCosmosPath(const FString& NewPath);

	/**
	 * Validate a Cosmos installation path.
	 * @param CandidatePath Path to validate
	 * @param OutError Validation failure reason
	 * @return true when path looks valid for CADET execution
	 */
	static bool ValidateCosmosPath(const FString& CandidatePath, FString& OutError);

	/**
	 * Get the default CADET tools root directory for this platform.
	 */
	static FString GetDefaultCadetToolsRoot();

	/**
	 * Get the default Cosmos install path under the CADET tools root.
	 */
	static FString GetDefaultCosmosInstallPath();

	/**
	 * Get all available dependencies for this platform
	 * @return Array of dependency statuses
	 */
	static TArray<FCadetDependencyStatus> GetAvailableDependencies();

	/**
	 * Refresh all dependency statuses
	 */
	static void RefreshDependencyStatuses(TArray<FCadetDependencyStatus>& OutDependencies);

private:
	/**
	 * Determine the platform-specific SteamCMD path
	 * @return Path based on platform
	 */
	static FString GetPlatformSteamCmdPath();
};
