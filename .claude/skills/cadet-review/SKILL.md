---
name: cadet-review
description: Non-skippable review against acceptance criteria, hard gates, and framework rules. Invoke after each completed story.
---

You are executing the Cadet **Code Review** skill. This skill is the primary instruction context for this turn. Do not drift into implementation fixes unless a finding is trivial and clearly safe; instead, file findings and let the user decide.

## Gate Check

**This gate cannot be bypassed.** Before transitioning from `implementation` to `review`, confirm `testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`, and `storyTrackingUpdated` are all `true` in `.cadet/state.json`. If any is `false`, STOP, state the failing gate, and do not proceed.

After review, set `codeReviewCompleted`, `securityReviewPassed`, and `acceptanceCriteriaValidated` to `true` before advancing to `validation`.

## Primary Context

Read `.cadet/agent/core/cadet-agent.md` for the global directive, then read `.cadet/agent/core/skills/CodeReview.md` as the primary instruction context. Follow every step in that skill file — it defines the complete 15-step review process, required inputs, and expected outputs.

## Completion

After review completes, update `.cadet/state.json`:
- Set `codeReviewCompleted` to `true`.
- Set `securityReviewPassed` to `true`.
- Set `acceptanceCriteriaValidated` to `true`.
- Advance `currentPhase` to `validation`.
