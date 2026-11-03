# Verification — Unity pack

What proves a Unity change is good, and what the record must carry.

## What this page covers

The three gates a Unity project can automate, the signal that settles each one, and the fallback when the editor or its CLI is not available.

## Commands

| Gate | Command | Success |
|---|---|---|
| `testsPassed` | `unity test <project> --format json` | exit `0` and envelope `success: true` |
| `compileCheckConfirmed` | `unity build <project> --target StandaloneWindows64 -o <out> --format json` | exit `0` |
| `compileCheckConfirmed` (running editor) | `unity command --project-path <root> eval "return !UnityEditor.Compilation.CompilationPipeline.isCompiling"` | eval `true` |
| `unityAnalyzerClean` | `unity run <project> --command <analyzer-cmd> --format json` | exit `0` and zero `UNT*` in `data` |

## Choosing the compile signal

A batch build is the strongest proof: it compiles the player target from the project as it stands, with no editor session involved. Prefer it.

The eval form asks a running editor whether it is still compiling, which answers "is the editor idle" rather than "does the project compile". Use it when the editor must stay open, and say in the evidence which signal you used — the three are not equivalent, and only one of them proves the player compiles.

## The analyzer gate

- The analyzer is a project `[CliCommand]`, named in `.cadet/harness.json` as `analyzerCommand`. It must be declared before the gate can be automated.
- Zero `UNT*` in the returned data is the pass. One diagnostic, in any changed file, is a fail.
- Do not enumerate the analyzer rules by hand, and do not suppress a diagnostic to clear the gate. A suppression is a decision about the code, and it belongs in the review.

## When automation is unavailable

The editor CLI may be absent, or the project may have no build script. Then:

1. Ask the user to focus the editor and report whether it compiled cleanly.
2. Record a `manual-confirmation` for `compileCheckConfirmed` with the project path, the editor version, the timestamp and what it covers.
3. State the reason automation was unavailable. A manual record is a weaker claim, and the record says so.

A command that never launched — the CLI missing, the editor at the wrong version — is `blocked`, not a failure. Retrying a missing interpreter does not make it appear.

## Rules

1. **Focus is not optional.** Unity compiles when the editor regains focus. A compile check taken while the window is in the background can report the previous build as current.
2. **Wait for the import.** A new asset is imported after the compile; a scene that references it can fail to load until the import finishes. Check the console for errors before recording a pass.
3. **Keep the report.** The command's report is the evidence: path, hash, and the exit code. The harness binds it to the work item and the input tree.
4. **Do not hand-edit a gate.** Record evidence with `cadet-agent harness verify` or `cadet-agent harness confirm`; a `true` written by hand is rejected at the transition.
5. **A green build is not a green feature.** The build proves it compiles; a visual or interactive claim needs the Visual Evidence skill and an artifact from the running game.
