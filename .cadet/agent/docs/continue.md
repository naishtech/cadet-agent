# Continue Setup

Use this guide when installing Cadet-Agent into a repository that will use Continue.

## Installed Files
Cadet-Agent installs these Continue-facing files:
- `.continue/rules/cadet-agent.md` — System rule
- `.continue/rules/cadet-agent-reviewer.md` — Reviewer rule
- `.continue/config.yaml` — Custom slash commands
- `.cadet/agent/core/` — Shared framework documents

## What Each File Does
- `.continue/rules/cadet-agent.md` is the Continue system rule that anchors the framework. It instructs the model to read `.cadet/agent/core/cadet-agent.md` on every turn and dispatches to canonical skill files.
- `.continue/rules/cadet-agent-reviewer.md` is a separate rule for reviewer-only mode.
- `.continue/config.yaml` defines custom slash commands (`/cadet-requirements`, `/cadet-architecture`, etc.) that instruct the model to load the matching canonical skill file.
- `.cadet/agent/core/` contains the shared Cadet framework documents.

## Installation
1. From the target repository root, run `npx cadet-agent@latest init`.
2. If you want to install into a different folder, use `npx cadet-agent@latest init --target <path>`.
3. Confirm these paths exist: `.cadet/agent/core/`, `.continue/rules/cadet-agent.md`, `.continue/config.yaml`.
4. Open the repository in VS Code with Continue installed.
5. Restart Continue or reload the window to pick up new rules and commands.

## Slash Commands

Continue custom commands defined in `.continue/config.yaml`:

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

Each command instructs the model to read the canonical skill from `.cadet/agent/core/skills/` as primary context.

## Expected Behavior
- Continue should load `.continue/rules/cadet-agent.md` as a local project rule.
- The rule directs the model to `.cadet/agent/core/cadet-agent.md` for the global directive.
- Use `/cadet-<skill>` commands for phase dispatch.

## Git Guard
Continue does not have native PreToolUse hooks. The Cadet rule instructs the model to ask for approval before commits. For additional protection, you can install the git-guard scripts as a manual pre-commit hook:
- PowerShell: `.github/hooks/scripts/git-guard.ps1`
- Bash: `.github/hooks/scripts/git-guard.sh`

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add planning artifacts under `.cadet/agent/project-plans`.
- Keep Continue-specific instructions thin unless a behavior is genuinely unique to Continue.

## Updating
- Run `npx cadet-agent@latest sync` to update managed framework files.
- Preserved paths: `.cadet/agent/policies`, `.cadet/agent/project-plans`, `.cadet/state.json`.