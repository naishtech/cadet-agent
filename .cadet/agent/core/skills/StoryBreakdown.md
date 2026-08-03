# Skill: Story Breakdown

You are executing the Cadet **Story Breakdown** skill. This skill is the primary instruction context for this turn. Do not begin implementation until this skill completes and the user confirms the breakdown.

## Gate Check

Before proceeding, read `.cadet/state.json`. Requirements and architecture must be complete (`currentPhase` is `architectureComplete` or later). Any spikes triggered by unverified assumptions must be complete.

## Purpose

Decompose large work into small, independently implementable stories grouped under epics.

## When to Invoke

- Large changes, after architecture is finalized and spikes are resolved.

## Required Inputs

- Approved requirements and acceptance criteria.
- Approved technical design.
- Project plan or rollout sequencing if available.

## Process

1. For each epic, create a directory named after the epic (e.g., `epic-1-player-movement/`).
2. Inside the directory, create `epic.md` by reading `<output ref=".cadet/agent/core/templates/EpicTemplate.md"/>` and writing pure Markdown.
3. For each epic, decompose into small, independently implementable stories.
4. Each story must be completable in a single session and produce a working, testable increment.
5. A story should address exactly one user-observable behavior or integration point.
6. If a story still feels large, split it further until each story is small enough for a focused code review.
7. Create each story as `story-N-name.md` by reading `<output ref=".cadet/agent/core/templates/StoryTemplate.md"/>` and writing pure Markdown.
8. After producing all epic and story files, ask the user if they want to commit them before beginning implementation.

## Expected Outputs

- Epic directories with `epic.md` files.
- Story files under each epic directory.
- Traceability from acceptance criteria to stories.

## Completion

After the breakdown is accepted, update `.cadet/state.json`:
- Set `currentPhase` to `implementation`.
- Record active epic and first story.
- Reset gates for the first story.
