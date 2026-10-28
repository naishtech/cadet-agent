#include "Slate/SCadetPublishingToolsPanel.h"
#include "Slate/SSteamCredentialsDialog.h"
#include "CadetCosmosInstaller.h"
#include "CadetSteamCmdInstaller.h"
#include "CadetDependencyManager.h"
#include "Styling/AppStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "IDesktopPlatform.h"
#include "DesktopPlatformModule.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/PlatformProcess.h"
#include "Misc/MessageDialog.h"
#include "Misc/Paths.h"

#define LOCTEXT_NAMESPACE "SCadetPublishingToolsPanel"

void SCadetPublishingToolsPanel::Construct(const FArguments& InArgs)
{
	Dependencies = FCadetDependencyManager::GetAvailableDependencies();

	// Auto-detect: if nothing is saved yet but the default path has steamcmd, save it automatically
	{
		FString DefaultPath = FCadetDependencyManager::GetSteamCmdPath();
#if PLATFORM_WINDOWS
		FString DefaultExe = DefaultPath / TEXT("steamcmd.exe");
#else
		FString DefaultExe = DefaultPath / TEXT("steamcmd.sh");
#endif
		if (!DefaultPath.IsEmpty() && FPaths::FileExists(DefaultExe))
		{
			// Already at the default — persist it so the field shows it
			FCadetDependencyManager::SetSteamCmdPath(DefaultPath);
		}
	}

	ChildSlot
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(12, 12, 12, 6)
		[
			BuildHeaderSection()
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0, 6, 0, 12)
		[
			SNew(SBorder)
			.Padding(8.0f)
			.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
			[
				SNew(STextBlock)
				.Text(LOCTEXT("InfoBox", "Configure publishing dependencies and platform credentials required for Steam and other publishing platforms."))
				.AutoWrapText(true)
			]
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(12, 0, 12, 6)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("DependenciesHeader", "Required Dependencies"))
			.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label"))
		]
		+ SVerticalBox::Slot()
		.FillHeight(1.0f)
		.Padding(12, 0, 12, 12)
		[
			SNew(SScrollBox)
			+ SScrollBox::Slot()
			[
				SAssignNew(DependencyContainer, SVerticalBox)
			]
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(12, 0, 12, 12)
		[
			BuildCosmosSection()
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(12, 0, 12, 12)
		[
			BuildSteamCmdSection()
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(12, 12, 12, 12)
		[
			BuildCredentialsSection()
		]
	];

	RefreshDependencyStatus();
}

void SCadetPublishingToolsPanel::RefreshDependencyStatus()
{
	Dependencies = FCadetDependencyManager::GetAvailableDependencies();

	if (DependencyContainer.IsValid())
	{
		DependencyContainer->ClearChildren();

		for (const FCadetDependencyStatus& Dep : Dependencies)
		{
			DependencyContainer->AddSlot()
			.AutoHeight()
			.Padding(0, 0, 0, 12)
			[
				BuildDependencyCard(Dep)
			];
		}
	}

	UpdateCosmosStatus();
	UpdateSteamCmdStatus();
	UpdateSteamStatus();
}
TSharedRef<SWidget> SCadetPublishingToolsPanel::BuildDependencyCard(const FCadetDependencyStatus& Dependency)
{
	const FText StatusText = Dependency.bIsInstalled
		? LOCTEXT("DependencyInstalled", "Installed")
		: LOCTEXT("DependencyMissing", "Missing");

	const FSlateColor StatusColor = Dependency.bIsInstalled
		? FSlateColor(FLinearColor(0.25f, 0.75f, 0.25f))
		: FSlateColor(FLinearColor(0.85f, 0.25f, 0.25f));

	return SNew(SBorder)
		.Padding(8.0f)
		.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot()
				.AutoHeight()
				[
					SNew(STextBlock)
					.Text(FText::FromString(Dependency.Name))
					.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label"))
				]
				+ SVerticalBox::Slot()
				.AutoHeight()
				.Padding(0.0f, 4.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text(FText::FromString(Dependency.Description))
					.AutoWrapText(true)
					.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label.Small"))
				]
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(12.0f, 0.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(StatusText)
				.ColorAndOpacity(StatusColor)
				.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label.Small"))
			]
		];
}

