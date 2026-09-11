# AGENTS.md

This repository uses **Cadet-Agent**, a workflow framework for Unity/C# game development.

## Authoritative instructions

Read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. It defines the workflow phases, the gate protocol, and the skill dispatch table.

Phase instructions live in `.cadet/agent/core/skills/`. Agent clients that scan project skills (Deep Code, Claude Code) discover Cadet's phase skills through their adapters; otherwise read the skill file for the phase directly.

## State and gates

- Workflow state and gate booleans: `.cadet/state.json`
- Harness rules, budgets, and evidence requirements: `.cadet/agent/core/Harness.md`
- Local policies (yours, never overwritten by sync): `.cadet/agent/policies/`
