# Framework Sync Gate — Required Before Substantive Work

Before Cadet begins planning, implementation, or project bootstrap actions, it should treat the packaged framework as a bootstrap snapshot and resolve whether a newer framework release is available.

- Read `.cadet/agent/core/FrameworkManifest.json` to determine the packaged framework version, canonical repository, managed paths, and preserved paths.
- Use the canonical repository `https://github.com/naishtech/cadet-agent` as the source of truth for framework-managed files.
- Prefer syncing from tagged releases or another explicitly declared stable release channel rather than assuming `main` is safe for consumers.
- Update only framework-managed files during bootstrap sync:
  - `.github/agents/cadet.agent.md`
  - `.cursor/rules/**`
  - `.continue/rules/**`
  - `.claude/skills/**`
  - `.cadet/agent/core/**`
- Preserve repository-local files unless the user explicitly approves broader changes:
  - `.cadet/agent/policies/**`
  - `.cadet/agent/project-plans/**`
  - project code, assets, and other repository content outside the managed framework paths
- Before applying a framework update, tell the user what will be updated and what will be preserved.
- If Cadet updates any framework files under `.cadet/agent/core`, stop after the update and instruct the user to start a fresh chat so the new instructions are loaded.
- If the update check fails, the user is offline, or the canonical repo cannot be reached, continue using the packaged snapshot and explicitly state that the session is running in fallback mode. The agent must state the specific reason for fallback (e.g., no internet, repo unreachable, manifest missing).

**Step 1 — Check for `gh` CLI:**
- Run `gh --version` to detect whether the GitHub CLI is installed.
- If not installed, offer to install it:
  - Windows: `winget install --id GitHub.cli`
  - macOS: `brew install gh`
  - After install, run `gh auth login` and walk the user through authentication.
- If the user declines `gh` installation, give them the manual steps: create a repository on github.com, then continue from Step 3 using the remote URL.

**Step 2 — Create the remote repository (no clone — the folder already exists):**
- Ask the user for the repository name and whether it should be public or private.
- Create the remote only; do not clone (that would require an empty folder):
```powershell
gh repo create <repo-name> --private
```
- Do not use `--source`, `--remote`, `--push`, or other options that assume the current folder is already a Git repository.
- Do not combine remote creation with `git init` in one chained command; finish Step 2 first, then run Step 3.
- Capture the remote URL:
```powershell
$remoteUrl = gh repo view <repo-name> --json url -q .url
$remoteUrl = "$remoteUrl.git"
# Or if the owner/name is already known:
$remoteUrl = "https://github.com/<github-username>/<repo-name>.git"
```

**Step 3 — Initialize Git in the existing folder and connect to the remote:**
```powershell
git init
git remote add origin $remoteUrl
```
- This is safe to run with files already present. Nothing is deleted or moved.

**Step 4 — Bootstrap commit: `.gitignore`, `README.md`, and agent docs:**
- Download the engine's `.gitignore` template from `https://github.com/github/gitignore`; the engine pack names the file to take:
```powershell
Invoke-WebRequest "https://raw.githubusercontent.com/github/gitignore/main/<Engine>.gitignore" -OutFile .gitignore
```
- Ask the user for a one-line game description and create `README.md` with it.
- The agent docs from the extracted zip are already in `agent\core\` — include them.
- If the remote repository is empty and has no default branch yet, create the first bootstrap commit on local `main` and push it once to establish the remote default branch:
```powershell
git add .
git commit -m "chore: project bootstrap — readme, gitignore, Cadet-Agent framework"
git push -u origin main
```
- After `main` exists on the remote, return to the normal PR-based workflow for all later changes.
- If the remote already has a default branch, create a bootstrap branch, commit, push that branch, and merge through a pull request:
```powershell
git checkout -b chore/bootstrap-framework
git add .
git commit -m "chore: project bootstrap — readme, gitignore, Cadet-Agent framework"
git push -u origin chore/bootstrap-framework
gh pr create --base main --head chore/bootstrap-framework --title "chore: bootstrap framework" --body "Bootstrap readme, gitignore, and Cadet-Agent framework files."
gh pr merge --squash --delete-branch
```

**Step 5 — Create the project with the engine's own tooling.**

The folder already contains `.gitignore`, `README.md`, and the Cadet bootstrap files, so it is not empty. Some engines refuse to create a project in a folder that already holds files, and others do not, so the pack states the route that works: create in place when the engine allows it, or create beside the folder and move the generated tree in. The pack names every command in this step; this file names the sequence and the waiting points.

**5a — Install the editor (if needed):**
- Use the pack's install command and its aliases for a version or a release channel.
- If the engine's own CLI is missing, the pack names how to install it.
- This replaces the manual "open the launcher → Installs → add version" step.

**5b — Discover the installed editor:**
- Run the pack's command that lists installed editors as structured output, so no install path is assumed.
- If the list is empty, the editor is not installed, or it was installed outside the tool's registry; the pack names how to register an existing install.
- If more than one version is listed, ask the user to confirm which version the project uses. Do not choose for them.

**5c — Create the project files, then register and open the project:**
- Run the engine's create command with the version confirmed in 5b, pointed at the current folder.
- This takes between seconds and minutes, and the engine writes hundreds of files. Wait for the process to exit before continuing: a commit taken mid-write captures a half-built project.
- Register the folder with the engine's launcher, then open it, using the pack's commands. Registration is what makes the editor and the project agree about the version.
- Confirm the generated marker exists — the pack names it (a project descriptor, or the settings folder). If it is absent, the create step failed; report that instead of committing.

- After the bootstrap state is established on `main` and the engine has finished generating files, create a new branch, commit the scaffold, and merge it through a pull request:
```powershell
git checkout main
git pull --ff-only
git checkout -b chore/initial-engine-scaffold
git add .
git commit -m "chore: initial engine-generated project scaffold"
git push -u origin chore/initial-engine-scaffold
gh pr create --base main --head chore/initial-engine-scaffold --title "chore: initial project scaffold" --body "Add the initial engine-generated project scaffold."
gh pr merge --squash --delete-branch
```

Do not proceed to detailed game vision, requirements, or planning until all five steps are complete: remote repo created or confirmed, Git initialized in the folder, bootstrap state established on `main`, the project created by its engine, and scaffold PR merged.

---

## Backlinks
- Framework index: [README](README.md)
