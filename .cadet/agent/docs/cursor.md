# Cursor Setup

Use this guide when installing Cadet-Agent into a repository that will use Cursor.

## Installed Files
Cadet-Agent installs these Cursor-facing files:
- `.cursor/rules/cadet-agent.md` — Always-apply rule (loads automatically)
- `.cursor/rules/cadet-agent-reviewer.md` — Reviewer rule (enable manually)
- `.cadet/agent/core/` — Shared framework documents

## What Each File Does
- `.cursor/rules/cadet-agent.md` is the `alwaysApply: true` Cursor rule that anchors the framework. It instructs the model to read `.cadet/agent/core/cadet-agent.md` on every turn and dispatches to canonical skill files when a workflow phase is named.
- `.cursor/rules/cadet-agent-reviewer.md` is a separate `alwaysApply: false` rule that turns the Cursor agent into a reviewer-only mode. Enable it when you want to audit Cadet's output without generating code.
- `.cadet/agent/core/` contains the shared Cadet framework documents referenced by the rule.

## Installation
1. From the target repository root, run `npx cadet-agent@latest init`.
2. If you want to install into a different folder, use `npx cadet-agent@latest init --target <path>`.
3. Confirm these paths exist: `.cadet/agent/core/`, `.cursor/rules/cadet-agent.md`, `.cursor/rules/cadet-agent-reviewer.md`.
4. Open the repository in Cursor.
5. Verify the project rule appears under Cursor project rules.

## Expected Behavior
- Cursor should load `.cursor/rules/cadet-agent.md` as an always-apply project rule.
- The rule directs the model to `.cadet/agent/core/cadet-agent.md` for the global directive.
- When you name a workflow phase (e.g., "run the requirements skill", "do a code review"), the model reads the canonical skill from `.cadet/agent/core/skills/<SkillName>.md` as primary context.

## Skill Invocation

Ask for a phase by name:
- "Run the requirements skill" → loads `Requirements.md`
- "Do a code review" → loads `CodeReview.md`
- "Start TDD" → loads `TDD.md`
- "Resume the workflow" → loads resume flow from cadet-agent.md

## Reviewer Mode
1. Open Cursor Settings → Rules.
2. Enable the `cadet-agent-reviewer` rule.
3. Start a new chat or ask: "Act as Cadet Agent Reviewer."
4. The model will audit work against framework rules without writing code.

## Git Guard
Cursor does not have native PreToolUse hooks. The Cadet rule instructs the model to ask for approval before commits. For additional protection, you can install the git-guard scripts as a manual pre-commit hook:
- PowerShell: `.github/hooks/scripts/git-guard.ps1`
- Bash: `.github/hooks/scripts/git-guard.sh`

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add planning artifacts under `.cadet/agent/project-plans`.
- Keep IDE-specific customization thin; extend the shared framework first when the behavior should apply across IDEs.

## Updating
- Run `npx cadet-agent@latest sync` to update managed framework files.
- Preserved paths: `.cadet/agent/policies`, `.cadet/agent/project-plans`, `.cadet/state.json`.