# Continue Setup

Use this guide when installing Cadet-Agent into a repository that will use Continue.

## Installed Files
Cadet-Agent installs these Continue-facing files:
- `.continue/rules/cadet-agent.md`
- `AGENTS.md`
- `agent/core/`

## What Each File Does
- `.continue/rules/cadet-agent.md` is the Continue rule entrypoint for Cadet-Agent.
- `AGENTS.md` provides a shared top-level instruction file.
- `agent/core/` contains the shared Cadet framework documents referenced by the rule.

## Installation
1. Copy `cadet-agent.zip` to the target repository root.
2. Extract it into the repository root.
3. Confirm these paths exist: `agent/core/`, `.continue/rules/cadet-agent.md`, and `AGENTS.md`.
4. Open the repository in VS Code with Continue installed.
5. Verify Continue can see the local rule under `.continue/rules`.

## Expected Behavior
- Continue should load `.continue/rules/cadet-agent.md` as a local project rule.
- The rule should direct the agent to `agent/core/README.md` for framework navigation and to `agent/core/Workflow.md` plus `agent/core/LearnerModel.md` before substantial recommendations or code changes.

## Repository-Specific Extensions
- Add repository policy overlays under `agent/policies`.
- Add planning artifacts under `agent/project-plans`.
- Keep Continue-specific instructions thin unless a behavior is genuinely unique to Continue.

## Updating
- Replace `.continue/rules/cadet-agent.md`, `AGENTS.md`, and `agent/core` from a new package version.
- Preserve `agent/policies`, `agent/project-plans`, and the rest of the repository.