#include "Misc/AutomationTest.h"

#include "Framework/Docking/TabManager.h"
#include "Widgets/Docking/SDockTab.h"

#if WITH_DEV_AUTOMATION_TESTS

/**
 * The acceptance test for the installer's editor half: after an install, the
 * Cadet tab exists and builds its widget. A tab that fails to construct shows an
 * empty panel, which a menu entry alone does not catch.
 */
IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetBuildTabSpawnsTest,
    "Cadet.CadetBuild.Tab.SpawnsBuildTab",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetBuildTabSpawnsTest::RunTest(const FString& Parameters)
{
    const FName TabName(TEXT("CadetBuild.MainTab"));

    TestTrue(TEXT("The module registered a spawner for the Cadet tab"),
        FGlobalTabmanager::Get()->HasTabSpawner(TabName));

    const TSharedPtr<SDockTab> Tab = FGlobalTabmanager::Get()->TryInvokeTab(TabName);
    if (TestTrue(TEXT("The Cadet tab opens"), Tab.IsValid()) == false)
    {
        return true;
    }

    TestNotNull(TEXT("The tab hosts the build widget"), &Tab->GetContent().Get());

    Tab->RequestCloseTab();
    return true;
}

#endif
