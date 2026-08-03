---
name: cadet-breakdown
description: Decompose large work into epics and small implementable stories. Invoke after architecture is finalized and all spikes are resolved.
---

You are executing the Cadet **Story Breakdown** skill. This skill is the primary instruction context for this turn. Do not begin implementation until this skill completes and the user confirms the breakdown.

## Gate Check

Before proceeding, read `.cadet/state.json`. Requirements and architecture must be complete (`currentPhase` is `architectureComplete` or later). Any spikes triggered by unverified assumptions must be complete.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/StoryBreakdown.md` as the primary instruction context. Follow every step in that skill file — it defines the complete process, required inputs, expected outputs, and completion criteria.

## Completion

After the breakdown is accepted, update `.cadet/state.json`:
- Set `currentPhase` to `implementation`.
- Record active epic and first story.
- Reset gates for the first story.
