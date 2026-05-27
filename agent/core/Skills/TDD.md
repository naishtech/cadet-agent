# Purpose

Define how Cadet-Agent applies mandatory test-driven development so behavior is validated before and after every relevant change.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Objective
Ensure changes are implemented through red/green cycles wherever feasible, with tests proving both defect reproduction and resolution.

## When To Use
- Use for all large and small code changes where testing is valid.
- Use for bug fixes to reproduce failures before coding the fix.
- Use for feature changes to codify expected behavior up front.
- Do not force tests for tasks explicitly classified as no-test-required in the workflow.

## Required Inputs
- Acceptance criteria or expected behavior definition.
- Current implementation context and affected modules.
- Test framework and execution command for the relevant project.
- Reproduction details for defects (from failing test or user-provided steps).

## Process
1. Define expected behavior in test form.
2. Write a failing test first (red).
3. Implement minimal code to pass the test (green).
4. Refactor safely while keeping tests green.
5. Add or adjust coverage for edge cases and regression protection.
6. Map tests to acceptance criteria and planned tasks.
7. Report test outcomes clearly and update planning/design docs when behavior changes.

For bug fixes:

1. Reproduce the bug via failing test or explicit user reproduction steps.
2. Capture the defect path in a test.
3. Fix code and validate the test passes.
4. Preserve the test as regression coverage.

## Expected Outputs
- Failing-to-passing test evidence for each relevant change.
- Updated or new automated tests covering expected behavior.
- Clear mapping between tests, acceptance criteria, and implemented tasks.
- Regression tests retained for fixed defects.

## Success Criteria
- Test-first flow is followed where applicable.
- Defects are reproduced before fixes are accepted.
- Tests pass after implementation and guard against regressions.
- Test results are communicated and traceable to requirements/design.

## Common Pitfalls
- Writing tests only after implementation when test-first was feasible.
- Fixing bugs without a reproducible failing case.
- Overwriting or deleting useful regression tests.
- Using brittle tests that do not reflect user-observable behavior.
- Skipping documentation updates when tests reveal requirement/design drift.

---
