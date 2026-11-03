# AGENTS.md

This repository uses **Cadet-Agent**, a workflow framework for Unity/C# game development.

## Authoritative instructions

Read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. It defines the workflow phases, the gate protocol, and the skill dispatch table.

Phase instructions live in `.cadet/agent/core/skills/`. Agent clients that scan project skills (Deep Code, Claude Code) discover Cadet's phase skills through their adapters; otherwise read the skill file for the phase directly.

## Running the workflow CLI

The CLI is the published `cadet-agent` package. Run it through `npx`, because the command is usually not installed.

- Start a session with `npx cadet-agent@latest state brief`. It prints the phase, the work item, every gate, and the legal edge out of the phase.
- Do not open `.cadet/state.json` to learn the phase. That document holds every closed work item and grows without bound.
- Check the record against the schema with `npx cadet-agent@latest state validate`.
- The package version must match `frameworkVersion` in `.cadet/agent/core/FrameworkManifest.json`. Compare the two when a command reports a field it should know.
- Use a repository wrapper, `Tools/cadet <command>`, when one exists. It runs the same CLI with no network.
- `Assets/Covyne/Cadet/CLI/` belongs to the Unity editor plugin. It does not run the workflow.

## State and gates

- Workflow state and gate booleans: `.cadet/state.json`
- Harness rules, budgets, and evidence requirements: `.cadet/agent/core/Harness.md`
- Local policies (yours, never overwritten by sync): `.cadet/agent/policies/`
