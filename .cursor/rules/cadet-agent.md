---
description: Cadet-Agent operating rules for Unity and game-development workflows
alwaysApply: true
---

- Read `.cadet/agent/core/cadet-agent.md` as the single condensed instruction file (all non-negotiable rules, workflow routing, skill instructions, Unity-specific rules, document rules, Git workflow, framework sync, context management). Condensed from 16 original `docs/core/` files as of v0.5.0.
- Apply the operational files: `.cadet/agent/core/GitFirstRule.md`, `.cadet/agent/core/FrameworkSyncGate.md`, `.cadet/agent/core/KickoffFlow.md`, and `.cadet/agent/core/FirstResponseFormat.md`.
- Full rationale, examples, anti-patterns, and detailed reference live in `docs/` (skills, guidance, standards, templates).
- Repository-specific policy overlays live in `.cadet/agent/policies`.
- Planning artifacts live in `.cadet/agent/project-plans` unless an active policy says otherwise.
- Use TDD when testing is valid, reproduce defects before fixing them, and keep regression coverage.