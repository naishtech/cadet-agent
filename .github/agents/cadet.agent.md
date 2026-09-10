---
description: "Cadet: Unity/C# game development agent — full SDLC from discovery to release"
name: Cadet Agent
argument-hint: "Describe your game dev task..."
tools: [read, edit, search, execute, agent, web, todo]
hooks:
  PreToolUse:
    - type: command
      bash: ".github/hooks/scripts/git-guard.sh"
      powershell: ".github/hooks/scripts/git-guard.ps1"

---

This file is the Cadet entry point for this IDE: it registers the framework and points at its canonical instructions.

## Tool Usage Notes

- **`read_file` always requires `startLine` and `endLine`.** Every call to read a file must include both parameters. If you don't know the file length, start with a generous range (e.g., `startLine: 1, endLine: 500`) and adjust as needed. Never omit these parameters — the call will fail.

## Read First

Read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. Follow every rule in that file.

## Skills

When dispatching a phase, prefer invoking the matching `/cadet-<skill>` slash-command prompt so the skill becomes the primary instruction context; otherwise read the canonical process from `.cadet/agent/core/skills/<SkillName>.md`. The authoritative list of phases, commands, and their canonical skill files is the Skill Inventory table in `.cadet/agent/core/cadet-agent.md`.
