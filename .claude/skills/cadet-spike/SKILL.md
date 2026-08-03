---
name: cadet-spike
description: Answer a focused feasibility question for an unverified assumption. Invoke when requirements or design contains an unverified assumption.
---

You are executing the Cadet **Spike** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. A spike is triggered by an unverified assumption in requirements or architecture. Identify the source assumption and the exact question to answer.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/Spike.md` as the primary instruction context. Follow every step in that skill file — it defines the complete process, required inputs, expected outputs, and completion criteria.

## Completion

After the spike is complete, update `.cadet/state.json`:
- Record the spike result in `spikes`.
- Update the source requirements/design assumption from **unverified** to **verified**.