TSharedRef<SWidget> SCadetPublishingToolsPanel::BuildSteamCmdSection()
{
	FString CurrentPath = FCadetDependencyManager::GetSteamCmdPath();
	if (CurrentPath.IsEmpty())
	{
		CurrentPath = TEXT("Not configured");
	}

	return SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 6.0f)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("SteamCmdHeader", "SteamCMD Path"))
			.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label"))
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		[
			SNew(SBorder)
			.Padding(8.0f)
			.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
			[
				SNew(SVerticalBox)
				+	SVerticalBox::Slot()
				.AutoHeight()
				[
					SNew(SHorizontalBox)
					+	SHorizontalBox::Slot()
					.FillWidth(1.0f)
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 8.0f, 0.0f)
					[
						SAssignNew(SteamCmdPathText, STextBlock)
						.Text(FText::FromString(CurrentPath))
						.AutoWrapText(false)
					]
					+	SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(SButton)
						.Text(LOCTEXT("BrowseSteamButton", "Browse..."))
						.OnClicked(this, &SCadetPublishingToolsPanel::OnBrowseSteamCmdClicked)
					]
					+	SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(SButton)
						.Text(LOCTEXT("InstallSteamButton", "Install"))
						.IsEnabled_Lambda([this]() { return !bSteamCmdInstallInProgress; })
						.OnClicked(this, &SCadetPublishingToolsPanel::OnInstallSteamCmdClicked)
					]
					+	SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(SButton)
						.Text(LOCTEXT("UninstallSteamButton", "Uninstall"))
						.IsEnabled_Lambda([this]() { return !bSteamCmdInstallInProgress; })
						.OnClicked(this, &SCadetPublishingToolsPanel::OnUninstallSteamCmdClicked)
					]
					+	SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					[
						SNew(SButton)
						.Text(LOCTEXT("VerifySteamButton", "Verify"))
						.IsEnabled_Lambda([this]() { return !bSteamCmdInstallInProgress; })
						.OnClicked(this, &SCadetPublishingToolsPanel::OnVerifySteamCmdClicked)
					]
				]
				+	SVerticalBox::Slot()
				.AutoHeight()
				.Padding(0.0f, 6.0f, 0.0f, 0.0f)
				[
					SAssignNew(SteamCmdStatusText, STextBlock)
					.Text(LOCTEXT("SteamCmdInitialStatus", "Status: Not configured"))
				]
			]
		];
}

TSharedRef<SWidget> SCadetPublishingToolsPanel::BuildCosmosSection()
{
	FString CurrentPath = FCadetDependencyManager::GetCosmosPath();
	if (CurrentPath.IsEmpty())
	{
		CurrentPath = TEXT("Not configured");
	}

	return SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 6.0f)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("CosmosHeader", "Cosmos Binaries Path"))
			.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label"))
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		[
			SNew(SBorder)
			.Padding(8.0f)
			.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot()
				.AutoHeight()
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot()
					.FillWidth(1.0f)
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 8.0f, 0.0f)
					[
						SAssignNew(CosmosPathText, STextBlock)
						.Text(FText::FromString(CurrentPath))
						.AutoWrapText(false)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(SButton)
						.Text(LOCTEXT("BrowseCosmosButton", "Browse..."))
						.OnClicked(this, &SCadetPublishingToolsPanel::OnBrowseCosmosClicked)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(SButton)
						.Text(LOCTEXT("InstallCosmosButton", "Install"))
						.IsEnabled_Lambda([this]() { return !bCosmosInstallInProgress; })
						.OnClicked(this, &SCadetPublishingToolsPanel::OnInstallCosmosClicked)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(SButton)
						.Text(LOCTEXT("UninstallCosmosButton", "Uninstall"))
						.IsEnabled_Lambda([this]() { return !bCosmosInstallInProgress; })
						.OnClicked(this, &SCadetPublishingToolsPanel::OnUninstallCosmosClicked)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					[
						SNew(SButton)
						.Text(LOCTEXT("VerifyCosmosButton", "Verify"))
						.IsEnabled_Lambda([this]() { return !bCosmosInstallInProgress; })
						.OnClicked(this, &SCadetPublishingToolsPanel::OnVerifyCosmosClicked)
					]
				]
				+ SVerticalBox::Slot()
				.AutoHeight()
				.Padding(0.0f, 6.0f, 0.0f, 0.0f)
				[
					SAssignNew(CosmosStatusText, STextBlock)
					.Text(LOCTEXT("CosmosInitialStatus", "Status: Not configured"))
				]
			]
		];
}

