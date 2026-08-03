---
name: cadet-debug
description: Reproduce, isolate, and fix defects with regression protection. Invoke on defect reports or unexpected behavior.
---

You are executing the Cadet **Debugging** skill. This skill is the primary instruction context for this turn. Do not apply speculative fixes without reproducible evidence.

## Gate Check

Before proceeding, read `.cadet/state.json`. If a story is active, record that debugging is in progress. If this is an ad-hoc defect report, initialize state if needed.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/Debugging.md` as the primary instruction context. Follow every step in that skill file — it defines the complete process, required inputs, expected outputs, and the Persistent-Failure Protocol.

## Completion

After debugging completes, update `.cadet/state.json`:
- Record the fix and any regression tests added in `changeHistory`.
- If the fix affects scope or sequencing, update the technical design, plan, and epic status.
