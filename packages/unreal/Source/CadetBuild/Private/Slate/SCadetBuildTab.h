#pragma once

#include "CadetProfileModel.h"
#include "CoreMinimal.h"
#include "HAL/PlatformProcess.h"
#include "Widgets/SCompoundWidget.h"

template<typename ItemType> class SListView;
enum class EActiveTimerReturnType : uint8;
class STextBlock;
class SScrollBox;
class SEditableTextBox;
class SCheckBox;
class STextComboBox;
class SWidgetSwitcher;

class SCadetBuildTab : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SCadetBuildTab) {}
    SLATE_END_ARGS()

    void Construct(const FArguments& InArgs);

private:
    TArray<TSharedPtr<FString>> ProfileItems;
    TArray<FCadetProfileData> Profiles;
    TSharedPtr<SListView<TSharedPtr<FString>>> ProfileListView;
    TSharedPtr<SScrollBox> ConsoleScrollBox;
    TSharedPtr<STextBlock> ConsoleTextBlock;
    TSharedPtr<SEditableTextBox> ProfileNameTextBox;
    TSharedPtr<STextComboBox> PlatformComboBox;
    TSharedPtr<STextComboBox> OsComboBox;
    TArray<TSharedPtr<FString>> PlatformOptions;
    TArray<TSharedPtr<FString>> OsOptions;
    TSharedPtr<SEditableTextBox> UnrealEngineRootTextBox;
    TSharedPtr<SEditableTextBox> UnrealProjectPathTextBox;
    TSharedPtr<SEditableTextBox> UnrealBuildOutputPathTextBox;
    TSharedPtr<SEditableTextBox> UnrealProjectNameTextBox;
    TSharedPtr<SEditableTextBox> CookerSettingsOverrideTextBox;
    TSharedPtr<SEditableTextBox> PackagingIniOverrideTextBox;
    TSharedPtr<SEditableTextBox> SteamAppIdTextBox;
    TSharedPtr<SEditableTextBox> SteamSetLiveTextBox;
    TSharedPtr<SEditableTextBox> SteamDepotIdTextBox;
    TSharedPtr<SEditableTextBox> SteamDepotLocalPathTextBox;
    TSharedPtr<SEditableTextBox> SteamDepotPathTextBox;
    TSharedPtr<SEditableTextBox> SteamDepotRecursiveTextBox;
    TSharedPtr<SCheckBox> BuildOperationCheckBox;
    TSharedPtr<SCheckBox> SteamPublishOperationCheckBox;

    FProcHandle ActiveProcess;
    void* ReadPipe = nullptr;
    void* WritePipe = nullptr;
    void* StdErrReadPipe = nullptr;
    void* StdErrWritePipe = nullptr;
    bool bIsJobRunning = false;
    bool bIsLaunchingJob = false;
    bool bCancelLaunchRequested = false;
    bool bIsRecoveredDetachedJob = false;
    bool bIsInitializing = false;
    bool bAsyncStatusPollInProgress = false;
    bool bHasObservedStatusFile = false;
    bool bLoggedWaitingForStatusFile = false;
    FString ConsoleBuffer;
    FString ActiveJobGuid;
    FString ActiveLaunchToken;
    FString ActiveManifestPath;
    FString ActiveProfileName;
    FString ActiveRuntimeProfilePath;
    int32 ActiveDetachedProcessId = 0;
    FString StdOutPendingLine;
    FString StdErrPendingLine;

    // Status file polling
    FString StatusFilePath;
    FString CurrentPhase;
    FString LastParsedPhase;
    FString LastParsedDetails;
    int32 LastStatusFileSize = 0;
    double LastStatusCheckTime = 0.0;
    double StatusCheckInterval = 0.5; // Poll every 0.5 seconds
    double StatusFileCreationDeadlineTime = 0.0;
    double StatusFileCreationGracePeriodSeconds = 10.0;

    TSharedPtr<SWidgetSwitcher> MainViewSwitcher;

    // Status file parsing
    bool ParseStatusFile(FString& OutPhase, FString& OutDetails);
    void UpdatePhaseDisplay();
    void SetPhaseDisplayText(const FString& PhaseText);
    bool SaveDetachedManifest(const FString& OverallStatus, const FString& CurrentOperation, const FString& CurrentMessage, bool bTerminal, int32 ExitCode);
    void TryRestoreDetachedJobState();
    bool SyncWorkspaceForProfile(const FCadetProfileData& Profile, FString& OutResolvedProjectPath, FString& OutError);

    void RefreshProfileItems(const FString& ProfileToSelect = FString());
    void LoadProfiles();
    void PopulateEditorFromSelection();
    void StartAsyncInitialization();
    void PollStatusAsynchronously();
    FCadetProfileData* FindSelectedProfile();
    bool BuildRuntimeProfileJson(const FCadetProfileData& Profile, FString& OutProfilePath, FString& OutError) const;
    bool LaunchCadetForProfile(const FCadetProfileData& Profile, bool bRunBuild, bool bRunSteamPublish, FString& OutError);
    void ClearConsoleOutput();
    void AppendConsoleLine(const FString& Line);
    EActiveTimerReturnType TickActiveProcess(double CurrentTime, float DeltaTime);

    FReply OnNewProfileClicked();
    FReply OnDuplicateProfileClicked();
    FReply OnSaveProfileClicked();
    FReply OnDeleteProfileClicked();
    FReply OnExportProfileClicked();
    FReply OnExecuteClicked();
    FReply OnCancelClicked();
};
