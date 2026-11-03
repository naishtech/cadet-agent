#pragma once

#include "CoreMinimal.h"
#include "CadetDependencyManager.h"
#include "Widgets/SCompoundWidget.h"

class STextBlock;
class SVerticalBox;

/**
 * Slate widget for the Publishing Tools panel
 * Displays dependency status and platform credentials configuration
 */
class SCadetPublishingToolsPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SCadetPublishingToolsPanel) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/**
	 * Refresh dependency status display
	 */
	void RefreshDependencyStatus();

private:
	TArray<FCadetDependencyStatus> Dependencies;
	TSharedPtr<SVerticalBox> DependencyContainer;
	TSharedPtr<STextBlock> SteamStatusText;
	TSharedPtr<STextBlock> SteamCmdPathText;
	TSharedPtr<STextBlock> SteamCmdStatusText;
	TSharedPtr<STextBlock> CosmosStatusText;
	TSharedPtr<STextBlock> CosmosPathText;
	bool bSteamCmdInstallInProgress = false;
	bool bCosmosInstallInProgress = false;

	/**
	 * Build the header section
	 */
	TSharedRef<SWidget> BuildHeaderSection();

	/**
	 * Build the dependencies section with scrollable list
	 */
	TSharedRef<SWidget> BuildDependenciesSection();

	/**
	 * Build a single dependency card
	 */
	TSharedRef<SWidget> BuildDependencyCard(const FCadetDependencyStatus& Dependency);

	/**
	 * Build the Cosmos path configuration row
	 */
	TSharedRef<SWidget> BuildCosmosSection();

	/**
	 * Build the SteamCMD path configuration row
	 */
	TSharedRef<SWidget> BuildSteamCmdSection();

	/**
	 * Build the platform credentials section
	 */
	TSharedRef<SWidget> BuildCredentialsSection();

	/**
	 * Handle the Browse button click to pick Cosmos directory
	 */
	FReply OnBrowseCosmosClicked();

	/**
	 * Handle Verify Cosmos button click
	 */
	FReply OnVerifyCosmosClicked();

	/**
	 * Handle Install Cosmos button click
	 */
	FReply OnInstallCosmosClicked();

	/**
	 * Handle Uninstall Cosmos button click
	 */
	FReply OnUninstallCosmosClicked();

	/**
	 * Handle the Browse button click to pick SteamCMD directory
	 */
	FReply OnBrowseSteamCmdClicked();

	/**
	 * Handle Verify SteamCMD button click
	 */
	FReply OnVerifySteamCmdClicked();

	/**
	 * Handle Install SteamCMD button click
	 */
	FReply OnInstallSteamCmdClicked();

	/**
	 * Handle Uninstall SteamCMD button click
	 */
	FReply OnUninstallSteamCmdClicked();

	/**
	 * Handle Steam credential configuration button click
	 */
	FReply OnConfigureSteamCredentialsClicked();

	/**
	 * Update Cosmos status display
	 */
	void UpdateCosmosStatus();

	/**
	 * Update Steam status display
	 */
	void UpdateSteamStatus();

	/**
	 * Update SteamCMD install status display in dependency section
	 */
	void UpdateSteamCmdStatus();
};
