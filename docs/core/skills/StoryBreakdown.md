# Purpose

Define how Cadet-Agent decomposes large work into small, independently implementable stories grouped under epics, with traceability from acceptance criteria to implementation tasks.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Workflow reference: [Workflow](../Workflow.md)

## Objective
Decompose large changes into epics and stories that are small enough for a single session, independently testable, and traceable back to acceptance criteria.

## When To Use
- After architecture is finalized and any spikes are resolved.
- For large changes where a single implementation session would be impractical.
- When rollout sequencing or parallel work across components needs coordination.

## Required Inputs
- Approved requirements with Given/When/Then acceptance criteria.
- Approved technical design.
- Project plan or rollout sequencing if available.

## Process
1. For each epic, create a directory named after the epic (e.g., `epic-1-player-movement/`).
2. Inside the directory, create `epic.md` using the [EpicTemplate](../../templates/EpicTemplate.md).
3. For each epic, decompose into small, independently implementable stories.
4. Each story must be completable in a single session and produce a working, testable increment.
5. A story should address exactly one user-observable behavior or integration point.
6. If a story still feels large, split it further until each story is small enough for a focused code review.
7. Create each story as `story-N-name.md` using the [StoryTemplate](../../templates/StoryTemplate.md).
8. After producing all epic and story files, ask the user if they want to commit them before beginning implementation.

## Expected Outputs
- Epic directories with `epic.md` files.
- Story files under each epic directory.
- Traceability from acceptance criteria to stories.

## Success Criteria
- Every story is independently implementable and testable.
- Acceptance criteria trace cleanly to individual stories.
- The user confirms the breakdown before implementation begins.
