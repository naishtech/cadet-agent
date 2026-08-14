# Unity CLI — Capability Reference

Full rationale for how Cadet uses the Unity CLI and the Unity MCP server. The condensed canonical lives at `.cadet/agent/core/UnityCli.md`; keep the two in sync.

## Two modes: CLI commands vs MCP

The Unity CLI has two distinct surfaces. The choice depends on whether the task is **deterministic** (needs a reliable exit code, no AI reasoning) or **cognitive** (needs the agent to inspect, reason about, or modify the live project).

### CLI commands — deterministic automation

Use standard CLI commands for scripts, automation, and deterministic tasks:

- **CI/CD build pipelines** — headless builds, automated NUnit test suites, asset-bundle export on a remote server.
- **Project management & setup** — package installation via UPM, headless service-account auth, editor install (no Hub UI).
- **Deterministic macros** — batch-process assets, import textures, generate data files.
- **Low-resource / remote environments** — SSH into a machine with no GUI.

### MCP mode — AI inspection and reasoning

Use `unity mcp` when an AI agent needs deep context about the live project:

- **Agentic workflows** — read scene hierarchies, locate GameObjects, examine active components.
- **Live scene generation** — generate, position, and configure objects directly in the active scene.
- **Context-aware debugging** — pass live runtime logs, compiler errors, and inspector state to an LLM.
- **Semantic code navigation** — search C# by meaning, not text.

### Decision rule

| Task type | Mode |
|---|---|
| Verification gates (`testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`) | **CLI commands** (deterministic exit codes / structured output) |
| Inspection, reasoning, understanding, scene generation | **MCP mode** (deep, live context) |

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
| `unity mcp configure <client>` | Write MCP config for a client (`--list`, `--local`, `--yes`, `--dry-run`) |
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

---

## Backlinks
- Docs index: [index](../index.md)
