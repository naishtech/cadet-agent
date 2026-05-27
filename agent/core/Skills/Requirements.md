# Purpose

Define how Cadet-Agent captures, validates, and maintains requirements so implementation stays aligned with user goals and acceptance criteria.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Objective
Produce clear, testable requirements that drive technical design, planning artifacts, and implementation without ambiguity.

## When To Use
- Use for large or cross-component changes.
- Use when end-to-end behavior must be validated.
- Use when scope is unclear and needs structured clarification.
- Skip as a separate artifact for small changes when the workflow allows test-first implementation directly.

## Required Inputs
- User problem statement and intended outcome.
- Relevant learner tier or a working learner assumption when explanation depth matters.
- Constraints, deadlines, and non-functional requirements.
- Current system context and impacted components.
- Known risks, assumptions, and dependencies.
- Preferred document location, or the workspace default if a local policy defines one.

## Process
1. Confirm whether the change is large and requires a requirements document.
2. Capture requirements in markdown with Given/When/Then acceptance criteria.
3. Walk the user through each acceptance criterion at a depth that matches the learner tier unless they explicitly request end-only review.
4. Validate each criterion is testable and maps to an expected outcome.
5. Run an ambiguity scan after initial requirement or plan drafting.
6. Ask user permission before running one-by-one clarification questions with clickable options.
7. Resolve ambiguities through concise single-question prompts and update artifacts immediately.
8. Finalize requirements and hand off to technical design.
9. Ensure downstream project plan and epic tasks trace back to the finalized criteria.
10. If acceptance criteria change later, propagate updates to technical design, project plan, and epic tasks before continuing implementation.
11. Record scope changes and descopes in document history.

## Expected Outputs
- Requirements markdown document with Given/When/Then acceptance criteria.
- Learner-context notes when explanation depth materially affects the requirements conversation.
- Scope boundaries, assumptions, dependencies, and exclusions.
- Traceability notes linking criteria to design and planned tasks.
- Change-history entries for revisions, descopes, and re-prioritization.

## Success Criteria
- Every acceptance criterion is clear, testable, and approved by the user.
- Requirements are synchronized with technical design, project plan, and epic tasks.
- Changes in scope are reflected consistently across all related planning artifacts.
- Requirements are actionable enough to begin TDD-aligned implementation.
- Ambiguities were explicitly reviewed and resolved through user-approved clarification flow.

## Common Pitfalls
- Writing broad requirements that cannot be tested.
- Skipping user confirmation for ambiguous criteria.
- Letting requirements drift from design and task breakdown.
- Failing to document descopes and change history.
- Treating small-change work as a large requirements exercise unnecessarily.

---
