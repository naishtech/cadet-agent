# Agent Framework Index

Purpose: Provide a single navigation entry point for Cadet-Agent identity, operating rules, workflow, skills, standards, and templates.

## Core Documents
- [Identity](Identity.md)
- [LearnerModel](LearnerModel.md)
- [Principles](Principles.md)
- [Workflow](Workflow.md)
- [FrameworkManifest](FrameworkManifest.json)

## Guidance
- [ArchitecturePatterns](Guidance/ArchitecturePatterns.md)
- [UnityPatterns](Guidance/UnityPatterns.md)
- [PerformancePatterns](Guidance/PerformancePatterns.md)
- [DebuggingPatterns](Guidance/DebuggingPatterns.md)
- [LocalizationPatterns](Guidance/LocalizationPatterns.md)
- [SpikePatterns](Guidance/SpikePatterns.md)

## Policy System
- Repository-specific policy files should live in `.cadet/agent/policies` at the repository root.
- Create repository-specific policy files only when the user explicitly requests one.
- Use [PolicyTemplate](Templates/PolicyTemplate.md) to create a new repository policy.
- Name repository policy files using the convention `{RepoName}Policy.md`.
- When exactly one repository policy file exists in `.cadet/agent/policies` besides templates or placeholders, treat it as the active policy.
- When multiple repository policy files exist, choose the one whose scope best matches the active workspace; if that is unclear, ask the user which policy should be active.
- When no repository policy file exists, proceed with core framework plus guidance and create a policy only on explicit user request.

## Skills
- [Requirements](Skills/Requirements.md)
- [Architecture](Skills/Architecture.md)
- [TDD](Skills/TDD.md)
- [Debugging](Skills/Debugging.md)
- [CodeReview](Skills/CodeReview.md)
- [Orchestrator](Skills/Orchestrator.md)

## Standards
- [Performance](Standards/Performance.md)
- [Security](Standards/Security.md)
- [SOLID](Standards/SOLID.md)
- [Testing](Standards/Testing.md)

## Templates
- [RequirementsTemplate](Templates/RequirementsTemplate.md)
- [TechnicalDesignTemplate](Templates/TechnicalDesignTemplate.md)
- [ProjectPlanTemplate](Templates/ProjectPlanTemplate.md)
- [EpicTemplate](Templates/EpicTemplate.md)
- [PolicyTemplate](Templates/PolicyTemplate.md)

## License
- [CC BY 4.0 License](LICENSE.md)

## Version Bump Policy
- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, or documentation-only clarifications that do not change agent behavior.
- **Minor** (`0.X.0`): new skill, standard, template, guidance document, or structural reorganization that adds capability without breaking existing consumer installs.
- **Major** (`X.0.0`): breaking change to `managedPaths` in `FrameworkManifest.json`, removal of an existing skill or standard, or a workflow routing change that invalidates prior planning artifacts.

Update `FrameworkManifest.json → frameworkVersion` when publishing a new package version.

## Slash Command
- Project-wide kickoff command: [cadet](../../../.github/prompts/cadet.prompt.md)

## Document Precedence
Apply framework documents in this order when deciding how to respond:

1. [LearnerModel](LearnerModel.md): sets explanation depth, scaffolding, and teaching posture.
2. [Workflow](Workflow.md): sets routing, operating mode, and execution path.
3. Guidance documents under [Guidance](Guidance/UnityPatterns.md): set preferred defaults and lessons learned.
4. Standards documents under [Standards](Standards/Testing.md): set mandatory quality bars.
5. Active policy files under `.cadet/agent/policies`: set repository-specific required conventions and delivery rules.

If two documents appear to conflict, prefer the higher-precedence document for its specific concern and do not let guidance weaken standards or policy.

## Cross-Document Rules
- Learner adaptation is defined by [LearnerModel](LearnerModel.md); it controls explanation depth, scaffolding, and default teaching posture.
- Workflow routing is defined by [Workflow](Workflow.md); it combines learner tier, user intent, and task size to choose the execution path.
- Framework distribution and bootstrap update boundaries are defined by [FrameworkManifest](FrameworkManifest.json); use it to determine the canonical source of truth plus which paths are managed versus preserved.
- Guidance documents capture preferred lessons and heuristics; they should influence defaults without overriding standards or policy.
- Standards and repository conventions apply independently of learner tier.
- Requirements, technical design, project plan, and epic docs must stay synchronized with implementation and with each other.
- Large changes must follow requirements (Given/When/Then) -> technical design -> project plan -> epics before implementation.
- After drafting a project plan, run an ambiguity review and ask permission before one-by-one clickable clarification questions.
- Epic planning targets about 10 to 12 small tasks per epic, and each epic must deliver a testable value slice.
- TDD is mandatory where testing is valid, including reproduce-first defect handling and regression protection.
- Interface-first and mock-first patterns are required for service-style architecture and testing seams.
- Do not guess: if uncertain, state uncertainty, ask the user, and request permission before online research if needed.
- When a local policy file is present, use it for repository layout, naming, planning paths, delivery policies, and studio-specific constraints.
- Generated repository policies should be created in `.cadet/agent/policies` only after an explicit user request.
- All code changes should be done on branches; do not push directly to `main` from local.
- `main` integration should happen through pull requests only.
- Rebase-first branch maintenance and force-push with lease are preferred when branch history rewrite is intentional.
- Squash merge is the preferred PR merge strategy unless project policy says otherwise.
- Shared infrastructure placement and other repository conventions should be preserved according to the active workspace policy.
- Route user-facing strings through localization helpers/tables and preserve fallback behavior for missing keys or optional package dependencies.
- For multilingual localization updates, keep locale message sources in sync, preserve serialization-safe key enum ordering, validate non-Latin glyph coverage, and request TMP font regeneration when glyph maps change.
- Production paths must remain separate from spike or example assets unless explicitly approved.
- Sensitive data must never be committed, and security concerns must be surfaced immediately.
- Technology recommendations should prioritize long-term support, active maintenance, and strong community ecosystem.
- Unity validation handoff is explicit: specify which tests to run, ask user to focus Unity for recompilation when needed, and use reported outcomes to drive next actions.
- After each epic, ask user to check token count and recommend a new chat if context exceeds 100k tokens.
- If framework-managed files are updated during bootstrap sync, require a fresh `/cadet` chat before continuing so updated prompt instructions are actually loaded.

## Framework Separation
- [LearnerModel](LearnerModel.md): who the user is for this task and how deeply to explain.
- [Workflow](Workflow.md): how to route work based on learner tier, user intent, and task size.
- [Guidance](Guidance/UnityPatterns.md) and the other guidance docs: preferred patterns and lessons learned that Cadet should favor by default.
- [Standards](Standards/Testing.md) and the other standards docs: the quality bar that does not change by learner tier.
- Policy files in `.cadet/agent/policies`: repository-specific conventions that do not change by learner tier.

## Planning Location Convention
- If a local policy defines a planning directory, use that location.
- Otherwise, ask the user where planning artifacts should live before creating them.

## Git Workflow For Beginners
- Branch: a safe workspace for your change (for example, `feature/new-combat-ui`).
- Pull Request (PR): the review gate where branch changes are discussed and validated before entering `main`.
- Rebase: replay your branch commits on top of latest `main` to keep history linear and reduce merge noise.
- Force-push with lease: safe way to update a branch after rebase while preventing accidental overwrite of others' new remote commits.
- Squash merge: combines PR commits into one clean commit in `main`, making history easier to read.

---
