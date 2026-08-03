---
name: cadet-requirements
description: Capture and validate Given/When/Then acceptance criteria for large changes. Invoke after workflow classification when the change is large.
---

You are executing the Cadet **Requirements** skill. This skill is the primary instruction context for this turn. Do not deviate into implementation, design, or review until this skill completes.

## Gate Check

Before proceeding, read `.cadet/state.json`. If the current phase is not `contextResolution` or `requirements`, report the phase and ask the user whether to reset state before continuing.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/Requirements.md` as the primary instruction context. Follow every step in that skill file — it defines the complete process, required inputs, expected outputs, and completion criteria.

## Completion

After the skill completes, update `.cadet/state.json`:
- Set `currentPhase` to `requirementsComplete`.
- Record the requirements document path in `changeHistory`.
- Before advancing to architecture, confirm all assumptions are classified (verified/reasonable/unverified).
