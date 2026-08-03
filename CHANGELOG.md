# Changelog

All notable changes to Cadet-Agent are documented here. Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## Version bump policy
- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, or documentation-only clarifications that do not change agent behavior.
- **Minor** (`0.X.0`): new skill, standard, template, guidance document, or structural reorganization that adds capability or improves routing without breaking existing consumer installs.
- **Major** (`X.0.0`): breaking change to managed paths in `FrameworkManifest.json`, removal of an existing skill or standard, or a workflow routing change that invalidates prior planning artifacts.

Consumers should update `FrameworkManifest.json → frameworkVersion` in their installed copies when syncing a new package.

---

## [0.18.0] — 2026-08-03

### Added
- **Cross-IDE adapter suite**: full parity for Cursor, Continue, and Claude Code — all 8 skills + reviewer mode in every IDE.
  - **Cursor**: Rewritten `.cursor/rules/cadet-agent.md` with robust dispatch instructions. New `.cursor/rules/cadet-agent-reviewer.md` for reviewer-only mode.
  - **Continue**: Rewritten `.continue/rules/cadet-agent.md` with dispatch instructions. New `.continue/rules/cadet-agent-reviewer.md` for reviewer mode. New `.continue/config.yaml` with 9 custom slash commands (`/cadet-requirements` through `/cadet-agent-reviewer`).
  - **Claude Code**: Refined `.claude/skills/cadet-agent.md` base skill with dispatch table. New per-phase skills: `cadet-requirements.md`, `cadet-architecture.md`, `cadet-spike.md`, `cadet-breakdown.md`, `cadet-tdd.md`, `cadet-debug.md`, `cadet-review.md`, `cadet-resume.md`. New `cadet-agent-reviewer.md` reviewer skill.
- `test/adapters.test.mjs` — 122 automated consistency checks across all IDE adapters (file existence, canonical references, YAML frontmatter, gate checks, non-duplication, manifest coverage).
- `ADAPTERS.md` — complete adapter inventory and contract documentation.
- Cross-IDE parity matrix in `README.md`.

### Changed
- `FrameworkManifest.json`: added all new adapter paths to `managedPaths`; fixed missing `cadet-resume.prompt.md`.
- `src/install.mjs`: IDE-specific post-install messages with slash-command syntax and reviewer invocation instructions for each IDE.
- `.cadet/agent/docs/cursor.md`, `continue.md`, `claude-code.md`: updated with accurate file lists, slash-command tables, reviewer instructions, and git guard guidance.

### Fixed
- `FrameworkManifest.json` was missing `.github/prompts/cadet-resume.prompt.md` from `managedPaths`.

## [0.17.0] — 2026-08-03

### Added
- `/cadet-resume` slash-command prompt: inspects `.cadet/state.json`, cross-validates git history and epic/story files for discrepancies, then routes to the correct phase skill.
- Workflow diagram in `README.md` (Mermaid flowchart) showing the full SDLC, resume flow, hard-gate transitions, and phase-gating table.
- `docs/core/skills/Spike.md` and `docs/core/skills/StoryBreakdown.md` reference documentation.

## [0.16.0] — 2026-08-03

### Added
- Scoped Cadet skills under `.cadet/agent/core/skills/` (Requirements, Architecture, Spike, StoryBreakdown, TDD, Debugging, CodeReview).
- GitHub Copilot slash-command prompts under `.github/prompts/` (`/cadet-requirements`, `/cadet-architecture`, `/cadet-spike`, `/cadet-breakdown`, `/cadet-tdd`, `/cadet-debug`, `/cadet-review`).
- `state.schema.json` under `.cadet/agent/core/` defining session state, phases, tracking modes, and hard gates.
- `test/skills.test.mjs` verifying skill files, prompt adapters, manifest entries, thin-directive structure, and state schema.

### Changed
- `cadet-agent.md` is now a thin global directive containing identity, non-negotiable rules, workflow routing, hard-gate protocol, state management, and skill dispatch. Detailed workflow-phase instructions have moved to skill files.
- IDE adapter files updated to reference the thin directive and the skills directory.
- `package-agent.ps1` now stages `.github/prompts/` and `.cadet/agent/core/skills/` into the consumer zip.
- `FrameworkManifest.json` managed paths now include `.cadet/agent/core/skills/`, `.cadet/agent/core/state.schema.json`, and all `.github/prompts/cadet-*.prompt.md` files. `preservedPaths` now also includes `.cadet/state.json`.
- `.gitignore` now excludes user-reserved `.cadet/agent/project-plans/` and `.cadet/cadet-local-config.md` from the framework repository.
- `README.md`, `CONTRIBUTING.md`, `docs/index.md`, and `.cadet/agent/core/README.md` updated to describe the directive + skill architecture.

## [0.15.0] — 2026-08-03

### Added
- npx-based CLI (`cadet-agent`) for one-command install and sync from GitHub Releases.
- Cadet Agent Reviewer agent (`.github/agents/cadet-agent-reviewer.agent.md`).
- Git guard hooks (`.github/hooks/`) for bash and PowerShell.
- XML tag convention (`<slot/>`, `<gate/>`, `<output/>`) in `cadet-agent.md`.
- Runtime templates under `.cadet/agent/core/templates/`.
- `state.schema.json` for session state validation.
- Smoke tests for version normalization, path matching, header building, and ZIP parsing.

### Changed
- Condensed `cadet-agent.md` updated with XML tag convention, hard gates protocol, and template path policy.
- Framework version tracking moved to `FrameworkManifest.json`.
- Post-install UX now directs Copilot users to the agent picker instead of `/cadet`.

