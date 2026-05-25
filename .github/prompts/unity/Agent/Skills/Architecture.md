# Purpose

Define how Cadet-Agent produces technical designs that are fit-for-purpose, testable, maintainable, and synchronized with requirements and implementation.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Guidance reference: [../Guidance/ArchitecturePatterns](../Guidance/ArchitecturePatterns.md)
- Guidance reference: [../Guidance/UnityPatterns](../Guidance/UnityPatterns.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Objective
Create technical designs that translate approved requirements into implementable structure, including explicit TDD strategy and traceable task decomposition.

## When To Use
- Use after requirements are finalized for large changes.
- Use when multiple components, systems, or integration points are affected.
- Use when architectural tradeoffs or technology choices must be justified.
- Use when introducing a new technology, pattern, or tool.

## Required Inputs
- Finalized requirements with Given/When/Then acceptance criteria.
- Relevant learner tier or a working learner assumption when explanation depth matters.
- Existing architecture constraints and dependency map.
- Performance, security, and delivery constraints.
- User preferences for tools/technology (including first-time technology consent).
- Workflow expectations for plan and epic decomposition.
- Applicable guidance documents for preferred patterns and lessons learned.
- Applicable standards documents and any active repository policy.

## Process
1. Derive design decisions directly from approved acceptance criteria.
2. Define components, interfaces, data flow, and integration boundaries.
3. Evaluate options and select the right design and tools for the specific problem.
4. For first-time technology proposals, confirm user familiarity, explain when needed, and request consent or equivalent alternative.
5. Include a TDD red/green test strategy tied to acceptance criteria.
6. Define the architectural seams, extension points, and test boundaries the implementation will rely on.
7. Keep production code out of spike or example folders; treat spike assets as reference-only unless explicitly directed otherwise.
8. Identify localization, persistence, rollout, migration, and integration concerns where relevant.
9. Apply the relevant guidance documents for preferred Unity patterns and implementation heuristics.
10. Apply the relevant standards documents for design, testing, performance, and security.
11. Apply any active repository policy for naming, shared-code placement, platform wiring, logging, and other local conventions.
12. After design finalization, decompose into project plan and epic files.
13. Keep design synchronized with implementation progress and update history when scope changes.

## Expected Outputs
- Technical design markdown document.
- Decision log with rationale and alternatives considered.
- Learner-context notes when explanation depth materially affects the design conversation.
- Explicit red/green test strategy linked to requirements.
- Traceability to project plan phases and epic task breakdown.
- Change-history entries for design adjustments.
- Reuse map identifying what belongs in domain folders vs the repository's shared-code location.

## Success Criteria
- Design fully covers approved requirements and acceptance criteria.
- Chosen architecture is appropriate to constraints and maintainable over time.
- TDD strategy is actionable and integrated into implementation workflow.
- Plan and epic tasks can be generated without ambiguity.
- Any design change is propagated to plan and task artifacts.
- Interface-first boundaries and test/mocking seams are explicit.
- Production implementation paths are separated from spike/example assets.
- Shared infrastructure placement is intentional and communicated before extraction when an active policy defines shared-code rules.
- Relevant guidance informed default patterns without being mistaken for mandatory rules.
- Relevant standards and active policy conventions were applied without mixing them into learner-tier behavior.
- Localization design supports optional dependencies, predictable keying, and graceful fallback behavior.

## Common Pitfalls
- Designing without direct mapping to acceptance criteria.
- Choosing tools or patterns based on preference instead of fit.
- Omitting test strategy from the design.
- Failing to update design docs after implementation-driven changes.
- Allowing plan or epic tasks to diverge from the approved design.
- Ignoring useful guidance that could have simplified the design without any countervailing tradeoff.
- Mixing repository-specific conventions into general architecture guidance instead of applying the active policy.
- Overusing inheritance or deep abstraction where composition would simplify behavior.
- Leaving spike code mixed into production paths after feasibility is confirmed.
- Ignoring relevant standards or active policy constraints while drafting the design.

---
