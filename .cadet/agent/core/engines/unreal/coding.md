# Coding — Unreal pack

## What this page covers

This page is the Unreal pack's C++ coding reference. A phase skill names the capability — run the project's build, run its tests — and this page names the command (`.cadet/agent/core/cadet-agent.md` § Engine Seam). Test-first sequencing and per-change review are core process, not pack business: read `.cadet/agent/core/skills/TDD.md` and `.cadet/agent/core/skills/CodeReview.md` and do not re-derive them here.

Project identity: `{{uproject}}` is the editor project file; the game module it declares is `{{gameModule}}`, exporting `{{gameModule}}_API`.

In scope:

- C++ under `{{projectRoot}}/Source/{{gameModule}}/`, the test module beside it, `Plugins/`, build scripts, `*.Build.cs`, `*.Target.cs`.
- Test-first development where the code is testable.
- Building with `{{buildScript}}` and running automation tests.

Out of scope:

- `.uasset` / `.umap` edits, documentation-only tasks, tasks with no code change.
- Unreal Editor state, Blueprint graphs and asset inspection — that is the pack's editor/MCP capability, not this page.
- CLI and source-sync work, which belongs to the repository that owns the concern (`.cadet/agent/core/RepositoryRoleBoundary.md`).

## Commands

| Task | Command |
|---|---|
| Build the editor target | `{{buildScript}}` |
| Clean build | `{{buildScript}} --clean` |
| Build, then run automation tests | `{{buildScript}} --test` |
| Run the automation suite on its own | `{{testCommand}}` |
| Read readable strings out of a binary asset without opening the editor | `grep -a '<regex>' <asset>.uasset` — on the named asset only |
| Ask the live editor something (scene state, a graph, a log) | the MCP toolset in [mcp.md](mcp.md); this page adds no driver of its own |
| Play the change by hand before calling it done | the editor's own Play session, or the PIE tool the MCP page names |

Run every command from `{{projectRoot}}`. When the project ships a build script, that script is the entry point: it carries the target, the platform and any cache the project depends on, and its flags are the project's own. A project with no script builds with the engine's `Build.bat` (or `Build.sh`) and the arguments in [README](README.md) — and then there is no `--clean` or `--test` flag to reach for; run the test command separately.

## Conventions

