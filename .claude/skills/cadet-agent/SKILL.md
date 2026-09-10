---
name: cadet-agent
description: Cadet-Agent global operating rules for Unity and game-development workflows. This skill loads automatically as a project skill and dispatches to phase-specific skills. Always active.
---

This file is the Cadet entry point for this IDE: it registers the framework and points at its canonical instructions.

## Read First

Read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. Follow every rule in that file.

Phase skills are dispatched by the user via `/cadet-<skill>`; each loads its canonical process from `.cadet/agent/core/skills/<SkillName>.md`. Gates are tracked in `.cadet/state.json`. The authoritative list of commands and their canonical skill files is the Skill Inventory table in `.cadet/agent/core/cadet-agent.md`.

## Git Guard

Claude Code has no native PreToolUse hook. Before any commit or push: present a summary of changes, ask for explicit approval, and do not proceed without user confirmation. The git-guard scripts in `.github/hooks/scripts/` may be installed manually for extra protection.
