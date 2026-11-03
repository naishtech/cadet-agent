#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

struct FToolMenuSection;
class SDockTab;
class SWidget;

class FCadetBuildModule : public IModuleInterface
{
public:
    static const FName TabName;

    virtual void StartupModule() override;
    virtual void ShutdownModule() override;

private:
    TSharedRef<SDockTab> SpawnCadetBuildTab(const class FSpawnTabArgs& SpawnTabArgs);
    void RegisterMenus();
    void AddToolsMenuEntry(FToolMenuSection& Section);
};
