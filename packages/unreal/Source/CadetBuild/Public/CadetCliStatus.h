#pragma once

#include "CoreMinimal.h"

/**
 * The state of the CLI folder that the installer writes into the plugin:
 * Plugins/CadetBuild/CLI. The plugin launches builds through dist.sh there,
 * so a missing or partial folder is a first-run condition, not an error.
 */
struct FCadetCliStatus
{
    /** Resolved CLI folder, always set. */
    FString CliRoot;

    /** Version from .cadet-cli.json, else VERSION. Empty when nothing names one. */
    FString Version;

    /** Required files that do not exist, as paths relative to CliRoot. */
    TArray<FString> MissingFiles;

    bool IsInstalled() const { return MissingFiles.Num() == 0; }

    /** Banner text for the build tab. Empty when the CLI is installed. */
    FText GetMissingText() const;

    /** One-line label for the Publishing Tools panel, e.g. "Cadet CLI 0.63.1". */
    FText GetVersionText() const;
};

/**
 * The CLI folder and the files the plugin needs before a build can start.
 * One list, so the tab, the banner and the tests cannot drift apart.
 */
namespace CadetCli
{
    /** Paths relative to the plugin CLI root that a build needs. */
    const TArray<FString>& GetRequiredFiles();

    /** Plugins/CadetBuild/CLI for the current project. */
    FString GetCliRoot();

    /** Read the state of CliRoot from disk. */
    FCadetCliStatus Inspect(const FString& CliRoot);

    /** Inspect the CLI folder of the current project. */
    FCadetCliStatus InspectInstalled();
}
