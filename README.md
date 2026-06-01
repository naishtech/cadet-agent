# Cadet-Agent

Cadet-Agent is a cross-IDE agent framework for game-development workflows, with a shared framework core and authored root integrations for GitHub Copilot, Cursor, and Continue.

## Repository Layout
- `agent/core/` contains the shared Cadet-Agent framework documents.
- `agent/docs/` contains setup guides for each supported IDE.
- `AGENTS.md` contains shared top-level agent instructions.
- `.github/` contains GitHub Copilot-specific authored files.
- `.cursor/` contains Cursor-specific authored files.
- `.continue/` contains Continue-specific authored files.
- `package-agent.ps1` builds the distributable `cadet-agent.zip` package.

## Getting Started
- For repository setup and package contents, see [agent/README.md](agent/README.md).
- For framework navigation, see [agent/core/README.md](agent/core/README.md).
- For GitHub Copilot setup, see [agent/docs/github-copilot.md](agent/docs/github-copilot.md).
- For Cursor setup, see [agent/docs/cursor.md](agent/docs/cursor.md).
- For Continue setup, see [agent/docs/continue.md](agent/docs/continue.md).

## Package Output
Running `./package-agent.ps1` produces `cadet-agent.zip` with this layout:
- `agent/core/`
- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/prompts/cadet.prompt.md`
- `.cursor/rules/cadet-agent.mdc`
- `.continue/rules/cadet-agent.md`

## Notes
- `agent/core/FrameworkManifest.json` defines the managed and preserved paths for packaged installs.
- Repository-specific policy overlays belong in `agent/policies`.
- Planning artifacts belong in `agent/project-plans` unless an active policy says otherwise.