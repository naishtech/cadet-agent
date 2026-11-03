#include "Slate/SSteamCredentialsDialog.h"

#include "SCadetPublishingToolsPanel.h"
#include "CadetSteamValidator.h"
#include "Styling/AppStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "Framework/Application/SlateApplication.h"

#define LOCTEXT_NAMESPACE "SSteamCredentialsDialog"

// ---------------------------------------------------------------------------
// Construct
// ---------------------------------------------------------------------------

void SSteamCredentialsDialog::Construct(const FArguments& InArgs, TSharedPtr<SCadetPublishingToolsPanel> InPublishingPanel)
{
	PublishingPanelPtr = InPublishingPanel;
	CurrentStep = ECadetCredentialsWizardStep::LoginCredentials;
	PostExitWaitSeconds = 0.0f;
	bPostExitWaiting = false;

	// Load any previously saved credentials so the form is pre-filled
	FCadetSteamCredentials Saved = FCadetSteamValidator::ReadCredentials();
	UsernameInput = FText::FromString(Saved.Username);
	PasswordInput = FText::FromString(Saved.Password);

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
		.Padding(16.0f)
		[
			SNew(SVerticalBox)
			// Title
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.0f, 0.0f, 0.0f, 12.0f)
			[
				SNew(STextBlock)
				.Font(FAppStyle::GetFontStyle("HeadingExtraSmall"))
				.Text(LOCTEXT("Title", "Steam Credentials"))
			]
			// Dynamic content area (swapped per wizard step)
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			[
				SAssignNew(ContentArea, SBox)
				[
					BuildLoginStep()
				]
			]
			// Status text (shared across all steps)
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.0f, 8.0f, 0.0f, 0.0f)
			[
				SAssignNew(StatusTextBlock, STextBlock)
				.Text(this, &SSteamCredentialsDialog::GetStatusText)
				.AutoWrapText(true)
			]
		]
	];
}

// ---------------------------------------------------------------------------
// ShowDialog
// ---------------------------------------------------------------------------

void SSteamCredentialsDialog::ShowDialog(TSharedPtr<SCadetPublishingToolsPanel> InPublishingPanel)
{
	TSharedRef<SSteamCredentialsDialog> DialogWidget = SNew(SSteamCredentialsDialog, InPublishingPanel);

	TSharedRef<SWindow> Window = SNew(SWindow)
		.Title(LOCTEXT("WindowTitle", "Configure Steam Credentials"))
		.ClientSize(FVector2D(420.0f, 320.0f))
		.SupportsMinimize(false)
		.SupportsMaximize(false)
		[
			DialogWidget
		];

	DialogWidget->ModalWindow = Window;

	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().AddModalWindow(Window, FSlateApplication::Get().GetActiveTopLevelWindow());
	}
}

// ---------------------------------------------------------------------------
// Tick - monitors the SteamCMD process and transitions state
// ---------------------------------------------------------------------------

void SSteamCredentialsDialog::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);

	if (CurrentStep != ECadetCredentialsWizardStep::WaitingForProcess)
	{
		return;
	}

	if (bPostExitWaiting)
	{
		// Wait 5 seconds after process exits for the log to be fully flushed (mirrors Unity pattern)
		PostExitWaitSeconds += InDeltaTime;
		if (PostExitWaitSeconds >= 5.0f)
		{
			bPostExitWaiting = false;
			PostExitWaitSeconds = 0.0f;

			ECadetSteamValidationResult Result = Validator.CheckLogForResult();
			switch (Result)
			{
				case ECadetSteamValidationResult::InvalidCredentials:
					StatusText = LOCTEXT("InvalidCredentials", "Invalid username or password. Please try again.");
					TransitionToStep(ECadetCredentialsWizardStep::LoginCredentials);
					break;

				case ECadetSteamValidationResult::ConnectionFailed:
					StatusText = LOCTEXT("ConnectionFailed", "Could not connect to Steam. Check your network and try again.");
					TransitionToStep(ECadetCredentialsWizardStep::LoginCredentials);
					break;

				case ECadetSteamValidationResult::Success:
				default:
					// Proceed to optional Steam Guard code step
					GuardCodeInput = FText::GetEmpty();
					StatusText = FText::GetEmpty();
					TransitionToStep(ECadetCredentialsWizardStep::OptionalGuardCode);
					break;
			}
		}
		return;
	}

	// Poll the running process
	if (!Validator.IsProcessRunning())
	{
		// Process has exited - begin 5-second wait before reading log
		bPostExitWaiting = true;
		PostExitWaitSeconds = 0.0f;

		// Update status to show we're waiting for the log
		StatusText = LOCTEXT("ValidatingLog", "Validating... please wait.");
	}
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

