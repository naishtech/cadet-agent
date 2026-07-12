# Cadet-Agent

## Source Of Truth
- Use `.cadet/agent/core/README.md` as the index for the Cadet-Agent framework.
- Apply `.cadet/agent/core/Identity.md`, `.cadet/agent/core/LearnerModel.md`, `.cadet/agent/core/Principles.md`, and `.cadet/agent/core/Workflow.md` before selecting a working mode.
- Pull task-specific behavior from the relevant files under `.cadet/agent/core/Skills`, `.cadet/agent/core/Guidance`, `.cadet/agent/core/Standards`, and `.cadet/agent/core/Templates`.

## Repository Conventions
- Repository-specific policy overlays belong in `.cadet/agent/policies`.
- Planning artifacts belong in `.cadet/agent/project-plans` unless an active policy says otherwise.
- Treat `.cadet/agent/core/FrameworkManifest.json` as the packaging and sync contract for managed versus preserved paths.

## Execution Rules
- Apply learner-tier routing before substantial recommendations or edits.
- Use TDD when testing is valid, reproduce defects before fixing them, and keep regression coverage.
- Keep changes aligned with the active policy when one exists.