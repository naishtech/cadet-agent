---
name: cadet-agent
description: Cadet-Agent operating rules for Unity and game-development workflows. Automatically loaded as a Continue project rule.
---

This file is the Cadet entry point for this IDE: it registers the framework and points at its canonical instructions.

## Read First

On every turn, read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. Follow every rule in that file.

Phase skills are dispatched when the user names a workflow phase or invokes a `/cadet-<skill>` custom command (see `.continue/config.yaml`); each loads its canonical process from `.cadet/agent/core/skills/<SkillName>.md`. Gates are tracked in `.cadet/state.json`. The authoritative list of phases, commands, and their canonical skill files is the Skill Inventory table in `.cadet/agent/core/cadet-agent.md`.

## Reviewer Mode

For audit-only work, invoke the `/cadet-agent-reviewer` custom command. It loads its canonical process from `.cadet/agent/core/skills/AgentReviewer.md`.

## Git Guard

Continue has no native PreToolUse hook. Before any commit or push: present a summary of changes, ask for explicit approval, and do not proceed without user confirmation. The git-guard scripts in `.github/hooks/scripts/` may be installed manually for extra protection.
