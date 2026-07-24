# GitHub Copilot Setup

Use this guide when installing Cadet-Agent into a repository that will use GitHub Copilot in VS Code.

## Installed Files
Cadet-Agent installs these GitHub Copilot-facing files:
- `.github/agents/cadet.agent.md`
- `.cadet/agent/core/`

## What Each File Does
- `.github/agents/cadet.agent.md` defines the **Cadet** custom agent. Select it from the agent picker in Copilot Chat.
- `.cadet/agent/core/` contains the shared Cadet framework instructions.

## Installation
1. Copy `cadet-agent.zip` to the target repository root.
2. Extract it into the repository root.
3. Confirm these paths exist: `.cadet/agent/core/` and `.github/agents/cadet.agent.md`.
4. Open the repository in VS Code with GitHub Copilot enabled.
5. Select the **Cadet** agent from the agent picker in Copilot Chat and describe your task.

## Expected Behavior
The Cadet agent reads `.cadet/agent/core/cadet-agent.md` which routes behavior through workflow classification, skill dispatch, and all non-negotiable rules.

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add generated planning artifacts under `.cadet/agent/project-plans`.
- Do not edit `.cadet/agent/core` directly in consumer repositories unless you intentionally want to fork the framework.

## Updating
- Treat `.cadet/agent/core/FrameworkManifest.json` as the source for managed versus preserved paths.
- When updating Cadet-Agent from a new package, managed files under `.github/prompts/`, `.cadet/agent/core/`, and IDE adapters will be refreshed. Preserved paths (`.cadet/agent/policies`, `.cadet/agent/project-plans`, and repository code) are never overwritten.