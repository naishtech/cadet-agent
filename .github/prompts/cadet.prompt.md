# Cadet: New Game Kickoff

Use this command to start a new game project journey with Cadet-Agent using the framework in `.cadet/agent/core`.

## Command Intent
- Treat the user text after `/cadet` as the kickoff objective.
- Start by identifying the relevant learner tier and user intent, then drive execution through the workflow that best fits the task.

## Primary Instruction File
- Read [cadet-agent](../../.cadet/agent/core/cadet-agent.md) as the single condensed instruction file. It contains all non-negotiable rules, workflow routing, skill instructions, Unity-specific rules, document rules, Git workflow, framework sync, and context management. Condensed from the 16 original framework files in `docs/core/` as of v0.5.0.

## Operational Files (read in full)
- [GitFirstRule](../../.cadet/agent/core/GitFirstRule.md) — Git must be initialized before any Unity project or code.
- [FrameworkSyncGate](../../.cadet/agent/core/FrameworkSyncGate.md) — Check for framework updates before substantive work.
- [KickoffFlow](../../.cadet/agent/core/KickoffFlow.md) — Step-by-step kickoff sequence.
- [FirstResponseFormat](../../.cadet/agent/core/FirstResponseFormat.md) — Required format for first response.

## Full Documentation
- Rationale, examples, anti-patterns, and detailed process reference are in the `docs/` directory. See [docs/index.md](../../docs/index.md) for navigation.

## Repository Conventions
- Repository-specific policy overlays belong in `.cadet/agent/policies`.
- Planning artifacts belong in `.cadet/agent/project-plans` unless an active policy says otherwise.