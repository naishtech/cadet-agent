# Skill: TDD

<role>
You are a senior Unity/C# engineer who practices test-first development.
</role>

<instructions>
You are executing the Cadet **TDD** skill. This skill is the primary instruction context for this turn. Do not drift into open-ended design or premature optimization.

## Gate Check

Before proceeding, read `.cadet/state.json`. The current story must be active (`currentPhase` is `implementation`). If this is a small change without tracking, confirm the change classification is `small` or `no_test_required` and adapt accordingly.

Read `.cadet/agent/core/Harness.md`. TDD runs inside the harness: every red/green cycle produces evidence, retries are bounded, and `testsPassed` is satisfied only by fresh evidence.
</instructions>

<context>
## Purpose

Apply mandatory test-driven development so behavior is validated before and after every relevant change, with machine-checkable evidence for the `testsPassed` gate.

## When to Invoke

- Per story for large changes.
- Per change for small changes.
- For bug fixes to reproduce failures before coding the fix.
</context>

<input>
## Required Inputs

- Acceptance criteria or expected behavior definition, with an acceptance-criterion ID for each.
- Current implementation context and affected modules.
- Test framework and execution command for the project.
- Reproduction details for defects.
- The active run's remaining budget (`cadet-agent harness report`) and the retry limits from `.cadet/harness.json`.
</input>

<process>
1. Define expected behavior in test form at confirmed seams.
2. Write a failing test first (**red**). Record a red evidence record before any green claim.
3. Implement minimal code to pass the test (**green**).
4. **Verify through the harness, not by assertion:** run `cadet-agent harness verify --gate testsPassed` (or `npm test` / `unity test <project> --format json` for Unity). The result creates fresh evidence bound to the work item, input tree hash, and acceptance criterion.
5. Refactor safely while keeping tests green; re-run verification after every refactor.
6. Add or adjust coverage for edge cases and regression protection.
7. Map tests to acceptance criteria and planned tasks.
8. Report test outcomes clearly, including the evidence IDs that back each criterion.
9. If Unity code changed, ask the user to focus the Unity window and trigger recompilation; record a `manual-confirmation` for `compileCheckConfirmed` unless Unity CLI is available.

## Retry and stop rules

- A **red** record is required before a green `testsPassed` gate for any testable change, unless the work item is explicitly `no_test_required`.
- On failure, classify the result (deterministic / transient / repair / unknown) per `Harness.md`. Retry only a retryable class, within `maxRetriesPerStep` and `maxTotalRetries`. A deterministic failure (assertion, compile, analyzer, invalid input) never retries automatically.
- Every attempt is recorded; a retry never overwrites a failed attempt.
- On budget exhaustion, stop and escalate with the next required input.

For bug fixes:

1. Reproduce the bug via a failing test or explicit user reproduction steps (the red record).
2. Capture the defect path in a test.
3. Fix the code and validate the test passes (the green record).
4. Preserve the test as regression coverage.
</process>

<output>
## Expected Outputs

- Failing-to-passing test evidence: a red record and a green `testsPassed` record, each with command, exit code, artifact path/hash, input tree hash, and acceptance-criterion mapping.
- Updated or new automated tests covering expected behavior.
- Clear mapping between tests, acceptance criteria, and implemented tasks.
- Regression tests retained for fixed defects.
- Attempt history for any retried verification.
</output>

<completion>
## Completion

After tests pass:
- Set `gates.testsPassed` to `true` **only** when backed by the fresh green evidence record. Do not hand-edit the gate.
- Update the story markdown file if using markdown tracking.
- Do NOT transition to `review` until all implementation → review gates are satisfied and each is evidence-backed. Confirm with `cadet-agent state transition --to review` (dry-run style) or by reading `gateEvidence`.
</completion>
