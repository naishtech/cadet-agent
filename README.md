# Cadet-Agent

Cadet-Agent is an **opinionated** cross-IDE agent framework for game-development workflows. It is built on foundational software engineering practices and real-world game-development experience, with the goal of **guiding you through the entire development process** — from requirements and technical design through TDD, implementation, and review.

Cadet-Agent is **not a one-shot code generator**. It won't spit out a finished game from a single prompt. Instead, it walks you through each phase methodically: calibrating the learner model, scoping work into epics and stories, planning architecture, writing tests first, and iterating on feedback. The shared framework core integrates with GitHub Copilot, Cursor, Continue, and Claude Code.

## Repository Layout
- `.cadet/agent/core/` contains the shared Cadet-Agent framework documents.
- `.cadet/agent/docs/` contains setup guides for each supported IDE.
- `.github/agents/` contains the Copilot custom agent definition (agent mode).
- `.cursor/` contains Cursor-specific authored files.
- `.continue/` contains Continue-specific authored files.
- `.claude/` contains Claude Code-specific authored files.
- These IDE folders hold thin integration shims; the core framework logic still lives in `.cadet/agent/core/`.
- `package-agent.ps1` builds the distributable `cadet-agent.zip` package.
- `publish-npm.ps1` publishes the CLI to npm using a token from `~/.npm_token`.

## Quick Install

```bash
npx cadet-agent@latest init
```

This downloads the latest framework release and extracts it into your current directory. For a specific target directory:

```bash
npx cadet-agent@latest init --target ./my-unity-project
```

## Manual Install (fallback)

If you prefer to install from a packaged release artifact, download `cadet-agent.zip` from [GitHub Releases](https://github.com/naishtech/cadet-agent/releases) and extract it into your Unity project root:

```powershell
Expand-Archive .\cadet-agent.zip -DestinationPath . -Force
```

## Getting Started
- For repository setup and package contents, see [.cadet/agent/README.md](.cadet/agent/README.md).
- For framework navigation, see [.cadet/agent/core/README.md](.cadet/agent/core/README.md).
- For GitHub Copilot setup, see [.cadet/agent/docs/github-copilot.md](.cadet/agent/docs/github-copilot.md).
- For Cursor setup, see [.cadet/agent/docs/cursor.md](.cadet/agent/docs/cursor.md).
- For Continue setup, see [.cadet/agent/docs/continue.md](.cadet/agent/docs/continue.md).
- For Claude Code setup, see [.cadet/agent/docs/claude-code.md](.cadet/agent/docs/claude-code.md).

## Examples

### GitHub Copilot
Run `npx cadet-agent@latest init` in your Unity project root, then open the repo in VS Code.

**Agent mode:** Select the **Cadet** agent from the agent picker in Copilot Chat. The agent definition at `.github/agents/cadet.agent.md` provides focused instructions and tool configuration.

```text
[Describe your game dev task...]
```

Cadet will use the shared framework in `.cadet/agent/core` to route the conversation through learner calibration, bootstrap checks, and planning.

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
- `.github/agents/cadet.agent.md`
- `.cursor/rules/cadet-agent.md`
- `.continue/rules/cadet-agent.md`
- `.claude/skills/cadet-agent.md`

## Notes
- `.cadet/agent/core/FrameworkManifest.json` defines the managed and preserved paths for packaged installs.
- Workflow progress is tracked in `.cadet/state.json` with two modes: **markdown** (epic/story files) or **GitHub** (Projects/Issues).
- Repository-specific policy overlays belong in `.cadet/agent/policies`.
- Planning artifacts belong in `.cadet/agent/project-plans` unless an active policy says otherwise.