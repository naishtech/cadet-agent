# Cadet-Agent

## Primary Agent Instruction File
- Read `.cadet/agent/core/cadet-agent.md` as the single condensed instruction file. It contains all non-negotiable rules, orchestrator integration, skill instructions, Unity-specific rules, document rules, Git workflow, framework sync, and context management.

## Operational Files
- `.cadet/agent/core/README.md` — Framework index and policy system rules.
- `.cadet/agent/core/GitFirstRule.md` — Git must be initialized before any Unity project or code.
- `.cadet/agent/core/FrameworkSyncGate.md` — Check for framework updates before substantive work.
- `.cadet/agent/core/KickoffFlow.md` — Step-by-step kickoff sequence.
- `.cadet/agent/core/FirstResponseFormat.md` — Required format for first response.

## Full Documentation
- Rationale, examples, anti-patterns, and detailed process reference are in the `docs/` directory, deployed to GitHub Pages. See `docs/index.md` for navigation.

## Repository Conventions
- Repository-specific policy overlays belong in `.cadet/agent/policies`.
- Planning artifacts belong in `.cadet/agent/project-plans` unless an active policy says otherwise.
- Treat `.cadet/agent/core/FrameworkManifest.json` as the packaging and sync contract for managed versus preserved paths.
- The orchestrator CLI at `.cadet/orchestrator/cadet-orchestrator` manages workflow state, routing, and validation gates.