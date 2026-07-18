# Claude Code Setup

Use this guide when installing Cadet-Agent into a repository that will use Claude Code.

## Installed Files
Cadet-Agent installs these Claude Code-facing files:
- `.claude/skills/cadet-agent.md`
- `AGENTS.md`
- `.cadet/agent/core/`

## What Each File Does
- `.claude/skills/cadet-agent.md` is the Claude Code skill that anchors the framework.
- `AGENTS.md` supplies shared agent instructions that Claude Code can also use.
- `.cadet/agent/core/` contains the shared Cadet framework documents referenced by the skill.

## Installation
1. Copy `cadet-agent.zip` to the target repository root.
2. Extract it into the repository root.
3. Confirm these paths exist: `.cadet/agent/core/`, `.claude/skills/cadet-agent.md`, and `AGENTS.md`.
4. Open the repository in Claude Code.
5. Verify the skill appears under Claude Code project skills.

## Expected Behavior
- Claude Code should load `.claude/skills/cadet-agent.md` as a project skill.
- The skill should direct the agent to `.cadet/agent/core/README.md` for framework navigation and to `.cadet/agent/core/Workflow.md` plus `.cadet/agent/core/LearnerModel.md` before substantial recommendations or edits.

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add planning artifacts under `.cadet/agent/project-plans`.
- Keep Claude Code-specific instructions thin; extend the shared framework first when the behavior should apply across IDEs.

## Updating
- Replace `.claude/skills/cadet-agent.md`, `AGENTS.md`, and `.cadet/agent/core` from a new package version.
- Preserve `.cadet/agent/policies`, `.cadet/agent/project-plans`, and the rest of the repository.
