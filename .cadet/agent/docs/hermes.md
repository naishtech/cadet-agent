# Hermes Setup

Use this guide when installing Cadet-Agent into a repository that will use [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) (`hermes`).

## Installed Files

Cadet-Agent installs these Hermes-facing files (shared with Deep Code under the cross-client skills root):

- `.agents/skills/cadet-agent/SKILL.md` — Base/global skill (always active)
- `.agents/skills/cadet-agent-reviewer/SKILL.md` — Reviewer skill
- `.agents/skills/cadet-requirements/SKILL.md` — Requirements phase skill
- `.agents/skills/cadet-architecture/SKILL.md` — Architecture phase skill
- `.agents/skills/cadet-spike/SKILL.md` — Spike phase skill
- `.agents/skills/cadet-breakdown/SKILL.md` — Story Breakdown phase skill
- `.agents/skills/cadet-tdd/SKILL.md` — TDD phase skill
- `.agents/skills/cadet-debug/SKILL.md` — Debugging phase skill
- `.agents/skills/cadet-review/SKILL.md` — Code Review phase skill
- `.agents/skills/cadet-resume/SKILL.md` — Resume workflow skill
- `.agents/skills/cadet-mcp-setup/SKILL.md` — MCP Setup skill
- `.cadet/agent/core/` — Shared framework documents

Cadet ships no `.hermes/` directory: Hermes discovers project skills in `.agents/skills/` natively.

## What Each File Does

- `.agents/skills/cadet-agent/SKILL.md` is the base skill Hermes discovers as a project skill. It points at the canonical instructions; the global directive, skill dispatch table, reviewer mode, operational files, and git guard instructions live in `.cadet/agent/core/`.
- Each per-phase skill (`cadet-requirements/SKILL.md` through `cadet-mcp-setup/SKILL.md`) is a thin loader with YAML frontmatter. When invoked via `/cadet-<skill>`, it instructs the agent to read `.cadet/agent/core/cadet-agent.md` and then the canonical skill from `.cadet/agent/core/skills/` as primary context.
- `.agents/skills/cadet-agent-reviewer/SKILL.md` is the reviewer skill for auditing without writing code.
- `.cadet/agent/core/` contains the shared Cadet framework documents.

## Installation

1. Install Hermes and pick a model (`hermes` walks through provider setup on first run; `hermes doctor` verifies health).
2. From the target repository root, run `npx cadet-agent@latest init`.
3. Confirm these paths exist: `.cadet/agent/core/` and `.agents/skills/` (with skill folders, each containing a `SKILL.md`).
4. Inside the repository, run `hermes skills trust` once so project skills load.
5. Verify the `cadet-*` skills appear under `/skills` tagged `[project]`.

## Slash Commands

Each project skill becomes a discoverable slash command:

| Command | Purpose |
|---|---|
| `/cadet-requirements` | Capture Given/When/Then acceptance criteria |
| `/cadet-architecture` | Produce technical design and ADRs |
| `/cadet-spike` | Answer feasibility questions for unverified assumptions |
| `/cadet-breakdown` | Decompose into epics and stories |
| `/cadet-tdd` | Red/green test-first implementation |
| `/cadet-debug` | Reproduce, isolate, and fix defects |
| `/cadet-review` | Non-skippable code review |
| `/cadet-resume` | Inspect state.json and resume workflow |
| `/cadet-agent-reviewer` | Audit work against framework rules |

## Expected Behavior

- Hermes should discover `.agents/skills/cadet-agent/SKILL.md` as a project skill (highest-precedence tier, `[project]` tag).
- Use `/cadet-<skill>` commands for phase dispatch.
- Each skill command reads the canonical skill from `.cadet/agent/core/skills/` as primary context.
- The base skill enforces gate checks and the full Cadet workflow through `.cadet/state.json`.

## Git Guard

Hermes does not have native PreToolUse hooks. The Cadet base skill instructs the model to ask for approval before commits; additionally, enable Hermes' command approval policies so `git commit` and `git push` require confirmation. See `docs/guidance/Hermes.md` for details.

## Repository-Specific Extensions

- Add repository policy overlays under `.cadet/agent/policies`.
- Add planning artifacts under `.cadet/agent/project-plans`.
- Keep Hermes-specific instructions thin; extend the shared framework first when the behavior should apply across IDEs.

## Updating

- Run `npx cadet-agent@latest sync` to update managed framework files.
- Preserved paths: `.cadet/agent/policies`, `.cadet/agent/project-plans`, `.cadet/state.json`.
