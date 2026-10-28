#include "Slate/SCadetBuildTab.h"

#include "CadetDependencyManager.h"
#include "CadetProfileModel.h"
#include "Slate/SCadetPublishingToolsPanel.h"
#include "Utils/CadetDetachedLaunch.h"
#include "Async/Async.h"
#include "DesktopPlatformModule.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Notifications/NotificationManager.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/App.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"
#include "Misc/DateTime.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Widgets/Notifications/SNotificationList.h"

#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SCheckBox.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Input/STextComboBox.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SSplitter.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SUniformGridPanel.h"
#include "Widgets/Layout/SWidgetSwitcher.h"
#include "Widgets/Views/SListView.h"
#include "Widgets/Text/STextBlock.h"

#define LOCTEXT_NAMESPACE "SCadetBuildTab"
DEFINE_LOG_CATEGORY_STATIC(LogCadetBuild, Log, All);

namespace
{
    bool ValidatePluginCliRuntime(const FString& PluginCliRoot, FString& OutError)
    {
        const TArray<FString> RequiredRelativePaths = {
            TEXT("dist.sh"),
            TEXT("Util/json_parser.sh"),
            TEXT("Util/build_status.sh"),
            TEXT("Steam/publish.sh"),
            TEXT("Unreal/build.sh")
        };

        TArray<FString> MissingFiles;
        for (const FString& RelativePath : RequiredRelativePaths)
        {
            const FString AbsolutePath = FPaths::Combine(PluginCliRoot, RelativePath);
            if (!FPaths::FileExists(AbsolutePath))
            {
                MissingFiles.Add(AbsolutePath);
            }
        }

        if (MissingFiles.Num() == 0)
        {
            OutError.Empty();
            return true;
        }

        FString MissingList;
        for (const FString& Missing : MissingFiles)
        {
            if (!MissingList.IsEmpty())
            {
                MissingList += TEXT("\n  - ");
            }
            else
            {
                MissingList = TEXT("  - ");
            }
            MissingList += Missing;
        }

        OutError = FString::Printf(
            TEXT("CADET CLI runtime is incomplete under %s\n\n")
            TEXT("Missing required files:\n%s\n\n")
            TEXT("Resync the plugin CLI bundle from cadet-cli:\n")
            TEXT("  powershell -NoProfile -ExecutionPolicy Bypass -File F:/unity/projects/cadet/cadet-cli/make.ps1 -Target sync -SyncUnrealPlugin"),
            *PluginCliRoot,
            *MissingList);
        return false;
    }

    struct FCadetDirectorySyncResult
    {
        bool bSuccess = false;
        bool bCancelled = false;
        int32 FilesCopied = 0;
        int32 FilesDeleted = 0;
        FString ResolvedTargetProjectPath;
        FString Error;
    };

    struct FCadetDetachedManifest
    {
        int32 SchemaVersion = 1;
        FString JobGuid;
        FString LaunchToken;
        FString ProfileName;
        FString RuntimeProfilePath;
        FString StatusFilePath;
        FString LogPath;
        int32 ProcessId = 0;
        FString StartedAtUtc;
        FString UpdatedAtUtc;
        FString TerminalAtUtc;
        FString OverallStatus;
        FString CurrentOperation;
        FString CurrentMessage;
        int32 ExitCode = INDEX_NONE;
    };

    FString GetCadetJobsDirectory()
    {
        return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Config"), TEXT("CadetBuild"), TEXT("Jobs"));
    }

    FString BuildDetachedManifestPath(const FString& JobGuid)
    {
        if (JobGuid.IsEmpty())
        {
            return FString();
        }

        return FPaths::Combine(GetCadetJobsDirectory(), FString::Printf(TEXT("%s-detached.json"), *JobGuid));
    }

    FString UtcNowIsoString()
    {
        return FDateTime::UtcNow().ToIso8601();
    }

    bool IsTerminalStatusValue(const FString& StatusValue)
    {
        const FString Lower = StatusValue.ToLower();
        return Lower == TEXT("success")
            || Lower == TEXT("succeeded")
            || Lower == TEXT("failed")
            || Lower == TEXT("error")
            || Lower == TEXT("cancelled")
            || Lower == TEXT("canceled")
            || Lower == TEXT("completed")
            || Lower == TEXT("done");
    }

    bool IsTerminalManifest(const FCadetDetachedManifest& Manifest)
    {
        if (!Manifest.TerminalAtUtc.IsEmpty())
        {
            return true;
        }

        return IsTerminalStatusValue(Manifest.OverallStatus);
    }

    bool WriteDetachedManifestToDisk(const FString& ManifestPath, const FCadetDetachedManifest& Manifest)
    {
        if (ManifestPath.IsEmpty())
        {
            return false;
        }

        TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
        Root->SetNumberField(TEXT("schemaVersion"), Manifest.SchemaVersion);
        Root->SetStringField(TEXT("jobGuid"), Manifest.JobGuid);
        Root->SetStringField(TEXT("launchToken"), Manifest.LaunchToken);
        Root->SetStringField(TEXT("profileName"), Manifest.ProfileName);
        Root->SetStringField(TEXT("runtimeProfilePath"), Manifest.RuntimeProfilePath);
        Root->SetStringField(TEXT("statusFilePath"), Manifest.StatusFilePath);
        Root->SetStringField(TEXT("logPath"), Manifest.LogPath);
        Root->SetNumberField(TEXT("processId"), Manifest.ProcessId);
        Root->SetStringField(TEXT("startedAtUtc"), Manifest.StartedAtUtc);
        Root->SetStringField(TEXT("updatedAtUtc"), Manifest.UpdatedAtUtc);
        Root->SetStringField(TEXT("terminalAtUtc"), Manifest.TerminalAtUtc);
        Root->SetStringField(TEXT("overallStatus"), Manifest.OverallStatus);
        Root->SetStringField(TEXT("currentOperation"), Manifest.CurrentOperation);
        Root->SetStringField(TEXT("currentMessage"), Manifest.CurrentMessage);
        Root->SetNumberField(TEXT("exitCode"), Manifest.ExitCode);

        FString Output;
        const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Output);
        if (!FJsonSerializer::Serialize(Root, Writer))
        {
            return false;
        }

        IFileManager::Get().MakeDirectory(*FPaths::GetPath(ManifestPath), true);
        return FFileHelper::SaveStringToFile(Output, *ManifestPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
    }

    bool ReadDetachedManifestFromDisk(const FString& ManifestPath, FCadetDetachedManifest& OutManifest)
    {
        FString Json;
        if (!FFileHelper::LoadFileToString(Json, *ManifestPath))
        {
            return false;
        }

        TSharedPtr<FJsonObject> Root;
        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
        if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
        {
            return false;
        }

        OutManifest.SchemaVersion = Root->GetIntegerField(TEXT("schemaVersion"));
        Root->TryGetStringField(TEXT("jobGuid"), OutManifest.JobGuid);
        Root->TryGetStringField(TEXT("launchToken"), OutManifest.LaunchToken);
        Root->TryGetStringField(TEXT("profileName"), OutManifest.ProfileName);
        Root->TryGetStringField(TEXT("runtimeProfilePath"), OutManifest.RuntimeProfilePath);
        Root->TryGetStringField(TEXT("statusFilePath"), OutManifest.StatusFilePath);
        Root->TryGetStringField(TEXT("logPath"), OutManifest.LogPath);
        double ProcessIdValue = 0.0;
        if (Root->TryGetNumberField(TEXT("processId"), ProcessIdValue))
        {
            OutManifest.ProcessId = static_cast<int32>(ProcessIdValue);
        }
        Root->TryGetStringField(TEXT("startedAtUtc"), OutManifest.StartedAtUtc);
        Root->TryGetStringField(TEXT("updatedAtUtc"), OutManifest.UpdatedAtUtc);
        Root->TryGetStringField(TEXT("terminalAtUtc"), OutManifest.TerminalAtUtc);
        Root->TryGetStringField(TEXT("overallStatus"), OutManifest.OverallStatus);
        Root->TryGetStringField(TEXT("currentOperation"), OutManifest.CurrentOperation);
        Root->TryGetStringField(TEXT("currentMessage"), OutManifest.CurrentMessage);
        double ExitCodeValue = static_cast<double>(OutManifest.ExitCode);
        if (Root->TryGetNumberField(TEXT("exitCode"), ExitCodeValue))
        {
            OutManifest.ExitCode = static_cast<int32>(ExitCodeValue);
        }

        return !OutManifest.JobGuid.IsEmpty();
    }

    bool TryReadTerminalStateFromStatusFile(const FString& StatusFilePath, bool& bOutTerminal, int32& OutExitCode, FString& OutStatusText)
    {
        bOutTerminal = false;
        OutExitCode = INDEX_NONE;
        OutStatusText.Empty();

        if (StatusFilePath.IsEmpty() || !FPaths::FileExists(StatusFilePath))
        {
            return false;
        }

        FString Json;
        if (!FFileHelper::LoadFileToString(Json, *StatusFilePath))
        {
            return false;
        }

        TSharedPtr<FJsonObject> Root;
        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
        if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
        {
            return false;
        }

        bool bTerminalField = false;
        if (Root->TryGetBoolField(TEXT("terminal"), bTerminalField) || Root->TryGetBoolField(TEXT("isTerminal"), bTerminalField))
        {
            bOutTerminal = bTerminalField;
        }

        bool bCompleted = false;
        if (Root->TryGetBoolField(TEXT("completed"), bCompleted) || Root->TryGetBoolField(TEXT("done"), bCompleted))
        {
            bOutTerminal = bOutTerminal || bCompleted;
        }

        FString Status;
        if (Root->TryGetStringField(TEXT("overallStatus"), Status)
            || Root->TryGetStringField(TEXT("status"), Status)
            || Root->TryGetStringField(TEXT("state"), Status))
        {
            OutStatusText = Status;
            bOutTerminal = bOutTerminal || IsTerminalStatusValue(Status);
        }

        double ExitCodeValue = static_cast<double>(OutExitCode);
        if (Root->TryGetNumberField(TEXT("exitCode"), ExitCodeValue))
        {
            OutExitCode = static_cast<int32>(ExitCodeValue);
        }
        return true;
    }

    FString EscapeJson(const FString& Value)
    {
        FString Out = Value;
        Out.ReplaceInline(TEXT("\\"), TEXT("\\\\"));
        Out.ReplaceInline(TEXT("\""), TEXT("\\\""));
        return Out;
    }

    FString ResolveEditorEngineRoot()
    {
        FString EngineRoot = FPaths::ConvertRelativePathToFull(FPaths::EngineDir());
        FPaths::NormalizeFilename(EngineRoot);

        const FString EngineMarker = TEXT("/Engine/");
        const int32 EngineIndex = EngineRoot.Find(EngineMarker, ESearchCase::IgnoreCase, ESearchDir::FromEnd);
        if (EngineIndex > 0)
        {
            EngineRoot = EngineRoot.Left(EngineIndex);
        }

        return EngineRoot;
    }

    FString ResolveDefaultSteamContentRoot(const FString& BuildOutputPath)
    {
        FString Normalized = BuildOutputPath;
        FPaths::NormalizeFilename(Normalized);
        return Normalized;
    }

    FString ResolveDefaultSteamBuildOutput(const FString& BuildOutputPath)
    {
        FString Normalized = FPaths::Combine(BuildOutputPath, TEXT("build"));
        FPaths::NormalizeFilename(Normalized);
        return Normalized;
    }

    FString ResolveDefaultSteamDepotLocalPath()
    {
        return TEXT("archives/windows/*");
    }

    void ApplyDerivedSteamPaths(FCadetProfileData& Profile)
    {
        if (Profile.Unreal.BuildOutputPath.IsEmpty())
        {
            const FString EffectiveProjectName = Profile.Unreal.ProjectName.IsEmpty() ? FApp::GetProjectName() : Profile.Unreal.ProjectName;
            Profile.Unreal.BuildOutputPath = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("CadetBuild"), TEXT("Builds"), EffectiveProjectName);
        }

