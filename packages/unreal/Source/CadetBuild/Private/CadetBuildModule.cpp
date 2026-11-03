#include "CadetBuildModule.h"

#include "LevelEditor.h"
#include "Slate/SCadetBuildTab.h"
#include "ToolMenus.h"
#include "Widgets/Docking/SDockTab.h"

#define LOCTEXT_NAMESPACE "CadetBuildModule"

const FName FCadetBuildModule::TabName(TEXT("CadetBuild.MainTab"));

IMPLEMENT_MODULE(FCadetBuildModule, CadetBuild)

void FCadetBuildModule::StartupModule()
{
    FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
        TabName,
        FOnSpawnTab::CreateRaw(this, &FCadetBuildModule::SpawnCadetBuildTab)
    )
    .SetDisplayName(LOCTEXT("CadetBuildTabTitle", "CADET Build"))
    .SetMenuType(ETabSpawnerMenuType::Hidden);

    UToolMenus::RegisterStartupCallback(
        FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FCadetBuildModule::RegisterMenus)
    );
}

void FCadetBuildModule::ShutdownModule()
{
    UToolMenus::UnRegisterStartupCallback(this);
    UToolMenus::UnregisterOwner(this);

    if (FModuleManager::Get().IsModuleLoaded("LevelEditor"))
    {
        FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(TabName);
    }
}

TSharedRef<SDockTab> FCadetBuildModule::SpawnCadetBuildTab(const FSpawnTabArgs& SpawnTabArgs)
{
    return SNew(SDockTab)
        .TabRole(ETabRole::NomadTab)
        [
            SNew(SCadetBuildTab)
        ];
}

void FCadetBuildModule::RegisterMenus()
{
    FToolMenuOwnerScoped OwnerScoped(this);

    UToolMenu* ToolsMenu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Tools");
    FToolMenuSection& Section = ToolsMenu->FindOrAddSection("Tools");

    AddToolsMenuEntry(Section);
}

void FCadetBuildModule::AddToolsMenuEntry(FToolMenuSection& Section)
{
    Section.AddMenuEntry(
        "OpenCadet",
        LOCTEXT("OpenCadetLabel", "Cadet"),
        LOCTEXT("OpenCadetTooltip", "Open Cadet build and publishing tools."),
        FSlateIcon(),
        FUIAction(FExecuteAction::CreateLambda([]()
        {
            FGlobalTabmanager::Get()->TryInvokeTab(FCadetBuildModule::TabName);
        }))
    );
}

#undef LOCTEXT_NAMESPACE
