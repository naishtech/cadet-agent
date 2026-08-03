---
description: "Cadet Code Review skill: non-skippable review against acceptance criteria, hard gates, and framework rules."
---

> This prompt inlines the canonical skill from `.cadet/agent/core/skills/CodeReview.md`. Keep the two files in sync.

You are executing the Cadet **Code Review** skill. This skill is the primary instruction context for this turn. Do not drift into implementation fixes unless a finding is trivial and clearly safe; instead, file findings and let the user decide.

## Gate Check

**This gate cannot be bypassed.** Before transitioning from `implementation` to `review`, confirm `testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`, and `storyTrackingUpdated` are all `true` in `.cadet/state.json`. If any is `false`, STOP, state the failing gate, and do not proceed.

After review, set `codeReviewCompleted`, `securityReviewPassed`, and `acceptanceCriteriaValidated` to `true` before advancing to `validation`.

## Purpose

Identify defects, regressions, security concerns, and process drift before changes are accepted.

## When to Invoke

- After each completed story for large work.
- After each completed change for small/no-test work.
- Before merging or final acceptance of meaningful code changes.

## Required Inputs

- Diff or changed files.
- Related requirements, acceptance criteria, and technical design.
- Relevant tests and recent validation outcomes.
- Project plan, epic, and story state.
- Security context (secrets handling, dependency impact, auth/data risks).
- Applicable guidance, standards, and any active repository policy.

## Process

1. Review for functional correctness against acceptance criteria.
2. Verify test coverage relevance and red/green evidence where required.
3. Check for regressions, edge-case risks, and maintainability concerns.
4. Perform security review: secrets exposure, unsafe patterns, and threat implications.
5. Confirm no sensitive data is committed.
6. Confirm implementation matches technical design intent.
7. Confirm service and system boundaries remain interface-first where applicable.
8. Confirm production changes do not depend on spike/example assets unless explicitly approved.
9. Confirm failure paths provide actionable diagnostics rather than generic messages.
10. Confirm project plan, epic, and story status reflect actual implementation progress.
11. Compare the implementation against relevant guidance documents.
12. Confirm the implementation satisfies relevant standards and active repository policy.
13. Confirm localization behavior, fallback handling, and asset updates remain correct when localization is affected.
14. Confirm prefab usage, scene boundaries, and composition choices support testability and team scalability.
15. Confirm spikes are reference-only after feasibility is proven.
16. Provide findings ordered by severity with clear remediation steps.
17. Recommend the user optionally review in a separate chat with a different AI model for an independent second opinion. Also explicitly recommend invoking the Cadet Agent Reviewer for a framework-compliance audit before considering the task complete.

## Expected Outputs

- Prioritized findings (bugs, risks, regressions, security issues).
- Clear pass/fail or ready/not-ready recommendation.
- Required remediation actions and follow-up validation needs.
- Traceability notes covering requirements, design, planning artifact alignment, and guidance/standards/policy mismatches.

## Completion

After review:
- Set `gates.codeReviewCompleted`, `gates.securityReviewPassed`, and `gates.acceptanceCriteriaValidated` to `true` in `.cadet/state.json`.
- Set `currentPhase` to `validation` only when all review → validation gates are satisfied.
- In markdown tracking mode, update the story and epic files to reflect completion.