FReply SCadetPublishingToolsPanel::OnBrowseSteamCmdClicked()
{
	IDesktopPlatform* DesktopPlatform = FDesktopPlatformModule::Get();
	if (!DesktopPlatform)
	{
		return FReply::Handled();
	}

	FString StartDir = FCadetDependencyManager::GetSteamCmdPath();
	if (StartDir.IsEmpty())
	{
		StartDir = FCadetDependencyManager::GetDefaultCadetToolsRoot();
		if (StartDir.IsEmpty())
		{
			StartDir = FPlatformProcess::UserDir();
		}
	}
	FString SelectedDir;

	const void* ParentWindow = FSlateApplication::Get().GetActiveTopLevelWindow().IsValid()
		? FSlateApplication::Get().GetActiveTopLevelWindow()->GetNativeWindow()->GetOSWindowHandle()
		: nullptr;

	if (DesktopPlatform->OpenDirectoryDialog(ParentWindow, TEXT("Select SteamCMD Directory"), StartDir, SelectedDir))
	{
		FCadetDependencyManager::SetSteamCmdPath(SelectedDir);

		if (SteamCmdPathText.IsValid())
		{
			SteamCmdPathText->SetText(FText::FromString(SelectedDir));
		}

		// Refresh dependency cards so the status indicator updates
		RefreshDependencyStatus();
	}

	return FReply::Handled();
}

FReply SCadetPublishingToolsPanel::OnVerifySteamCmdClicked()
{
	FString ValidationError;
	const FString SteamPath = FCadetDependencyManager::GetSteamCmdPath();
	const bool bValid = FCadetSteamCmdInstaller::VerifyInstall(SteamPath, ValidationError);

	if (bValid)
	{
		FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("SteamVerifySuccess", "SteamCMD installation verified successfully."));
	}
	else
	{
		FMessageDialog::Open(
			EAppMsgType::Ok,
			FText::FromString(FString::Printf(TEXT("SteamCMD verification failed:\n\n%s"), *ValidationError)));
	}

	UpdateSteamCmdStatus();
	RefreshDependencyStatus();
	return FReply::Handled();
}

