# Contributing to Cadet-Agent

Thank you for your interest in improving Cadet-Agent. This document covers how to propose changes, what the managed-path boundaries are, and how to test your changes locally before opening a pull request.

## License
Cadet-Agent is distributed under [CC BY 4.0](agent/core/LICENSE.md). By submitting a contribution you agree that your changes will be released under the same license. Attribution to the original work must be preserved in any derivative distribution.

## Branch and PR requirements
All changes must happen on a feature branch. Direct commits to `main` are not permitted.

1. Fork the repository (external contributors) or create a branch (collaborators).
2. Name the branch descriptively: `feature/spike-patterns-guidance`, `fix/workflow-step4-rename`, etc.
3. Open a pull request against `main`.
4. Squash-merge is the preferred integration strategy unless a specific exception is agreed in the PR.
5. Do not force-push to `main`. Rebase your branch to stay current with `main` and use `--force-with-lease` only when rewriting your own branch history intentionally.

## Managed paths explained
`agent/core/FrameworkManifest.json` lists the paths that Cadet-Agent owns and distributes in the bootstrap package. Any change to a managed path affects every consumer who installs Cadet-Agent from the zip.

**Managed paths** (owned by Cadet-Agent, overwritten on sync):
- `agent/core/`
- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/prompts/cadet.prompt.md`
- `.cursor/rules/cadet-agent.mdc`
- `.continue/rules/cadet-agent.md`

**Preserved paths** (owned by the consumer, never overwritten by a Cadet update):
- `agent/policies/`
- `agent/project-plans/`

If you add a new managed path, update `FrameworkManifest.json → managedPaths` in the same PR.

## Version bump rules
Follow the policy defined in [agent/core/README.md](agent/core/README.md#version-bump-policy):
- **Patch**: wording correction, broken-link fix, or doc-only clarification.
- **Minor**: new skill, standard, template, or guidance document; structural reorganization.
- **Major**: breaking change to managed paths, removal of an existing skill or standard, or a workflow routing change that invalidates prior planning artifacts.

Update `agent/core/FrameworkManifest.json → frameworkVersion` in the same PR as your content change. Update `CHANGELOG.md` with an entry under the new version number.

## Testing your changes locally

### 1. Run the package script
```powershell
./package-agent.ps1
```
The script validates that every managed path in `FrameworkManifest.json` exists in the local source tree, then stages and zips the package. A clean run exits with code 0 and prints a file count and zip size. Any missing path causes an immediate exit with a descriptive error.

### 2. Verify the zip contents
```powershell
Expand-Archive .\cadet-agent.zip -DestinationPath .\cadet-agent-test -Force
Get-ChildItem .\cadet-agent-test -Recurse
Remove-Item .\cadet-agent-test -Recurse -Force
```
Confirm all expected paths are present and no unexpected files were included.

### 3. Check markdown links
The CI `links` job uses [lychee](https://github.com/lycheeverse/lychee) in offline mode to verify all internal markdown links are valid. You can run a local equivalent:
```powershell
# Using lychee if installed
lychee --offline --include-fragments 'agent/core/**/*.md' 'agent/docs/**/*.md' '*.md'
```
Fix any broken links before pushing.

## What to put where
| Type of change | Location |
|---|---|
| Framework behavior, workflow, standards, skills, templates | `agent/core/` |
| IDE-specific adapter (Copilot, Cursor, Continue) | IDE-specific root path (e.g. `.github/`, `.cursor/`) |
| Repository-specific conventions | `agent/policies/{RepoName}Policy.md` (not in this repo) |
| Planning artifacts | `agent/project-plans/` (not in this repo) |
| Setup documentation | `agent/docs/` |

## Questions
Open a GitHub Discussion or an issue on the [canonical repository](https://github.com/naishtech/cadet-agent) before starting large structural changes so the direction can be agreed before implementation.
