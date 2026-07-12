# Cursor Setup

Use this guide when installing Cadet-Agent into a repository that will use Cursor.

## Installed Files
Cadet-Agent installs these Cursor-facing files:
- `.cursor/rules/cadet-agent.md`
- `AGENTS.md`
- `.cadet/agent/core/`

## What Each File Does
- `.cursor/rules/cadet-agent.md` is the always-apply Cursor rule that anchors the framework.
- `AGENTS.md` supplies shared agent instructions that Cursor can also use.
- `.cadet/agent/core/` contains the shared Cadet framework documents referenced by the rule.

## Installation
1. Copy `cadet-agent.zip` to the target repository root.
2. Extract it into the repository root.
3. Confirm these paths exist: `.cadet/agent/core/`, `.cursor/rules/cadet-agent.md`, and `AGENTS.md`.
4. Open the repository in Cursor.
5. Verify the project rule appears under Cursor project rules.

## Expected Behavior
- Cursor should load `.cursor/rules/cadet-agent.md` as an always-apply project rule.
- The rule should direct the agent to `.cadet/agent/core/README.md` for framework navigation and to `.cadet/agent/core/Workflow.md` plus `.cadet/agent/core/LearnerModel.md` before substantial recommendations or edits.

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add planning artifacts under `.cadet/agent/project-plans`.
- Keep IDE-specific customization thin; extend the shared framework first when the behavior should apply across IDEs.

## Updating
- Replace `.cursor/rules/cadet-agent.md`, `AGENTS.md`, and `.cadet/agent/core` from a new package version.
- Preserve `.cadet/agent/policies`, `.cadet/agent/project-plans`, and the rest of the repository.