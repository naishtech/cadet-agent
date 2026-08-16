# Cadet-Agent Setup

This repository packages Cadet-Agent as a cross-IDE framework with a shared core and thin IDE adapters.

## Layout
- `core/` contains the shared Cadet-Agent framework.
- The repository root contains thin IDE-specific adapter files under `.github/`, `.cursor/`, `.continue/`, and `.claude/` for native integration.
- `docs/` contains setup guides for each supported IDE.

## Package Output
Running `package-agent.ps1` produces `cadet-agent.zip` with these install paths:
- `.cadet/agent/core/` (includes `skills/` and `templates/`)
- `.github/agents/cadet.agent.md`
- `.github/agents/cadet-agent-reviewer.agent.md`
- `.github/prompts/cadet-*.prompt.md`
- `.github/hooks/`
- `.cursor/rules/cadet-agent.md`
- `.cursor/rules/cadet-agent-reviewer.md`
- `.continue/rules/cadet-agent.md`
- `.continue/rules/cadet-agent-reviewer.md`
- `.continue/config.yaml`
- `.claude/skills/cadet-agent/SKILL.md`
- `.claude/skills/cadet-*/SKILL.md`

## Setup Guides
- [GitHub Copilot](docs/github-copilot.md)
- [Cursor](docs/cursor.md)
- [Continue](docs/continue.md)

## Shared Conventions
- Repository-specific policy overlays belong in `.cadet/agent/policies`.
- Planning artifacts belong in `.cadet/agent/project-plans` unless an active policy says otherwise.
- `.cadet/agent/core/FrameworkManifest.json` is the packaging and sync contract.