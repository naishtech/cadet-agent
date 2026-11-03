#pragma once

#include <CoreMinimal.h>
#include <Widgets/SCompoundWidget.h>
#include "CadetSteamValidator.h"

class SCadetPublishingToolsPanel;
class SBox;
class STextBlock;

/** Steps in the Steam Credentials wizard */
enum class ECadetCredentialsWizardStep : uint8
{
	/** User enters username and password */
	LoginCredentials,
	/** SteamCMD is running in a console window */
	WaitingForProcess,
	/** SteamCMD finished - user may enter Steam Guard code */
	OptionalGuardCode
};

/**
 * Multi-step modal wizard for configuring and verifying Steam credentials.
 *
 * Step flow mirrors the CADET Unity SteamCredentialsWizard:
 *   LoginCredentials -> WaitingForProcess -> OptionalGuardCode
 *
 * Credentials are persisted to ~/.env_cadet_steam_credentials (KEY=VALUE format).
 */
class SSteamCredentialsDialog : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SSteamCredentialsDialog) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs, TSharedPtr<SCadetPublishingToolsPanel> InPublishingPanel);

	/** Shows the wizard as a modal window */
	static void ShowDialog(TSharedPtr<SCadetPublishingToolsPanel> InPublishingPanel);

	/** SCompoundWidget override - drives process monitoring while WaitingForProcess */
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

private:
	// ---- Step builders ----
	TSharedRef<SWidget> BuildLoginStep();
	TSharedRef<SWidget> BuildWaitingStep();
	TSharedRef<SWidget> BuildGuardCodeStep();

	/** Rebuild ContentArea to reflect the current wizard step */
	void TransitionToStep(ECadetCredentialsWizardStep NewStep);

	// ---- Callbacks ----
	FReply OnVerifyClicked();
	FReply OnSaveClicked();
	FReply OnCancelClicked();

	// ---- Text bindings ----
	FText GetUsernameText() const          { return UsernameInput; }
	FText GetPasswordText() const          { return PasswordInput; }
	FText GetGuardCodeText() const         { return GuardCodeInput; }
	FText GetStatusText() const            { return StatusText; }
	void  SetUsernameText(const FText& T)  { UsernameInput = T; }
	void  SetPasswordText(const FText& T)  { PasswordInput = T; }
	void  SetGuardCodeText(const FText& T);

	/** Close the owning modal window */
	void CloseDialog();

	// ---- State ----
	TSharedPtr<SCadetPublishingToolsPanel> PublishingPanelPtr;
	TSharedPtr<SWindow>    ModalWindow;
	TSharedPtr<SBox>       ContentArea;
	TSharedPtr<STextBlock> StatusTextBlock;

	ECadetCredentialsWizardStep CurrentStep = ECadetCredentialsWizardStep::LoginCredentials;

	FText UsernameInput;
	FText PasswordInput;
	FText GuardCodeInput;
	FText StatusText;

	FCadetSteamValidator Validator;

	/** Seconds elapsed since the SteamCMD process exited (for the 5-second log-flush wait) */
	float PostExitWaitSeconds = 0.0f;
	bool  bPostExitWaiting = false;
};
