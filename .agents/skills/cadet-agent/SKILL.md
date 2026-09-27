---
name: cadet-agent
description: Cadet-Agent global operating rules for Unity and game-development workflows. Loads automatically as a project skill and dispatches to phase-specific skills. Always active.
---

This file is the Cadet entry point for the `.agents/skills/` cross-client root (Deep Code, Hermes): it registers the framework and points at its canonical instructions.

## Read First

Read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. Follow every rule in that file.

Phase skills are selected from the `/` skills menu (`/skills` lists them); each loads its canonical process from `.cadet/agent/core/skills/<SkillName>.md`. Gates are tracked in `.cadet/state.json`. The authoritative command list and canonical skill files are in the Skill Inventory table in `.cadet/agent/core/cadet-agent.md`.

## Git Guard

This client has no PreToolUse hook — enforce approval through your client's permission system:

- Deep Code: put `mutate-git-log` (and optionally `network`, `write-out-cwd`) in `.deepcode/settings.json` `permissions.ask`, or use `"defaultMode": "askAll"`.
- Hermes: enable command approval policies so `git commit` and `git push` require confirmation (see `docs/guidance/Hermes.md`).

Before any commit or push, also present a summary of changes and wait for explicit approval.
