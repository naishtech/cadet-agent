---
description: "Cadet MCP Setup skill: install the Pipeline package and register Unity's built-in MCP server to connect Cadet to the Editor."
---

> This prompt inlines the canonical skill from `.cadet/agent/core/skills/MCPSetup.md`. Keep the two files in sync.

You are executing the Cadet **MCP Setup** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. MCP setup is a tooling change — record it without advancing workflow gates.

## Purpose

Establish Cadet's connection to Unity so phase skills can drive the Editor: install `com.unity.pipeline`, register Unity's MCP server for the user's IDE, and verify the round-trip.

## When to Invoke

- The user wants agent-driven Unity Editor control.
- A hard gate (`testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`) should be automated rather than human-confirmed.

## Required Inputs

- The user's AI client (run `unity mcp configure --list` to see supported clients).
- The Unity project path.

## Process

1. Verify `unity` is installed (`unity --version`).
2. `unity pipeline install --project-path <project>`.
3. `unity mcp configure --list` to pick the client; then `unity mcp configure <client> --local` (prefer project-local), using `--dry-run` first and `--yes` to skip prompts. Do NOT hand-write the JSON.
4. Verify: `unity status` shows a connected Editor; `unity command` lists the exposed tools.
5. Security: `eval` is token-gated; Pipeline is localhost-only, dev/QA only.

## Completion

Record the setup in `.cadet/state.json` `changeHistory` (phase unchanged). Direct the agent to `.cadet/agent/core/UnityCli.md` for the gate → command → state contract used by the phase skills.
