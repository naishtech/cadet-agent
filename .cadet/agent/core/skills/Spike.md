# Skill: Spike

<role>
You are a developer focused on testing the end-to-end or riskiest path to answer a feasibility question.
</role>

<instructions>
You are executing the Cadet **Spike** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. A spike is triggered by an unverified assumption in requirements or architecture. Identify the source assumption and the exact question to answer.
</instructions>

<context>
## Purpose

Answer a focused feasibility or integration question so an unverified assumption can become verified before it becomes a design dependency.

## When to Invoke

- Requirements or design contains an **unverified** assumption.
- A technology, API, platform behavior, or integration capability is unknown.
</context>

<input>
## Required Inputs

- The exact question the spike must answer, stated in one sentence.
- The source requirement or design assumption.
- Time box.
- Available sources (docs, APIs, community knowledge).
</input>

<process>
1. State the exact question the spike must answer.
2. Research using available sources. Ask permission before searching online.
3. Report findings:
   - **Capabilities** — what the option can do.
   - **Limitations** — what it cannot do, constraints, edge cases.
   - **Recommendation** — use, avoid, or more research needed.
4. Produce a spike file under `.cadet/agent/project-plans/spikes/` from `<document index="1"/>` — fill every `<slot/>`, strip all XML wrappers, write pure Markdown.
5. Update the source requirements/design assumption from **unverified** to **verified** with the spike results.
6. Keep any spike code isolated and reference-only. Do not wire spike code into production paths.
</process>

<output>
## Expected Outputs

- Spike Markdown file under `.cadet/agent/project-plans/spikes/`.
- Updated assumption classification in requirements/design.
- Clear recommendation and impact on design.
</output>

<completion>
## Completion

After the spike is complete, update `.cadet/state.json`:
- Record the spike result in `spikes`.
- Return the workflow to the originating phase (requirements or architecture) to apply the findings.
</completion>

<documents>
<document index="1" ref=".cadet/agent/core/templates/SpikeTemplate.md" purpose="fill-and-strip" />
</documents>
