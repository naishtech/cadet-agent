# Agent Framework Index

Purpose: Navigation entry point for Cadet-Agent.

## Primary Agent Instruction File

- **[cadet-agent.md](cadet-agent.md)** — The single condensed instruction file the agent reads at runtime. Contains all non-negotiable rules, workflow routing, skill instructions, Unity-specific rules, document rules, Git workflow, framework sync, and context management.

## Framework Artifacts

- **[FrameworkManifest.json](FrameworkManifest.json)** — Distribution contract: managed paths, preserved paths, canonical repository, supported IDEs.
- **[LICENSE.md](LICENSE.md)** — CC BY 4.0 License.

## Operational Files

These files define specific operational workflows. Their rules are also condensed into `cadet-agent.md`.

- [GitFirstRule](GitFirstRule.md) — Git must be initialized before any Unity project or code.
- [FrameworkSyncGate](FrameworkSyncGate.md) — Check for framework updates before substantive work.
- [KickoffFlow](KickoffFlow.md) — Step-by-step kickoff sequence.
- [FirstResponseFormat](FirstResponseFormat.md) — Required format for first response.

## Full Documentation (GitHub Pages)

Rationale, examples, anti-patterns, and detailed process reference are in the [docs/](../../../docs/index.md) directory, deployed to GitHub Pages:

- **Core Concepts**: Identity, Principles, Learner Model, Workflow, Operating Rules
- **Skills**: Detailed process reference for each skill (Requirements, Architecture, StoryBreakdown, TDD, Debugging, Code Review)
- **Guidance**: Preferred patterns and lessons learned (Architecture, Unity, Performance, Debugging, Localization, Spikes, Technology Decisions)
- **Standards**: Mandatory quality bars (Performance, Security, SOLID, Testing)
- **Templates**: Document templates (Requirements, Technical Design, Project Plan, Epic, Policy, ADR)

## Policy System

- Repository-specific policy files live in `.cadet/agent/policies`.
- Create policy files only when the user explicitly requests one.
- Use the Policy Template from docs/ to create new policies.
- Name policy files using `{RepoName}Policy.md`.
- When exactly one policy file exists, treat it as the active policy.
- When multiple exist, choose the best match for the active workspace.
- When none exist, proceed with core framework plus guidance.

## Version Bump Policy

- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, documentation-only clarifications.
- **Minor** (`0.X.0`): new skill, standard, template, guidance, or structural reorganization that adds capability without breaking consumer installs.
- **Major** (`X.0.0`): breaking change to `managedPaths` in `FrameworkManifest.json`, removal of existing skill/standard, or workflow routing change.

Update `FrameworkManifest.json → frameworkVersion` when publishing.



