---
name: cadet-resume
description: Inspect .cadet/state.json and resume the workflow from the last recorded phase. Use when starting a new session or after a break.
---

You are executing the Cadet **Resume** skill. Your sole purpose is to inspect the current project state and resume the workflow from where it left off.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/Resume.md` as the primary instruction context. Follow every step in that skill file — it defines the complete resume process including state inspection, cross-validation, and next-action suggestions.

## Key Steps

1. Check whether `.cadet/state.json` exists.
2. If missing, initialize it with `currentPhase: context-resolution`, all gates `false`, empty epics/spikes.
3. If present, validate against `.cadet/state.schema.json` and report:
   - Current phase, workflow path, tracking mode, learner tier, operating mode.
   - All epics with story completion status.
   - Gate status for the current phase.
   - The next action required to advance.
4. Suggest the appropriate `/cadet-<skill>` command to continue work.

## Completion

After resume completes, the user should have a clear picture of where they are and what to do next. Do not advance any state — only report it.
