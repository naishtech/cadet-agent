# Agent Framework Index

Purpose: Navigation entry point for Cadet-Agent.

## Primary Agent Instruction File

- **[cadet-agent.md](cadet-agent.md)** — The thin global directive the agent reads at runtime. Contains identity, non-negotiable rules, workflow routing, hard-gate protocol, state management, skill dispatch, Unity-specific rules, document rules, Git workflow, framework sync, and context management.

## Skills

Workflow phases are implemented as scoped skills under **[skills/](skills/)**. When a phase is dispatched, the matching skill becomes the primary instruction context:

- [PlanningReview](skills/PlanningReview.md)
- [Requirements](skills/Requirements.md)
- [Architecture](skills/Architecture.md)
- [Spike](skills/Spike.md)
- [StoryBreakdown](skills/StoryBreakdown.md)
- [TDD](skills/TDD.md)
- [Debugging](skills/Debugging.md)
- [CodeReview](skills/CodeReview.md)
- [Resume](skills/Resume.md)
- [MCPSetup](skills/MCPSetup.md)
- [AgentReviewer](skills/AgentReviewer.md)

For GitHub Copilot, these skills are also exposed as slash-command prompts under `.github/prompts/`.

## Framework Artifacts

- **[FrameworkManifest.json](FrameworkManifest.json)** — Distribution contract: managed paths, preserved paths, canonical repository, supported IDEs.
- **[Harness.md](Harness.md)** — Harness rules: budgets, evidence-backed gates, retries, context tiers, tool routing, privacy, and escalation.
- **[harness.schema.json](harness.schema.json)** — JSON Schema for harness policy, run ledgers, spans, evidence, decisions, and state v2.
- **[state.schema.json](state.schema.json)** — Session state schema (v1 and v2). See `docs/core/HarnessContract.md` for the frozen contract.
- **[LICENSE.md](LICENSE.md)** — CC BY 4.0 License.

## Harness

Cadet runs under an observable, bounded harness. In short:

- A gate is `true` only when backed by fresh, structured evidence in `.cadet/state.json → gateEvidence`.
- Every run records a sanitized ledger under `.cadet/runs/<runId>.json` (no secrets, no raw prompts by default).
- Budgets and limits live in `.cadet/harness.json` (repository overrides) with conservative defaults defined in `src/harness/policy.mjs`.
- The CLI enforces the rules:

```bash
cadet-agent state validate          # validate state against the schema
cadet-agent state migrate           # atomically upgrade v1 → v2
cadet-agent state transition --to <phase>
cadet-agent harness verify --gate <gate>
cadet-agent harness report
cadet-agent harness cleanup
cadet-agent harness capabilities
```

Read `Harness.md` for the full contract. See `docs/core/HarnessContract.md` for the frozen data contract and compatibility invariants.

## Operational Files

These files define specific operational workflows. Their rules are also condensed into `cadet-agent.md`.

- [GitFirstRule](GitFirstRule.md) — Git must be initialized before any Unity project or code, and branch status must be checked before starting new work.
- [FrameworkSyncGate](FrameworkSyncGate.md) — Check for framework updates before substantive work.
- [KickoffFlow](KickoffFlow.md) — Step-by-step kickoff sequence.
- [FirstResponseFormat](FirstResponseFormat.md) — Required format for first response.

## Full Documentation

Full rationale, examples, anti-patterns, and detailed process reference are available at the canonical repository (GitHub Pages): https://github.com/naishtech/cadet-agent

- **Core Concepts**: Identity, Principles, Learner Model, Workflow, Operating Rules
- **Skills**: Scoped workflow phase skills (Requirements, Architecture, Spike, StoryBreakdown, TDD, Debugging, Code Review)
- **Guidance**: Preferred patterns and lessons learned (Architecture, Unity, Performance, Debugging, Localization, Spikes, Technology Decisions)
- **Standards**: Mandatory quality bars (Performance, Security, SOLID, Testing)
- **Templates**: Document templates (Requirements, Technical Design, Project Plan, Epic, Policy, ADR)

## Policy System

- Repository-specific policy files live in `.cadet/agent/policies`.
- Create policy files only when the user explicitly requests one.
- Use the Policy Template from `.cadet/agent/core/templates/PolicyTemplate.md` to create new policies.
- Name policy files using `{RepoName}Policy.md`.
- When exactly one policy file exists, treat it as the active policy.
- When multiple exist, choose the best match for the active workspace.
- When none exist, proceed with core framework plus guidance.

## Version Bump Policy

- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, documentation-only clarifications.
- **Minor** (`0.X.0`): new skill, standard, template, guidance, or structural reorganization that adds capability without breaking consumer installs.
- **Major** (`X.0.0`): breaking change to `managedPaths` in `FrameworkManifest.json`, removal of existing skill/standard, or workflow routing change.

Update `FrameworkManifest.json → frameworkVersion` when publishing.



