# Continue Setup

Use this guide when installing Cadet-Agent into a repository that will use Continue.

## Installed Files
Cadet-Agent installs these Continue-facing files:
- `.continue/rules/cadet-agent.md`
- `.cadet/agent/core/`

## What Each File Does
- `.continue/rules/cadet-agent.md` is the Continue rule entrypoint for Cadet-Agent.
- `.cadet/agent/core/` contains the shared Cadet framework documents referenced by the rule.

## Installation
1. From the target repository root, run `npx cadet-agent@latest init`.
2. If you want to install into a different folder, use `npx cadet-agent@latest init --target <path>`.
3. Confirm these paths exist: `.cadet/agent/core/` and `.continue/rules/cadet-agent.md`.
4. Open the repository in VS Code with Continue installed.
5. Verify Continue can see the local rule under `.continue/rules`.

## Expected Behavior
- Continue should load `.continue/rules/cadet-agent.md` as a local project rule.
- The rule should direct the agent to `.cadet/agent/core/README.md` for framework navigation and to `.cadet/agent/core/Workflow.md` plus `.cadet/agent/core/LearnerModel.md` before substantial recommendations or code changes.

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add planning artifacts under `.cadet/agent/project-plans`.
- Keep Continue-specific instructions thin unless a behavior is genuinely unique to Continue.

## Updating
- Replace `.continue/rules/cadet-agent.md` and `.cadet/agent/core` from a new package version.
- Preserve `.cadet/agent/policies`, `.cadet/agent/project-plans`, and the rest of the repository.