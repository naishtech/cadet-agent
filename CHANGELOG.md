# Changelog

All notable changes to Cadet-Agent are documented here. Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## Version bump policy
- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, or documentation-only clarifications that do not change agent behavior.
- **Minor** (`0.X.0`): new skill, standard, template, guidance document, or structural reorganization that adds capability or improves routing without breaking existing consumer installs.
- **Major** (`X.0.0`): breaking change to managed paths in `FrameworkManifest.json`, removal of an existing skill or standard, or a workflow routing change that invalidates prior planning artifacts.

Consumers should update `FrameworkManifest.json → frameworkVersion` in their installed copies when syncing a new package.

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
