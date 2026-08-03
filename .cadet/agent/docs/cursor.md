# Cursor Setup

Use this guide when installing Cadet-Agent into a repository that will use Cursor.

## Installed Files
Cadet-Agent installs these Cursor-facing files:
- `.cursor/rules/cadet-agent.md`
- `.cadet/agent/core/`

## What Each File Does
- `.cursor/rules/cadet-agent.md` is the always-apply Cursor rule that anchors the framework.
- `.cadet/agent/core/` contains the shared Cadet framework documents referenced by the rule.

## Installation
1. From the target repository root, run `npx cadet-agent@latest init`.
2. If you want to install into a different folder, use `npx cadet-agent@latest init --target <path>`.
3. Confirm these paths exist: `.cadet/agent/core/` and `.cursor/rules/cadet-agent.md`.
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
- Replace `.cursor/rules/cadet-agent.md` and `.cadet/agent/core` from a new package version.
- Preserve `.cadet/agent/policies`, `.cadet/agent/project-plans`, and the rest of the repository.