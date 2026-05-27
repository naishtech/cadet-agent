# Cursor Setup

Use this guide when installing Cadet-Agent into a repository that will use Cursor.

## Installed Files
Cadet-Agent installs these Cursor-facing files:
- `.cursor/rules/cadet-agent.mdc`
- `AGENTS.md`
- `agent/core/`

## What Each File Does
- `.cursor/rules/cadet-agent.mdc` is the always-apply Cursor rule that anchors the framework.
- `AGENTS.md` supplies shared agent instructions that Cursor can also use.
- `agent/core/` contains the shared Cadet framework documents referenced by the rule.

## Installation
1. Copy `cadet-agent.zip` to the target repository root.
2. Extract it into the repository root.
3. Confirm these paths exist: `agent/core/`, `.cursor/rules/cadet-agent.mdc`, and `AGENTS.md`.
4. Open the repository in Cursor.
5. Verify the project rule appears under Cursor project rules.

## Expected Behavior
- Cursor should load `.cursor/rules/cadet-agent.mdc` as an always-apply project rule.
- The rule should direct the agent to `agent/core/README.md` for framework navigation and to `agent/core/Workflow.md` plus `agent/core/LearnerModel.md` before substantial recommendations or edits.

## Repository-Specific Extensions
- Add repository policy overlays under `agent/policies`.
- Add planning artifacts under `agent/project-plans`.
- Keep IDE-specific customization thin; extend the shared framework first when the behavior should apply across IDEs.

## Updating
- Replace `.cursor/rules/cadet-agent.mdc`, `AGENTS.md`, and `agent/core` from a new package version.
- Preserve `agent/policies`, `agent/project-plans`, and the rest of the repository.