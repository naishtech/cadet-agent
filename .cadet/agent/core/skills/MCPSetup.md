# Skill: MCP Setup

<role>
You are a DevOps/tooling engineer who wires agent↔Editor connectivity.
</role>

<instructions>
You are executing the Cadet **MCP Setup** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. MCP setup is a tooling change, not a game-code change — record it under the current phase without advancing workflow gates.

Read `.cadet/agent/core/Harness.md`. MCP is for live Unity inspection or mutation only; the connection must be proven with round-trip evidence, and live-editor mutation requires explicit user approval.
</instructions>

<context>
## Purpose

Establish Cadet's connection to Unity so the phase skills (TDD, Debugging, Code Review, Architecture) can drive the Editor: install `com.unity.pipeline`, register Unity's built-in MCP server for the user's IDE, and verify the round-trip.

## When to Invoke

- The user wants agent-driven Unity Editor control (run tests, query scene state, evaluate C# live).
- A hard gate (`testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`) should be automated rather than human-confirmed.
</context>

<input>
## Required Inputs

- The user's IDE / AI client — run `unity mcp configure --list` to see the supported clients and their config paths.
- The Unity project path.
</input>

<process>
1. Verify `unity` is installed (`unity --version`). If absent, install the Unity CLI.
2. Install the Pipeline package: `unity pipeline install --project-path <project>`.
3. Configure the MCP client for the user's IDE:
   - `unity mcp configure --list` first, to show supported clients and their config paths.
   - Prefer project-local config where supported: `unity mcp configure <client> --local` (cursor, vscode).
   - Preview with `--dry-run`, then run without it; `--yes` skips the "already exists, update?" prompt.
   - Do NOT hand-write the config JSON — let `unity mcp configure` own the file (it merges and prompts correctly).
4. Verify the connection: `unity status` shows a connected Editor; `unity command` lists the commands the connected Editor exposes. Record a **round-trip evidence artifact** (the `unity status` output, or a trivial read command's result with its hash) — a configured client is not proof of a working round-trip.
5. **Record tool capability:** note which commands the Editor exposes and whether live mutation is available. Run `cadet-agent harness capabilities` and record the MCP availability in the run ledger.
6. **Mutation approval:** before any live-editor mutation (scene generation, component change, eval that writes), obtain explicit user confirmation and record it. The harness blocks an unconfirmed live mutation.
7. **Timeout handling:** if a live command times out, classify it per `Harness.md` (a reproducible timeout is deterministic and does not retry); never leave a hung Editor command.
8. Confirm the security boundary: `unity command eval` is token-gated; Pipeline is localhost-only and off by default (dev/QA builds only — never production).
</process>

<output>
## Expected Outputs

- `com.unity.pipeline` installed in the project manifest.
- The MCP client config written for the user's IDE (via `unity mcp configure`).
- A verified `unity status` / `unity command` round-trip.
</output>

<completion>
## Completion

After the skill completes, record the setup in `.cadet/state.json` `changeHistory` (phase unchanged). Direct the agent to `.cadet/agent/core/UnityCli.md` for the exact gate → command → state contract — the phase skills use that contract when running tests, checking compilation, or querying the analyzer.
</completion>