FReply SCadetPublishingToolsPanel::OnInstallSteamCmdClicked()
{
	if (bSteamCmdInstallInProgress)
	{
		return FReply::Handled();
	}

	bSteamCmdInstallInProgress = true;
	if (SteamCmdStatusText.IsValid())
	{
		SteamCmdStatusText->SetText(LOCTEXT("SteamInstallStarting", "Status: Downloading SteamCMD binaries..."));
	}

	FCadetSteamCmdInstallRequest Request;
	Request.TargetInstallPath = FCadetDependencyManager::GetSteamCmdPath();
	if (Request.TargetInstallPath.IsEmpty())
	{
		Request.TargetInstallPath = FPaths::Combine(FCadetDependencyManager::GetDefaultCadetToolsRoot(), TEXT("steamcmd"));
	}

	TWeakPtr<SCadetPublishingToolsPanel> WeakPanel = SharedThis(this);
	FCadetSteamCmdInstaller::InstallAsync(
		Request,
		[WeakPanel](const FCadetCosmosInstallProgress& Progress)
		{
			const TSharedPtr<SCadetPublishingToolsPanel> Pinned = WeakPanel.Pin();
			if (!Pinned.IsValid() || !Pinned->SteamCmdStatusText.IsValid())
			{
				return;
			}

			Pinned->SteamCmdStatusText->SetText(FText::FromString(
				FString::Printf(TEXT("Status: %s (%.0f%%)"), *Progress.Message, Progress.Percent * 100.0f)));
		},
		[WeakPanel](const FCadetSteamCmdInstallResult& Result)
		{
			const TSharedPtr<SCadetPublishingToolsPanel> Pinned = WeakPanel.Pin();
			if (!Pinned.IsValid())
			{
				return;
			}

			Pinned->bSteamCmdInstallInProgress = false;
			if (Result.bSuccess)
			{
				FCadetDependencyManager::SetSteamCmdPath(Result.InstallPath);
				if (Pinned->SteamCmdPathText.IsValid())
				{
					Pinned->SteamCmdPathText->SetText(FText::FromString(Result.InstallPath));
				}
				Pinned->RefreshDependencyStatus();
				FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("SteamInstallSuccess", "SteamCMD installed successfully."));
			}
			else
			{
				if (Pinned->SteamCmdStatusText.IsValid())
				{
					Pinned->SteamCmdStatusText->SetText(FText::FromString(FString::Printf(TEXT("Status: Error (%s)"), *Result.Error)));
				}
				FMessageDialog::Open(EAppMsgType::Ok, FText::FromString(FString::Printf(TEXT("SteamCMD installation failed:\n\n%s"), *Result.Error)));
			}
		});

	return FReply::Handled();
}

FReply SCadetPublishingToolsPanel::OnUninstallSteamCmdClicked()
{
	if (bSteamCmdInstallInProgress)
	{
		return FReply::Handled();
	}

	FString SteamPath = FCadetDependencyManager::GetSteamCmdPath();
	if (SteamPath.IsEmpty())
	{
		SteamPath = FPaths::Combine(FCadetDependencyManager::GetDefaultCadetToolsRoot(), TEXT("steamcmd"));
	}

	FString Error;
	if (!FCadetSteamCmdInstaller::Uninstall(SteamPath, Error))
	{
		FMessageDialog::Open(EAppMsgType::Ok, FText::FromString(FString::Printf(TEXT("SteamCMD uninstall failed:\n\n%s"), *Error)));
		return FReply::Handled();
	}

	FCadetDependencyManager::SetSteamCmdPath(TEXT(""));
	if (SteamCmdPathText.IsValid())
	{
		SteamCmdPathText->SetText(FText::FromString(TEXT("Not configured")));
	}

	RefreshDependencyStatus();
	FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("SteamUninstallSuccess", "SteamCMD uninstalled."));
	return FReply::Handled();
}

FReply SCadetPublishingToolsPanel::OnBrowseCosmosClicked()
{
	IDesktopPlatform* DesktopPlatform = FDesktopPlatformModule::Get();
	if (!DesktopPlatform)
	{
		return FReply::Handled();
	}

	FString StartDir = FCadetDependencyManager::GetCosmosPath();
	if (StartDir.IsEmpty())
	{
		StartDir = FCadetDependencyManager::GetDefaultCadetToolsRoot();
		if (StartDir.IsEmpty())
		{
			StartDir = FPlatformProcess::UserDir();
		}
	}

	FString SelectedDir;
	const void* ParentWindow = FSlateApplication::Get().GetActiveTopLevelWindow().IsValid()
		? FSlateApplication::Get().GetActiveTopLevelWindow()->GetNativeWindow()->GetOSWindowHandle()
		: nullptr;

	if (DesktopPlatform->OpenDirectoryDialog(ParentWindow, TEXT("Select Cosmos Directory"), StartDir, SelectedDir))
	{
		FCadetDependencyManager::SetCosmosPath(SelectedDir);

		if (CosmosPathText.IsValid())
		{
			CosmosPathText->SetText(FText::FromString(SelectedDir));
		}

		RefreshDependencyStatus();
	}

	return FReply::Handled();
}

