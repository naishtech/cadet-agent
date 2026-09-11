---
name: cadet-agent
description: Cadet-Agent global operating rules for Unity and game-development workflows. Loads automatically as a project skill and dispatches to phase-specific skills. Always active.
---

This file is the Cadet entry point for Deep Code: it registers the framework and points at its canonical instructions.

## Read First

Read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. Follow every rule in that file.

Phase skills are selected from the `/` skills menu (`/skills` lists them); each loads its canonical process from `.cadet/agent/core/skills/<SkillName>.md`. Gates are tracked in `.cadet/state.json`. The authoritative command list and canonical skill files are in the Skill Inventory table in `.cadet/agent/core/cadet-agent.md`.

## Git Guard

Deep Code has no PreToolUse hook. Enforce approval through `.deepcode/settings.json` permissions instead: put `mutate-git-log` (and optionally `network`, `write-out-cwd`) in `permissions.ask`, or use `"defaultMode": "askAll"`. Before any commit or push, also present a summary of changes and wait for explicit approval.
