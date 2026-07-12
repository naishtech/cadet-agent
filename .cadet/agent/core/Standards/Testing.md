# Purpose

Define testing standards for Unity and C# work so behavior is validated through reproducible evidence before and after change.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Standard Description
This standard enforces mandatory TDD where valid, reproduce-first defect handling, and layered automated testing using Unity Test Framework and related tooling. It ensures each relevant change is proven by tests mapped to acceptance criteria and planning artifacts.

## Rules
- TDD is mandatory where testing is feasible.
- Start with a failing test (red), implement minimal passing change (green), then refactor safely.
- Reproduce bugs before fixing them using failing tests or explicit user steps.
- Preserve regression tests for resolved defects.
- Map tests to acceptance criteria and implementation tasks.
- Use appropriate Unity test types: EditMode for logic-focused tests, PlayMode for runtime/integration behavior.
- For service-oriented systems, use interface-first test seams and mock-first validation.
- Create or update a base mock for each new interface and track method calls for behavioral verification.
- Keep tests deterministic and isolated from unrelated environment variability.
- Avoid live network stack execution in unit or integration tests when mock-based call verification is sufficient.
- For no-test-required work, provide explicit manual validation steps and request user confirmation.
- Report test outcomes clearly and update plan/design documents when behavior changes.
- When Unity validation is required, specify which tests the user should run and why.
- Do not run Unity tests directly unless the user explicitly asks.
- Request user Unity recompilation/focus when validation depends on Unity compile state.

## Validation Checklist
- Failing test or explicit reproduction exists before defect fix.
- Passing result confirmed after implementation.
- Test coverage updated for new behavior and edge cases.
- Unity test suites selected appropriately (EditMode or PlayMode).
- Regression protection retained for previously fixed issues.
- Test results are traceable to requirement IDs and task IDs.
- Mock behavior checks are used where they provide safer and faster verification than live runtime networking.
- Unity validation instructions were given clearly to the user before asking for results.
- Manual validation checklist provided when automated tests are not applicable.

## Common Violations
- Implementing behavior changes without prior failing tests when feasible.
- Fixing bugs without reproducible evidence.
- Deleting or weakening regression tests after bug resolution.
- Relying only on happy-path tests.
- Running tests only in Editor mode when runtime behavior requires PlayMode validation.
- Running live networking in tests where deterministic mock verification should be used.
- Running Unity tests without user request when user-executed validation was expected.
- Not communicating validation outcomes to the user.

## Review Questions
- What failed before the change, and how was that failure captured?
- Which tests now prove the behavior is correct?
- Are tests mapped back to acceptance criteria and planned tasks?
- Did we add or preserve regression coverage for this change?
- Did the strategy use interface-first and mock-first patterns where appropriate?
- If tests were not used, is manual validation explicit and confirmed by the user?

---
