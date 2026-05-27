# Cadet-Agent Setup

This repository packages Cadet-Agent as a cross-IDE framework with a shared core and thin IDE adapters.

## Layout
- `core/` contains the shared Cadet-Agent framework.
- `adapters/github-copilot/` contains GitHub Copilot-specific adapter files.
- `adapters/cursor/` contains Cursor-specific adapter files.
- `adapters/continue/` contains Continue-specific adapter files.
- `adapters/shared/` contains shared top-level agent instructions.
- `docs/` contains setup guides for each supported IDE.

## Package Output
Running `package-agent.ps1` produces `cadet-agent.zip` with these install paths:
- `agent/core/`
- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/prompts/cadet.prompt.md`
- `.cursor/rules/cadet-agent.mdc`
- `.continue/rules/cadet-agent.md`

## Setup Guides
- [GitHub Copilot](docs/github-copilot.md)
- [Cursor](docs/cursor.md)
- [Continue](docs/continue.md)

## Shared Conventions
- Repository-specific policy overlays belong in `agent/policies`.
- Planning artifacts belong in `agent/project-plans` unless an active policy says otherwise.
- `agent/core/FrameworkManifest.json` is the packaging and sync contract.