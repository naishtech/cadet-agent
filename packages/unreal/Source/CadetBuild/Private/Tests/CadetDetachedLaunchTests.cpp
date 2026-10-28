#include "Misc/AutomationTest.h"
#include "Utils/CadetDetachedLaunch.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetDetachedLaunchBuildsPowerShellCommandTest,
    "Bloodstone.CadetBuild.DetachedLaunch.BuildsPowerShellCommand",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetDetachedLaunchBuildsPowerShellCommandTest::RunTest(const FString& Parameters)
{
    FCadetDetachedLaunchRequest Request;
    Request.BashPath = TEXT("C:/Program Files/Git/bin/bash.exe");
    Request.DistScriptPath = TEXT("F:/unity/projects/cadet/cadet-cli/Tools/CLI/dist.sh");
    Request.RuntimeProfilePath = TEXT("F:/tmp/runtime.json");
    Request.VdfsDirectory = TEXT("F:/tmp/vdfs");
    Request.JobGuid = TEXT("job-guid-1");
    Request.LaunchToken = TEXT("launch-token-1");
    Request.StatusFilePath = TEXT("F:/tmp/status.json");

    FCadetDetachedLaunchPlan Plan;
    FString Error;
    const bool bBuilt = BuildDetachedLaunchPlanWindows(Request, Plan, Error);

    TestTrue(TEXT("BuildDetachedLaunchPlanWindows should succeed for valid request"), bBuilt);
    TestTrue(TEXT("Error should be empty"), Error.IsEmpty());
    TestEqual(TEXT("Launcher should be PowerShell"), Plan.LauncherPath, FString(TEXT("powershell.exe")));
    TestTrue(TEXT("Arguments should include Start-Process"), Plan.LauncherArgs.Contains(TEXT("Start-Process")));
    TestTrue(TEXT("Arguments should include bash path"), Plan.LauncherArgs.Contains(Request.BashPath));
    TestTrue(TEXT("Arguments should include --engine=unreal"), Plan.LauncherArgs.Contains(TEXT("--engine=unreal")));
    TestTrue(TEXT("Arguments should include --status-file"), Plan.LauncherArgs.Contains(TEXT("--status-file")));
    TestTrue(TEXT("Detached launch should not use pipes"), !Plan.bUsePipes);
    TestTrue(TEXT("Detached launch should use detached process mode"), Plan.bLaunchDetached);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCadetDetachedLaunchRejectsEmptyPathsTest,
    "Bloodstone.CadetBuild.DetachedLaunch.RejectsEmptyPaths",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCadetDetachedLaunchRejectsEmptyPathsTest::RunTest(const FString& Parameters)
{
    FCadetDetachedLaunchRequest Request;
    FCadetDetachedLaunchPlan Plan;
    FString Error;

    const bool bBuilt = BuildDetachedLaunchPlanWindows(Request, Plan, Error);
    TestTrue(TEXT("BuildDetachedLaunchPlanWindows should fail for empty request"), !bBuilt);
    TestTrue(TEXT("Error should mention missing bash path"), Error.Contains(TEXT("BashPath")));
    return true;
}

#endif
