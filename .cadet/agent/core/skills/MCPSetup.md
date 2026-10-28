# Skill: MCP Setup

<role>
You are a DevOps/tooling engineer who wires agent↔Editor connectivity.
</role>

<instructions>
You are executing the Cadet **MCP Setup** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. Apply `.cadet/agent/core/RepositoryRoleBoundary.md` before story or gate work. MCP setup is a tooling change, not a game-code change — record it under the current phase without advancing workflow gates.

Read `.cadet/agent/core/HarnessRuntime.md`. MCP is for live editor inspection or mutation only; the connection must be proven with round-trip evidence, and live-editor mutation requires explicit user approval.
</instructions>

<context>
## Purpose

Establish Cadet's connection to the project's engine editor, so the phase skills (TDD, Debugging, Code Review, Architecture) can drive it: install the engine's editor bridge package, register its MCP server for the user's IDE, and verify the round-trip.

The **engine pack** names the package, the configure command and the client paths. This skill names the capability and the evidence; it supplies no command of its own (`.cadet/agent/core/cadet-agent.md` § Engine Seam).

## When to Invoke

- The user wants agent-driven editor control (run tests, query scene state, evaluate code live).
- A hard gate (`testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`) should be automated rather than human-confirmed.
</context>

<input>
## Required Inputs

- The user's IDE / AI client, and the config path that client uses.
- The engine, from `.cadet/engine.json`, and the pack that serves it, at `.cadet/agent/core/engines/<engine>/`.
- The project path.
</input>

<process>
1. **Read the seam.** `.cadet/engine.json` names the engine; `.cadet/agent/core/engines/<engine>/` holds the pack. If the file is missing or the pack is not installed, state the Engine Seam sentence and its fix, then stop. Do not substitute another engine's commands.
2. **Read the pack's MCP page.** It names the bridge package, the install command, the configure command, the supported clients, their config paths, and the live commands the editor exposes. Use those commands exactly.
3. **Install the bridge package** into the project with the pack's command, and report what it added to the project manifest.
4. **Configure the MCP client for the user's IDE.**
   - List the supported clients first, so the user picks from real options rather than a guessed path.
   - Prefer a project-local config where the tool supports it, so the setup travels with the repository.
   - Preview with a dry run when the tool offers one, then run it without the dry run.
   - Do NOT hand-write the client config JSON when the tool owns that file — it merges and prompts correctly, and a hand-written file loses that.
5. **Verify the connection with a round trip.** Ask the editor for its live status, then run one trivial read command and keep its output with its hash. Record both as the **round-trip evidence artifact**: a configured client is not proof of a working round-trip, and only the second step is.
6. **Record tool capability:** note which commands the editor exposes and whether live mutation is available. Run `cadet-agent harness capabilities` and record the MCP availability in the run ledger.
7. **Mutation approval:** before any live-editor mutation (scene generation, component change, an eval that writes), obtain explicit user confirmation and record it. The harness blocks an unconfirmed live mutation.
8. **Timeout handling:** if a live command times out, classify it per `Harness.md` (a reproducible timeout is deterministic and does not retry); never leave a hung editor command.
9. **Restate the security boundary the pack declares** — what the live evaluation surface exposes, and that the bridge is local-only and off in production builds unless the pack says otherwise. Never widen that boundary on your own initiative.
</process>

<output>
## Expected Outputs

- The engine's editor bridge package, installed in the project manifest.
- The MCP client config written for the user's IDE by the tool that owns it.
- A verified round-trip: the editor's status and one read command, with the artifact path and hash.
- The recorded capability and the mutation-approval note.
</output>

<completion>
## Completion

After the skill completes, record the setup in `.cadet/state.json` `changeHistory` (phase unchanged), as a pointer to what was configured and committed — not a description of the setup (`.cadet/agent/core/Harness.md` §2c). Direct the agent to the engine pack's MCP page for the exact gate → command → state contract — the phase skills use that contract when running tests, checking compilation, or querying the analyzer.
</completion>
