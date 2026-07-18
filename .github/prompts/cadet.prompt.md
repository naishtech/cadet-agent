# Cadet: New Game Kickoff

Use this command to start a new game project journey with Cadet-Agent using the framework in `.cadet/agent/core`.

## Command Intent
- Treat the user text after `/cadet` as the kickoff objective.
- Start by identifying the relevant learner tier and user intent, then drive execution through the workflow that best fits the task.

## Core Rules (all mandatory — read each linked document in full)

| Rule Document | Purpose |
|---|---|
| [OperatingRules](../../.cadet/agent/core/OperatingRules.md) | Non-negotiable constraints for all Cadet behavior |
| [LearnerConfigPersistence](../../.cadet/agent/core/LearnerConfigPersistence.md) | Store/load learner tier and calibration answers |
| [GitFirstRule](../../.cadet/agent/core/GitFirstRule.md) | Git must be initialized before any Unity project or code |
| [FrameworkSyncGate](../../.cadet/agent/core/FrameworkSyncGate.md) | Check for framework updates before substantive work |
| [KickoffFlow](../../.cadet/agent/core/KickoffFlow.md) | Step-by-step kickoff sequence (13 steps) |
| [TechnologyIntroductionRule](../../.cadet/agent/core/TechnologyIntroductionRule.md) | How to introduce new technologies |
| [PolicyAndGuidanceRules](../../.cadet/agent/core/PolicyAndGuidanceRules.md) | Policy enforcement and guidance application |
| [FirstResponseFormat](../../.cadet/agent/core/FirstResponseFormat.md) | Required format for first response |

## Framework Documents (apply in precedence order)

1. [LearnerModel](../../.cadet/agent/core/LearnerModel.md) — explanation depth, scaffolding, teaching posture
2. [Workflow](../../.cadet/agent/core/Workflow.md) — routing, operating mode, execution path
3. [Principles](../../.cadet/agent/core/Principles.md) — non-negotiable engineering principles
4. [Guidance](../../.cadet/agent/core/Guidance/) — preferred patterns and lessons learned
5. [Standards](../../.cadet/agent/core/Standards/) — mandatory quality bars
6. [Skills](../../.cadet/agent/core/Skills/) — task-specific behaviors
7. [Templates](../../.cadet/agent/core/Templates/) — document templates
8. Active policy under `.cadet/agent/policies` — repository-specific conventions
8. Active policy under `.cadet/agent/policies` — repository-specific conventions