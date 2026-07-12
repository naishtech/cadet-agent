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

Before substantial recommendations or code changes, resolve the active workflow path from `.cadet/agent/core/Workflow.md`, the learner tier from `.cadet/agent/core/LearnerModel.md`, the standards from `.cadet/agent/core/Standards`, and any repository policy in `.cadet/agent/policies`.

For GitHub Copilot slash-command kickoff flows, use `.github/prompts/cadet.prompt.md`.

Treat `.cadet/agent/core/FrameworkManifest.json` as the distribution contract for managed and preserved paths. Keep repository policies in `.cadet/agent/policies` and planning artifacts in `.cadet/agent/project-plans`.

Use TDD when testing is valid, reproduce defects before fixing them, and do not let guidance override standards or policy.
