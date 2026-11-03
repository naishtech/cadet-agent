#include "CadetCliStatus.h"

#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

#define LOCTEXT_NAMESPACE "CadetCliStatus"

namespace
{
    /** Trimmed first line of a VERSION file, or empty when the file is absent. */
    FString ReadVersionFile(const FString& CliRoot)
    {
        FString Contents;
        if (!FFileHelper::LoadFileToString(Contents, *FPaths::Combine(CliRoot, TEXT("VERSION"))))
        {
            return FString();
        }

        FString FirstLine;
        if (!Contents.Split(TEXT("\n"), &FirstLine, nullptr))
        {
            FirstLine = Contents;
        }
        FirstLine.TrimStartAndEndInline();
        return FirstLine;
    }

    /** "version" field of .cadet-cli.json, or empty when the file is absent. */
    FString ReadVersionManifest(const FString& CliRoot)
    {
        FString Contents;
        if (!FFileHelper::LoadFileToString(Contents, *FPaths::Combine(CliRoot, TEXT(".cadet-cli.json"))))
        {
            return FString();
        }

        TSharedPtr<FJsonObject> Document;
        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Contents);
        if (!FJsonSerializer::Deserialize(Reader, Document) || !Document.IsValid())
        {
            return FString();
        }

        FString Version;
        Document->TryGetStringField(TEXT("version"), Version);
        Version.TrimStartAndEndInline();
        return Version;
    }
}

FText FCadetCliStatus::GetMissingText() const
{
    if (IsInstalled())
    {
        return FText::GetEmpty();
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

    return FText::FromString(FString::Printf(
        TEXT("Cadet CLI missing: run `npx cadet-agent init` in this project.\n\n")
        TEXT("Folder: %s\n")
        TEXT("Missing files:\n%s"),
        *CliRoot,
        *MissingList));
}

FText FCadetCliStatus::GetVersionText() const
{
    if (!IsInstalled())
    {
        return LOCTEXT("CliNotInstalled", "Cadet CLI: not installed");
    }

    if (Version.IsEmpty())
    {
        return LOCTEXT("CliVersionUnknown", "Cadet CLI: version not recorded");
    }

    return FText::FromString(FString::Printf(TEXT("Cadet CLI %s"), *Version));
}

namespace CadetCli
{
    const TArray<FString>& GetRequiredFiles()
    {
        static const TArray<FString> RequiredFiles = {
            TEXT("dist.sh"),
            TEXT("Util/json_parser.sh"),
            TEXT("Util/build_status.sh"),
            TEXT("Steam/publish.sh"),
            TEXT("Unreal/build.sh")
        };
        return RequiredFiles;
    }

    FString GetCliRoot()
    {
        return FPaths::ConvertRelativePathToFull(
            FPaths::Combine(FPaths::ProjectPluginsDir(), TEXT("CadetBuild"), TEXT("CLI")));
    }

    FCadetCliStatus Inspect(const FString& CliRoot)
    {
        FCadetCliStatus Status;
        Status.CliRoot = CliRoot;

        for (const FString& RelativePath : GetRequiredFiles())
        {
            if (!FPaths::FileExists(FPaths::Combine(CliRoot, RelativePath)))
            {
                Status.MissingFiles.Add(RelativePath);
            }
        }

        Status.Version = ReadVersionManifest(CliRoot);
        if (Status.Version.IsEmpty())
        {
            Status.Version = ReadVersionFile(CliRoot);
        }

        return Status;
    }

    FCadetCliStatus InspectInstalled()
    {
        return Inspect(GetCliRoot());
    }
}

#undef LOCTEXT_NAMESPACE
