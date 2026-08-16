# Claude Code Setup

Use this guide when installing Cadet-Agent into a repository that will use Claude Code.

## Installed Files
Cadet-Agent installs these Claude Code-facing files:
- `.claude/skills/cadet-agent/SKILL.md` — Base/global skill (always active)
- `.claude/skills/cadet-agent-reviewer/SKILL.md` — Reviewer skill
- `.claude/skills/cadet-requirements/SKILL.md` — Requirements phase skill
- `.claude/skills/cadet-architecture/SKILL.md` — Architecture phase skill
- `.claude/skills/cadet-spike/SKILL.md` — Spike phase skill
- `.claude/skills/cadet-breakdown/SKILL.md` — Story Breakdown phase skill
- `.claude/skills/cadet-tdd/SKILL.md` — TDD phase skill
- `.claude/skills/cadet-debug/SKILL.md` — Debugging phase skill
- `.claude/skills/cadet-review/SKILL.md` — Code Review phase skill
- `.claude/skills/cadet-resume/SKILL.md` — Resume workflow skill
- `.claude/skills/cadet-mcp-setup/SKILL.md` — MCP Setup skill
- `.cadet/agent/core/` — Shared framework documents

## What Each File Does
- `.claude/skills/cadet-agent/SKILL.md` is the base skill that loads automatically. It defines the global directive, skill dispatch table, reviewer mode, operational files, and git guard instructions.
- Each per-phase skill (`cadet-requirements/SKILL.md` through `cadet-mcp-setup/SKILL.md`) is a thin loader with YAML frontmatter. When invoked via `/cadet-<skill>`, it instructs Claude to read `.cadet/agent/core/cadet-agent.md` and then the canonical skill from `.cadet/agent/core/skills/` as primary context.
- `.claude/skills/cadet-agent-reviewer/SKILL.md` is the reviewer skill for auditing without writing code.
- `.cadet/agent/core/` contains the shared Cadet framework documents.

## Installation
1. From the target repository root, run `npx cadet-agent@latest init`.
2. If you want to install into a different folder, use `npx cadet-agent@latest init --target <path>`.
3. Confirm these paths exist: `.cadet/agent/core/` and `.claude/skills/` (with 11 skill folders, each containing a `SKILL.md`).
4. Open the repository in Claude Code.
5. Verify the skills appear under Claude Code project skills.

## Slash Commands

Each Claude Code skill becomes a discoverable slash command:

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
- Claude Code should load `.claude/skills/cadet-agent/SKILL.md` as a project skill (available globally).
- Use `/cadet-<skill>` commands for phase dispatch.
- Each skill command reads the canonical skill from `.cadet/agent/core/skills/` as primary context.
- The base skill enforces gate checks and the full Cadet workflow.

## Git Guard
Claude Code does not have native PreToolUse hooks. The Cadet base skill instructs the model to ask for approval before commits. For additional protection, you can install the git-guard scripts as a manual pre-commit hook:
- PowerShell: `.github/hooks/scripts/git-guard.ps1`
- Bash: `.github/hooks/scripts/git-guard.sh`

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add planning artifacts under `.cadet/agent/project-plans`.
- Keep Claude Code-specific instructions thin; extend the shared framework first when the behavior should apply across IDEs.

## Updating
- Run `npx cadet-agent@latest sync` to update managed framework files.
- Preserved paths: `.cadet/agent/policies`, `.cadet/agent/project-plans`, `.cadet/state.json`.
