# Unity CLI — Capability Reference

Single source of truth for when Cadet uses the Unity CLI (`unity`) and how its commands map onto the framework's hard gates. This file is canonical; skills and adapters must reference it, not duplicate it.

## Two modes: CLI commands vs MCP

The Unity CLI has two distinct surfaces. Use the right one for the task:

| Mode | Use when | Examples |
|---|---|---|
| **CLI commands** | Deterministic, scriptable, exit-code-driven tasks — no AI reasoning needed | `unity test`, `unity build`, `unity run --command <analyzer>`, `unity install`, `unity open` |
| **MCP mode** (`unity mcp`) | The agent must inspect, reason about, or modify the live project | scene-hierarchy reads, GameObject/component lookup, live logs, semantic code search, live scene generation |

Rule of thumb:

- **Verification gates** (`testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`) are deterministic → always **CLI commands** (they return exit codes / structured output, not prose).
- **Inspection and reasoning** (debugging context, understanding the codebase, generating scene content) → **MCP mode** (deep, live project context).

Phase mapping:

- **TDD / Code Review** (gate checks) → CLI commands.
- **Debugging** → MCP mode for live context, plus CLI commands to reproduce (`unity test`).
- **Requirements / Architecture** (understanding the codebase) → MCP mode for semantic navigation.

## Command inventory (verified against Unity CLI v1.0.0-beta.4)

### Editors, modules, projects

| Task | Command |
|---|---|
| Install an Editor | `unity install <version-or-alias> -m <modules>` (`lts`, `latest`, or e.g. `6000.0.47f1`) |
| Add modules | `unity install-modules -e <version> -m <ids>` |
| List installed Editors | `unity editors -i --format json` |
| Create a new project (fresh folder only) | `unity projects new <name> --path <parent> --editor-version <ver>` |
| Register an existing project folder | `unity projects add <paths...>` |
| Open a project | `unity open <path>` |
| Ensure a project's editor is installed | `unity projects require <path>` |
| Sign in / status | `unity auth login` / `unity auth status` |
| Diagnose | `unity doctor` |

### Connected Editors and AI agents

| Command | Purpose |
|---|---|
| `unity mcp` | Start an MCP server for AI agents, or configure agent clients |
| `unity pipeline install` | Install `com.unity.pipeline` into a project |
| `unity command` / `unity cmd` | List or forward commands to a connected Editor |
| `unity list` | List tools a connected Editor registers, with parameter schema |
| `unity status` | Live state of connected Editors (port, project path, version, PID) |
| `unity command eval "<expr>"` | Evaluate C# in a running Editor/Player (live REPL) |
| `unity command eval_file <file>` | Evaluate a C# file |
| `unity command --runtime <player>` | Aim commands/eval at a dev Player build |

### CI / verification

| Command | Purpose |
|---|---|
| `unity test <project>` | Run Edit + Play Mode tests; write NUnit/JUnit report |
| `unity build <project>` | Batch-mode build (requires `--target` or `--profile`) |
| `unity run <project>` | Batch-mode run, or headless Editor command via `--command <name>` |

Note: `test`/`build`/`run` take the project as a **positional** argument (or `UNITY_PROJECT_PATH`). `--project-path` is a flag only on the connected-Editor commands (`command`, `list`, `mcp`).

## Automation contract

- Output: `--format human|tsv|json|ndjson` (`--json` shorthand). JSON envelope = `{ success, command, data, errors, warnings }`. Errors → stderr; results → stdout.
- Exit codes: `0` success · `1` general error · `2` usage · `3` auth · `4` config required · `6` primary operation failed (incl. **tests failed**) · `130` SIGINT · `143` SIGTERM.
- Env: `UNITY_NON_INTERACTIVE`, `UNITY_SERVICE_ACCOUNT_ID`/`SECRET`, `UNITY_PROJECT_PATH`, `UNITY_FORMAT`.

## Gate → command → state contract

Only three gates are automatable. The five process gates remain agent-owned.

| Gate (`state.json`) | Command | Success signal | Failure signal | State write |
|---|---|---|---|---|
| `testsPassed` | `unity test <project> --format json` | exit `0` + envelope `success: true` | exit `6`/`1`; parse the `--output` NUnit/JUnit report | set `true` only on success |
| `compileCheckConfirmed` | A) `unity build <project> --target StandaloneWindows64 -o <tmp>`; B) `unity run <project> --command <compile-check>`; C) `unity command --project-path <root> eval "return !UnityEditor.Compilation.CompilationPipeline.isCompiling"` | exit `0` (A/B); eval `true` (C) | exit `6`/`1`; eval `false` | set `true` only on the chosen signal |
| `unityAnalyzerClean` | `unity run <project> --command <analyzer-cmd> --format json` (project `[CliCommand]`) | exit `0` + zero `UNT*` in `data` | exit `6`/`1` or `UNT*` present | set `true` only when zero `UNT*` |

Non-automated (agent-owned): `storyTrackingUpdated`, `codeReviewCompleted`, `securityReviewPassed`, `acceptanceCriteriaValidated`, `designArtifactSyncConfirmed`.

Run-semantics (exit codes/signals on a real Editor run) and the project-defined `<analyzer-cmd>` are validated per-project at implementation time.

## Security

`unity command eval` is token-gated. Pipeline is localhost-only and off by default — dev/QA builds only, never production.
