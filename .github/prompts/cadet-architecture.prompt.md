---
description: "Cadet Architecture skill: produce a technical design and ADRs from approved requirements."
---

> This prompt inlines the canonical skill from `.cadet/agent/core/skills/Architecture.md`. Keep the two files in sync.

You are executing the Cadet **Architecture** skill. This skill is the primary instruction context for this turn. Do not deviate into implementation or review until this skill completes.

## Gate Check

Before proceeding, read `.cadet/state.json`. Requirements must be finalized (`currentPhase` is `requirementsComplete` or later). If requirements are not approved, stop and invoke the Requirements skill first.

## Purpose

Produce a technical design that translates approved requirements into implementable structure, including explicit TDD strategy and traceable task decomposition.

## When to Invoke

- Large changes, after requirements are finalized.
- Multiple components, systems, or integration points are affected.
- Architectural tradeoffs or technology choices must be justified.
- A new technology, pattern, or tool is being introduced.

## Required Inputs

- Finalized requirements with Given/When/Then acceptance criteria.
- Existing architecture constraints and dependency map.
- Performance, security, and delivery constraints.
- User preferences for tools/technology.
- Applicable guidance, standards, and any active repository policy.

## Process

1. Derive design decisions directly from approved acceptance criteria.
2. Define components, interfaces, data flow, and integration boundaries.
3. Evaluate technology options using the TechnologyDecisionFramework. Record each significant decision as an ADR under `.cadet/agent/project-plans/adr/`.
4. Include an explicit TDD red/green test strategy tied to acceptance criteria.
5. Identify architectural seams and test boundaries.
6. **Assumption audit:** List every design assumption. Classify each as **verified**, **reasonable**, or **unverified**. For unverified assumptions, recommend a spike.
7. Read `<output ref=".cadet/agent/core/templates/TechnicalDesignTemplate.md"/>`. Fill every `<slot/>`, strip all XML wrappers, and write pure Markdown as `technical-design.md`.
8. Ask the user whether to commit the technical design to a new branch and create a PR.
9. If design changes later, propagate updates to the project plan and epics before continuing.

## Expected Outputs

- `technical-design.md`.
- ADRs for significant decisions.
- Explicit red/green test strategy linked to acceptance criteria.
- Traceability to project plan phases and epic breakdown.

## Completion

After the design is accepted, update `.cadet/state.json`:
- Set `currentPhase` to `architectureComplete`.
- Record the design file path.
- Reset gates for the next phase.
