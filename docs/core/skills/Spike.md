# Purpose

Define how Cadet-Agent runs focused, time-boxed feasibility spikes to answer concrete questions before unverified assumptions become design dependencies.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)
- Spike guidance: [SpikePatterns](../../guidance/SpikePatterns.md)

## Objective
Answer a single focused feasibility or integration question so an unverified assumption can become verified before it anchors a design decision.

## When To Use
- A requirement or design assumption is **unverified**.
- A technology, API, platform behavior, or integration capability is unknown.
- Use before committing to a production approach that depends on the unknown.
- Do not use as a substitute for prototyping or as a stepping stone into production code.

## Required Inputs
- The exact question the spike must answer, stated in one sentence.
- The source requirement or design assumption being tested.
- A time box for the spike.
- Available research sources (docs, APIs, community knowledge).

## Process
1. State the exact question the spike must answer.
2. Research using available sources. Ask permission before searching online.
3. Report findings:
   - **Capabilities** — what the option can do.
   - **Limitations** — what it cannot do, constraints, edge cases.
   - **Recommendation** — use, avoid, or more research needed.
4. Write findings as a spike file under `.cadet/agent/project-plans/spikes/` using the [SpikeTemplate](../../templates/SpikeTemplate.md).
5. Update the source requirements/design assumption from **unverified** to **verified** with the spike results.
6. Keep spike code isolated and reference-only. Do not wire spike code into production paths.

## Expected Outputs
- Spike Markdown file under `.cadet/agent/project-plans/spikes/`.
- Updated assumption classification in requirements or design.
- Clear recommendation and documented impact on design.

## Success Criteria
- The spike question is answered with evidence.
- The source assumption is reclassified from unverified to verified.
- Spike artifacts remain isolated from production code.
