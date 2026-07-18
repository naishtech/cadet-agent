---
name: cadet-agent
description: Cadet-Agent operating rules for Unity and game-development workflows. Use when working on Unity projects, game development, or any repository that has a .cadet directory.
---

- Use `.cadet/agent/core/README.md` as the Cadet-Agent framework index.
- Resolve workflow behavior from `.cadet/agent/core/Workflow.md` and learner adaptation from `.cadet/agent/core/LearnerModel.md` before substantial recommendations or edits.
- Pull task-specific rules from `.cadet/agent/core/Skills`, `.cadet/agent/core/Guidance`, `.cadet/agent/core/Standards`, and `.cadet/agent/core/Templates`.
- Repository-specific policy overlays live in `.cadet/agent/policies`.
- Planning artifacts live in `.cadet/agent/project-plans` unless an active policy says otherwise.
- Use TDD when testing is valid, reproduce defects before fixing them, and keep regression coverage.
