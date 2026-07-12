# Purpose

Define how Cadet-Agent operates as a stateful orchestrator that resolves context, routes work to the correct skill, enforces workflow sequencing, and tracks artifact completion — making the coordination layer explicit, testable, and auditable.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Learner model reference: [LearnerModel](../LearnerModel.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Objective

Replace implicit LLM interpretation of workflow routing with an explicit orchestrator model that:

- Resolves learner tier, operating mode, active policy, guidance, and standards into a typed context object before any work begins.
- Routes changes through the correct workflow path (large / small / no-test-required) deterministically.
- Dispatches to the correct Skill with the resolved context.
- Tracks artifact state across the SDLC phases.
- Validates completion gates before closing work.
- Surfaces deviations and audit information to the user.

## When To Use

- Use for every user request that triggers a substantive action, recommendation, or code change.
- Use as the pre-flight gate before any Skill executes.
- Use to enforce artifact sequencing (requirements → design → plan → epics → implementation → validation).
- Use to track cross-skill state when multiple skills must be invoked in a defined order.

## Required Inputs

- User request (intent, task description, change scope).
- Current workspace state and repository structure.
- Available skills, guidance documents, standards, and templates from the framework index.
- Active policy file if one exists in `.cadet/agent/policies`.
- Framework manifest for managed/preserved path boundaries.
- User's demonstrated skill level across the six learner dimensions.

## Process

### Phase 0: Context Resolution

1. Resolve learner tier for the task-relevant dimension using [LearnerModel](../LearnerModel.md).
2. Determine operating mode: instruction-first, implementation-first, or hybrid.
3. Scan `.cadet/agent/policies` and resolve the active policy using the README policy-system rules.
4. Identify which guidance documents are relevant to the task.
5. Identify which standards documents apply (all standards apply universally, but flag the most relevant).
6. Build an `OrchestratorContext` with all resolved values.

### Phase 1: Change Classification

1. Classify the change as large, small, or no-test-required based on:
   - Number of components or systems affected.
   - Whether new architecture, technology, or patterns are introduced.
   - Whether end-to-end behavior must be validated across integration boundaries.
   - User's explicit preference for artifact depth.
2. Select the workflow path and determine the artifact sequence.
3. Confirm branch strategy and planning-artifact storage location.
4. Emit a short rule-trace showing the resolved context and routing decision before proceeding.

### Phase 2: Skill Dispatch

1. For large changes, dispatch skills in strict sequence:
   - `Requirements` → `Architecture` → `TDD` (test strategy in design) → implementation via epics.
2. After requirements and design finalization, dispatch for project plan and epic decomposition.
3. For small changes, dispatch directly to `TDD` with red/green cycle.
4. For no-test-required changes, dispatch to direct implementation with manual validation preparation.
5. Each skill receives the `OrchestratorContext` and a skill-specific input contract.
6. The orchestrator validates each skill's output before advancing to the next phase.
7. If a skill in a sequence fails, stop the sequence and report partial results with the failure reason.

### Phase 3: Implementation Tracking

1. Track which epic and task is currently active.
2. After each task completes, update the project plan and epic status.
3. Detect when acceptance criteria or design changes mid-implementation and trigger re-sync.
4. After each epic completes, prompt the user for token-count check.
5. Manage spike lifecycle: ensure spikes stay reference-only and prompt for cleanup after production completion.

### Phase 4: Validation and Closure

1. Execute the workflow-path-specific validation checklist from [Workflow](../Workflow.md) Step 4.
2. Run security and quality gates (no secrets, no unsafe patterns).
3. Confirm all required artifacts are produced and synchronized.
4. Surface any unresolved deviations from policy, guidance defaults, or workflow expectations.
5. Report completion status and request user acceptance or next-iteration direction.

## Expected Outputs

- Resolved `OrchestratorContext` (learner tier, operating mode, active policy, relevant guidance, applicable standards).
- Classified workflow path with explicit rationale.
- Rule-trace showing policy/guidance/standards/path before first substantive action.
- Dispatch log: which skills were invoked, in what order, and their outcomes.
- Artifact state map: which documents exist, which are synchronized, which need updates.
- Deviation log: any material deviation from policy defaults, guidance defaults, or workflow expectations with concrete reasons.
- Completion validation report against the workflow-path criteria.

## Orchestrator State Model

The orchestrator maintains the following state across a session and exposes it as an immutable snapshot:

```
SessionState
├── OrchestratorContext (immutable once resolved, revisable on new evidence)
├── WorkflowPath (large | small | no-test-required)
├── CurrentPhase (context-resolution | requirements | design | planning | epics | implementation | validation | closed)
├── ArtifactMap
│   ├── RequirementsDoc (path + last-synced hash)
│   ├── TechnicalDesignDoc (path + last-synced hash)
│   ├── ProjectPlanDoc (path + last-synced hash)
│   └── EpicDocs (per-epic path + status + task completion count)
├── ActiveEpic (currently executing epic identifier)
├── ActiveTask (currently executing task within the active epic)
├── SkillInvocationLog (ordered list of skill dispatches with outcomes)
├── DeviationLog (deviations from defaults with rationale)
└── GateStatus (per-gate pass/fail/pending)
```

## Success Criteria

- Context is fully resolved before any skill executes.
- Workflow path is classified deterministically with explicit rationale.
- Skills are dispatched in the correct sequence for the classified path.
- Artifact sequencing is enforced (no design before requirements, no implementation before plan for large changes).
- Cross-artifact synchronization is maintained throughout implementation.
- Deviations from policy, guidance, or workflow expectations are logged with concrete reasons, never silent.
- Completion gates are validated before work is declared done.
- The orchestrator itself is auditable: any routing decision can be traced back to resolved inputs.

## Common Pitfalls

- Dispatching a skill without first resolving the active policy.
- Allowing implementation to begin for a large change before requirements and design are finalized.
- Failing to detect mid-implementation scope drift and re-sync artifacts.
- Treating the orchestrator as a replacement for LLM judgment rather than a coordination scaffold.
- Over-engineering the orchestrator state model for small, single-skill tasks.
- Silently drifting from the classified workflow path without documenting the reason.
- Forgetting to update the artifact map after skill outputs change.
- Failing to surface rule-trace before the first substantive action when it materially affects the decision.

## Companion Implementation

A bash implementation of this skill lives at `.cadet/orchestrator/` providing:

- `cadet-orchestrator` — CLI entry point with subcommands: `init`, `classify`, `dispatch`, `dispatch-seq`, `epic-start`, `task-done`, `epic-done`, `validate`, `status`.
- `lib/state.sh` — JSON state file management via `jq` (state stored as `.cadet/orchestrator/state.json`, gitignored).
- `lib/context.sh` — Phase 0: resolves learner tier, active policy, guidance, and standards.
- `lib/classify.sh` — Phase 1: keyword-based change classification (large / small / no_test_required).
- `lib/dispatch.sh` — Phase 2: dispatches skills individually or in sequence, stops on failure.
- `lib/track.sh` — Phase 3: epic/task tracking, completion counters, drift detection.
- `lib/validate.sh` — Phase 4: per-path gate validation, closes phase on completion.
- Full bats test coverage at `.cadet/orchestrator/tests/` (45 tests) following TDD red/green cycles.

Requires `bash`, `jq`, and optionally `cygpath` (auto-detected for MSYS2/Git Bash on Windows). The bash implementation keeps orchestrator logic out of shipped game code — it is development tooling that runs alongside the project, not inside Unity.

---
