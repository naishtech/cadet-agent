# Cadet-Agent Adapter Inventory

> Generated: 2026-08-03 | Framework version: 0.17.0

This document tracks every IDE adapter file, its purpose, and its canonical dependency. The adapter contract is: **no IDE-specific file may duplicate canonical content from `.cadet/agent/core/`.** Each adapter must only contain frontmatter, identity, file-reference instructions, and IDE-specific invocation patterns.

## Adapter Contract

1. **Frontmatter** required by the target IDE.
2. **Short identity/description** of Cadet-Agent.
3. **Instructions to read** canonical files under `.cadet/agent/core/`.
4. **IDE-specific invocation patterns** (slash commands, rule globs, skill names).
5. **References to preserved user paths** (`.cadet/agent/policies/`, `.cadet/agent/project-plans/`, `.cadet/state.json`).

## Inventory

| IDE | File | Type | Canonical Dependency |
|---|---|---|---|
| GitHub Copilot | `.github/agents/cadet.agent.md` | Agent definition | `.cadet/agent/core/cadet-agent.md` |
| GitHub Copilot | `.github/agents/cadet-agent-reviewer.agent.md` | Reviewer agent | `.cadet/agent/core/cadet-agent.md` |
| GitHub Copilot | `.github/prompts/cadet-requirements.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Requirements.md` |
| GitHub Copilot | `.github/prompts/cadet-architecture.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Architecture.md` |
| GitHub Copilot | `.github/prompts/cadet-spike.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Spike.md` |
| GitHub Copilot | `.github/prompts/cadet-breakdown.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/StoryBreakdown.md` |
| GitHub Copilot | `.github/prompts/cadet-tdd.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/TDD.md` |
| GitHub Copilot | `.github/prompts/cadet-debug.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Debugging.md` |
| GitHub Copilot | `.github/prompts/cadet-review.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/CodeReview.md` |
| GitHub Copilot | `.github/prompts/cadet-resume.prompt.md` | Slash-command prompt | `.cadet/agent/core/cadet-agent.md` (resume logic) |
| GitHub Copilot | `.github/hooks/git-guard.json` | PreToolUse hook config | n/a (infrastructure) |
| Cursor | `.cursor/rules/cadet-agent.md` | Always-apply rule | `.cadet/agent/core/cadet-agent.md` |
| Cursor | `.cursor/rules/cadet-agent-reviewer.md` | Reviewer rule | `.cadet/agent/core/cadet-agent.md` |
| Continue | `.continue/rules/cadet-agent.md` | System rule | `.cadet/agent/core/cadet-agent.md` |
| Continue | `.continue/rules/cadet-agent-reviewer.md` | Reviewer rule | `.cadet/agent/core/cadet-agent.md` |
| Continue | `.continue/config.yaml` | Custom commands | `.cadet/agent/core/skills/*.md` |
| Claude Code | `.claude/skills/cadet-agent/SKILL.md` | Base/global skill | `.cadet/agent/core/cadet-agent.md` |
| Claude Code | `.claude/skills/cadet-agent-reviewer/SKILL.md` | Reviewer skill | `.cadet/agent/core/cadet-agent.md` |
| Claude Code | `.claude/skills/cadet-requirements/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Requirements.md` |
| Claude Code | `.claude/skills/cadet-architecture/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Architecture.md` |
| Claude Code | `.claude/skills/cadet-spike/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Spike.md` |
| Claude Code | `.claude/skills/cadet-breakdown/SKILL.md` | Phase skill | `.cadet/agent/core/skills/StoryBreakdown.md` |
| Claude Code | `.claude/skills/cadet-tdd/SKILL.md` | Phase skill | `.cadet/agent/core/skills/TDD.md` |
| Claude Code | `.claude/skills/cadet-debug/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Debugging.md` |
| Claude Code | `.claude/skills/cadet-review/SKILL.md` | Phase skill | `.cadet/agent/core/skills/CodeReview.md` |
| Claude Code | `.claude/skills/cadet-resume/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Resume.md` |

## Verification

Run `npm test` to validate:
- Every skill has an adapter in each IDE that can invoke it.
- Every adapter references `.cadet/agent/core/cadet-agent.md`.
- No adapter duplicates canonical skill process content.
- `FrameworkManifest.json` lists every adapter in `managedPaths`.
- `package-agent.ps1` stages every adapter path.
