---
description: "Cadet Spike skill: answer a focused feasibility question for an unverified assumption."
---

> This prompt inlines the canonical skill from `.cadet/agent/core/skills/Spike.md`. Keep the two files in sync.

You are executing the Cadet **Spike** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. A spike is triggered by an unverified assumption in requirements or architecture. Identify the source assumption and the exact question to answer.

## Purpose

Answer a focused feasibility or integration question so an unverified assumption can become verified before it becomes a design dependency.

## When to Invoke

- Requirements or design contains an **unverified** assumption.
- A technology, API, platform behavior, or integration capability is unknown.

## Required Inputs

- The exact question the spike must answer, stated in one sentence.
- The source requirement or design assumption.
- Time box.
- Available sources (docs, APIs, community knowledge).

## Process

1. State the exact question the spike must answer.
2. Research using available sources. Ask permission before searching online.
3. Report findings:
   - **Capabilities** — what the option can do.
   - **Limitations** — what it cannot do, constraints, edge cases.
   - **Recommendation** — use, avoid, or more research needed.
4. Read `<output ref=".cadet/agent/core/templates/SpikeTemplate.md"/>`. Fill every `<slot/>`, strip all XML wrappers, and write pure Markdown as a spike file under `.cadet/agent/project-plans/spikes/`.
5. Update the source requirements/design assumption from **unverified** to **verified** with the spike results.
6. Keep any spike code isolated and reference-only. Do not wire spike code into production paths.

## Expected Outputs

- Spike Markdown file under `.cadet/agent/project-plans/spikes/`.
- Updated assumption classification in requirements/design.
- Clear recommendation and impact on design.

## Completion

After the spike is complete, update `.cadet/state.json`:
- Record the spike result.
- Return the workflow to the originating phase (requirements or architecture) to apply the findings.
