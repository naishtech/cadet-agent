# Git-First Rule — Required Before Any Code or Unity Project Creation

Every new game project must initialize Git before any Unity project is created and before any substantive project code is written.

The packaged Cadet bootstrap files extracted from `cadet-agent.zip` are the one allowed pre-Git exception because they exist only to install the framework snapshot needed to run `/cadet`.

**Why this matters:**
- Unity generates hundreds of files on first open. Without Git already in place, the initial project state is never captured and the earliest history is permanently lost.
- A remote repository on GitHub gives you an off-machine backup from day one, enables branching and pull-request workflows, and makes it possible to roll back to any known-good state.
- Setting Git up after a project already exists is error-prone: `.gitignore` is often missed, large or generated files get committed, and the history starts in a messy state.

**Prerequisites — what the user does before typing `/cadet`:**
1. Create a project folder, e.g. `C:\dev\MyGame`.
2. Copy `cadet-agent.zip` into that folder and extract it — this installs a bootstrap snapshot at `.cadet\agent\core\`, `.github\prompts\cadet.prompt.md`, `.cursor\rules\cadet-agent.md`, `.continue\rules\cadet-agent.md`, `.claude\skills\cadet-agent.md`, and `AGENTS.md`.
3. Open VS Code with that folder as the workspace root.
4. Type `/cadet <objective>` to begin the framework sync gate before substantive work starts.

The packaged files are a bootstrap snapshot so Cadet can start immediately, but the canonical source of truth for framework updates is the Cadet-Agent repository.

---

## Backlinks
- Framework index: [README](README.md)
