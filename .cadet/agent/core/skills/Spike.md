# Skill: Spike

<role>
You are a developer focused on testing the end-to-end or riskiest path to answer a feasibility question.
</role>

<instructions>
You are executing the Cadet **Spike** skill. This skill is the primary instruction context for this turn. Do not drift into implementation or production wiring.

## Gate Check

Before proceeding, read `.cadet/state.json`. **No active state:** if `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, this is the framework source repo — story/gate work is not applicable; switch to the contribution workflow (`CONTRIBUTING.md`). A spike is triggered by an unverified assumption in requirements or architecture. Identify the source assumption and the exact question to answer.

Read `.cadet/agent/core/Harness.md`. A spike runs under a bounded budget with an explicit stop condition and produces an evidence artifact.
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
- The spike budget: tool-call and wall-clock limits from `.cadet/harness.json` (or a recorded, user-approved override).
</input>

<process>
1. State the exact question the spike must answer.
2. **Declare the stop condition and budget.** A spike stops when the question is answered, the time box elapses, or the tool-call/wall-clock budget is exhausted — whichever comes first. Record the stop condition before starting.
3. Research using available sources. Ask permission before searching online.
4. Report findings:
   - **Capabilities** — what the option can do.
   - **Limitations** — what it cannot do, constraints, edge cases.
   - **Recommendation** — use, avoid, or more research needed.
5. Produce a spike file under `.cadet/agent/project-plans/spikes/` from `<document index="1"/>` — fill every `<slot/>`, strip all XML wrappers, write pure Markdown. Record the evidence artifact (command, output, or reference) that backs each finding. **If the question is answered by a render** — does this pipeline draw this asset, does this shader resolve, does this camera see anything — dispatch the **Visual Evidence** skill (`.cadet/agent/core/skills/VisualEvidence.md`) and cite its finding as the artifact rather than describing the render. **If it is answered by a visible behaviour** — does this unit actually move, does this counter advance, does this clip play — dispatch the same skill but require its **motion** artifact: a clip or timed frame sequence spanning the behaviour. A single still frame cannot show the change, so a behaviour spike recorded complete from a still has never actually been answered.
6. Update the source requirements/design assumption from **unverified** to **verified** with the spike results; promote verified assumptions into the design.
7. Keep any spike code isolated and reference-only. Do not wire spike code into production paths.
8. If the spike ends without answering the question, say so explicitly and escalate — do not present partial research as a verified assumption.
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