TSharedRef<SWidget> SSteamCredentialsDialog::BuildLoginStep()
{
	return SNew(SVerticalBox)
		// Username
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 4.0f)
		[
			SNew(STextBlock)
			.Font(FAppStyle::GetFontStyle("Small"))
			.Text(LOCTEXT("UsernameLabel", "Steam Username"))
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 10.0f)
		[
			SNew(SEditableTextBox)
			.Text(this, &SSteamCredentialsDialog::GetUsernameText)
			.OnTextChanged(this, &SSteamCredentialsDialog::SetUsernameText)
			.HintText(LOCTEXT("UsernameHint", "Enter your Steam username"))
		]
		// Password
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 4.0f)
		[
			SNew(STextBlock)
			.Font(FAppStyle::GetFontStyle("Small"))
			.Text(LOCTEXT("PasswordLabel", "Steam Password"))
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 10.0f)
		[
			SNew(SEditableTextBox)
			.Text(this, &SSteamCredentialsDialog::GetPasswordText)
			.OnTextChanged(this, &SSteamCredentialsDialog::SetPasswordText)
			.HintText(LOCTEXT("PasswordHint", "Enter your Steam password"))
			.IsPassword(true)
		]
		// Info
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 14.0f)
		[
			SNew(STextBlock)
			.Font(FAppStyle::GetFontStyle("Small"))
			.Text(LOCTEXT("LoginInfo", "Clicking Verify will open SteamCMD in a console window. Steam will prompt if a Guard code is needed."))
			.AutoWrapText(true)
		]
		// Buttons row
		+ SVerticalBox::Slot()
		.AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			[
				SNew(SButton)
				.Text(LOCTEXT("VerifyButton", "Verify Credentials"))
				.OnClicked(this, &SSteamCredentialsDialog::OnVerifyClicked)
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.Padding(4.0f, 0.0f, 0.0f, 0.0f)
			[
				SNew(SButton)
				.Text(LOCTEXT("CancelButton", "Cancel"))
				.OnClicked(this, &SSteamCredentialsDialog::OnCancelClicked)
			]
		];
}

TSharedRef<SWidget> SSteamCredentialsDialog::BuildWaitingStep()
{
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.FillHeight(1.0f)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("WaitingMessage", "SteamCMD is running in a console window.\n\nPlease complete any prompts in that window (e.g. Steam Guard), then wait for it to close automatically."))
			.AutoWrapText(true)
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 12.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			[
				SNew(SButton)
				.Text(LOCTEXT("CancelProcessButton", "Cancel"))
				.OnClicked(this, &SSteamCredentialsDialog::OnCancelClicked)
			]
		];
}

TSharedRef<SWidget> SSteamCredentialsDialog::BuildGuardCodeStep()
{
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 8.0f)
		[
			SNew(STextBlock)
			.Text(LOCTEXT("GuardCodeInfo", "If Steam sent you a Guard code by email or authenticator app, enter it below. Otherwise click Save to continue without one."))
			.AutoWrapText(true)
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 4.0f)
		[
			SNew(STextBlock)
			.Font(FAppStyle::GetFontStyle("Small"))
			.Text(LOCTEXT("GuardCodeLabel", "Steam Guard Code (optional)"))
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(0.0f, 0.0f, 0.0f, 14.0f)
		[
			SNew(SEditableTextBox)
			.Text(this, &SSteamCredentialsDialog::GetGuardCodeText)
			.OnTextChanged(this, &SSteamCredentialsDialog::SetGuardCodeText)
			.HintText(LOCTEXT("GuardCodeHint", "e.g. A1B2C"))
		]
		// Buttons row
		+ SVerticalBox::Slot()
		.AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			[
				SNew(SButton)
				.Text(LOCTEXT("SaveButton", "Save Credentials"))
				.OnClicked(this, &SSteamCredentialsDialog::OnSaveClicked)
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.Padding(4.0f, 0.0f, 0.0f, 0.0f)
			[
				SNew(SButton)
				.Text(LOCTEXT("CancelButton", "Cancel"))
				.OnClicked(this, &SSteamCredentialsDialog::OnCancelClicked)
			]
		];
}

