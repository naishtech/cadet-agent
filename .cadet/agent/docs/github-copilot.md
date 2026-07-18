# GitHub Copilot Setup

Use this guide when installing Cadet-Agent into a repository that will use GitHub Copilot in VS Code or GitHub-hosted Copilot surfaces.

## Installed Files
Cadet-Agent installs these GitHub Copilot-facing files:
- `.github/prompts/cadet.prompt.md`
- `AGENTS.md`
- `.cadet/agent/core/`

## What Each File Does
- `.github/prompts/cadet.prompt.md` is the Cadet `/cadet` slash-command prompt entrypoint.
- `AGENTS.md` provides generic agent instructions that nearby tools can also consume.
- `.cadet/agent/core/` contains the shared Cadet framework that the adapter points at.

## Installation
1. Copy `cadet-agent.zip` to the target repository root.
2. Extract it into the repository root.
3. Confirm these paths exist: `.cadet/agent/core/`, `.github/prompts/cadet.prompt.md`, and `AGENTS.md`.
4. Open the repository in VS Code with GitHub Copilot enabled.
5. Start the Cadet flow: type `/cadet <your objective>` in the Copilot chat.

## Expected Behavior
- The `/cadet` slash command loads `.github/prompts/cadet.prompt.md` which routes behavior through `.cadet/agent/core/Workflow.md`, `.cadet/agent/core/LearnerModel.md`, and the relevant documents under `.cadet/agent/core/Skills`, `.cadet/agent/core/Guidance`, `.cadet/agent/core/Standards`, and `.cadet/agent/core/Templates`.

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add generated planning artifacts under `.cadet/agent/project-plans`.
- Do not edit `.cadet/agent/core` directly in consumer repositories unless you intentionally want to fork the framework.

## Updating
- Treat `.cadet/agent/core/FrameworkManifest.json` as the source for managed versus preserved paths.
- When updating Cadet-Agent from a new package, managed files under `.github/prompts/`, `.cadet/agent/core/`, and IDE adapters will be refreshed. Preserved paths (`.cadet/agent/policies`, `.cadet/agent/project-plans`, and repository code) are never overwritten.