### Removed
- `AGENTS.md`, `.github/cadet-copilot-instructions.md`, `.github/prompts/`, `.cadet/orchestrator/`, `verify-coverage.sh` (deprecated by condensation and CLI).

### Fixed
- Version comparison now normalizes `v` prefix from GitHub release tags.
- ZIP extraction now awaits write stream completion.
- `GITHUB_TOKEN`/`GH_TOKEN` now sent in API requests when present.

---

## [0.5.0] — 2026-07-19

### Changed
- **Framework condensation:** Collapsed 36+ markdown files into a single `cadet-agent.md` (~150 lines) as the primary agent instruction file. Full rationale, guidance, standards, templates, and skills reference moved to `docs/` for GitHub Pages deployment.
- **Orchestrator classify:** Replaced keyword-based change classification with explicit path validation (`large|small|no_test_required`). The LLM determines the path by asking the user; the orchestrator validates and sets state.
- **Orchestrator in package:** `.cadet/orchestrator/` now ships in the distributed zip as part of `managedPaths`.
- **Build pipeline:** `package-agent.ps1` includes orchestrator directory and validates `cadet-agent.md` existence before packaging.
- **AGENTS.md:** Updated to reference `cadet-agent.md` as the single primary instruction file.
- **README.md:** Restructured to point to docs/ for full documentation.

### Added
- `verify-coverage.sh` — instruction-loss verification script for auditing condensed coverage.
- `docs/coverage-report.md` — manual audit tracing every source instruction to its disposition.
- `docs/index.md` — GitHub Pages landing page with navigation.
- `.github/workflows/pages.yml` — GitHub Actions workflow for docs deployment.

---

## [0.4.0] — 2026-07-18

### Added
- Claude Code IDE adapter: `.claude/skills/cadet-agent.md` skill file referencing the `.cadet/agent/core/` framework.
- Claude Code setup documentation at `.cadet/agent/docs/claude-code.md`.

### Changed
- Updated `FrameworkManifest.json` to include `claude-code` in `supportedIDEs` and `.claude/skills/cadet-agent.md` in `managedPaths`.
- Updated `package-agent.ps1` to package `.claude/` alongside the other IDE adapters.
- Updated `README.md` to list Claude Code as a supported IDE.

---

## [0.3.0] — 2026-07-12

### Changed
- **Breaking:** Moved `agent/` → `.cadet/agent/` so framework files live under `.cadet/` alongside the orchestrator.
- Updated `FrameworkManifest.json` managed and preserved paths to reflect new `.cadet/agent/` root.
- Updated `package-agent.ps1` to source from and package to `.cadet/agent/core/`.
- Updated all IDE adapter files (`AGENTS.md`, `.github/cadet-copilot-instructions.md`, `.cursor/rules/cadet-agent.md`, `.continue/rules/cadet-agent.md`, `.github/prompts/cadet.prompt.md`) to reference `.cadet/agent/` paths.
- Renamed `.cursor/rules/cadet-agent.mdc` → `.cursor/rules/cadet-agent.md` (old `.mdc` file is not removed by package extraction — consumers upgrading from 0.2.0 must delete the stale `.mdc` file manually).
- Updated `README.md`, `CONTRIBUTING.md` to reflect new layout.
- **Breaking:** Renamed `.github/copilot-instructions.md` → `.github/cadet-copilot-instructions.md` to avoid overwriting pre-existing Copilot instructions. Consumers upgrading from 0.2.0 must delete the stale `.github/copilot-instructions.md` and follow the activation steps in `.cadet/agent/docs/github-copilot.md`.

### Added
- `Skills/Orchestrator.md` — declarative skill document defining the orchestrator pattern for Cadet-Agent workflow coordination.
- `.cadet/orchestrator/` — bash implementation of the orchestrator with CLI entry point, JSON state management, and bats test suite (45 tests).

---

## [0.2.0] — 2026-06-01

### Added
- `agent/core/Guidance/SpikePatterns.md` — consolidated spike guidance (feasibility-question-first, separation from production, cleanup prompt after completion).
- `agent/core/Templates/ExamplePolicy.md` — worked example policy showing every PolicyTemplate section filled with concrete fictional rules.
- `CHANGELOG.md` with version bump policy.
- `CONTRIBUTING.md` covering fork/branch/PR conventions, managed-path explanation, and local build instructions.
- `.gitignore` excluding build outputs (`cadet-agent.zip`, `cadet-agent-updated.zip`).
- GitHub Actions `ci.yml` — package build and markdown link-check jobs on push/PR to `main`.
- GitHub Actions `release.yml` — tag-triggered release job that attaches `cadet-agent.zip` as a release asset.
- Manifest validation in `package-agent.ps1` that cross-checks every `managedPaths` entry against the local source tree before staging.

### Changed
- `Identity.md` — mission and scope now explicitly state Unity and C# as the primary and intended targets.
- `LearnerModel.md` — added a Scope Note confirming the model is calibrated for Unity/C# workflows.
- `Workflow.md` — renamed `## Validation` section to `## Step 4` so the step-numbered execution path is complete.
- Spike guidance in `Workflow.md`, `Principles.md`, `Guidance/ArchitecturePatterns.md`, and `Skills/CodeReview.md` slimmed to cross-references pointing to the new `SpikePatterns.md`.
- `agent/core/README.md` — version bump policy added; `SpikePatterns` added to Guidance index.
- `agent/core/Templates/PolicyTemplate.md` — added cross-reference to `ExamplePolicy.md`.