// ---------------------------------------------------------------------------
// Step transitions
// ---------------------------------------------------------------------------

void SSteamCredentialsDialog::TransitionToStep(ECadetCredentialsWizardStep NewStep)
{
	CurrentStep = NewStep;

	if (!ContentArea.IsValid())
	{
		return;
	}

	switch (NewStep)
	{
		case ECadetCredentialsWizardStep::LoginCredentials:
			ContentArea->SetContent(BuildLoginStep());
			break;
		case ECadetCredentialsWizardStep::WaitingForProcess:
			ContentArea->SetContent(BuildWaitingStep());
			break;
		case ECadetCredentialsWizardStep::OptionalGuardCode:
			ContentArea->SetContent(BuildGuardCodeStep());
			break;
	}
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

FReply SSteamCredentialsDialog::OnVerifyClicked()
{
	if (UsernameInput.IsEmpty() || PasswordInput.IsEmpty())
	{
		StatusText = LOCTEXT("EmptyFields", "Please enter both username and password.");
		return FReply::Handled();
	}

	StatusText = LOCTEXT("LaunchingMsg", "Launching SteamCMD...");

	if (!Validator.LaunchVerification(UsernameInput.ToString(), PasswordInput.ToString()))
	{
		StatusText = LOCTEXT("LaunchFailed", "SteamCMD not found. Please install SteamCMD first.");
		return FReply::Handled();
	}

	StatusText = FText::GetEmpty();
	PostExitWaitSeconds = 0.0f;
	bPostExitWaiting = false;
	TransitionToStep(ECadetCredentialsWizardStep::WaitingForProcess);
	return FReply::Handled();
}

FReply SSteamCredentialsDialog::OnSaveClicked()
{
	FCadetSteamCredentials Credentials;
	Credentials.Username = UsernameInput.ToString();
	Credentials.Password = PasswordInput.ToString();
	Credentials.GuardCode = GuardCodeInput.ToString();

	if (FCadetSteamValidator::WriteCredentials(Credentials))
	{
		UE_LOG(LogTemp, Log, TEXT("SSteamCredentialsDialog: Steam credentials saved to %s"),
			*FCadetSteamValidator::GetCredentialsFilePath());

		// Tell the publishing panel to refresh its status display
		if (PublishingPanelPtr.IsValid())
		{
			PublishingPanelPtr->RefreshDependencyStatus();
		}

		CloseDialog();
	}
	else
	{
		StatusText = LOCTEXT("SaveFailed", "Failed to save credentials. Check file permissions.");
	}

	return FReply::Handled();
}

FReply SSteamCredentialsDialog::OnCancelClicked()
{
	Validator.CancelProcess();
	CloseDialog();
	return FReply::Handled();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

void SSteamCredentialsDialog::SetGuardCodeText(const FText& T)
{
	// Mirror Unity: max 5 chars, alphanumeric, uppercase
	FString Raw = T.ToString().ToUpper();
	FString Filtered;
	for (TCHAR Ch : Raw)
	{
		if (FChar::IsAlpha(Ch) || FChar::IsDigit(Ch))
		{
			Filtered.AppendChar(Ch);
		}
		if (Filtered.Len() >= 5) break;
	}
	GuardCodeInput = FText::FromString(Filtered);
}

void SSteamCredentialsDialog::CloseDialog()
{
	if (ModalWindow.IsValid())
	{
		ModalWindow->RequestDestroyWindow();
	}
}

#undef LOCTEXT_NAMESPACE