        FPaths::NormalizeFilename(Profile.Unreal.BuildOutputPath);
        Profile.Steam.ContentRoot = ResolveDefaultSteamContentRoot(Profile.Unreal.BuildOutputPath);
        Profile.Steam.BuildOutput = ResolveDefaultSteamBuildOutput(Profile.Unreal.BuildOutputPath);
    }

    FString GetDefaultDialogPath(const TSharedPtr<SEditableTextBox>& TextBox)
    {
        if (TextBox.IsValid())
        {
            const FString Candidate = TextBox->GetText().ToString().TrimStartAndEnd();
            if (!Candidate.IsEmpty())
            {
                if (FPaths::DirectoryExists(Candidate))
                {
                    return Candidate;
                }

                const FString CandidateDir = FPaths::GetPath(Candidate);
                if (FPaths::DirectoryExists(CandidateDir))
                {
                    return CandidateDir;
                }
            }
        }

        return FPaths::ProjectDir();
    }

    void SetComboSelection(
        const TSharedPtr<STextComboBox>& ComboBox,
        const TArray<TSharedPtr<FString>>& Options,
        const FString& DesiredValue,
        const FString& FallbackValue)
    {
        if (!ComboBox.IsValid() || Options.Num() == 0)
        {
            return;
        }

        TSharedPtr<FString> SelectedOption;
        for (const TSharedPtr<FString>& Option : Options)
        {
            if (Option.IsValid() && Option->Equals(DesiredValue, ESearchCase::IgnoreCase))
            {
                SelectedOption = Option;
                break;
            }
        }

        if (!SelectedOption.IsValid())
        {
            for (const TSharedPtr<FString>& Option : Options)
            {
                if (Option.IsValid() && Option->Equals(FallbackValue, ESearchCase::IgnoreCase))
                {
                    SelectedOption = Option;
                    break;
                }
            }
        }

        if (!SelectedOption.IsValid())
        {
            SelectedOption = Options[0];
        }

        ComboBox->SetSelectedItem(SelectedOption);
    }

    FString GetComboSelectionValue(const TSharedPtr<STextComboBox>& ComboBox)
    {
        if (!ComboBox.IsValid())
        {
            return FString();
        }

        const TSharedPtr<FString> Selected = ComboBox->GetSelectedItem();
        return Selected.IsValid() ? *Selected : FString();
    }

    bool PickDirectoryForTextBox(const TSharedPtr<SEditableTextBox>& TextBox, const FString& DialogTitle)
    {
        IDesktopPlatform* DesktopPlatform = FDesktopPlatformModule::Get();
        if (DesktopPlatform == nullptr || !TextBox.IsValid())
        {
            return false;
        }

        FString PickedFolder;
        const void* ParentHandle = FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr);
        const bool bPicked = DesktopPlatform->OpenDirectoryDialog(
            ParentHandle,
            DialogTitle,
            GetDefaultDialogPath(TextBox),
            PickedFolder);

        if (bPicked && !PickedFolder.IsEmpty())
        {
            TextBox->SetText(FText::FromString(PickedFolder));
        }

        return bPicked;
    }

    bool PickFileForTextBox(const TSharedPtr<SEditableTextBox>& TextBox, const FString& DialogTitle, const FString& FileTypes)
    {
        IDesktopPlatform* DesktopPlatform = FDesktopPlatformModule::Get();
        if (DesktopPlatform == nullptr || !TextBox.IsValid())
        {
            return false;
        }

        TArray<FString> PickedFiles;
        const void* ParentHandle = FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr);
        const bool bPicked = DesktopPlatform->OpenFileDialog(
            ParentHandle,
            DialogTitle,
            GetDefaultDialogPath(TextBox),
            TEXT(""),
            FileTypes,
            EFileDialogFlags::None,
            PickedFiles);

        if (bPicked && PickedFiles.Num() > 0)
        {
            TextBox->SetText(FText::FromString(PickedFiles[0]));
        }

        return bPicked;
    }

    FString NormalizePathForCompare(const FString& InPath)
    {
        FString Path = FPaths::ConvertRelativePathToFull(InPath);
        FPaths::NormalizeFilename(Path);
        while (Path.RemoveFromEnd(TEXT("/")))
        {
        }
        return Path;
    }

    bool IsPathWithin(const FString& ParentPath, const FString& ChildPath)
    {
        const FString NormalizedParent = NormalizePathForCompare(ParentPath);
        const FString NormalizedChild = NormalizePathForCompare(ChildPath);

        if (NormalizedParent.IsEmpty() || NormalizedChild.IsEmpty())
        {
            return false;
        }

        return NormalizedChild.StartsWith(NormalizedParent + TEXT("/"), ESearchCase::IgnoreCase);
    }

    bool IsExcludedRelativePath(const FString& RelativePath)
    {
        FString Normalized = RelativePath;
        FPaths::NormalizeFilename(Normalized);

        TArray<FString> Segments;
        Normalized.ParseIntoArray(Segments, TEXT("/"), true);
        if (Segments.Num() == 0)
        {
            return false;
        }

        const FString& TopLevel = Segments[0];
        return TopLevel.Equals(TEXT("Binaries"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT("Build"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT("DerivedDataCache"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT("Intermediate"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT("Saved"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT(".git"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT(".vs"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT(".idea"), ESearchCase::IgnoreCase)
            || TopLevel.Equals(TEXT(".vscode"), ESearchCase::IgnoreCase);
    }

    bool ShouldCopyFile(const FString& SourceFile, const FString& TargetFile)
    {
        IFileManager& FileManager = IFileManager::Get();
        if (!FileManager.FileExists(*TargetFile))
        {
            return true;
        }

        const int64 SourceSize = FileManager.FileSize(*SourceFile);
        const int64 TargetSize = FileManager.FileSize(*TargetFile);
        if (SourceSize != TargetSize)
        {
            return true;
        }

        const FDateTime SourceStamp = FileManager.GetTimeStamp(*SourceFile);
        const FDateTime TargetStamp = FileManager.GetTimeStamp(*TargetFile);
        return SourceStamp > TargetStamp;
    }

    FCadetDirectorySyncResult SyncWorkspaceDirectory(
        const FString& SourceProjectPath,
        const FString& ConfiguredTargetWorkspacePath,
        TFunctionRef<bool()> IsCancellationRequested,
        TFunctionRef<void(const FString&)> ReportProgress)
    {
        FCadetDirectorySyncResult Result;

        auto ReturnCancelled = [&Result]() -> FCadetDirectorySyncResult
        {
            Result.bCancelled = true;
            Result.Error = TEXT("Workspace sync cancelled.");
            return Result;
        };

        if (IsCancellationRequested())
        {
            return ReturnCancelled();
        }

        const FString NormalizedSourceProject = NormalizePathForCompare(SourceProjectPath);
        if (!FPaths::FileExists(NormalizedSourceProject))
        {
            Result.Error = FString::Printf(TEXT("Source project file does not exist: %s"), *NormalizedSourceProject);
            return Result;
        }

        FString TargetWorkspacePath = ConfiguredTargetWorkspacePath.TrimStartAndEnd();
        if (TargetWorkspacePath.IsEmpty())
        {
            Result.Error = TEXT("Set Sync Workspace Directory to a separate folder before executing.");
            return Result;
        }

        // Backward-compatible normalization: older profiles may store a .uproject path.
        if (TargetWorkspacePath.EndsWith(TEXT(".uproject"), ESearchCase::IgnoreCase))
        {
            TargetWorkspacePath = FPaths::GetPath(TargetWorkspacePath);
        }

        if (TargetWorkspacePath.IsEmpty())
        {
            Result.Error = TEXT("Sync Workspace Directory is invalid.");
            return Result;
        }

        const FString NormalizedTargetWorkspace = NormalizePathForCompare(TargetWorkspacePath);
        const FString SourceProjectName = FPaths::GetCleanFilename(NormalizedSourceProject);
        const FString NormalizedTargetProject = NormalizePathForCompare(FPaths::Combine(NormalizedTargetWorkspace, SourceProjectName));
        const FString SourceRoot = NormalizePathForCompare(FPaths::GetPath(NormalizedSourceProject));
        const FString TargetRoot = NormalizedTargetWorkspace;

        if (SourceRoot.IsEmpty() || TargetRoot.IsEmpty())
        {
            Result.Error = TEXT("Failed to resolve source/target workspace paths for sync.");
            return Result;
        }

        if (SourceRoot.Equals(TargetRoot, ESearchCase::IgnoreCase))
        {
            Result.Error = TEXT("Sync Workspace Directory must point to a separate sync workspace. Source and target cannot be the same folder.");
            return Result;
        }

        if (IsPathWithin(SourceRoot, TargetRoot) || IsPathWithin(TargetRoot, SourceRoot))
        {
            Result.Error = TEXT("Source and sync workspaces cannot be nested inside each other.");
            return Result;
        }

        IFileManager& FileManager = IFileManager::Get();
        if (!FileManager.MakeDirectory(*TargetRoot, true))
        {
            Result.Error = FString::Printf(TEXT("Failed to create sync workspace folder: %s"), *TargetRoot);
            return Result;
        }

        TArray<FString> SourceFiles;
        FileManager.FindFilesRecursive(SourceFiles, *SourceRoot, TEXT("*"), true, false, false);

        const FString SourcePrefix = SourceRoot + TEXT("/");
        for (const FString& SourceFile : SourceFiles)
        {
            if (IsCancellationRequested())
            {
                return ReturnCancelled();
            }

            FString RelativePath = SourceFile;
            FPaths::NormalizeFilename(RelativePath);
            if (!RelativePath.RemoveFromStart(SourcePrefix, ESearchCase::IgnoreCase))
            {
                continue;
            }

            if (IsExcludedRelativePath(RelativePath))
            {
                continue;
            }

            const FString TargetFile = FPaths::Combine(TargetRoot, RelativePath);
            const FString TargetDirectory = FPaths::GetPath(TargetFile);
            if (!FileManager.MakeDirectory(*TargetDirectory, true))
            {
                Result.Error = FString::Printf(TEXT("Failed to create target directory during sync: %s"), *TargetDirectory);
                return Result;
            }

            if (!ShouldCopyFile(SourceFile, TargetFile))
            {
                continue;
            }

            ReportProgress(FString::Printf(TEXT("[SYNC] Copying: %s"), *RelativePath));

            if (FileManager.Copy(*TargetFile, *SourceFile, true, true) != COPY_OK)
            {
                Result.Error = FString::Printf(TEXT("Failed to copy file during sync: %s"), *RelativePath);
                return Result;
            }

            ++Result.FilesCopied;
        }

        TArray<FString> TargetFiles;
        FileManager.FindFilesRecursive(TargetFiles, *TargetRoot, TEXT("*"), true, false, false);

        const FString TargetPrefix = TargetRoot + TEXT("/");
        for (const FString& TargetFile : TargetFiles)
        {
            if (IsCancellationRequested())
            {
                return ReturnCancelled();
            }

            FString RelativePath = TargetFile;
            FPaths::NormalizeFilename(RelativePath);
            if (!RelativePath.RemoveFromStart(TargetPrefix, ESearchCase::IgnoreCase))
            {
                continue;
            }

            if (IsExcludedRelativePath(RelativePath))
            {
                continue;
            }

            const FString SourceCandidate = FPaths::Combine(SourceRoot, RelativePath);
            if (FileManager.FileExists(*SourceCandidate))
            {
                continue;
            }

            ReportProgress(FString::Printf(TEXT("[SYNC] Deleting stale: %s"), *RelativePath));

            if (!FileManager.Delete(*TargetFile, false, true, true))
            {
                Result.Error = FString::Printf(TEXT("Failed to remove stale file during sync: %s"), *RelativePath);
                return Result;
            }

            ++Result.FilesDeleted;
        }

        Result.bSuccess = true;
        Result.ResolvedTargetProjectPath = NormalizePathForCompare(NormalizedTargetProject);
        return Result;
    }

    void ShowNotification(const FText& Message, SNotificationItem::ECompletionState State)
    {
        FNotificationInfo Info(Message);
        Info.FadeInDuration = 0.1f;
        Info.FadeOutDuration = 0.3f;
        Info.ExpireDuration = 2.5f;
        Info.bUseLargeFont = false;

        TSharedPtr<SNotificationItem> Notification = FSlateNotificationManager::Get().AddNotification(Info);
        if (Notification.IsValid())
        {
            Notification->SetCompletionState(State);
        }
    }

    void AppendOutputChunk(const FString& Chunk, FString& PendingLine, const FString& Prefix, TFunctionRef<void(const FString&)> AppendLine)
    {
        if (Chunk.IsEmpty())
        {
            return;
        }

        FString Combined = PendingLine + Chunk;
        int32 Cursor = 0;

        while (true)
        {
            const int32 NewLineIndex = Combined.Find(TEXT("\n"), ESearchCase::CaseSensitive, ESearchDir::FromStart, Cursor);
            if (NewLineIndex == INDEX_NONE)
            {
                break;
            }

            FString Line = Combined.Mid(Cursor, NewLineIndex - Cursor);
            Line.TrimEndInline(); // trim CR from CRLF while preserving leading indentation

            if (!Line.IsEmpty())
            {
                AppendLine(Prefix + Line);
            }

            Cursor = NewLineIndex + 1;
        }

        PendingLine = Combined.Mid(Cursor);
    }
}

void SCadetBuildTab::SetPhaseDisplayText(const FString& PhaseText)
{
    CurrentPhase = PhaseText;
}

bool SCadetBuildTab::SaveDetachedManifest(const FString& OverallStatus, const FString& CurrentOperation, const FString& CurrentMessage, bool bTerminal, int32 ExitCode)
{
    if (ActiveJobGuid.IsEmpty())
    {
        return false;
    }

    if (ActiveManifestPath.IsEmpty())
    {
        ActiveManifestPath = BuildDetachedManifestPath(ActiveJobGuid);
    }

    FCadetDetachedManifest Existing;
    const bool bHasExisting = ReadDetachedManifestFromDisk(ActiveManifestPath, Existing);

    FCadetDetachedManifest Manifest = Existing;
    Manifest.JobGuid = ActiveJobGuid;
    Manifest.LaunchToken = ActiveLaunchToken;
    Manifest.ProfileName = ActiveProfileName;
    Manifest.RuntimeProfilePath = ActiveRuntimeProfilePath;
    Manifest.StatusFilePath = StatusFilePath;
    Manifest.ProcessId = ActiveDetachedProcessId;
    Manifest.UpdatedAtUtc = UtcNowIsoString();

    if (Manifest.StartedAtUtc.IsEmpty())
    {
        Manifest.StartedAtUtc = Manifest.UpdatedAtUtc;
    }

    if (!OverallStatus.IsEmpty())
    {
        Manifest.OverallStatus = OverallStatus;
    }
    if (!CurrentOperation.IsEmpty())
    {
        Manifest.CurrentOperation = CurrentOperation;
    }
    if (!CurrentMessage.IsEmpty())
    {
        Manifest.CurrentMessage = CurrentMessage;
    }
    if (ExitCode != INDEX_NONE)
    {
        Manifest.ExitCode = ExitCode;
    }

    if (bTerminal)
    {
        Manifest.TerminalAtUtc = Manifest.UpdatedAtUtc;
    }
    else if (!bHasExisting)
    {
        Manifest.TerminalAtUtc.Empty();
    }

    return WriteDetachedManifestToDisk(ActiveManifestPath, Manifest);
}

void SCadetBuildTab::TryRestoreDetachedJobState()
{
    const FString JobsDir = GetCadetJobsDirectory();
    TArray<FString> ManifestFiles;
    IFileManager::Get().FindFiles(ManifestFiles, *(JobsDir / TEXT("*-detached.json")), true, false);
    if (ManifestFiles.Num() == 0)
    {
        return;
    }

    bool bFoundRunning = false;
    FString BestRunningUpdated;
    bool bFoundTerminal = false;
    FString BestTerminalUpdated;
    FCadetDetachedManifest SelectedManifest;
    FString SelectedManifestPath;

    for (const FString& ManifestName : ManifestFiles)
    {
        const FString ManifestPath = FPaths::Combine(JobsDir, ManifestName);
        FCadetDetachedManifest Manifest;
        if (!ReadDetachedManifestFromDisk(ManifestPath, Manifest))
        {
            continue;
        }

        const bool bTerminal = IsTerminalManifest(Manifest);
        const FString Updated = Manifest.UpdatedAtUtc;
        if (!bTerminal)
        {
            if (!bFoundRunning || Updated > BestRunningUpdated)
            {
                bFoundRunning = true;
                BestRunningUpdated = Updated;
                SelectedManifest = Manifest;
                SelectedManifestPath = ManifestPath;
            }
        }
        else if (!bFoundRunning)
        {
            if (!bFoundTerminal || Updated > BestTerminalUpdated)
            {
                bFoundTerminal = true;
                BestTerminalUpdated = Updated;
                SelectedManifest = Manifest;
                SelectedManifestPath = ManifestPath;
            }
        }
    }

    if (SelectedManifest.JobGuid.IsEmpty())
    {
        return;
    }

    ActiveJobGuid = SelectedManifest.JobGuid;
    ActiveLaunchToken = SelectedManifest.LaunchToken;
    ActiveManifestPath = SelectedManifestPath;
    ActiveProfileName = SelectedManifest.ProfileName;
    ActiveRuntimeProfilePath = SelectedManifest.RuntimeProfilePath;
    ActiveDetachedProcessId = SelectedManifest.ProcessId;
    StatusFilePath = SelectedManifest.StatusFilePath.IsEmpty()
        ? FPaths::Combine(GetCadetJobsDirectory(), FString::Printf(TEXT("%s-status.json"), *SelectedManifest.JobGuid))
        : SelectedManifest.StatusFilePath;

    bIsRecoveredDetachedJob = true;
    bIsJobRunning = !IsTerminalManifest(SelectedManifest);
    LastStatusCheckTime = FPlatformTime::Seconds();
    bHasObservedStatusFile = FPaths::FileExists(StatusFilePath);
    bLoggedWaitingForStatusFile = false;
    StatusFileCreationDeadlineTime = LastStatusCheckTime + StatusFileCreationGracePeriodSeconds;

    if (bIsJobRunning && !FPaths::FileExists(StatusFilePath))
    {
        const FString RecoveryMessage = FString::Printf(
            TEXT("Recovered detached job %s has no status file. Marking as failed and unlocking Execute."),
            *ActiveJobGuid);
        bIsJobRunning = false;
        bIsRecoveredDetachedJob = false;
        SetPhaseDisplayText(TEXT("Idle"));
        AppendConsoleLine(FString::Printf(TEXT("[DIST] %s"), *RecoveryMessage));
        SaveDetachedManifest(TEXT("failed"), TEXT("recovery"), RecoveryMessage, true, -1);
        ShowNotification(LOCTEXT("CadetRecoveredRunMissingStatus", "Recovered CADET run had no status file. Marked as failed."), SNotificationItem::CS_Fail);
        return;
    }

    if (SelectedManifest.CurrentMessage.IsEmpty())
    {
        SetPhaseDisplayText(SelectedManifest.OverallStatus.IsEmpty() ? TEXT("Detached job recovered") : SelectedManifest.OverallStatus);
    }
    else
    {
        SetPhaseDisplayText(SelectedManifest.CurrentMessage);
    }

    AppendConsoleLine(FString::Printf(TEXT("[DIST] Recovered detached job %s from persisted manifest."), *ActiveJobGuid));
    if (bIsJobRunning)
    {
        AppendConsoleLine(FString::Printf(TEXT("[DIST] Monitoring status file after restart: %s"), *StatusFilePath));
        RegisterActiveTimer(0.2f, FWidgetActiveTimerDelegate::CreateSP(this, &SCadetBuildTab::TickActiveProcess));
    }
    else
    {
        AppendConsoleLine(FString::Printf(TEXT("[DIST] Last known terminal status: %s"), *SelectedManifest.OverallStatus));
    }
}

bool SCadetBuildTab::SyncWorkspaceForProfile(const FCadetProfileData& Profile, FString& OutResolvedProjectPath, FString& OutError)
{
    const FString SourceProjectPath = FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath());
    AppendConsoleLine(TEXT("[SYNC] Starting workspace sync preflight..."));

    FCadetDirectorySyncResult SyncResult = SyncWorkspaceDirectory(
        SourceProjectPath,
        Profile.Unreal.ProjectPath,
        []() { return false; },
        [](const FString&) {});
    if (!SyncResult.bSuccess)
    {
        OutError = SyncResult.Error;
        return false;
    }

    OutResolvedProjectPath = SyncResult.ResolvedTargetProjectPath;
    AppendConsoleLine(FString::Printf(
        TEXT("[SYNC] Workspace synchronized to %s (copied: %d, deleted: %d)"),
        *OutResolvedProjectPath,
        SyncResult.FilesCopied,
        SyncResult.FilesDeleted));
    return true;
}

void SCadetBuildTab::LoadProfiles()
{
    Profiles = FCadetProfileStore::LoadAllProfiles();

    if (Profiles.Num() == 0)
    {
        Profiles.Add(FCadetProfileData::MakeDefault(1));
        FString Error;
        FCadetProfileStore::SaveProfile(Profiles[0], &Error);
    }

    RefreshProfileItems();
}

void SCadetBuildTab::RefreshProfileItems(const FString& ProfileToSelect)
{
    ProfileItems.Reset();
    for (const FCadetProfileData& Profile : Profiles)
    {
        ProfileItems.Add(MakeShared<FString>(Profile.ProfileName));
    }

    if (ProfileListView.IsValid())
    {
        ProfileListView->RequestListRefresh();
        if (ProfileItems.Num() > 0)
        {
            TSharedPtr<FString> ItemToSelect = ProfileItems[0];
            if (!ProfileToSelect.IsEmpty())
            {
                for (const TSharedPtr<FString>& Item : ProfileItems)
                {
                    if (Item.IsValid() && *Item == ProfileToSelect)
                    {
                        ItemToSelect = Item;
                        break;
                    }
                }
            }

            ProfileListView->SetSelection(ItemToSelect);
        }

        PopulateEditorFromSelection();
    }
}

void SCadetBuildTab::PopulateEditorFromSelection()
{
    FCadetProfileData* Selected = FindSelectedProfile();
    if (Selected == nullptr)
    {
        if (ProfileNameTextBox.IsValid())
        {
            ProfileNameTextBox->SetText(FText::GetEmpty());
        }
        SetComboSelection(PlatformComboBox, PlatformOptions, TEXT("steam"), TEXT("steam"));
        SetComboSelection(OsComboBox, OsOptions, TEXT("windows"), TEXT("windows"));
        if (UnrealEngineRootTextBox.IsValid())
        {
            UnrealEngineRootTextBox->SetText(FText::GetEmpty());
        }
        if (UnrealProjectPathTextBox.IsValid())
        {
            UnrealProjectPathTextBox->SetText(FText::GetEmpty());
        }
        if (UnrealBuildOutputPathTextBox.IsValid())
        {
            UnrealBuildOutputPathTextBox->SetText(FText::GetEmpty());
        }
        if (UnrealProjectNameTextBox.IsValid())
        {
            UnrealProjectNameTextBox->SetText(FText::GetEmpty());
        }
        if (CookerSettingsOverrideTextBox.IsValid())
        {
            CookerSettingsOverrideTextBox->SetText(FText::GetEmpty());
        }
        if (PackagingIniOverrideTextBox.IsValid())
        {
            PackagingIniOverrideTextBox->SetText(FText::GetEmpty());
        }
        if (SteamAppIdTextBox.IsValid())
        {
            SteamAppIdTextBox->SetText(FText::GetEmpty());
        }
        if (SteamSetLiveTextBox.IsValid())
        {
            SteamSetLiveTextBox->SetText(FText::GetEmpty());
        }
        if (SteamDepotIdTextBox.IsValid())
        {
            SteamDepotIdTextBox->SetText(FText::GetEmpty());
        }
        if (SteamDepotLocalPathTextBox.IsValid())
        {
            SteamDepotLocalPathTextBox->SetText(FText::FromString(ResolveDefaultSteamDepotLocalPath()));
        }
        if (SteamDepotPathTextBox.IsValid())
        {
            SteamDepotPathTextBox->SetText(FText::FromString(TEXT(".")));
        }
        if (SteamDepotRecursiveTextBox.IsValid())
        {
            SteamDepotRecursiveTextBox->SetText(FText::FromString(TEXT("1")));
        }
        return;
    }

    if (ProfileNameTextBox.IsValid())
    {
        ProfileNameTextBox->SetText(FText::FromString(Selected->ProfileName));
    }
    SetComboSelection(PlatformComboBox, PlatformOptions, Selected->Platform, TEXT("steam"));
    SetComboSelection(OsComboBox, OsOptions, Selected->Os, TEXT("windows"));
    if (UnrealEngineRootTextBox.IsValid())
    {
        const FString EffectiveEngineRoot = Selected->Unreal.EngineRoot.IsEmpty()
            ? ResolveEditorEngineRoot()
            : Selected->Unreal.EngineRoot;
        UnrealEngineRootTextBox->SetText(FText::FromString(EffectiveEngineRoot));
    }
    if (UnrealProjectPathTextBox.IsValid())
    {
        UnrealProjectPathTextBox->SetText(FText::FromString(Selected->Unreal.ProjectPath));
    }
    if (UnrealBuildOutputPathTextBox.IsValid())
    {
        UnrealBuildOutputPathTextBox->SetText(FText::FromString(Selected->Unreal.BuildOutputPath));
    }

    FString EffectiveBuildOutputPath = Selected->Unreal.BuildOutputPath;
    if (EffectiveBuildOutputPath.IsEmpty())
    {
        const FString EffectiveProjectName = Selected->Unreal.ProjectName.IsEmpty() ? FApp::GetProjectName() : Selected->Unreal.ProjectName;
        EffectiveBuildOutputPath = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("CadetBuild"), TEXT("Builds"), EffectiveProjectName);
    }
    if (UnrealProjectNameTextBox.IsValid())
    {
        UnrealProjectNameTextBox->SetText(FText::FromString(Selected->Unreal.ProjectName));
    }
    if (CookerSettingsOverrideTextBox.IsValid())
    {
        CookerSettingsOverrideTextBox->SetText(FText::FromString(Selected->Unreal.CookerSettingsOverride));
    }
    if (PackagingIniOverrideTextBox.IsValid())
    {
        PackagingIniOverrideTextBox->SetText(FText::FromString(Selected->Unreal.PackagingIniOverride));
    }
    if (SteamAppIdTextBox.IsValid())
    {
        SteamAppIdTextBox->SetText(FText::FromString(Selected->Steam.AppId));
    }
    if (SteamSetLiveTextBox.IsValid())
    {
        SteamSetLiveTextBox->SetText(FText::FromString(Selected->Steam.SetLive));
    }
    FCadetProfileData::FSteamSettings::FSteamDepot EffectiveDepot;
    if (Selected->Steam.Depots.Num() > 0)
    {
        EffectiveDepot = Selected->Steam.Depots[0];
    }
    else
    {
        EffectiveDepot.Os = TEXT("windows");
        EffectiveDepot.LocalPath = ResolveDefaultSteamDepotLocalPath();
        EffectiveDepot.DepotPath = TEXT(".");
        EffectiveDepot.Recursive = TEXT("1");
    }

    if (SteamDepotIdTextBox.IsValid())
    {
        SteamDepotIdTextBox->SetText(FText::FromString(EffectiveDepot.DepotId));
    }
    if (SteamDepotLocalPathTextBox.IsValid())
    {
        SteamDepotLocalPathTextBox->SetText(FText::FromString(EffectiveDepot.LocalPath));
    }
    if (SteamDepotPathTextBox.IsValid())
    {
        SteamDepotPathTextBox->SetText(FText::FromString(EffectiveDepot.DepotPath));
    }
    if (SteamDepotRecursiveTextBox.IsValid())
    {
        SteamDepotRecursiveTextBox->SetText(FText::FromString(EffectiveDepot.Recursive));
    }
}

FCadetProfileData* SCadetBuildTab::FindSelectedProfile()
{
    if (!ProfileListView.IsValid())
    {
        return nullptr;
    }

    TArray<TSharedPtr<FString>> Selected;
    ProfileListView->GetSelectedItems(Selected);
    if (Selected.Num() == 0 || !Selected[0].IsValid())
    {
        return nullptr;
    }

    const FString& SelectedName = *Selected[0];
    for (FCadetProfileData& Profile : Profiles)
    {
        if (Profile.ProfileName == SelectedName)
        {
            return &Profile;
        }
    }

    return nullptr;
}

FReply SCadetBuildTab::OnNewProfileClicked()
{
    const int32 NewIndex = Profiles.Num() + 1;
    FCadetProfileData NewProfile = FCadetProfileData::MakeDefault(NewIndex);
    NewProfile.Unreal.EngineRoot = ResolveEditorEngineRoot();

    FString Error;
    if (!FCadetProfileStore::SaveProfile(NewProfile, &Error))
    {
        ShowNotification(FText::FromString(FString::Printf(TEXT("Failed to create profile: %s"), *Error)), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    Profiles.Add(NewProfile);
    RefreshProfileItems(NewProfile.ProfileName);
    ShowNotification(LOCTEXT("ProfileCreated", "Profile created."), SNotificationItem::CS_Success);
    return FReply::Handled();
}

FReply SCadetBuildTab::OnDuplicateProfileClicked()
{
    FCadetProfileData* Selected = FindSelectedProfile();
    if (Selected == nullptr)
    {
        ShowNotification(LOCTEXT("NoProfileSelected", "Select a profile first."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    FCadetProfileData Duplicate = *Selected;
    Duplicate.ProfileName = FString::Printf(TEXT("%s-Copy"), *Selected->ProfileName);

    FString Error;
    if (!FCadetProfileStore::SaveProfile(Duplicate, &Error))
    {
        ShowNotification(FText::FromString(FString::Printf(TEXT("Failed to duplicate profile: %s"), *Error)), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    Profiles.Add(Duplicate);
    RefreshProfileItems(Duplicate.ProfileName);
    ShowNotification(LOCTEXT("ProfileDuplicated", "Profile duplicated."), SNotificationItem::CS_Success);
    return FReply::Handled();
}

FReply SCadetBuildTab::OnSaveProfileClicked()
{
    FCadetProfileData* Selected = FindSelectedProfile();
    if (Selected == nullptr)
    {
        ShowNotification(LOCTEXT("NoProfileSelectedSave", "Select a profile first."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    const FString PreviousName = Selected->ProfileName;

    if (ProfileNameTextBox.IsValid())
    {
        Selected->ProfileName = ProfileNameTextBox->GetText().ToString().TrimStartAndEnd();
    }
    Selected->Platform = GetComboSelectionValue(PlatformComboBox).TrimStartAndEnd();
    Selected->Os = GetComboSelectionValue(OsComboBox).TrimStartAndEnd();
    if (UnrealEngineRootTextBox.IsValid())
    {
        Selected->Unreal.EngineRoot = UnrealEngineRootTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (UnrealProjectPathTextBox.IsValid())
    {
        Selected->Unreal.ProjectPath = UnrealProjectPathTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (UnrealBuildOutputPathTextBox.IsValid())
    {
        Selected->Unreal.BuildOutputPath = UnrealBuildOutputPathTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (UnrealProjectNameTextBox.IsValid())
    {
        Selected->Unreal.ProjectName = UnrealProjectNameTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (CookerSettingsOverrideTextBox.IsValid())
    {
        Selected->Unreal.CookerSettingsOverride = CookerSettingsOverrideTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (PackagingIniOverrideTextBox.IsValid())
    {
        Selected->Unreal.PackagingIniOverride = PackagingIniOverrideTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (SteamAppIdTextBox.IsValid())
    {
        Selected->Steam.AppId = SteamAppIdTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (SteamSetLiveTextBox.IsValid())
    {
        Selected->Steam.SetLive = SteamSetLiveTextBox->GetText().ToString().TrimStartAndEnd();
    }
    FCadetProfileData::FSteamSettings::FSteamDepot Depot;
    Depot.Os = TEXT("windows");
    Depot.LocalPath = ResolveDefaultSteamDepotLocalPath();
    Depot.DepotPath = TEXT(".");
    Depot.Recursive = TEXT("1");

    if (SteamDepotIdTextBox.IsValid())
    {
        Depot.DepotId = SteamDepotIdTextBox->GetText().ToString().TrimStartAndEnd();
    }
    if (SteamDepotLocalPathTextBox.IsValid())
    {
        const FString Value = SteamDepotLocalPathTextBox->GetText().ToString().TrimStartAndEnd();
        if (!Value.IsEmpty())
        {
            Depot.LocalPath = Value;
        }
    }
    if (SteamDepotPathTextBox.IsValid())
    {
        const FString Value = SteamDepotPathTextBox->GetText().ToString().TrimStartAndEnd();
        if (!Value.IsEmpty())
        {
            Depot.DepotPath = Value;
        }
    }
    if (SteamDepotRecursiveTextBox.IsValid())
    {
        const FString Value = SteamDepotRecursiveTextBox->GetText().ToString().TrimStartAndEnd();
        if (Value == TEXT("0") || Value == TEXT("1"))
        {
            Depot.Recursive = Value;
        }
    }

    if (Selected->Platform.IsEmpty())
    {
        Selected->Platform = TEXT("steam");
    }
    if (Selected->Os.IsEmpty())
    {
        Selected->Os = TEXT("windows");
    }
    Selected->Unreal.BuildConfiguration = TEXT("Shipping");
    if (Selected->Unreal.EngineRoot.IsEmpty())
    {
        Selected->Unreal.EngineRoot = ResolveEditorEngineRoot();
    }
    if (Selected->Unreal.BuildOutputPath.IsEmpty())
    {
        const FString EffectiveProjectName = Selected->Unreal.ProjectName.IsEmpty() ? FApp::GetProjectName() : Selected->Unreal.ProjectName;
        Selected->Unreal.BuildOutputPath = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("CadetBuild"), TEXT("Builds"), EffectiveProjectName);
    }
    FPaths::NormalizeFilename(Selected->Unreal.BuildOutputPath);
    Selected->Unreal.TargetPlatforms = TEXT("Win64");
    Selected->Unreal.ArchiveDirectory = FPaths::Combine(Selected->Unreal.BuildOutputPath, TEXT("windows"));
    ApplyDerivedSteamPaths(*Selected);

    Selected->Steam.Depots.Reset();
    if (!Depot.DepotId.IsEmpty())
    {
        Selected->Steam.Depots.Add(Depot);
    }

    FString Error;
    if (!FCadetProfileStore::SaveProfile(*Selected, &Error, &PreviousName))
    {
        ShowNotification(FText::FromString(FString::Printf(TEXT("Failed to save profile: %s"), *Error)), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    RefreshProfileItems(Selected->ProfileName);
    ShowNotification(LOCTEXT("ProfileSaved", "Profile saved."), SNotificationItem::CS_Success);
    return FReply::Handled();
}

FReply SCadetBuildTab::OnDeleteProfileClicked()
{
    FCadetProfileData* Selected = FindSelectedProfile();
    if (Selected == nullptr)
    {
        ShowNotification(LOCTEXT("NoProfileSelectedDelete", "Select a profile first."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    const FString ProfileNameToDelete = Selected->ProfileName;
    FString Error;
    if (!FCadetProfileStore::DeleteProfileByName(ProfileNameToDelete, &Error))
    {
        ShowNotification(FText::FromString(FString::Printf(TEXT("Failed to delete profile: %s"), *Error)), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    Profiles.RemoveAll([&ProfileNameToDelete](const FCadetProfileData& Item)
    {
        return Item.ProfileName == ProfileNameToDelete;
    });

    if (Profiles.Num() == 0)
    {
        FCadetProfileData NewProfile = FCadetProfileData::MakeDefault(1);
        FCadetProfileStore::SaveProfile(NewProfile);
        Profiles.Add(NewProfile);
        RefreshProfileItems(NewProfile.ProfileName);
    }
    else
    {
        RefreshProfileItems(Profiles[0].ProfileName);
    }

    ShowNotification(LOCTEXT("ProfileDeleted", "Profile deleted."), SNotificationItem::CS_Success);
    return FReply::Handled();
}

FReply SCadetBuildTab::OnExportProfileClicked()
{
    FCadetProfileData* Selected = FindSelectedProfile();
    if (Selected == nullptr)
    {
        ShowNotification(LOCTEXT("NoProfileSelectedExport", "Select a profile first."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    FString ExportPath;
    FString Error;
    FCadetProfileData ExportProfile = *Selected;
    ApplyDerivedSteamPaths(ExportProfile);
    if (!FCadetProfileStore::ExportProfile(ExportProfile, &ExportPath, &Error))
    {
        ShowNotification(FText::FromString(FString::Printf(TEXT("Failed to export profile: %s"), *Error)), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    ShowNotification(FText::FromString(FString::Printf(TEXT("Exported profile to: %s"), *ExportPath)), SNotificationItem::CS_Success);
    return FReply::Handled();
}

bool SCadetBuildTab::BuildRuntimeProfileJson(const FCadetProfileData& Profile, FString& OutProfilePath, FString& OutError) const
{
    const FString TempRoot = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Temp"), TEXT("CadetBuild")));
    IFileManager::Get().MakeDirectory(*TempRoot, true);

    FString EngineRoot = Profile.Unreal.EngineRoot;
    FString ProjectPath = Profile.Unreal.ProjectPath;
    FString BuildOutputPath = Profile.Unreal.BuildOutputPath;
    FString ProjectName = Profile.Unreal.ProjectName;
    const FString BuildConfiguration = TEXT("Shipping");
    const FString TargetPlatformsJson = TEXT("\"Win64\"");
    FString ArchiveDirectory;

    if (EngineRoot.IsEmpty())
    {
        EngineRoot = ResolveEditorEngineRoot();
    }
    if (ProjectPath.IsEmpty())
    {
        ProjectPath = FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath());
    }
    if (ProjectName.IsEmpty())
    {
        ProjectName = FApp::GetProjectName();
    }
    if (BuildOutputPath.IsEmpty())
    {
        BuildOutputPath = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("CadetBuild"), TEXT("Builds"), ProjectName);
    }

    EngineRoot = FPaths::ConvertRelativePathToFull(EngineRoot);
    ProjectPath = FPaths::ConvertRelativePathToFull(ProjectPath);
    BuildOutputPath = FPaths::ConvertRelativePathToFull(BuildOutputPath);

    FPaths::NormalizeFilename(EngineRoot);
    FPaths::NormalizeFilename(ProjectPath);
    FPaths::NormalizeFilename(BuildOutputPath);

    ArchiveDirectory = FPaths::Combine(BuildOutputPath, TEXT("windows"));
    const FString SteamCmdPath = FCadetDependencyManager::GetSteamCmdPath();
    const FString SteamContentRoot = ResolveDefaultSteamContentRoot(BuildOutputPath);
    const FString SteamBuildOutput = ResolveDefaultSteamBuildOutput(BuildOutputPath);
    FString DepotsJson = TEXT("[]");
    if (Profile.Steam.Depots.Num() > 0)
    {
        TArray<FString> DepotEntries;
        for (const FCadetProfileData::FSteamSettings::FSteamDepot& Depot : Profile.Steam.Depots)
        {
            if (Depot.DepotId.IsEmpty())
            {
                continue;
            }

            const FString DepotOs = Depot.Os.IsEmpty() ? TEXT("windows") : Depot.Os;
            const FString DepotLocalPath = Depot.LocalPath.IsEmpty() ? ResolveDefaultSteamDepotLocalPath() : Depot.LocalPath;
            const FString DepotPath = Depot.DepotPath.IsEmpty() ? TEXT(".") : Depot.DepotPath;
            const FString DepotRecursive = (Depot.Recursive == TEXT("0") || Depot.Recursive == TEXT("1")) ? Depot.Recursive : TEXT("1");

            DepotEntries.Add(FString::Printf(
                TEXT("{\"depotId\": \"%s\", \"os\": \"%s\", \"localPath\": \"%s\", \"depotPath\": \"%s\", \"recursive\": \"%s\"}"),
                *EscapeJson(Depot.DepotId),
                *EscapeJson(DepotOs),
                *EscapeJson(DepotLocalPath),
                *EscapeJson(DepotPath),
                *EscapeJson(DepotRecursive)));
        }

        if (DepotEntries.Num() > 0)
        {
            DepotsJson = FString::Printf(TEXT("[%s]"), *FString::Join(DepotEntries, TEXT(", ")));
        }
    }

    const FString FileName = FString::Printf(TEXT("%s-runtime.json"), *FGuid::NewGuid().ToString(EGuidFormats::Digits));
    OutProfilePath = FPaths::Combine(TempRoot, FileName);

    const FString EffectivePlatform = Profile.Platform.IsEmpty() ? FString(TEXT("steam")) : Profile.Platform;
    const FString EffectiveOs = Profile.Os.IsEmpty() ? FString(TEXT("windows")) : Profile.Os;
    const FString EffectiveBundleId = FString::Printf(TEXT("com.covyne.%s"), *ProjectName.ToLower());

    const FString PackagingIniOverrideJson = Profile.Unreal.PackagingIniOverride.IsEmpty()
        ? TEXT("")
        : FString::Printf(TEXT(",\n    \"packagingIniOverride\": \"%s\""), *EscapeJson(Profile.Unreal.PackagingIniOverride));

    const FString Json = FString::Printf(
        TEXT("{\n")
        TEXT("  \"profileName\": \"%s\",\n")
        TEXT("  \"platform\": \"%s\",\n")
        TEXT("  \"os\": \"%s\",\n")
        TEXT("  \"bundleId\": \"%s\",\n")
        TEXT("  \"unreal\": {\n")
        TEXT("    \"engineRoot\": \"%s\",\n")
        TEXT("    \"projectPath\": \"%s\",\n")
        TEXT("    \"buildOutputPath\": \"%s\",\n")
        TEXT("    \"projectName\": \"%s\",\n")
        TEXT("    \"buildConfiguration\": \"%s\",\n")
        TEXT("    \"targetPlatforms\": [%s],\n")
        TEXT("    \"archiveDirectory\": \"%s\"%s\n")
        TEXT("  },\n")
        TEXT("  \"steam\": {\n")
        TEXT("    \"appId\": \"%s\",\n")
        TEXT("    \"steamcmdExe\": \"%s\",\n")
        TEXT("    \"useSentryFile\": %s,\n")
        TEXT("    \"description\": \"%s\",\n")
        TEXT("    \"setLive\": \"%s\",\n")
        TEXT("    \"contentRoot\": \"%s\",\n")
        TEXT("    \"buildOutput\": \"%s\",\n")
        TEXT("    \"depots\": %s\n")
        TEXT("  },\n")
        TEXT("  \"useGit\": false,\n")
        TEXT("  \"gitRepository\": \"\",\n")
        TEXT("  \"gitBranch\": \"\"\n")
        TEXT("}\n"),
        *EscapeJson(Profile.ProfileName),
        *EscapeJson(EffectivePlatform),
        *EscapeJson(EffectiveOs),
        *EscapeJson(EffectiveBundleId),
        *EscapeJson(EngineRoot),
        *EscapeJson(ProjectPath),
        *EscapeJson(BuildOutputPath),
        *EscapeJson(ProjectName),
        *EscapeJson(BuildConfiguration),
        *TargetPlatformsJson,
        *EscapeJson(ArchiveDirectory), *PackagingIniOverrideJson
        , *EscapeJson(Profile.Steam.AppId)
        , *EscapeJson(SteamCmdPath)
        , Profile.Steam.bUseSentryFile ? TEXT("true") : TEXT("false")
        , *EscapeJson(Profile.Steam.Description)
        , *EscapeJson(Profile.Steam.SetLive)
        , *EscapeJson(SteamContentRoot)
        , *EscapeJson(SteamBuildOutput)
        , *DepotsJson
    );

    if (!FFileHelper::SaveStringToFile(Json, *OutProfilePath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
    {
        OutError = FString::Printf(TEXT("Failed to write runtime profile JSON: %s"), *OutProfilePath);
        return false;
    }

    return true;
}

bool SCadetBuildTab::LaunchCadetForProfile(const FCadetProfileData& Profile, bool bRunBuild, bool bRunSteamPublish, FString& OutError)
{
    if (bIsJobRunning)
    {
        OutError = TEXT("A CADET job is already running.");
        return false;
    }

    if (!bRunBuild && !bRunSteamPublish)
    {
        OutError = TEXT("No operations selected. Enable Build and/or Publish Steam.");
        return false;
    }

    const FString CosmosPath = FCadetDependencyManager::GetCosmosPath();
    FString CosmosValidationError;
    if (!FCadetDependencyManager::ValidateCosmosPath(CosmosPath, CosmosValidationError))
    {
        OutError = FString::Printf(
            TEXT("Cosmos dependency is not configured or invalid: %s\n\nOpen CADET Publishing Tools and install/verify Cosmos binaries before executing."),
            *CosmosValidationError);
        AppendConsoleLine(FString::Printf(TEXT("[DIST] Cosmos preflight failed: %s"), *CosmosValidationError));
        return false;
    }

    AppendConsoleLine(FString::Printf(TEXT("[DIST] Cosmos path validated: %s"), *CosmosPath));

    // --- Target name mismatch preflight ---
    // If the profile's Project Name is empty the build adapter falls back to the
    // .uproject stem.  When the game target (Source/*.Target.cs) was given a
    // different name the packaged executable and editor receipt won't be found.
    // Detect this automatically so the user gets a clear actionable message.
    {
        const FString EffectiveProfileProjectName = Profile.Unreal.ProjectName.TrimStartAndEnd();
        if (EffectiveProfileProjectName.IsEmpty())
        {
            const FString UProjectStem = FApp::GetProjectName();
            const FString ProjectDir = Profile.Unreal.ProjectPath.IsEmpty()
                ? FPaths::ConvertRelativePathToFull(FPaths::ProjectDir())
                : FPaths::ConvertRelativePathToFull(FPaths::GetPath(Profile.Unreal.ProjectPath));
            const FString BinariesDir = FPaths::Combine(ProjectDir, TEXT("Binaries"), TEXT("Win64"));

            TArray<FString> TargetFiles;
            IFileManager::Get().FindFiles(TargetFiles, *(BinariesDir / TEXT("*.target")), true, false);

            TArray<FString> MismatchedTargets;
            for (const FString& TargetFile : TargetFiles)
            {
                const FString TargetStem = FPaths::GetBaseFilename(TargetFile);
                if (TargetStem.EndsWith(TEXT("Editor"), ESearchCase::IgnoreCase))
                {
                    continue;
                }
                if (!TargetStem.Equals(UProjectStem, ESearchCase::IgnoreCase))
                {
                    MismatchedTargets.Add(TargetStem);
                }
            }

            if (MismatchedTargets.Num() > 0)
            {
                const FString DetectedNames = FString::Join(MismatchedTargets, TEXT(", "));
                OutError = FString::Printf(
                    TEXT("Project Name is not set in this profile.\n\n")
                    TEXT("Your .uproject is named '%s', but the following non-editor build target(s) were "
                         "detected in Binaries/Win64: %s.\n\n")
                    TEXT("Set 'Project Name' in the profile to the target name (e.g. '%s'). "
                         "This must match the name in your Source/*.Target.cs file and the "
                         "resulting packaged executable."),
                    *UProjectStem, *DetectedNames, *MismatchedTargets[0]);
                AppendConsoleLine(FString::Printf(
                    TEXT("[DIST] Preflight failed: target name mismatch. .uproject='%s', detected targets: %s"),
                    *UProjectStem, *DetectedNames));
                return false;
            }
        }
    }

    FString RuntimeProfilePath;
    if (!BuildRuntimeProfileJson(Profile, RuntimeProfilePath, OutError))
    {
        return false;
    }

    const FString StatusDir = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Config"), TEXT("CadetBuild"), TEXT("Jobs")));
    const FString VdfsDir = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Temp"), TEXT("CadetBuild"), TEXT("GeneratedVdfs")));
    IFileManager::Get().MakeDirectory(*StatusDir, true);
    IFileManager::Get().MakeDirectory(*VdfsDir, true);

    ActiveJobGuid = FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens);
    const FString LaunchToken = FGuid::NewGuid().ToString(EGuidFormats::Digits);
    ActiveLaunchToken = LaunchToken;
    ActiveManifestPath = BuildDetachedManifestPath(ActiveJobGuid);
    ActiveProfileName = Profile.ProfileName;
    RuntimeProfilePath = FPaths::ConvertRelativePathToFull(RuntimeProfilePath);
    FPaths::NormalizeFilename(RuntimeProfilePath);

    ActiveRuntimeProfilePath = RuntimeProfilePath;
    ActiveDetachedProcessId = 0;
    bIsRecoveredDetachedJob = false;
    StatusFilePath = FPaths::ConvertRelativePathToFull(FPaths::Combine(StatusDir, FString::Printf(TEXT("%s-status.json"), *ActiveJobGuid)));
    FPaths::NormalizeFilename(StatusFilePath);

    bHasObservedStatusFile = false;
    bLoggedWaitingForStatusFile = false;
    StatusFileCreationDeadlineTime = FPlatformTime::Seconds() + StatusFileCreationGracePeriodSeconds;

    LastStatusFileSize = 0;
    LastStatusCheckTime = FPlatformTime::Seconds();

    SaveDetachedManifest(TEXT("launching"), TEXT("launch"), TEXT("Preparing CADET launch."), false, INDEX_NONE);

    const FString BashPath = TEXT("C:/Program Files/Git/bin/bash.exe");
    const FString PluginCliRoot = FPaths::ConvertRelativePathToFull(
        FPaths::Combine(FPaths::ProjectPluginsDir(), TEXT("CadetBuild"), TEXT("CLI")));
    const FString DistScript = FPaths::Combine(PluginCliRoot, TEXT("dist.sh"));

    if (!FPaths::FileExists(BashPath))
    {
        OutError = FString::Printf(TEXT("Git Bash not found at %s"), *BashPath);
        SaveDetachedManifest(TEXT("failed"), TEXT("launch"), OutError, true, -1);
        return false;
    }
    FString CliRuntimeError;
    if (!ValidatePluginCliRuntime(PluginCliRoot, CliRuntimeError))
    {
        OutError = CliRuntimeError;
        AppendConsoleLine(TEXT("[DIST] CLI runtime preflight failed."));
        AppendConsoleLine(CliRuntimeError);
        SaveDetachedManifest(TEXT("failed"), TEXT("launch"), OutError, true, -1);
        return false;
    }

    FCadetDetachedLaunchRequest LaunchRequest;
    LaunchRequest.BashPath = BashPath;
    LaunchRequest.DistScriptPath = DistScript;
    LaunchRequest.RuntimeProfilePath = RuntimeProfilePath;
    LaunchRequest.VdfsDirectory = VdfsDir;
    LaunchRequest.JobGuid = ActiveJobGuid;
    LaunchRequest.LaunchToken = LaunchToken;
    LaunchRequest.StatusFilePath = StatusFilePath;
    LaunchRequest.bRunBuild = bRunBuild;
    LaunchRequest.bRunSteamPublish = bRunSteamPublish;
    // COSMOS_BIN_DIR must point to the bundle's bin directory where jq lives.
    const FString CosmosBinPath = FPaths::Combine(CosmosPath, TEXT("bin"));
    LaunchRequest.CosmosBinPath = FPaths::DirectoryExists(CosmosBinPath) ? CosmosBinPath : CosmosPath;

    FCadetDetachedLaunchPlan LaunchPlan;
    if (!BuildDetachedLaunchPlanWindows(LaunchRequest, LaunchPlan, OutError))
    {
        SaveDetachedManifest(TEXT("failed"), TEXT("launch"), OutError, true, -1);
        return false;
    }

    // Write the script to a .ps1 file and use -File to avoid double-quote mangling with -Command.
    const FString ScriptFilePath = FPaths::Combine(
        FPaths::GetPath(StatusFilePath),
        FString::Printf(TEXT("%s-launcher.ps1"), *ActiveJobGuid));
    if (!FFileHelper::SaveStringToFile(LaunchPlan.Script, *ScriptFilePath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
    {
        OutError = FString::Printf(TEXT("Failed to write launcher script to: %s"), *ScriptFilePath);
        SaveDetachedManifest(TEXT("failed"), TEXT("launch"), OutError, true, -1);
        return false;
    }
    const FString ScriptFileArgs = FString::Printf(
        TEXT("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%s\""),
        *ScriptFilePath);

    FProcHandle LaunchHostProcess = FPlatformProcess::CreateProc(
        *LaunchPlan.LauncherPath,
        *ScriptFileArgs,
        LaunchPlan.bLaunchDetached,
        LaunchPlan.bLaunchHidden,
        LaunchPlan.bLaunchReallyHidden,
        nullptr,
        0,
        nullptr,
        nullptr,
        nullptr,
        nullptr
    );

    if (!LaunchHostProcess.IsValid())
    {
        OutError = TEXT("Failed to launch detached CADET host process.");
        SaveDetachedManifest(TEXT("failed"), TEXT("launch"), OutError, true, -1);
        return false;
    }

    // We intentionally do not track the host process handle. Detached lifecycle is monitored via status file.
    FPlatformProcess::CloseProc(LaunchHostProcess);
    ActiveProcess.Reset();
    ActiveDetachedProcessId = 0;

    // Open a visible terminal window that tails the build's stdout log so the user can watch progress.
    // Mirrors the LogTailMonitorUtility pattern from Cadet Pro (Unity):
    //   cmd.exe /k powershell -Command "... Get-Content -LiteralPath '<log>' -Tail 0 -Wait"
    if (!LaunchPlan.StdOutLogPath.IsEmpty())
    {
        const FString SafeLabel = FString::Printf(TEXT("CADET Build — %s"), *ActiveProfileName)
            .Replace(TEXT("\""), TEXT(""));
        const FString EscapedPath = LaunchPlan.StdOutLogPath.Replace(TEXT("'"), TEXT("''"));
        const FString EscapedLabel = SafeLabel.Replace(TEXT("'"), TEXT("''"));

        const FString PsCommand = FString::Printf(
            TEXT("$Host.UI.RawUI.WindowTitle='%s'; ")
            TEXT("Write-Host '[CADET] Waiting for build log...'; ")
            TEXT("$f='%s'; ")
            TEXT("while (-not (Test-Path -LiteralPath $f)) { Start-Sleep -Milliseconds 500 } ")
            TEXT("Write-Host '[CADET] Build started. Streaming log...'; ")
            TEXT("Write-Host ''; ")
            TEXT("Get-Content -LiteralPath $f -Tail 0 -Wait"),
            *EscapedLabel,
            *EscapedPath);

        const FString CmdArgs = FString::Printf(
            TEXT("/k powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command \"%s\""),
            *PsCommand);

        FProcHandle LogTerminal = FPlatformProcess::CreateProc(
            TEXT("cmd.exe"),
            *CmdArgs,
            /*bLaunchDetached=*/true,
            /*bLaunchHidden=*/false,
            /*bLaunchReallyHidden=*/false,
            nullptr, 0, nullptr, nullptr, nullptr, nullptr
        );

        if (LogTerminal.IsValid())
        {
            FPlatformProcess::CloseProc(LogTerminal);
            AppendConsoleLine(TEXT("[DIST] Opened build log terminal window."));
        }
        else
        {
            AppendConsoleLine(TEXT("[DIST] Warning: Could not open build log terminal window."));
        }
    }

    // Detached mode: no stdout/stderr pipes to avoid game-thread pipe reads during long builds.
    if (ReadPipe != nullptr || WritePipe != nullptr)
    {
        FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
        ReadPipe = nullptr;
        WritePipe = nullptr;
    }
    if (StdErrReadPipe != nullptr || StdErrWritePipe != nullptr)
    {
        FPlatformProcess::ClosePipe(StdErrReadPipe, StdErrWritePipe);
        StdErrReadPipe = nullptr;
        StdErrWritePipe = nullptr;
    }

    StdOutPendingLine.Empty();
    StdErrPendingLine.Empty();
    bIsJobRunning = true;
    bIsRecoveredDetachedJob = true;
    AppendConsoleLine(FString::Printf(TEXT("[DIST] Started CADET job %s"), *ActiveJobGuid));
    AppendConsoleLine(TEXT("[DIST] Launch mode: detached (PowerShell Start-Process)."));
    AppendConsoleLine(FString::Printf(TEXT("[DIST] Runtime profile: %s"), *RuntimeProfilePath));
    AppendConsoleLine(FString::Printf(TEXT("[DIST] Status file: %s"), *StatusFilePath));

    SaveDetachedManifest(TEXT("running"), TEXT("launch"), TEXT("CADET process launched."), false, INDEX_NONE);

    RegisterActiveTimer(0.2f, FWidgetActiveTimerDelegate::CreateSP(this, &SCadetBuildTab::TickActiveProcess));

    return true;
}

void SCadetBuildTab::AppendConsoleLine(const FString& Line)
{
    UE_LOG(LogCadetBuild, Log, TEXT("%s"), *Line);

    if (!ConsoleBuffer.IsEmpty())
    {
        ConsoleBuffer += TEXT("\n");
    }
    ConsoleBuffer += Line;

    if (ConsoleTextBlock.IsValid())
    {
        ConsoleTextBlock->SetText(FText::FromString(ConsoleBuffer));
    }

    if (ConsoleScrollBox.IsValid())
    {
        ConsoleScrollBox->ScrollToEnd();
    }
}

void SCadetBuildTab::ClearConsoleOutput()
{
    ConsoleBuffer.Empty();

    if (ConsoleTextBlock.IsValid())
    {
        ConsoleTextBlock->SetText(FText::GetEmpty());
    }

    if (ConsoleScrollBox.IsValid())
    {
        ConsoleScrollBox->ScrollToStart();
    }
}

bool SCadetBuildTab::ParseStatusFile(FString& OutPhase, FString& OutDetails)
{
    OutPhase.Empty();
    OutDetails.Empty();

    if (!FPaths::FileExists(*StatusFilePath))
    {
        return false;
    }

    FString StatusJson;
    if (!FFileHelper::LoadFileToString(StatusJson, *StatusFilePath))
    {
        return false;
    }

    TSharedPtr<FJsonObject> JsonObject;
    TSharedRef<TJsonReader<>> JsonReader = TJsonReaderFactory<>::Create(StatusJson);
    if (!FJsonSerializer::Deserialize(JsonReader, JsonObject) || !JsonObject.IsValid())
    {
        return false;
    }

    // Extract phase information
    if (JsonObject->HasField(TEXT("phase")))
    {
        OutPhase = JsonObject->GetStringField(TEXT("phase"));
    }
    else if (JsonObject->HasField(TEXT("currentPhase")))
    {
        OutPhase = JsonObject->GetStringField(TEXT("currentPhase"));
    }

    // Extract details if available
    if (JsonObject->HasField(TEXT("details")))
    {
        OutDetails = JsonObject->GetStringField(TEXT("details"));
    }
    else if (JsonObject->HasField(TEXT("status")))
    {
        OutDetails = JsonObject->GetStringField(TEXT("status"));
    }

    return true;
}

void SCadetBuildTab::UpdatePhaseDisplay()
{
    FString Phase, Details;
    if (ParseStatusFile(Phase, Details))
    {
        LastParsedPhase = Phase;
        LastParsedDetails = Details;

        FString DisplayText = Phase;
        if (!Details.IsEmpty())
        {
            DisplayText = FString::Printf(TEXT("%s - %s"), *Phase, *Details);
        }
        CurrentPhase = DisplayText;
    }
}

EActiveTimerReturnType SCadetBuildTab::TickActiveProcess(double CurrentTime, float DeltaTime)
{
    const bool bHasLiveProcess = ActiveProcess.IsValid();

    // Read stdout
    if (bHasLiveProcess && ReadPipe != nullptr)
    {
        const FString NewOutput = FPlatformProcess::ReadPipe(ReadPipe);
        AppendOutputChunk(NewOutput, StdOutPendingLine, TEXT(""), [this](const FString& Line)
        {
            AppendConsoleLine(Line);
        });
    }

    // Read stderr
    if (bHasLiveProcess && StdErrReadPipe != nullptr)
    {
        const FString NewErrorOutput = FPlatformProcess::ReadPipe(StdErrReadPipe);
        AppendOutputChunk(NewErrorOutput, StdErrPendingLine, TEXT("[STDERR] "), [this](const FString& Line)
        {
            AppendConsoleLine(Line);
        });
    }

    // Poll status file at intervals (async to avoid blocking game thread)
    double CurrentTimeDouble = FPlatformTime::Seconds();
    if ((CurrentTimeDouble - LastStatusCheckTime) >= StatusCheckInterval && !bAsyncStatusPollInProgress)
    {
        LastStatusCheckTime = CurrentTimeDouble;
        PollStatusAsynchronously();
    }

    if (!bIsJobRunning)
    {
        return EActiveTimerReturnType::Stop;
    }

    if (!bHasLiveProcess && bIsRecoveredDetachedJob)
    {
        const bool bStatusFileExists = FPaths::FileExists(StatusFilePath);
        if (bStatusFileExists)
        {
            bHasObservedStatusFile = true;
            bLoggedWaitingForStatusFile = false;
        }

        if (!bStatusFileExists)
        {
            const double Now = FPlatformTime::Seconds();
            const bool bWithinCreationGraceWindow = !bHasObservedStatusFile && Now < StatusFileCreationDeadlineTime;
            if (bWithinCreationGraceWindow)
            {
                if (!bLoggedWaitingForStatusFile)
                {
                    AppendConsoleLine(FString::Printf(
                        TEXT("[DIST] Waiting for status file creation: %s"),
                        *StatusFilePath));
                    bLoggedWaitingForStatusFile = true;
                }
                return EActiveTimerReturnType::Continue;
            }

            bIsJobRunning = false;
            bIsRecoveredDetachedJob = false;
            FString RecoveryMessage;
            if (bHasObservedStatusFile)
            {
                RecoveryMessage = FString::Printf(
                    TEXT("Recovered detached job %s lost its status file. Marking as failed and stopping monitor."),
                    *ActiveJobGuid);
            }
            else
            {
                RecoveryMessage = FString::Printf(
                    TEXT("Detached job %s did not create its status file within the grace window. Marking as failed and stopping monitor."),
                    *ActiveJobGuid);
            }
            SaveDetachedManifest(TEXT("failed"), TEXT("recovery"), RecoveryMessage, true, -1);
            AppendConsoleLine(FString::Printf(TEXT("[DIST] %s"), *RecoveryMessage));
            ShowNotification(
                bHasObservedStatusFile
                    ? LOCTEXT("CadetRecoveredRunStatusMissingDuringMonitor", "Recovered CADET run status file is missing. Marked as failed.")
                    : LOCTEXT("CadetRunStatusMissingCreationTimeout", "CADET run did not create a status file in time. Marked as failed."),
                SNotificationItem::CS_Fail);
            return EActiveTimerReturnType::Stop;
        }

        bool bTerminal = false;
        int32 ExitCode = INDEX_NONE;
        FString StatusText;
        if (TryReadTerminalStateFromStatusFile(StatusFilePath, bTerminal, ExitCode, StatusText) && bTerminal)
        {
            bIsJobRunning = false;

            FString FinalStatus = StatusText;
            if (FinalStatus.IsEmpty())
            {
                FinalStatus = ExitCode == 0 ? TEXT("succeeded") : TEXT("failed");
            }

            SaveDetachedManifest(FinalStatus, LastParsedPhase, CurrentPhase, true, ExitCode);
            AppendConsoleLine(FString::Printf(TEXT("[DIST] Recovered detached job reached terminal state (%s, exit code %d)."), *FinalStatus, ExitCode));
            ShowNotification(
                ExitCode == 0 ? LOCTEXT("CadetRecoveredRunSucceeded", "Recovered CADET run completed.") : LOCTEXT("CadetRecoveredRunFailed", "Recovered CADET run failed."),
                ExitCode == 0 ? SNotificationItem::CS_Success : SNotificationItem::CS_Fail
            );
            return EActiveTimerReturnType::Stop;
        }

        return EActiveTimerReturnType::Continue;
    }

    if (bHasLiveProcess && !FPlatformProcess::IsProcRunning(ActiveProcess))
    {
        int32 ReturnCode = INDEX_NONE;
        FPlatformProcess::GetProcReturnCode(ActiveProcess, &ReturnCode);

        if (!StdOutPendingLine.IsEmpty())
        {
            FString FinalStdOutLine = StdOutPendingLine;
            FinalStdOutLine.TrimEndInline();
            if (!FinalStdOutLine.IsEmpty())
            {
                AppendConsoleLine(FinalStdOutLine);
            }
            StdOutPendingLine.Empty();
        }
        if (!StdErrPendingLine.IsEmpty())
        {
            FString FinalStdErrLine = StdErrPendingLine;
            FinalStdErrLine.TrimEndInline();
            if (!FinalStdErrLine.IsEmpty())
            {
                AppendConsoleLine(FString::Printf(TEXT("[STDERR] %s"), *FinalStdErrLine));
            }
            StdErrPendingLine.Empty();
        }

        // Final status update
        UpdatePhaseDisplay();
        SaveDetachedManifest(ReturnCode == 0 ? TEXT("succeeded") : TEXT("failed"), LastParsedPhase, CurrentPhase, true, ReturnCode);

        bIsJobRunning = false;
        bIsRecoveredDetachedJob = false;
        FPlatformProcess::CloseProc(ActiveProcess);
        if (ReadPipe != nullptr || WritePipe != nullptr)
        {
            FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
            ReadPipe = nullptr;
            WritePipe = nullptr;
        }
        if (StdErrReadPipe != nullptr || StdErrWritePipe != nullptr)
        {
            FPlatformProcess::ClosePipe(StdErrReadPipe, StdErrWritePipe);
            StdErrReadPipe = nullptr;
            StdErrWritePipe = nullptr;
        }

        AppendConsoleLine(FString::Printf(TEXT("[DIST] Job finished with exit code %d"), ReturnCode));
        ShowNotification(
            ReturnCode == 0 ? LOCTEXT("CadetRunSucceeded", "CADET run completed.") : LOCTEXT("CadetRunFailed", "CADET run failed."),
            ReturnCode == 0 ? SNotificationItem::CS_Success : SNotificationItem::CS_Fail
        );

        return EActiveTimerReturnType::Stop;
    }

    return EActiveTimerReturnType::Continue;
}

FReply SCadetBuildTab::OnExecuteClicked()
{
    FCadetProfileData* Selected = FindSelectedProfile();
    if (Selected == nullptr)
    {
        ShowNotification(LOCTEXT("NoProfileSelectedExecute", "Select a profile first."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    if (bIsJobRunning || bIsLaunchingJob)
    {
        ShowNotification(LOCTEXT("CadetRunAlreadyActive", "A CADET run is already starting or running."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    const bool bRunBuild = !BuildOperationCheckBox.IsValid() || BuildOperationCheckBox->IsChecked();
    const bool bRunSteamPublish = !SteamPublishOperationCheckBox.IsValid() || SteamPublishOperationCheckBox->IsChecked();
    if (!bRunBuild && !bRunSteamPublish)
    {
        ShowNotification(LOCTEXT("NoOperationSelected", "Select at least one operation (Build and/or Publish Steam)."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    const FCadetProfileData ExecutionProfile = *Selected;
    const FString SourceProjectPath = FPaths::ConvertRelativePathToFull(FPaths::GetProjectFilePath());

    ClearConsoleOutput();
    bIsLaunchingJob = true;
    bCancelLaunchRequested = false;
    SetPhaseDisplayText(TEXT("Synchronizing workspace..."));
    AppendConsoleLine(TEXT("[SYNC] Synchronizing workspace in background..."));

    TWeakPtr<SCadetBuildTab> WeakTab = StaticCastSharedRef<SCadetBuildTab>(AsShared());
    Async(EAsyncExecution::ThreadPool, [WeakTab, ExecutionProfile, SourceProjectPath, bRunBuild, bRunSteamPublish]()
    {
        FCadetDirectorySyncResult SyncResult = SyncWorkspaceDirectory(
            SourceProjectPath,
            ExecutionProfile.Unreal.ProjectPath,
            [WeakTab]()
            {
                const TSharedPtr<SCadetBuildTab> Pinned = WeakTab.Pin();
                return !Pinned.IsValid() || Pinned->bCancelLaunchRequested;
            },
            [WeakTab](const FString& ProgressLine)
            {
                AsyncTask(ENamedThreads::GameThread, [WeakTab, ProgressLine]()
                {
                    const TSharedPtr<SCadetBuildTab> Pinned = WeakTab.Pin();
                    if (Pinned.IsValid())
                    {
                        Pinned->AppendConsoleLine(ProgressLine);
                    }
                });
            });

        FCadetProfileData SyncedProfile = ExecutionProfile;
        if (SyncResult.bSuccess)
        {
            SyncedProfile.Unreal.ProjectPath = SyncResult.ResolvedTargetProjectPath;
        }

        AsyncTask(ENamedThreads::GameThread, [WeakTab, SyncResult, SyncedProfile, bRunBuild, bRunSteamPublish]() mutable
        {
            const TSharedPtr<SCadetBuildTab> Pinned = WeakTab.Pin();
            if (!Pinned.IsValid())
            {
                return;
            }

            Pinned->bIsLaunchingJob = false;

            if (SyncResult.bCancelled)
            {
                Pinned->bCancelLaunchRequested = false;
                Pinned->SetPhaseDisplayText(TEXT("Idle"));
                Pinned->AppendConsoleLine(TEXT("[SYNC] Workspace sync cancelled."));
                ShowNotification(LOCTEXT("CadetRunCancelledBeforeLaunch", "CADET run cancelled before launch."), SNotificationItem::CS_Success);
                return;
            }

            if (!SyncResult.bSuccess)
            {
                Pinned->SetPhaseDisplayText(TEXT("Idle"));
                ShowNotification(FText::FromString(SyncResult.Error), SNotificationItem::CS_Fail);
                return;
            }

            Pinned->AppendConsoleLine(FString::Printf(
                TEXT("[SYNC] Workspace synchronized to %s (copied: %d, deleted: %d)"),
                *SyncResult.ResolvedTargetProjectPath,
                SyncResult.FilesCopied,
                SyncResult.FilesDeleted));

            // Apply cooker settings override if configured
            const FString& OverridePath = SyncedProfile.Unreal.CookerSettingsOverride;
            if (!OverridePath.IsEmpty())
            {
                if (FPaths::FileExists(OverridePath))
                {
                    const FString TargetConfigPath = FPaths::Combine(
                        FPaths::GetPath(SyncResult.ResolvedTargetProjectPath),
                        TEXT("Config"),
                        TEXT("DefaultEditorPerProjectUserSettings.ini"));
                    IFileManager& FileManager = IFileManager::Get();
                    const FString TargetConfigDir = FPaths::GetPath(TargetConfigPath);
                    FileManager.MakeDirectory(*TargetConfigDir, true);

                    // Log the target path before copy for debugging
                    Pinned->AppendConsoleLine(FString::Printf(
                        TEXT("[SYNC] Copying cooker settings override: %s → %s"),
                        *OverridePath, *TargetConfigPath));

                    if (FileManager.Copy(*TargetConfigPath, *OverridePath, true, true) == COPY_OK)
                    {
                        Pinned->AppendConsoleLine(FString::Printf(
                            TEXT("[SYNC] Cooker settings override applied: %s → %s"),
                            *OverridePath, *TargetConfigPath));

                        // Verify the copied file disables MCP auto-start
                        FString CopiedContent;
                        if (FFileHelper::LoadFileToString(CopiedContent, *TargetConfigPath))
                        if (CopiedContent.Contains(TEXT("bAutoStartServer=False")))
                        {
                            Pinned->AppendConsoleLine(
                                TEXT("[SYNC] Verified: bAutoStartServer=False in cooker workspace — MCP will not start"));
                        }
                        else if (CopiedContent.Contains(TEXT("bAutoStartServer=True")))
                        {
                            Pinned->AppendConsoleLine(
                                TEXT("[SYNC] WARNING: bAutoStartServer=True in cooker workspace — MCP port conflict may occur"));
                        }
                        else
                        {
                            Pinned->AppendConsoleLine(
                                TEXT("[SYNC] WARNING: bAutoStartServer not found in copied config — verify override file content"));
                        }
                    }
                    else
                    {
                        Pinned->AppendConsoleLine(FString::Printf(
                            TEXT("[SYNC] ERROR: Failed to copy cooker settings override from %s to %s"),
                            *OverridePath, *TargetConfigPath));
                    }
                }
                else
                {
                    Pinned->AppendConsoleLine(FString::Printf(
                        TEXT("[SYNC] ERROR: Cooker settings override file not found: %s"),
                        *OverridePath));
                }
            }
            else
            {
                Pinned->AppendConsoleLine(
                    TEXT("[SYNC] WARNING: No cooker settings override configured — MCP server may auto-start in cooker workspace and conflict with dev editor on port 8000"));
            }

            Pinned->SetPhaseDisplayText(TEXT("Launching CADET..."));

            FString Error;
            if (!Pinned->LaunchCadetForProfile(SyncedProfile, bRunBuild, bRunSteamPublish, Error))
            {
                Pinned->SetPhaseDisplayText(TEXT("Idle"));
                ShowNotification(FText::FromString(Error), SNotificationItem::CS_Fail);
                return;
            }

            ShowNotification(LOCTEXT("CadetRunStarted", "CADET run started."), SNotificationItem::CS_Success);
        });
    });

    return FReply::Handled();
}

FReply SCadetBuildTab::OnCancelClicked()
{
    if (bIsLaunchingJob)
    {
        bCancelLaunchRequested = true;
        SetPhaseDisplayText(TEXT("Cancelling sync..."));
        ShowNotification(LOCTEXT("CadetRunCancellingSync", "Cancelling workspace sync..."), SNotificationItem::CS_Success);
        return FReply::Handled();
    }

    if (!bIsJobRunning)
    {
        ShowNotification(LOCTEXT("NoCadetRunActive", "No active CADET run."), SNotificationItem::CS_Fail);
        return FReply::Handled();
    }

    if (!ActiveProcess.IsValid())
    {
        // Detached runs are monitored via status file and may not expose a live process handle.
        // Allow the user to stop monitoring and unlock Execute even when the child process is unmanaged.
        bIsJobRunning = false;
        bIsRecoveredDetachedJob = false;
        SetPhaseDisplayText(TEXT("Idle"));
        SaveDetachedManifest(TEXT("cancelled"), LastParsedPhase, TEXT("Cancel requested by user (detached monitor stopped)."), true, -1);
        AppendConsoleLine(TEXT("[DIST] Cancel requested by user (detached monitor stopped)."));
        ShowNotification(LOCTEXT("CadetDetachedMonitorStopped", "Detached CADET monitor stopped. You can execute again."), SNotificationItem::CS_Success);
        return FReply::Handled();
    }

    FPlatformProcess::TerminateProc(ActiveProcess, true);
    bIsJobRunning = false;
    SaveDetachedManifest(TEXT("cancelled"), LastParsedPhase, TEXT("Cancel requested by user."), true, -1);
    AppendConsoleLine(TEXT("[DIST] Cancel requested by user."));
    ShowNotification(LOCTEXT("CadetRunCancelled", "CADET run cancelled."), SNotificationItem::CS_Success);
    return FReply::Handled();
}

void SCadetBuildTab::Construct(const FArguments& InArgs)
{
    // Initialization will happen asynchronously to avoid blocking the editor
    bIsInitializing = true;

    PlatformOptions.Reset();
    PlatformOptions.Add(MakeShared<FString>(TEXT("steam")));

    OsOptions.Reset();
    OsOptions.Add(MakeShared<FString>(TEXT("windows")));

    ChildSlot
    [
        SNew(SBorder)
        .Padding(8.0f)
        [
            SNew(SVerticalBox)
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0, 0, 0, 6)
            [
                SNew(SHorizontalBox)
                + SHorizontalBox::Slot()
                .AutoWidth()
                .Padding(0, 0, 8, 0)
                [
                    SNew(SButton)
                    .Text(LOCTEXT("BuildProfilesTabButton", "Build Profiles"))
                    .OnClicked_Lambda([this]()
                    {
                        if (MainViewSwitcher.IsValid())
                        {
                            MainViewSwitcher->SetActiveWidgetIndex(0);
                        }
                        return FReply::Handled();
                    })
                ]
                + SHorizontalBox::Slot()
                .AutoWidth()
                [
                    SNew(SButton)
                    .Text(LOCTEXT("PublishingToolsTabButton", "Publishing Tools"))
                    .OnClicked_Lambda([this]()
                    {
                        if (MainViewSwitcher.IsValid())
                        {
                            MainViewSwitcher->SetActiveWidgetIndex(1);
                        }
                        return FReply::Handled();
                    })
                ]
            ]
            + SVerticalBox::Slot()
            .FillHeight(1.0f)
            [
                SAssignNew(MainViewSwitcher, SWidgetSwitcher)
                + SWidgetSwitcher::Slot()
                [
                    SNew(SSplitter)
            + SSplitter::Slot()
            .Value(0.28f)
            [
                SNew(SBorder)
                .Padding(8.0f)
                [
                    SNew(SVerticalBox)
                    + SVerticalBox::Slot()
                    .AutoHeight()
                    .Padding(0, 0, 0, 6)
                    [
                        SNew(STextBlock)
                        .Text(LOCTEXT("ProfilesHeader", "Profiles"))
                    ]
                    + SVerticalBox::Slot()
                    .FillHeight(1.0f)
                    [
                        SAssignNew(ProfileListView, SListView<TSharedPtr<FString>>)
                        .ListItemsSource(&ProfileItems)
                        .SelectionMode(ESelectionMode::Single)
                        .OnSelectionChanged_Lambda([this](TSharedPtr<FString> Item, ESelectInfo::Type SelectInfo)
                        {
                            PopulateEditorFromSelection();
                        })
                        .OnGenerateRow_Lambda([](TSharedPtr<FString> Item, const TSharedRef<STableViewBase>& Owner)
                        {
                            return SNew(STableRow<TSharedPtr<FString>>, Owner)
                                [
                                    SNew(STextBlock)
                                    .Text(Item.IsValid() ? FText::FromString(*Item) : FText::GetEmpty())
                                ];
                        })
                    ]
                    + SVerticalBox::Slot()
                    .AutoHeight()
                    .Padding(0, 6, 0, 0)
                    [
                        SNew(SHorizontalBox)
                        + SHorizontalBox::Slot()
                        .Padding(0, 0, 4, 0)
                        [
                            SNew(SButton)
                            .OnClicked(this, &SCadetBuildTab::OnNewProfileClicked)
                            .Text(LOCTEXT("NewProfileButton", "New"))
                        ]
                        + SHorizontalBox::Slot()
                        .Padding(0, 0, 4, 0)
                        [
                            SNew(SButton)
                            .OnClicked(this, &SCadetBuildTab::OnDuplicateProfileClicked)
                            .Text(LOCTEXT("DuplicateProfileButton", "Duplicate"))
                        ]
                        + SHorizontalBox::Slot()
                        [
                            SNew(SButton)
                            .OnClicked(this, &SCadetBuildTab::OnExportProfileClicked)
                            .Text(LOCTEXT("ExportProfileButton", "Export"))
                        ]
                    ]
                ]
            ]
            + SSplitter::Slot()
            .Value(0.72f)
            [
                SNew(SVerticalBox)
                + SVerticalBox::Slot()
                .AutoHeight()
                [
                    SNew(SBorder)
                    .Padding(8.0f)
                    [
                        SNew(STextBlock)
                        .Text(LOCTEXT("PreflightBanner", "Preflight: UI shell active. Validation wiring pending."))
                    ]
                ]
                + SVerticalBox::Slot()
                .FillHeight(1.0f)
                .Padding(0, 6, 0, 0)
                [
                    SNew(SSplitter)
                    .Orientation(Orient_Vertical)
                    + SSplitter::Slot()
                    .Value(0.62f)
                    [
                        SNew(SScrollBox)
                        + SScrollBox::Slot()
                        [
                            SNew(SVerticalBox)
                            + SVerticalBox::Slot()
                            .AutoHeight()
                            .Padding(0, 0, 0, 6)
                            [
                                SNew(STextBlock)
                                .Text(LOCTEXT("SettingsHeader", "Settings"))
                            ]
                            + SVerticalBox::Slot()
                            .AutoHeight()
                            .Padding(0, 0, 0, 10)
                            [
                                SNew(SVerticalBox)
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("ProfileNameLabel", "Profile Name"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SAssignNew(ProfileNameTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("PlatformLabel", "Platform"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SAssignNew(PlatformComboBox, STextComboBox)
                                    .OptionsSource(&PlatformOptions)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("OsLabel", "OS"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 10)
                                [
                                    SAssignNew(OsComboBox, STextComboBox)
                                    .OptionsSource(&OsOptions)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 6)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("UnrealSectionHeader", "Unreal Build Settings"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("UnrealEngineRootLabel", "Engine Root"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SNew(SHorizontalBox)
                                    + SHorizontalBox::Slot()
                                    .FillWidth(1.0f)
                                    .Padding(0, 0, 6, 0)
                                    [
                                        SAssignNew(UnrealEngineRootTextBox, SEditableTextBox)
                                    ]
                                    + SHorizontalBox::Slot()
                                    .AutoWidth()
                                    [
                                        SNew(SButton)
                                        .Text(LOCTEXT("BrowseEngineRootButton", "Browse..."))
                                        .OnClicked_Lambda([this]()
                                        {
                                            PickDirectoryForTextBox(UnrealEngineRootTextBox, TEXT("Select Unreal Engine Root"));
                                            return FReply::Handled();
                                        })
                                    ]
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("UnrealProjectPathLabel", "Sync Workspace Directory"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SNew(SHorizontalBox)
                                    + SHorizontalBox::Slot()
                                    .FillWidth(1.0f)
                                    .Padding(0, 0, 6, 0)
                                    [
                                        SAssignNew(UnrealProjectPathTextBox, SEditableTextBox)
                                    ]
                                    + SHorizontalBox::Slot()
                                    .AutoWidth()
                                    [
                                        SNew(SButton)
                                        .Text(LOCTEXT("BrowseProjectPathButton", "Browse..."))
                                        .OnClicked_Lambda([this]()
                                        {
                                            PickDirectoryForTextBox(UnrealProjectPathTextBox, TEXT("Select Sync Workspace Directory"));
                                            return FReply::Handled();
                                        })
                                    ]
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("UnrealBuildOutputLabel", "Build Output Path"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SNew(SHorizontalBox)
                                    + SHorizontalBox::Slot()
                                    .FillWidth(1.0f)
                                    .Padding(0, 0, 6, 0)
                                    [
                                        SAssignNew(UnrealBuildOutputPathTextBox, SEditableTextBox)
                                    ]
                                    + SHorizontalBox::Slot()
                                    .AutoWidth()
                                    [
                                        SNew(SButton)
                                        .Text(LOCTEXT("BrowseBuildOutputButton", "Browse..."))
                                        .OnClicked_Lambda([this]()
                                        {
                                            PickDirectoryForTextBox(UnrealBuildOutputPathTextBox, TEXT("Select Build Output Directory"));
                                            return FReply::Handled();
                                        })
                                    ]
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("UnrealProjectNameLabel", "Project Name"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SAssignNew(UnrealProjectNameTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("UnrealProjectNameHint",
                                        "Must match your game target name (declared in Source/YourName.Target.cs). "
                                        "Leave blank only when the target name equals the .uproject filename. "
                                        "Example: if your .uproject is 'MyGame' but Target.cs declares 'MyClient', enter 'MyClient' here."))
                                    .Font(FAppStyle::GetFontStyle("Small"))
                                    .ColorAndOpacity(FLinearColor(0.65f, 0.75f, 0.95f, 1.0f))
                                    .AutoWrapText(true)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("PackagingIniOverrideLabel", "Packaging INI Override"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(SHorizontalBox)
                                    + SHorizontalBox::Slot()
                                    .FillWidth(1.0f)
                                    .Padding(0, 0, 6, 0)
                                    [
                                        SAssignNew(PackagingIniOverrideTextBox, SEditableTextBox)
                                    ]
                                    + SHorizontalBox::Slot()
                                    .AutoWidth()
                                    [
                                        SNew(SButton)
                                        .Text(LOCTEXT("BrowsePackagingIniOverrideButton", "Browse..."))
                                        .OnClicked_Lambda([this]()
                                        {
                                            PickFileForTextBox(PackagingIniOverrideTextBox,
                                                TEXT("Select Packaging INI Override"),
                                                TEXT("INI Files (*.ini)|*.ini"));
                                            return FReply::Handled();
                                        })
                                    ]
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("PackagingIniOverrideHint",
                                        "Optional .ini containing +MapsToCook / +DirectoriesToNeverCook entries "
                                        "appended to DefaultGame.ini before cooking. "
                                        "Use for demo/subset builds. Leave empty for full builds."))
                                    .Font(FAppStyle::GetFontStyle("Small"))
                                    .ColorAndOpacity(FLinearColor(0.65f, 0.75f, 0.95f, 1.0f))
                                    .AutoWrapText(true)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("CookerSettingsOverrideLabel", "Cooker Settings Override"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(SHorizontalBox)
                                    + SHorizontalBox::Slot()
                                    .FillWidth(1.0f)
                                    .Padding(0, 0, 6, 0)
                                    [
                                        SAssignNew(CookerSettingsOverrideTextBox, SEditableTextBox)
                                    ]
                                    + SHorizontalBox::Slot()
                                    .AutoWidth()
                                    [
                                        SNew(SButton)
                                        .Text(LOCTEXT("BrowseCookerSettingsOverrideButton", "Browse..."))
                                        .OnClicked_Lambda([this]()
                                        {
                                            PickFileForTextBox(CookerSettingsOverrideTextBox,
                                                TEXT("Select Cooker Settings Override .ini"),
                                                TEXT("INI Files (*.ini)|*.ini"));
                                            return FReply::Handled();
                                        })
                                    ]
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("CookerSettingsOverrideHint",
                                        "Optional .ini file that overrides DefaultEditorPerProjectUserSettings.ini in the synced cooker workspace. "
                                        "Use this to disable auto-start servers (e.g. MCP) that would conflict with the dev editor."))
                                    .Font(FAppStyle::GetFontStyle("Small"))
                                    .ColorAndOpacity(FLinearColor(0.65f, 0.75f, 0.95f, 1.0f))
                                    .AutoWrapText(true)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 10)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("UnrealBuildDefaultsNote", "Build defaults: Shipping / Win64. Archive directory is derived from Build Output Path."))
                                    .Font(FAppStyle::GetFontStyle("Small"))
                                    .ColorAndOpacity(FLinearColor(0.75f, 0.75f, 0.75f, 1.0f))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 6)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamSectionHeader", "Steam Publish Settings"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamAppIdLabel", "Steam App ID"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SAssignNew(SteamAppIdTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamSetLiveLabel", "Set Live Branch"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SAssignNew(SteamSetLiveTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 10)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamDerivedPathsNote", "Steam content root and SteamCMD build output are derived automatically from Build Output Path, matching the Unity CADET editor."))
                                    .Font(FAppStyle::GetFontStyle("Small"))
                                    .ColorAndOpacity(FLinearColor(0.75f, 0.75f, 0.75f, 1.0f))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 6)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamDepotSectionHeader", "Steam Depot (Windows)"))
                                    .Font(FAppStyle::GetFontStyle("SmallBold"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamDepotIdLabel", "Depot ID"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SAssignNew(SteamDepotIdTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamDepotLocalPathLabel", "Local Path"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SAssignNew(SteamDepotLocalPathTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamDepotLocalPathHint",
                                        "Relative to Content Root. For Unreal Windows builds this should usually be 'archives/windows/*' so Steam uploads the archived package, not the intermediate build folder."))
                                    .Font(FAppStyle::GetFontStyle("Small"))
                                    .ColorAndOpacity(FLinearColor(0.65f, 0.75f, 0.95f, 1.0f))
                                    .AutoWrapText(true)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamDepotPathLabel", "Depot Path"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 8)
                                [
                                    SAssignNew(SteamDepotPathTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 4)
                                [
                                    SNew(STextBlock)
                                    .Text(LOCTEXT("SteamDepotRecursiveLabel", "Recursive (0 or 1)"))
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                .Padding(0, 0, 0, 10)
                                [
                                    SAssignNew(SteamDepotRecursiveTextBox, SEditableTextBox)
                                ]
                                + SVerticalBox::Slot()
                                .AutoHeight()
                                [
                                    SNew(SHorizontalBox)
                                    + SHorizontalBox::Slot()
                                    .AutoWidth()
                                    .Padding(0, 0, 8, 0)
                                    [
                                        SNew(SButton)
                                        .OnClicked(this, &SCadetBuildTab::OnSaveProfileClicked)
                                        .Text(LOCTEXT("SaveProfileButton", "Save Profile"))
                                    ]
                                    + SHorizontalBox::Slot()
                                    .AutoWidth()
                                    [
                                        SNew(SButton)
                                        .OnClicked(this, &SCadetBuildTab::OnDeleteProfileClicked)
                                        .Text(LOCTEXT("DeleteProfileButton", "Delete"))
                                    ]
                                ]
                            ]
                            + SVerticalBox::Slot()
                            .AutoHeight()
                            .Padding(0, 0, 0, 6)
                            [
                                SNew(STextBlock)
                                .Text(LOCTEXT("OperationsHeader", "Operations"))
                            ]
                            + SVerticalBox::Slot()
                            .AutoHeight()
                            [
                                SNew(SHorizontalBox)
                                + SHorizontalBox::Slot()
                                .AutoWidth()
                                .Padding(0, 0, 10, 0)
                                [
                                    SAssignNew(BuildOperationCheckBox, SCheckBox)
                                    .IsChecked(ECheckBoxState::Checked)
                                    [
                                        SNew(STextBlock)
                                        .Text(LOCTEXT("BuildOperation", "Build (package)"))
                                    ]
                                ]
                                + SHorizontalBox::Slot()
                                .AutoWidth()
                                [
                                    SAssignNew(SteamPublishOperationCheckBox, SCheckBox)
                                    .IsChecked(ECheckBoxState::Checked)
                                    [
                                        SNew(STextBlock)
                                        .Text(LOCTEXT("SteamOperation", "Publish Steam"))
                                    ]
                                ]
                            ]
                            + SVerticalBox::Slot()
                            .AutoHeight()
                            .Padding(0, 10, 0, 0)
                            [
                                SNew(SUniformGridPanel)
                                .SlotPadding(FMargin(0, 0, 8, 0))
                                + SUniformGridPanel::Slot(0, 0)
                                [
                                    SNew(SButton)
                                    .OnClicked(this, &SCadetBuildTab::OnExecuteClicked)
                                    .Text(LOCTEXT("ExecuteButton", "Execute"))
                                ]
                                + SUniformGridPanel::Slot(1, 0)
                                [
                                    SNew(SButton)
                                    .OnClicked(this, &SCadetBuildTab::OnCancelClicked)
                                    .IsEnabled_Lambda([this]() { return bIsJobRunning || bIsLaunchingJob; })
                                    .Text(LOCTEXT("CancelButton", "Cancel"))
                                ]
                            ]
                        ]
                    ]
                    + SSplitter::Slot()
                    .Value(0.38f)
                    [
                        SNew(SBorder)
                        .Padding(8.0f)
                        [
                            SNew(SVerticalBox)
                            + SVerticalBox::Slot()
                            .AutoHeight()
                            [
                                SNew(STextBlock)
                                .Text(LOCTEXT("ConsoleHeader", "Console / Logs"))
                            ]
                            + SVerticalBox::Slot()
                            .FillHeight(1.0f)
                            .Padding(0, 6, 0, 0)
                            [
                                SNew(SBox)
                                .MinDesiredHeight(160.0f)
                                [
                                    SAssignNew(ConsoleScrollBox, SScrollBox)
                                    + SScrollBox::Slot()
                                    [
                                        SAssignNew(ConsoleTextBlock, STextBlock)
                                        .Text(LOCTEXT("ConsolePlaceholder", "[DIST] CADET Build shell ready.\n\nJob status and live logs will appear here."))
                                    ]
                                ]
                            ]
                        ]
                    ]
                ]
            ]
                ]
                + SWidgetSwitcher::Slot()
                [
                    SNew(SBorder)
                    .Padding(8.0f)
                    [
                        SNew(SCadetPublishingToolsPanel)
                    ]
                ]
            ]
        ]
    ];

    // Start async initialization of profiles and detached job state
    StartAsyncInitialization();
}

void SCadetBuildTab::PollStatusAsynchronously()
{
    // Prevent concurrent polling to avoid race conditions
    bAsyncStatusPollInProgress = true;

    TWeakPtr<SCadetBuildTab> WeakTab = StaticCastSharedRef<SCadetBuildTab>(AsShared());
    FString StatusFilePathCopy = StatusFilePath;
    FString LastPhase = LastParsedPhase;
    FString LastDetails = LastParsedDetails;
    FString CurrentPhaseCopy = CurrentPhase;

    // Perform file I/O on background thread
    Async(EAsyncExecution::ThreadPool, [WeakTab, StatusFilePathCopy, LastPhase, LastDetails, CurrentPhaseCopy]()
    {
        // Read and parse status file (blocking file I/O, OK on background thread)
        FString NewPhase = LastPhase;
        FString NewDetails = LastDetails;

        if (FPaths::FileExists(*StatusFilePathCopy))
        {
            FString StatusJson;
            if (FFileHelper::LoadFileToString(StatusJson, *StatusFilePathCopy))
            {
                TSharedRef<TJsonReader<>> JsonReader = TJsonReaderFactory<>::Create(StatusJson);
                TSharedPtr<FJsonObject> JsonObject;
                if (FJsonSerializer::Deserialize(JsonReader, JsonObject) && JsonObject.IsValid())
                {
                    if (JsonObject->HasField(TEXT("phase")))
                    {
                        NewPhase = JsonObject->GetStringField(TEXT("phase"));
                    }
                    else if (JsonObject->HasField(TEXT("currentPhase")))
                    {
                        NewPhase = JsonObject->GetStringField(TEXT("currentPhase"));
                    }

                    if (JsonObject->HasField(TEXT("details")))
                    {
                        NewDetails = JsonObject->GetStringField(TEXT("details"));
                    }
                    else if (JsonObject->HasField(TEXT("status")))
                    {
                        NewDetails = JsonObject->GetStringField(TEXT("status"));
                    }
                }
            }
        }

        // Post results back to game thread
        AsyncTask(ENamedThreads::GameThread, [WeakTab, NewPhase, NewDetails]()
        {
            const TSharedPtr<SCadetBuildTab> Pinned = WeakTab.Pin();
            if (!Pinned.IsValid())
            {
                return;
            }

            // Update on game thread only
            Pinned->LastParsedPhase = NewPhase;
            Pinned->LastParsedDetails = NewDetails;

            FString DisplayText = NewPhase;
            if (!NewDetails.IsEmpty())
            {
                DisplayText = FString::Printf(TEXT("%s - %s"), *NewPhase, *NewDetails);
            }
            Pinned->CurrentPhase = DisplayText;

            // Save manifest on game thread (relatively quick, but still better off hot-path)
            FString Operation = NewPhase;
            if (Operation.IsEmpty())
            {
                Operation = TEXT("running");
            }

            FString Message = DisplayText;
            if (Message.IsEmpty())
            {
                Message = NewDetails;
            }

            Pinned->SaveDetachedManifest(TEXT("running"), Operation, Message, false, INDEX_NONE);

            // Allow next status poll
            Pinned->bAsyncStatusPollInProgress = false;
        });
    });
}

void SCadetBuildTab::StartAsyncInitialization()
{
    AppendConsoleLine(TEXT("[INIT] Initializing CADET Build tab..."));
    SetPhaseDisplayText(TEXT("Initializing..."));

    TWeakPtr<SCadetBuildTab> WeakTab = StaticCastSharedRef<SCadetBuildTab>(AsShared());

    Async(EAsyncExecution::ThreadPool, [WeakTab]()
    {
        // Load profiles on background thread
        TArray<FCadetProfileData> LoadedProfiles = FCadetProfileStore::LoadAllProfiles();
        if (LoadedProfiles.Num() == 0)
        {
            LoadedProfiles.Add(FCadetProfileData::MakeDefault(1));
        }

        // Scan for detached job manifests on background thread
        const FString JobsDir = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Config"), TEXT("CadetBuild"), TEXT("Jobs"));
        TArray<FString> ManifestFiles;
        IFileManager::Get().FindFiles(ManifestFiles, *(JobsDir / TEXT("*-detached.json")), true, false);

        // Post results back to game thread
        AsyncTask(ENamedThreads::GameThread, [WeakTab, LoadedProfiles, ManifestFiles]() mutable
        {
            const TSharedPtr<SCadetBuildTab> Pinned = WeakTab.Pin();
            if (!Pinned.IsValid())
            {
                return;
            }

            // Update profiles on game thread
            Pinned->Profiles = LoadedProfiles;
            Pinned->RefreshProfileItems();
            Pinned->PopulateEditorFromSelection();

            // Restore detached job state on game thread
            if (ManifestFiles.Num() > 0)
            {
                Pinned->TryRestoreDetachedJobState();
            }

            Pinned->bIsInitializing = false;
            Pinned->SetPhaseDisplayText(TEXT("Idle"));
            Pinned->AppendConsoleLine(TEXT("[INIT] Initialization complete."));
        });
    });
}

#undef LOCTEXT_NAMESPACE
