#include "Misc/AutomationTest.h"

#include "CadetCliStatus.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"

#if WITH_DEV_AUTOMATION_TESTS

namespace
{
    /** A throwaway CLI folder under Saved/Temp, removed when the test ends. */
    struct FScopedTestFolder
    {
        FString Root;

        FScopedTestFolder()
        {
            Root = FPaths::Combine(
                FPaths::ProjectSavedDir(),
                TEXT("Temp"),
                TEXT("CadetBuildTests"),
                FGuid::NewGuid().ToString(EGuidFormats::Digits));
            IFileManager::Get().MakeDirectory(*Root, true);
        }

        ~FScopedTestFolder()
        {
            IFileManager::Get().DeleteDirectory(*Root, false, true);
        }

        FString Write(const FString& RelativePath, const FString& Contents) const
        {
            const FString FullPath = FPaths::Combine(Root, RelativePath);
            IFileManager::Get().MakeDirectory(*FPaths::GetPath(FullPath), true);
            FFileHelper::SaveStringToFile(Contents, *FullPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
            return FullPath;
        }

        /** Every file a build needs, so Inspect reports an installed CLI. */
        void WriteRequiredFiles() const
        {
            for (const FString& RelativePath : CadetCli::GetRequiredFiles())
            {
                Write(RelativePath, TEXT("# test placeholder\n"));
            }
        }
    };
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetCliInspectMissingTest,
    "Cadet.CadetBuild.Cli.InspectReportsMissingFiles",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetCliInspectMissingTest::RunTest(const FString& Parameters)
{
    FScopedTestFolder Folder;
    const FCadetCliStatus Status = CadetCli::Inspect(Folder.Root);

    TestFalse(TEXT("An empty folder is not an installed CLI"), Status.IsInstalled());
    TestTrue(TEXT("dist.sh is reported missing"), Status.MissingFiles.Contains(TEXT("dist.sh")));
    TestEqual(TEXT("Every required file is reported"), Status.MissingFiles.Num(), CadetCli::GetRequiredFiles().Num());

    const FString Message = Status.GetMissingText().ToString();
    TestTrue(TEXT("The message names the fix"), Message.Contains(TEXT("npx cadet-agent init")));
    TestTrue(TEXT("The message names the folder"), Message.Contains(Folder.Root));
    TestTrue(TEXT("The version label says not installed"), Status.GetVersionText().ToString().Contains(TEXT("not installed")));

    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetCliInspectInstalledTest,
    "Cadet.CadetBuild.Cli.InspectReadsVersionFile",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetCliInspectInstalledTest::RunTest(const FString& Parameters)
{
    FScopedTestFolder Folder;
    Folder.WriteRequiredFiles();
    Folder.Write(TEXT("VERSION"), TEXT("1.2.3\n"));

    const FCadetCliStatus Status = CadetCli::Inspect(Folder.Root);

    TestTrue(TEXT("A complete folder is an installed CLI"), Status.IsInstalled());
    TestEqual(TEXT("Version comes from VERSION"), Status.Version, FString(TEXT("1.2.3")));
    TestTrue(TEXT("The version label shows the version"), Status.GetVersionText().ToString().Contains(TEXT("1.2.3")));
    TestTrue(TEXT("An installed CLI has no missing text"), Status.GetMissingText().IsEmpty());

    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetCliInspectManifestVersionTest,
    "Cadet.CadetBuild.Cli.InspectPrefersManifestVersion",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetCliInspectManifestVersionTest::RunTest(const FString& Parameters)
{
    FScopedTestFolder Folder;
    Folder.WriteRequiredFiles();
    Folder.Write(TEXT("VERSION"), TEXT("1.2.3\n"));
    Folder.Write(TEXT(".cadet-cli.json"), TEXT("{\"version\": \"9.9.9\"}\n"));

    const FCadetCliStatus Status = CadetCli::Inspect(Folder.Root);

    TestEqual(TEXT(".cadet-cli.json wins over VERSION"), Status.Version, FString(TEXT("9.9.9")));

    return true;
}

#endif
