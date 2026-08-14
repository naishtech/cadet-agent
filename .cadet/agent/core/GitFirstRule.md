# Git-First Rule — Required Before Any Code or Unity Project Creation

Every new game project must initialize Git before any Unity project is created and before any substantive project code is written.

The packaged Cadet bootstrap files extracted from `cadet-agent.zip` are the one allowed pre-Git exception because they exist only to install the framework snapshot needed to run the Cadet agent.

**Why this matters:**
- Unity generates hundreds of files on first open. Without Git already in place, the initial project state is never captured and the earliest history is permanently lost.
- A remote repository on GitHub gives you an off-machine backup from day one, enables branching and pull-request workflows, and makes it possible to roll back to any known-good state.
- Setting Git up after a project already exists is error-prone: `.gitignore` is often missed, large or generated files get committed, and the history starts in a messy state.

**Prerequisites — what the user does before using the Cadet agent:**
1. Create a project folder, e.g. `C:\dev\MyGame`.
2. Run `npx cadet-agent@latest init --target .` from that folder — this installs a bootstrap snapshot at `.cadet\agent\core\`, `.github\agents\cadet.agent.md`, `.cursor\rules\cadet-agent.md`, `.continue\rules\cadet-agent.md`, and `.claude\skills\cadet-agent.md`.
3. Open VS Code with that folder as the workspace root.
4. Select the **Cadet** agent from the agent picker in Copilot Chat and describe your objective to begin the framework sync gate before substantive work starts.

The packaged files are a bootstrap snapshot so Cadet can start immediately, but the canonical source of truth for framework updates is the Cadet-Agent repository.

---

## Branch Status Check — Before Starting New Work

Before beginning a brand-new task (anything that is not a continuation of work already in progress), establish the state of the current branch:

1. Run `git branch --show-current` and `git status --short`.
2. **Clean tree on `main`** — start the new task on a new branch: `git checkout -b feature/<task-name>` from `main`.
3. **Uncommitted or unpushed changes from a previous task** — do not silently continue. Ask the user how to proceed:
   - **Commit** the changes (with explicit approval),
   - **Stash** them for later,
   - **Push** them to the current branch, or
   - **Create a new branch** from `main` and move the work there before continuing.
4. **Continuation of in-progress work** (the current branch matches the active task) — continue on the current branch; do not ask to branch or stash.
5. Only start making further changes after the branch state is resolved.

---

## Backlinks
- Framework index: [README](README.md)
