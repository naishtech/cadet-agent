# AGENTS.md

This repository uses **Cadet-Agent**, a workflow framework for game development. It drives one engine — **Unity** or **Unreal** — through that engine's pack, and installs only the hosts and the engine you chose.

## Authoritative instructions

Read `.cadet/agent/core/cadet-agent.md` in full and treat it as authoritative for this turn. It defines the workflow phases, the gate protocol, and the skill dispatch table.

Phase instructions live in `.cadet/agent/core/skills/`. Agent clients that scan project skills (Deep Code, Claude Code) discover Cadet's phase skills through their adapters; otherwise read the skill file for the phase directly.

The engine's commands and conventions live in `.cadet/agent/core/engines/unity/` or `engines/unreal/`. A phase skill says "run the project's test command"; the engine pack says which command that is.

## What is installed, and where

- **Core, always:** `.cadet/agent/` (directive, harness, skills, templates, engine packs) and `.cadet/harness.json`.
- **The engine**, named in `.cadet/engine.json` with its plugin root, CLI root and editor version. A phase skill reads that file before it runs anything; when it is absent, the skill says so instead of guessing a command.
- **Hosts**, one folder each: `.github/` (Copilot agent, prompts and the git-guard hook), `.claude/skills/` (Claude Code), `.agents/skills/` (Deep Code and Hermes), `.cursor/rules/`, `.continue/`.
- **Engine products:** `Assets/Covyne/Cadet/` with its `CLI/` for Unity; `Plugins/CadetBuild/` with its `CLI/` for Unreal.
- **The record:** `.cadet/agent/install.json` lists every installed file with its sha256, the components and the engine. It is what makes `sync` and `uninstall` exact, and the installer writes it.

## Running the workflow CLI

The CLI is the published `cadet-agent` package. Run it through `npx`, because the command is usually not installed.

- Start a session with `npx cadet-agent@latest state brief`. It prints the phase, the work item, every gate, and the legal edge out of the phase.
- Do not open `.cadet/state.json` to learn the phase. That document holds every closed work item and grows without bound.
- Check the record against the schema with `npx cadet-agent@latest state validate`.
- The package version must match `frameworkVersion` in `.cadet/agent/core/FrameworkManifest.json`. Compare the two when a command reports a field it should know.
- `npx cadet-agent@latest sync` updates managed files and preserves your policies, plans, state, harness overrides and run ledgers. It never adds a component the record does not name; it reports the `init` command that would.
- `npx cadet-agent@latest uninstall --dry-run` prints what a removal would take. A real `uninstall` removes a file only when its hash still matches the record, keeps and names the ones you edited, and for Unreal removes `Plugins/CadetBuild/Binaries/` and `Intermediate/` by rule. It deletes the record last, so a second run exits clean.
- Use a repository wrapper, `Tools/cadet <command>`, when one exists. It runs the same CLI with no network.
- `Assets/Covyne/Cadet/CLI/` and `Plugins/CadetBuild/CLI/` belong to the installed engine product, not to the workflow.

## State and gates

- Workflow state and gate booleans: `.cadet/state.json`
- Harness rules, budgets, and evidence requirements: `.cadet/agent/core/Harness.md`
- Local policies (yours, never overwritten by sync): `.cadet/agent/policies/`

## Changing the framework itself

This section applies only where the repository is the framework source (it has `packages/`, `src/` and `test/`), not where it is a consumer project.

- `npm test` runs the node suite; `npm run test:cli` runs the CLI's own gate; `npm run lint` checks markdown links.
- The suite version lives in four files: `package.json`, `.cadet/agent/core/FrameworkManifest.json`, `packages/cli/VERSION` and `packages/unreal/CadetBuild.uplugin`. `bump-version.ps1` writes all four and reads them back; `test/version-consistency.test.mjs` fails when one drifts.
- `package-agent.ps1` builds the installer payload `cadet-agent.zip` and the hand-drop `cadet-unreal-<version>.zip`.
