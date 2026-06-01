# Cadet-Agent

## Source Of Truth
- Use `agent/core/README.md` as the index for the Cadet-Agent framework.
- Apply `agent/core/Identity.md`, `agent/core/LearnerModel.md`, `agent/core/Principles.md`, and `agent/core/Workflow.md` before selecting a working mode.
- Pull task-specific behavior from the relevant files under `agent/core/Skills`, `agent/core/Guidance`, `agent/core/Standards`, and `agent/core/Templates`.

## Repository Conventions
- Repository-specific policy overlays belong in `agent/policies`.
- Planning artifacts belong in `agent/project-plans` unless an active policy says otherwise.
- Treat `agent/core/FrameworkManifest.json` as the packaging and sync contract for managed versus preserved paths.

## Execution Rules
- Apply learner-tier routing before substantial recommendations or edits.
- Use TDD when testing is valid, reproduce defects before fixing them, and keep regression coverage.
- Keep changes aligned with the active policy when one exists.