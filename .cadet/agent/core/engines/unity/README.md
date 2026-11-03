# Unity — engine pack

The Unity commands and conventions that the engine-neutral phase skills defer to. A phase skill says *run the project's test command*; this pack says `unity test <project> --format json`.

Read `.cadet/engine.json` first. It names the engine and carries the paths this pack assumes:

| Field | Meaning here |
|---|---|
| `engine` | `unity`, or `unity` as the primary when both packs are installed |
| `unity.pluginRoot` | `Assets/Covyne/Cadet` — the installed tooling |
| `unity.cliRoot` | `Assets/Covyne/Cadet/CLI` — the CLI scripts this pack invokes |
| `unity.editorVersion` | the editor the project is on, read from `ProjectSettings/ProjectVersion.txt` |

If `.cadet/engine.json` is missing, or names another engine, do not use the commands below. State the Engine Seam sentence in `.cadet/agent/core/cadet-agent.md` and stop.

## The four capabilities

A phase skill names a capability; this table names the command. The detail, the exit codes and the evidence each one leaves are in [cli.md](cli.md) and [verification.md](verification.md).

| Capability | Command | Notes |
|---|---|---|
| build | `unity build <project> --target <target> -o <out> --format json` | `--target` or `--profile` is required; a batch build is the compile proof |
| test | `unity test <project> --format json` | Edit Mode and Play Mode in one run; writes a NUnit/JUnit report |
| verify | `unity run <project> --command <analyzer-cmd> --format json` | the analyzer command is a project `[CliCommand]`; it feeds `unityAnalyzerClean` |
| run | `unity run <project>` | batch-mode run; for a visual claim, `unity open <project>` and Play |

The project is a **positional** argument on `test`, `build` and `run`, or comes from `UNITY_PROJECT_PATH`. `--project-path` is a flag only on the connected-Editor commands.

## Pages

| Page | Read it when |
|---|---|
| [cli.md](cli.md) | you need the command inventory, the output envelope or the gate → command → state contract |
| [testing.md](testing.md) | you are writing or running tests |
| [coding.md](coding.md) | you are writing C# that the editor imports |
| [verification.md](verification.md) | you are proving a change compiles or is clean, and recording the evidence |
| [mcp.md](mcp.md) | the agent must drive a live editor |
| [patterns.md](patterns.md) | you are choosing an implementation shape, or adding user-facing text |

## Conventions that hold across the pack

- **Focus the editor for a recompile after a code change.** Unity compiles when it regains focus. Ask the user to focus the window, and wait for the compile to finish before you claim it passed.
- **The editor owns the asset files.** A `.meta` file, a scene and a prefab are text, but their GUIDs and their import settings are the editor's. Edit them by script only when no editor step exists, and never by hand-crafting a GUID.
- **A batch build and the editor share the project lock.** Do not run a build while the editor holds the project open in another mode; the second process fails on the lock.
- **Prefer the project's own scripts.** A repository that already has a build or test script owns the invocation; use it and let this pack explain the exit codes.
