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
- Download the Unity `.gitignore` template:
```powershell
Invoke-WebRequest "https://raw.githubusercontent.com/github/gitignore/main/Unity.gitignore" -OutFile .gitignore
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

**Step 5 — Create the Unity project inside this folder:**

The folder already contains `.gitignore`, `README.md`, and the Cadet bootstrap files, so it is non-empty. `unity projects new` / `unity projects create` refuse any existing folder (verified against Unity CLI v1.0.0-beta.4), so project creation stays on the Unity Editor CLI (`-batchmode -createProject`), which has no empty-folder restriction. The Unity CLI handles the editor-management and registration steps around it.

**5a — Install the Editor (if needed):**
```powershell
unity install <version-or-alias> -m <modules>
# examples:
unity install lts
unity install 6000.0.47f1 -m android ios webgl
```
- `<version-or-alias>` may be `lts`, `latest`, or a specific version string (e.g. `6000.0.47f1`).
- If the Unity CLI itself is not installed: Windows `$env:UNITY_CLI_CHANNEL='beta'; irm https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.ps1 | iex`; macOS/Linux `brew install --cask unity-cli` or the install script.
- This replaces the old "open Unity Hub → Installs → add version" step.

**5b — Discover the installed Editor:**
```powershell
unity editors -i --format json
```
- Lists installed editors as structured JSON (including their install paths) — no hardcoded `C:\Program Files\Unity\Hub\Editor` assumption.
- If empty, the editor is not installed (or was installed outside the CLI's registry) — run `unity install <version>` first, or register an existing install with `unity editors add <path>`.
- If more than one version is listed, ask the user to confirm which version to use.

**5c — Create the project via the Unity Editor CLI:**
```powershell
$unityVersion = "<version-confirmed-in-5b>"
$unityExe = "<editor-executable-from-5b-json>"  # e.g. C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe
& $unityExe -batchmode -createProject "$PWD" -quit
```
- `-batchmode -quit` creates the Unity project files (`Assets/`, `Packages/`, `ProjectSettings/`) and exits without opening the editor UI.
- This takes 20–60 seconds. Wait for the process to exit before continuing.
- Once complete, register the project with the Hub and open it:
  - `unity projects add "$PWD"` — register the existing folder in the Hub registry.
  - `unity open "$PWD"` — open it with the resolved editor.

- After the bootstrap state is established on `main` and Unity finishes generating files, create a new branch, commit the scaffold, and merge it through a pull request:
```powershell
git checkout main
git pull --ff-only
git checkout -b chore/unity-initial-scaffold
git add .
git commit -m "chore: initial Unity project scaffold"
git push -u origin chore/unity-initial-scaffold
gh pr create --base main --head chore/unity-initial-scaffold --title "chore: initial Unity project scaffold" --body "Add the initial Unity-generated project scaffold."
gh pr merge --squash --delete-branch
```

Do not proceed to detailed game vision, requirements, or planning until all five steps are complete: remote repo created or confirmed, Git initialized in the folder, bootstrap state established on `main`, Unity project created, and scaffold PR merged.

---

## Backlinks
- Framework index: [README](README.md)