1. Confirm the editor is closed before any build: ask the user directly and wait for explicit confirmation before `{{buildScript}}`, `{{buildScript}} --test`, `{{buildScript}} --clean`, or any `UnrealEditor.exe` launch. DLLs cannot be overwritten while the editor holds them, and there are no exceptions.
2. Restart the editor after `.ini` changes, module rebuilds, plugin enable/disable, and `.Build.cs` changes — ask the user to close it first.
3. Build after every discrete change, down to a single file, method or script edit.
4. Run the tests covering the touched area after every build, and report pass/fail counts with reasons.
5. Write the failing test before the implementation for new C++ code (`.cadet/agent/core/skills/TDD.md`); the only exceptions are build files, `.ini`, and Blueprint reparenting.
6. Treat a previously passing test that now fails as a regression and fix it before doing anything else; a failing new test with the rest green is the expected red phase.
7. Run a PIE smoke test for any player-observable change — gameplay, save/load, UI, Blueprint graph — without waiting to be asked, because PIE is the ground truth an automation test cannot give; skip only when no runnable path exists, and say so explicitly.
8. Shape a slice as one user-observable behaviour, completable in one session, small enough for a focused review; ask up front for step-by-step collaboration or document-first review, defaulting to step-by-step.
9. Stop at the end of each slice and hand control back with what changed, why that approach, what is verified, what is not, and the next slice (`.cadet/agent/core/skills/CodeReview.md`).
10. Use `{{gameModule}}` as the module name and `{{gameModule}}_API` as its export macro.
11. Put tests in `{{projectRoot}}/Source/{{gameModule}}Tests/Private/<Class>Tests.cpp` using `IMPLEMENT_SIMPLE_AUTOMATION_TEST`.
12. Name automation tests `{{gameModule}}.Unit.<Subsystem>.<Class>.<Behavior>` with flags `EditorContext | ProductFilter`.
13. Mark Blueprint-facing types explicitly: `UCLASS(ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))`, `UFUNCTION(BlueprintCallable)`, `UPROPERTY()`.
14. Include engine headers in angle brackets (`<CoreMinimal.h>`, `<Widgets/SCompoundWidget.h>`) and plugin headers in quotes (`"MyHeader.h"`).
15. Never use umbrella includes — `#include "Slate.h"` and `#include "Widgets.h"` pull deep ThirdParty dependencies that may be absent from the compile database, which surfaces as a missing `verse_local_allocator_ue.h` or similar; include the specific widget header instead (`Widgets/Text/STextBlock.h` for STextBlock, `Widgets/Input/SButton.h` for SButton).
16. Include `Widgets/SBoxPanel.h` for `SVerticalBox` and `SHorizontalBox` — a "type not found" error there means the box header is missing, not an individual layout header.
17. Wrap `SButton` in an `SBorder` or `SBox` for padding and alignment: `SButton::FArguments` exposes `.Text()`, `.OnClicked()`, `.ToolTipText()` and friends but no `.Padding()`, `.HAlign()` or `.VAlign()` — put those on the parent slot.
18. Prefer short explicit widget hierarchies (`SVerticalBox` → `SBorder` → `SHorizontalBox` with `.AutoHeight()`, `.AutoWidth()`, `.FillWidth()`) over deep nesting.
19. Avoid `SWindow` properties that may not exist in the current engine version — `.SizingRule(ESizingRule::Fixed)` is one; stick to documented properties such as `.ClientSize()` and `.Title()`.
20. Fall back to `UE_LOG(LogTemp, Warning, TEXT("message"))` or an in-widget `STextBlock` when notification headers are unavailable or have moved.
21. Scope a binary string search to the assets you named. Pointing it at `Content/` or `{{projectRoot}}` walks many gigabytes and leaves stray `grep`/`find` processes behind.
22. Git discipline is core, not pack business: the approval rule, the branch rule, the per-repository staging rule and the commit trailer live in `.cadet/agent/core/GitFirstRule.md` and in the directive. This pack adds nothing to them.
23. Stop at the end of each slice and hand control back with what changed, what is verified and what is not — the report shape is in `.cadet/agent/core/skills/CodeReview.md`.

## Verification

- **Build clean** — `{{buildScript}}` exiting without compile errors proves the change builds against the editor target for the current engine version; the artifact is the compile log plus freshly linked editor binaries, and a failing build leaves the error list to fix before anything else proceeds.
- **Automation suite** — `{{testCommand}}` (or `{{buildScript}} --test`) proves the area still matches its existing expectations and that the new test exercises the change; the artifact is the automation run report with pass/fail counts and failure names, which you quote with reasons.
- **Red phase** — exactly one new test failing while the rest pass proves the test actually reaches the unimplemented path rather than passing vacuously; the artifact is a run report showing that single expected failure.
- **Regression check** — a test that passed before and fails now proves the change broke existing behaviour; the artifact is the failing test name, and the repair precedes any new work.
- **PIE smoke run** — playing the change in a running editor proves the player-observable behaviour works where automation cannot reach; the artifact is a written record of what was played and what was observed, routed through `.cadet/agent/core/skills/VisualEvidence.md` when the evidence is visual.
- **Editor restart confirmation** — the user's explicit confirmation that the editor was closed and reopened proves the module, plugin or `.ini` change is actually loaded; the artifact is that confirmation in the transcript before the build ran.
- **Slate include audit** — a compile log free of missing ThirdParty-header errors and `SVerticalBox`/`SHorizontalBox` "not found" errors proves the includes are explicit rather than umbrella; the artifact is the clean compile output.
- **Binary asset string search** — a `grep -a` match in a named `.uasset` proves a node name, function name or asset reference exists without opening the editor; the artifact is the matched line with its asset path, and the search is scoped to the assets you named.
