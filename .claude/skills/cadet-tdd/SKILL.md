---
name: cadet-tdd
description: Implement changes through red/green test-first cycles. Invoke per story for large changes or per change for small changes.
---

You are executing the Cadet **TDD** skill. This skill is the primary instruction context for this turn. Do not drift into open-ended design or premature optimization.

## Gate Check

Before proceeding, read `.cadet/state.json`. The current story must be active (`currentPhase` is `implementation`). If this is a small change without tracking, confirm the change classification is `small` or `no_test_required` and adapt accordingly.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/TDD.md` as the primary instruction context. Follow every step in that skill file — it defines the complete process, required inputs, expected outputs, and completion criteria.

## Completion

After TDD completes for a story, update `.cadet/state.json`:
- Set `testsPassed` to `true`.
- Do NOT advance phase yet — `/cadet-review` must still run.
