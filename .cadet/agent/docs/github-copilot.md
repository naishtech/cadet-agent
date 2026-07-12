# GitHub Copilot Setup

Use this guide when installing Cadet-Agent into a repository that will use GitHub Copilot in VS Code or GitHub-hosted Copilot surfaces.

## Installed Files
Cadet-Agent installs these GitHub Copilot-facing files:
- `.github/cadet-copilot-instructions.md`
- `.github/prompts/cadet.prompt.md`
- `AGENTS.md`
- `.cadet/agent/core/`

## What Each File Does
- `.github/cadet-copilot-instructions.md` provides repository-wide Copilot instructions (namespaced so it never overwrites your own `.github/copilot-instructions.md`).
- `.github/prompts/cadet.prompt.md` is the Cadet kickoff prompt entrypoint.
- `AGENTS.md` provides generic agent instructions that nearby tools can also consume.
- `.cadet/agent/core/` contains the shared Cadet framework that the adapter points at.

## Activating Cadet Copilot Instructions

GitHub Copilot only reads `.github/copilot-instructions.md` — it will not pick up the namespaced `cadet-copilot-instructions.md` automatically. Choose one:

**If you do NOT have your own `.github/copilot-instructions.md`:**
Rename (or symlink) `.github/cadet-copilot-instructions.md` → `.github/copilot-instructions.md`.

**If you already have `.github/copilot-instructions.md`:**
Merge the contents of `.github/cadet-copilot-instructions.md` into your existing file. On future Cadet syncs, `cadet-copilot-instructions.md` will be refreshed; re-merge any new Cadet content into your file.

## Installation
1. Copy `cadet-agent.zip` to the target repository root.
2. Extract it into the repository root.
3. Confirm these paths exist: `.cadet/agent/core/`, `.github/cadet-copilot-instructions.md`, `.github/prompts/cadet.prompt.md`, and `AGENTS.md`.
4. Activate the Copilot instructions using one of the methods above.
5. Open the repository in VS Code with GitHub Copilot enabled.
6. Start the Cadet flow through the prompt entrypoint referenced by `.github/prompts/cadet.prompt.md`.

## Expected Behavior
- Copilot should pick up `.github/copilot-instructions.md` automatically for repository-scoped work (after activation above).
- The Cadet prompt should route behavior through `.cadet/agent/core/Workflow.md`, `.cadet/agent/core/LearnerModel.md`, and the relevant documents under `.cadet/agent/core/Skills`, `.cadet/agent/core/Guidance`, `.cadet/agent/core/Standards`, and `.cadet/agent/core/Templates`.

## Repository-Specific Extensions
- Add repository policy overlays under `.cadet/agent/policies`.
- Add generated planning artifacts under `.cadet/agent/project-plans`.
- Do not edit `.cadet/agent/core` directly in consumer repositories unless you intentionally want to fork the framework.

## Updating
- Treat `.cadet/agent/core/FrameworkManifest.json` as the source for managed versus preserved paths.
- When updating Cadet-Agent from a new package, replace managed files (`.github/cadet-copilot-instructions.md` will be refreshed) and preserve `.cadet/agent/policies`, `.cadet/agent/project-plans`, your own `.github/copilot-instructions.md`, and repository code.