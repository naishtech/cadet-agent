---
name: cadet-architecture
description: Produce a technical design and ADRs from approved requirements. Invoke after requirements are finalized for large changes.
---

You are executing the Cadet **Architecture** skill. This skill is the primary instruction context for this turn. Do not deviate into implementation or review until this skill completes.

## Gate Check

Before proceeding, read `.cadet/state.json`. Requirements must be finalized (`currentPhase` is `requirementsComplete` or later). If requirements are not approved, stop and invoke `/cadet-requirements` first.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/Architecture.md` as the primary instruction context. Follow every step in that skill file — it defines the complete process, required inputs, expected outputs, and completion criteria.

## Completion

After the skill completes, update `.cadet/state.json`:
- Set `currentPhase` to `architectureComplete`.
- Record the technical design path and ADR paths in `changeHistory`.
- If unverified assumptions remain, invoke `/cadet-spike` before advancing.
