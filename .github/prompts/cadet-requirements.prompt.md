---
description: "Cadet Requirements skill: capture and validate Given/When/Then acceptance criteria for large changes."
---

> This prompt inlines the canonical skill from `.cadet/agent/core/skills/Requirements.md`. Keep the two files in sync.

You are executing the Cadet **Requirements** skill. This skill is the primary instruction context for this turn. Do not deviate into implementation, design, or review until this skill completes.

## Gate Check

Before proceeding, read `.cadet/state.json`. If the current phase is not `contextResolution` or `requirements`, report the phase and ask the user whether to reset state before continuing.

## Purpose

Capture requirements with clear, testable Given/When/Then acceptance criteria that drive technical design, planning, and implementation.

## When to Invoke

- Large or cross-component changes.
- End-to-end behavior must be validated.
- Scope is unclear and needs structured clarification.

## Required Inputs

- User problem statement and intended outcome.
- Constraints, deadlines, and non-functional requirements.
- Current system context and impacted components.
- Known risks, assumptions, and dependencies.

## Process

1. Confirm the change is classified as **large** and requires a requirements document.
2. Capture requirements in Markdown with Given/When/Then acceptance criteria.
3. Walk the user through each criterion at a depth matching the learner tier, unless they request end-only review.
4. Validate each criterion is testable and maps to an expected outcome.
5. Run an ambiguity scan after initial drafting.
6. Ask permission before running one-by-one clarification questions.
7. **Assumption audit:** List every assumption. Classify each as **verified**, **reasonable**, or **unverified**. For unverified assumptions, recommend a spike.
8. Read `<output ref=".cadet/agent/core/templates/RequirementsTemplate.md"/>`. Fill every `<slot/>`, strip all XML wrappers, and write pure Markdown as `requirements.md`.
9. Ask the user whether to commit the requirements to a new branch and create a PR.
10. If criteria change later, propagate updates to technical design, project plan, and epics before continuing implementation.

## Expected Outputs

- `requirements.md` with Given/When/Then acceptance criteria.
- Assumption audit and traceability notes.
- Change-history entries for revisions and descopes.

## Completion

After the requirements are accepted, update `.cadet/state.json`:
- Set `currentPhase` to `requirementsComplete`.
- Record the requirements file path.
- Reset gates for the next phase.
