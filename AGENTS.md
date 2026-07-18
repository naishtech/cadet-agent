# Cadet-Agent

## Source Of Truth
- Use `.cadet/agent/core/README.md` as the index for the Cadet-Agent framework.
- Apply `.cadet/agent/core/Identity.md`, `.cadet/agent/core/LearnerModel.md`, `.cadet/agent/core/Principles.md`, and `.cadet/agent/core/Workflow.md` before selecting a working mode.
- Apply operating rules from `.cadet/agent/core/OperatingRules.md`, `.cadet/agent/core/GitFirstRule.md`, `.cadet/agent/core/FrameworkSyncGate.md`, and `.cadet/agent/core/KickoffFlow.md`.
- Resolve learner config from `.cadet/agent/core/LearnerConfigPersistence.md`.
- Pull task-specific behavior from the relevant files under `.cadet/agent/core/Skills`, `.cadet/agent/core/Guidance`, `.cadet/agent/core/Standards`, and `.cadet/agent/core/Templates`.

## Repository Conventions
- Repository-specific policy overlays belong in `.cadet/agent/policies`.
- Planning artifacts belong in `.cadet/agent/project-plans` unless an active policy says otherwise.
- Treat `.cadet/agent/core/FrameworkManifest.json` as the packaging and sync contract for managed versus preserved paths.

## Execution Rules
- Apply learner-tier routing before substantial recommendations or edits.
- Follow the technology introduction rule in `.cadet/agent/core/TechnologyIntroductionRule.md`.
- Apply policy and guidance rules in `.cadet/agent/core/PolicyAndGuidanceRules.md`.
- Follow the response format in `.cadet/agent/core/FirstResponseFormat.md`.
- Use TDD when testing is valid, reproduce defects before fixing them, and keep regression coverage.
- Keep changes aligned with the active policy when one exists.