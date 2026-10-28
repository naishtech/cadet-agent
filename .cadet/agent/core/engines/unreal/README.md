# Unreal — engine pack

The Unreal Engine commands and conventions that the engine-neutral phase skills defer to. A phase skill says *run the project's build*; this pack says which script, with which arguments.

Read `.cadet/engine.json` first. It names the engine and carries the paths this pack assumes:

| Field | Meaning here |
|---|---|
| `engine` | `unreal`, or `unreal` as the primary when both packs are installed |
| `unreal.pluginRoot` | `Plugins/CadetBuild` — the installed plugin |
| `unreal.cliRoot` | `Plugins/CadetBuild/CLI` — the CLI scripts this pack invokes |
| `unreal.editorVersion` | the engine version, from the `.uproject`'s `EngineAssociation` |

If `.cadet/engine.json` is missing, or names another engine, do not use the commands below. State the Engine Seam sentence in `.cadet/agent/core/cadet-agent.md` and stop.

## Tokens

A command below is written once with tokens instead of a project's names. Fill each token from the source named beside it, and fill it once — a path typed from memory is the usual reason a build fails on a project that built yesterday.

| Token | Filled from |
|---|---|
| `{{projectRoot}}` | the consumer repository root |
| `{{uproject}}` | the project descriptor at the root (`*.uproject`); use the path the command needs |
| `{{gameModule}}` | the primary game module under `Source/`, named as its `*.Target.cs` names the target |
| `{{buildScript}}` | the build entry point: the project's own build script when it has one, otherwise the engine's `Build.bat` (Windows) or `Build.sh` from the installed engine version — the `build` row below shows the engine form |
| `{{testCommand}}` | the automation command in the `test` row below, with the project and the filter filled in |

## The four capabilities

| Capability | Command | Notes |
|---|---|---|
| build | `{{buildScript}} {{gameModule}}Editor Win64 Development -Project="{{uproject}}" -WaitMutex` | the editor target is the module name plus `Editor`; `-WaitMutex` makes the caller wait for the lock |
| test | `UnrealEditor-Cmd.exe "{{uproject}}" -ExecCmds="Automation RunTests <filter>" -unattended -nullrhi -nosplash -testexit="Automation Test Queue Empty" -ReportExportPath=<dir>` | headless automation; the report lands in `<dir>`, and `-testexit` is what makes the process end |
| verify | the build above, then the automation run above, then `cadet-agent harness verify --gate <gate>` | two signals, because a compile and a test answer different questions |
| run | `UnrealEditor-Cmd.exe "{{uproject}}" -game` | a stand-alone session; for a visual claim, open the editor and play in it |

`-nullrhi` runs without a graphics device, which is right for automation and wrong for anything visual. A claim about what a frame shows needs a real window and the Visual Evidence skill.

## Pages

| Page | Read it when |
|---|---|
| [coding.md](coding.md) | you are writing C++ that the engine builds |
| [blueprints.md](blueprints.md) | you are working in Blueprints or on assets |
| [mcp.md](mcp.md) | the agent must drive a live editor |
| [optimization.md](optimization.md) | you are profiling, or arguing about a frame budget |
| [planning.md](planning.md) | you are sizing a change, or planning one |
| [review.md](review.md) | you are questioning a plan before the design is written |
| [breakdown.md](breakdown.md) | you are cutting an epic into stories |

## Conventions that hold across the pack

- **Close the editor before a module build.** The engine holds the module loaded and writes its own binaries; a second compiler writing the same files fails, or worse, leaves a half-linked module. This rule is why the build is a job the caller waits on rather than a background step.
- **A module build is slow.** It is minutes, not seconds, and it grows with the module. Treat it as a budget item and run it as a background job where the harness allows.
- **The `.uproject` and the `Source/` tree agree or nothing builds.** A module added to `Source/` without its entry in the `*.Build.cs` and the target file is invisible to the build, and the error names a symbol rather than the missing line.
- **Cooking is a separate cost from building.** A build proves the code compiles; a cook proves the content loads. Say which one you ran.
- **The plugin is a source plugin.** It lives at `Plugins/CadetBuild` with its `.uplugin`; the installer copies it there and `uninstall` removes what it recorded.
