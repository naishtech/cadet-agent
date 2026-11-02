#include "Misc/AutomationTest.h"

#include "CadetCliStatus.h"
#include "CadetProfileModel.h"
#include "CadetProfileValidator.h"
#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

#if WITH_DEV_AUTOMATION_TESTS

namespace
{
    /** plugins/CadetBuild/CLI/fixtures/profiles, written by the installer. */
    FString GetFixtureDirectory()
    {
        return FPaths::Combine(CadetCli::GetCliRoot(), TEXT("fixtures"), TEXT("profiles"));
    }

    /** Sorted *.json fixture paths. */
    TArray<FString> GetFixtureFiles()
    {
        TArray<FString> Files;
        IFileManager::Get().FindFiles(Files, *FPaths::Combine(GetFixtureDirectory(), TEXT("*.json")), true, false);
        Files.Sort();
        return Files;
    }

    bool LoadJsonObject(const FString& FullPath, TSharedPtr<FJsonObject>& OutDocument, FString& OutText)
    {
        if (!FFileHelper::LoadFileToString(OutText, *FullPath))
        {
            return false;
        }

        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(OutText);
        return FJsonSerializer::Deserialize(Reader, OutDocument) && OutDocument.IsValid();
    }

    /**
     * Fields the profile model deliberately does not carry.
     * bundleId is generated from the project name when the runtime profile is written;
     * the engine, store and macOS blocks belong to the CLI alone;
     * steamcmdSh is the macOS SteamCMD path and the plugin launcher is Windows only.
     * A field that appears in a fixture and is not on this list fails the round-trip test.
     */
    const TSet<FString>& GetFieldsOutsideTheModel()
    {
        static const TSet<FString> Fields = {
            TEXT("bundleId"),
            TEXT("unity"),
            TEXT("epic"),
            TEXT("macos"),
            TEXT("useGit"),
            TEXT("gitRepository"),
            TEXT("gitBranch"),
            TEXT("steam.steamcmdSh")
        };
        return Fields;
    }

