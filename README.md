# Cadet-Agent

Cadet-Agent is a cross-IDE agent framework for game-development workflows, with a shared framework core and authored root integrations for GitHub Copilot, Cursor, Continue, and Claude Code.

## Repository Layout
- `.cadet/agent/core/` contains the shared Cadet-Agent framework documents.
- `.cadet/agent/docs/` contains setup guides for each supported IDE.
- `AGENTS.md` contains shared top-level agent instructions.
- `.github/` contains GitHub Copilot-specific authored files.
- `.cursor/` contains Cursor-specific authored files.
- `.continue/` contains Continue-specific authored files.
- `.claude/` contains Claude Code-specific authored files.
- `package-agent.ps1` builds the distributable `cadet-agent.zip` package.

## Getting Started
- For repository setup and package contents, see [.cadet/agent/README.md](.cadet/agent/README.md).
- For framework navigation, see [.cadet/agent/core/README.md](.cadet/agent/core/README.md).
- For GitHub Copilot setup, see [.cadet/agent/docs/github-copilot.md](.cadet/agent/docs/github-copilot.md).
- For Cursor setup, see [.cadet/agent/docs/cursor.md](.cadet/agent/docs/cursor.md).
- For Continue setup, see [.cadet/agent/docs/continue.md](.cadet/agent/docs/continue.md).
- For Claude Code setup, see [.cadet/agent/docs/claude-code.md](.cadet/agent/docs/claude-code.md).

## Examples

### GitHub Copilot kickoff
After extracting `cadet-agent.zip` into a game repository, open the repo in VS Code and start a kickoff chat using the Cadet prompt.

```text
/cadet Help me bootstrap a beginner-friendly 2D racing prototype in Unity with AI opponents and a career progression loop.
```

Cadet-Agent will use `.github/prompts/cadet.prompt.md` plus the shared framework in `.cadet/agent/core` to route the conversation through learner calibration, bootstrap checks, and planning.

### Cursor feature request
After opening the repository in Cursor, the always-apply rule in `.cursor/rules/cadet-agent.md` should load automatically. A typical request looks like this:

```text
Design a small vertical slice for a kart handling prototype in Unity. Start with requirements, then a technical design, then the first TDD task.
```

Cursor will use the Cadet rule to pull workflow, standards, and guidance from `.cadet/agent/core` before responding.

### Continue planning request
With Continue installed in VS Code, open the repository and ask for a scoped planning artifact:

```text
Create a requirements outline for a single-player time-trial mode with ghost replay support and Given/When/Then acceptance criteria.
```

The Continue rule in `.continue/rules/cadet-agent.md` should steer the response back through the shared Cadet framework.

### Repository policy example
If a specific game repository needs local conventions, add a policy file under `.cadet/agent/policies` using `.cadet/agent/core/Templates/PolicyTemplate.md`. For example, a repository policy could define:
- where project plans should live
- where shared gameplay code should be extracted
- which Unity packages or UI stack are the project default

## Package Output
Running `./package-agent.ps1` produces `cadet-agent.zip` with this layout:
- `.cadet/agent/core/`
- `AGENTS.md`
- `.github/cadet-copilot-instructions.md`
- `.github/prompts/cadet.prompt.md`
- `.cursor/rules/cadet-agent.md`
- `.continue/rules/cadet-agent.md`
- `.claude/skills/cadet-agent.md`

## Notes
- `.cadet/agent/core/FrameworkManifest.json` defines the managed and preserved paths for packaged installs.
- Repository-specific policy overlays belong in `.cadet/agent/policies`.
- Planning artifacts belong in `.cadet/agent/project-plans` unless an active policy says otherwise.