FReply SCadetPublishingToolsPanel::OnVerifyCosmosClicked()
{
	FString ValidationError;
	const FString CosmosPath = FCadetDependencyManager::GetCosmosPath();
	const bool bValid = FCadetDependencyManager::ValidateCosmosPath(CosmosPath, ValidationError);

	if (bValid)
	{
		FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("CosmosVerifySuccess", "Cosmos installation verified successfully."));
	}
	else
	{
		FMessageDialog::Open(
			EAppMsgType::Ok,
			FText::FromString(FString::Printf(TEXT("Cosmos verification failed:\n\n%s"), *ValidationError)));
	}

	UpdateCosmosStatus();
	RefreshDependencyStatus();
	return FReply::Handled();
}

FReply SCadetPublishingToolsPanel::OnInstallCosmosClicked()
{
	if (bCosmosInstallInProgress)
	{
		return FReply::Handled();
	}

	bCosmosInstallInProgress = true;
	if (CosmosStatusText.IsValid())
	{
		CosmosStatusText->SetText(LOCTEXT("CosmosInstallStarting", "Status: Downloading Cosmos binaries..."));
	}

	FCadetCosmosInstallRequest Request;
	Request.TargetInstallPath = FCadetDependencyManager::GetCosmosPath();
	if (Request.TargetInstallPath.IsEmpty())
	{
		Request.TargetInstallPath = FCadetDependencyManager::GetDefaultCosmosInstallPath();
	}

	TWeakPtr<SCadetPublishingToolsPanel> WeakPanel = SharedThis(this);
	FCadetCosmosInstaller::InstallAsync(
		Request,
		[WeakPanel](const FCadetCosmosInstallProgress& Progress)
		{
			const TSharedPtr<SCadetPublishingToolsPanel> Pinned = WeakPanel.Pin();
			if (!Pinned.IsValid() || !Pinned->CosmosStatusText.IsValid())
			{
				return;
			}

			Pinned->CosmosStatusText->SetText(FText::FromString(
				FString::Printf(TEXT("Status: %s (%.0f%%)"), *Progress.Message, Progress.Percent * 100.0f)));
		},
		[WeakPanel](const FCadetCosmosInstallResult& Result)
		{
			const TSharedPtr<SCadetPublishingToolsPanel> Pinned = WeakPanel.Pin();
			if (!Pinned.IsValid())
			{
				return;
			}

			Pinned->bCosmosInstallInProgress = false;
			if (Result.bSuccess)
			{
				FCadetDependencyManager::SetCosmosPath(Result.InstallPath);
				if (Pinned->CosmosPathText.IsValid())
				{
					Pinned->CosmosPathText->SetText(FText::FromString(Result.InstallPath));
				}
				Pinned->RefreshDependencyStatus();
				FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("CosmosInstallSuccess", "Cosmos binaries installed successfully."));
			}
			else
			{
				if (Pinned->CosmosStatusText.IsValid())
				{
					Pinned->CosmosStatusText->SetText(FText::FromString(FString::Printf(TEXT("Status: Error (%s)"), *Result.Error)));
				}
				FMessageDialog::Open(EAppMsgType::Ok, FText::FromString(FString::Printf(TEXT("Cosmos installation failed:\n\n%s"), *Result.Error)));
			}
		});

	return FReply::Handled();
}

