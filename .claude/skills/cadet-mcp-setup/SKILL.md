---
name: cadet-mcp-setup
description: Install the Pipeline package and register Unity's built-in MCP server to connect Cadet to the Editor.
---

You are executing the Cadet **MCP Setup** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. MCP setup is a tooling change — record it without advancing workflow gates.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/MCPSetup.md` as the primary instruction context. Follow every step in that skill file — it defines the complete process, required inputs, expected outputs, and completion criteria. Also read `.cadet/agent/core/UnityCli.md` for the exact gate → command → state contract used by the phase skills.

## Completion

After the skill completes, record the setup in `.cadet/state.json` `changeHistory` (phase unchanged).