    /** Add "key" for every fixture key the model output does not have. */
    void CollectDroppedKeys(
        const TSharedPtr<FJsonObject>& Fixture,
        const TSharedPtr<FJsonObject>& ModelOutput,
        const FString& Prefix,
        TArray<FString>& OutDropped)
    {
        for (const TPair<FString, TSharedPtr<FJsonValue>>& Entry : Fixture->Values)
        {
            if (!ModelOutput->HasField(Entry.Key))
            {
                OutDropped.Add(Prefix + Entry.Key);
            }
        }
    }
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetProfileFixturesValidTest,
    "Cadet.CadetBuild.ProfileFixtures.EveryValidFixturePassesValidation",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetProfileFixturesValidTest::RunTest(const FString& Parameters)
{
    const TArray<FString> Files = GetFixtureFiles();
    if (TestTrue(TEXT("The installed CLI carries profile fixtures"), Files.Num() > 0) == false)
    {
        AddError(FString::Printf(TEXT("No fixtures under %s"), *GetFixtureDirectory()));
        return true;
    }

    for (const FString& File : Files)
    {
        if (File.StartsWith(TEXT("invalid-")))
        {
            continue;
        }

        TSharedPtr<FJsonObject> Document;
        FString Text;
        if (!TestTrue(FString::Printf(TEXT("%s parses"), *File), LoadJsonObject(FPaths::Combine(GetFixtureDirectory(), File), Document, Text)))
        {
            continue;
        }

        FCadetProfileValidationResult Result;
        const bool bValid = CadetProfileValidation::ValidateDocument(Document, Result);
        TestTrue(
            FString::Printf(TEXT("%s passes the schema rules: %s"), *File, *Result.GetErrorText()),
            bValid);
    }

    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetProfileFixturesInvalidTest,
    "Cadet.CadetBuild.ProfileFixtures.InvalidFixtureIsRejectedWithNamedField",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetProfileFixturesInvalidTest::RunTest(const FString& Parameters)
{
    const FString InvalidPath = FPaths::Combine(GetFixtureDirectory(), TEXT("invalid-missing-bundle.json"));

    FString Text;
    if (!TestTrue(TEXT("The invalid fixture is installed"), FFileHelper::LoadFileToString(Text, *InvalidPath)))
    {
        AddError(FString::Printf(TEXT("Expected %s in the installed CLI"), *InvalidPath));
        return true;
    }

    FCadetProfileValidationResult Result;
    const bool bValid = CadetProfileValidation::ValidateJsonText(Text, Result);

    TestFalse(TEXT("The invalid fixture is rejected"), bValid);
    TestTrue(
        FString::Printf(TEXT("The rejection names bundleId (got: %s)"), *Result.GetErrorText()),
        Result.Errors.Contains(TEXT("bundleId")));
    TestTrue(
        FString::Printf(TEXT("The rejection names the incomplete unity block (got: %s)"), *Result.GetErrorText()),
        Result.Errors.Contains(TEXT("unity.editorPath")));

    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetProfileModelRoundTripTest,
    "Cadet.CadetBuild.ProfileFixtures.ModelRoundTripDropsNoField",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetProfileModelRoundTripTest::RunTest(const FString& Parameters)
{
    const TArray<FString> Files = GetFixtureFiles();
    if (TestTrue(TEXT("The installed CLI carries profile fixtures"), Files.Num() > 0) == false)
    {
        AddError(FString::Printf(TEXT("No fixtures under %s"), *GetFixtureDirectory()));
        return true;
    }

    for (const FString& File : Files)
    {
        if (File.StartsWith(TEXT("invalid-")))
        {
            continue;
        }

        TSharedPtr<FJsonObject> Document;
        FString Text;
        if (!TestTrue(FString::Printf(TEXT("%s parses"), *File), LoadJsonObject(FPaths::Combine(GetFixtureDirectory(), File), Document, Text)))
        {
            continue;
        }

        FCadetProfileData Profile;
        if (!TestTrue(FString::Printf(TEXT("%s loads into the model"), *File),
            FCadetProfileStore::DeserializeProfileFromString(Text, Profile)))
        {
            continue;
        }

        TestEqual(FString::Printf(TEXT("%s keeps its profileName"), *File), Profile.ProfileName, File.Replace(TEXT(".json"), TEXT("")));

        FString ModelJson;
        if (!TestTrue(FString::Printf(TEXT("%s serializes from the model"), *File),
            FCadetProfileStore::SerializeProfileToString(Profile, ModelJson)))
        {
            continue;
        }

        TSharedPtr<FJsonObject> ModelDocument;
        const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(ModelJson);
        if (!TestTrue(FString::Printf(TEXT("%s model output parses"), *File),
            FJsonSerializer::Deserialize(Reader, ModelDocument) && ModelDocument.IsValid()))
        {
            continue;
        }

        TArray<FString> Dropped;
        CollectDroppedKeys(Document, ModelDocument, FString(), Dropped);

        for (const FString& BlockName : { FString(TEXT("unreal")), FString(TEXT("steam")) })
        {
            const TSharedPtr<FJsonObject>* FixtureBlock = nullptr;
            const TSharedPtr<FJsonObject>* ModelBlock = nullptr;
            if (Document->TryGetObjectField(BlockName, FixtureBlock) &&
                ModelDocument->TryGetObjectField(BlockName, ModelBlock))
            {
                CollectDroppedKeys(*FixtureBlock, *ModelBlock, BlockName + TEXT("."), Dropped);
            }
        }

        for (const FString& Field : Dropped)
        {
            TestTrue(
                FString::Printf(TEXT("%s: the model silently dropped '%s'; carry it or add it to the documented list"), *File, *Field),
                GetFieldsOutsideTheModel().Contains(Field));
        }
    }

    return true;
}

#endif
