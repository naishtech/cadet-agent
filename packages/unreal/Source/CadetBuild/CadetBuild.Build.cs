using UnrealBuildTool;

public class CadetBuild : ModuleRules
{
    public CadetBuild(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "Slate",
            "SlateCore"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "UnrealEd",
            "ToolMenus",
            "LevelEditor",
            "InputCore",
            "Projects",
            "Json",
            "JsonUtilities",
            "AppFramework",
            "DesktopPlatform"
        });
    }
}
