<!-- ═══════════════════════════════════════════════════════════════════════════
     CADET-AGENT COPILOT INSTRUCTIONS
     
     IMPORTANT: GitHub Copilot reads `.github/copilot-instructions.md` — NOT this
     namespaced file. This file is namespaced so Cadet never overwrites your own
     Copilot instructions.
     
     To activate these instructions:
     • If you do NOT have your own `.github/copilot-instructions.md`:
       rename (or symlink) this file to `copilot-instructions.md`
     • If you already have `.github/copilot-instructions.md`:
       merge this content into your existing file
     
     This file is managed by Cadet-Agent and will be overwritten on framework
     sync. Keep your own instructions in `.github/copilot-instructions.md`.
     ═══════════════════════════════════════════════════════════════════════════ -->

Use `.cadet/agent/core/README.md` as the framework index for Cadet-Agent.

Before substantial recommendations or code changes:
- Apply operating rules from `.cadet/agent/core/OperatingRules.md`, `.cadet/agent/core/GitFirstRule.md`, `.cadet/agent/core/FrameworkSyncGate.md`, and `.cadet/agent/core/KickoffFlow.md`.
- Resolve learner config from `.cadet/agent/core/LearnerConfigPersistence.md` and the learner tier from `.cadet/agent/core/LearnerModel.md`.
- Resolve the active workflow path from `.cadet/agent/core/Workflow.md`.
- Pull task-specific rules from `.cadet/agent/core/Skills`, `.cadet/agent/core/Guidance`, `.cadet/agent/core/Standards`, and `.cadet/agent/core/Templates`.
- Apply the technology introduction rule in `.cadet/agent/core/TechnologyIntroductionRule.md`.
- Apply policy and guidance rules in `.cadet/agent/core/PolicyAndGuidanceRules.md`.
- Follow the response format in `.cadet/agent/core/FirstResponseFormat.md`.

For GitHub Copilot slash-command kickoff flows, use `.github/prompts/cadet.prompt.md`.

Treat `.cadet/agent/core/FrameworkManifest.json` as the distribution contract for managed and preserved paths. Keep repository policies in `.cadet/agent/policies` and planning artifacts in `.cadet/agent/project-plans`.

Use TDD when testing is valid, reproduce defects before fixing them, and do not let guidance override standards or policy.