FReply SCadetPublishingToolsPanel::OnUninstallCosmosClicked()
{
	if (bCosmosInstallInProgress)
	{
		return FReply::Handled();
	}

	FString CosmosPath = FCadetDependencyManager::GetCosmosPath();
	if (CosmosPath.IsEmpty())
	{
		CosmosPath = FCadetDependencyManager::GetDefaultCosmosInstallPath();
	}

	FString Error;
	if (!FCadetCosmosInstaller::Uninstall(CosmosPath, Error))
	{
		FMessageDialog::Open(EAppMsgType::Ok, FText::FromString(FString::Printf(TEXT("Cosmos uninstall failed:\n\n%s"), *Error)));
		return FReply::Handled();
	}

	FCadetDependencyManager::SetCosmosPath(TEXT(""));
	if (CosmosPathText.IsValid())
	{
		CosmosPathText->SetText(FText::FromString(TEXT("Not configured")));
	}

	RefreshDependencyStatus();
	FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("CosmosUninstallSuccess", "Cosmos binaries uninstalled."));
	return FReply::Handled();
}

TSharedRef<SWidget> SCadetPublishingToolsPanel::BuildHeaderSection()
{
	return SNew(STextBlock)
		.Text(LOCTEXT("PublishingToolsHeader", "CADET Publishing Tools"))
		.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label"));
}

TSharedRef<SWidget> SCadetPublishingToolsPanel::BuildCredentialsSection()
{
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 12.0f)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("CredentialsHeader", "Platform Credentials"))
			.Font(FAppStyle::GetFontStyle("ToolMenuContext.Label"))
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 8.0f, 0.0f, 8.0f)
		[
			SNew(SBorder)
			.Padding(8.0f)
			.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.Padding(0.0f, 0.0f, 12.0f, 0.0f)
				.VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text(LOCTEXT("SteamLabel", "Steam:"))
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.VAlign(VAlign_Center)
				[
					SAssignNew(SteamStatusText, STextBlock)
					.Text(LOCTEXT("SteamNotConfigured", "Not Configured"))
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				[
					SNew(SButton)
					.Text(LOCTEXT("ConfigureButton", "Configure"))
					.OnClicked(this, &SCadetPublishingToolsPanel::OnConfigureSteamCredentialsClicked)
				]
			]
		];
}

FReply SCadetPublishingToolsPanel::OnConfigureSteamCredentialsClicked()
{
	// Open the Steam credentials configuration dialog
	SSteamCredentialsDialog::ShowDialog(SharedThis(this));
	return FReply::Handled();
}

void SCadetPublishingToolsPanel::UpdateSteamStatus()
{
	if (SteamStatusText.IsValid())
	{
		bool bSteamCmdInstalled = FCadetDependencyManager::IsSteamCmdWindowsInstalled();
		
		// TODO: Check if Steam credentials are actually configured
		// For now, just show if SteamCMD is installed
		FText StatusText = bSteamCmdInstalled 
			? LOCTEXT("SteamConfigured", "Ready (SteamCMD Installed)")
			: LOCTEXT("SteamNotReady", "Not Ready (SteamCMD Required)");

		SteamStatusText->SetText(StatusText);
	}
}

void SCadetPublishingToolsPanel::UpdateSteamCmdStatus()
{
	if (SteamCmdStatusText.IsValid())
	{
		FString ValidationError;
		const bool bSteamInstalled = FCadetSteamCmdInstaller::VerifyInstall(FCadetDependencyManager::GetSteamCmdPath(), ValidationError);

		const FText StatusText = bSteamInstalled
			? LOCTEXT("SteamCmdConfigured", "Status: Ready (SteamCMD installed)")
			: FText::FromString(FString::Printf(TEXT("Status: Not Ready (%s)"), *ValidationError));

		SteamCmdStatusText->SetText(StatusText);
	}
}

void SCadetPublishingToolsPanel::UpdateCosmosStatus()
{
	if (CosmosStatusText.IsValid())
	{
		FString ValidationError;
		const bool bCosmosInstalled = FCadetDependencyManager::ValidateCosmosPath(FCadetDependencyManager::GetCosmosPath(), ValidationError);

		const FText StatusText = bCosmosInstalled
			? LOCTEXT("CosmosConfigured", "Status: Ready (Cosmos installed)")
			: FText::FromString(FString::Printf(TEXT("Status: Not Ready (%s)"), *ValidationError));

		CosmosStatusText->SetText(StatusText);
	}
}

#undef LOCTEXT_NAMESPACE
