# Skill: Resume

<role>
You are a session manager who reconstructs workflow state and recommends the next action.
</role>

<instructions>
You are executing the Cadet **Resume** skill. Your sole purpose is to inspect the current project state and resume the workflow from where it left off.

## Gate Check

Before proceeding, read `.cadet/state.json`. **No active state:** if `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, this is the framework source repo — report the detected role instead of resuming a workflow that does not exist here, and switch to the contribution workflow (`CONTRIBUTING.md`). No specific phase gate — this skill can be invoked at any time to inspect and resume the current workflow.

Read `.cadet/agent/core/Harness.md`. Resume must load and validate the active run, stale evidence, remaining budgets, pending escalations, and the next legal transition before recommending an action.
</instructions>

<context>
## Purpose

Inspect the current project state and resume the Cadet workflow from the last recorded phase. This skill is the canonical source for session resumption — used by all IDEs.

## When to Invoke

- Starting a new chat session in any IDE.
- Returning after a break.
- The user asks "where are we?" or "what's next?"
- After a framework sync — verify state is consistent.
</context>

<process>
## Phase 1 — State Inspection

1. Check whether `.cadet/state.json` exists in the workspace root.
2. **If `state.json` is missing:**
   - Report: "No session state found — starting from the top of the workflow."
   - Initialize `state.json` with:
     - `version: 1`
     - `session.currentPhase: "context-resolution"`
     - `session.trackingMode: "markdown"` (ask the user to confirm or switch to `"github"`)
     - `session.workflowPath: null` (will be classified after the first user request)
     - All `gates` set to `false`
     - Empty `epics`, `spikes`, `changeHistory`
   - Prompt the user: "What would you like to work on?" and stop.
3. **If `state.json` exists:**
   - Read and validate it against `.cadet/state.schema.json`.
   - Report a structured summary:

```
## Cadet Session State

| Field | Value |
|---|---|
| Current Phase | <currentPhase> |
| Workflow Path | <workflowPath> |
| Tracking Mode | <trackingMode> |
| Learner Tier | <learnerTier> |
| Operating Mode | <operatingMode> |
```

   - List all epics and their stories with status:

```
## Epics & Stories

| Epic | Status | Stories Done / Total |
|---|---|---|
| <epic-dir> | <status> | <done>/<total> |
```

   - Report gate status for the current phase:

```
## Gates for Phase "<currentPhase> → <nextPhase>"

| Gate | Status |
|---|---|
| <gateName> | ✅ / ❌ |
```

## Phase 2 — Integrity Validation

Before determining the next action, cross-validate `state.json` against the actual repository state. Report every discrepancy as a ⚠️ warning — do not silently reconcile.

### 2a — Git History Validation

1. Run `git log --oneline -20` to inspect recent commit history.
2. Compare the commit history against `state.json → changeHistory`:
   - Find the last `changeHistory` entry. Note its `date` and `phase`.
   - Check whether any commits were made **after** that date.
   - If commits exist after the last state update, check whether their content aligns with the phase recorded in state.
3. **Discrepancies to flag:**
   - State says a story is `"done"` but there are **no commits** reflecting implementation work for that story.
   - State says current phase is `"implementation"` but recent commits look like review fixes or validation cleanup.
   - Commits exist that reference story/epic work not recorded in `state.json` at all.
   - The last `changeHistory` entry predates the most recent commit by a significant margin with no obvious state update.
4. Report findings:

```
## Git History Validation

Last state update: <date> (phase: <phase>)
Most recent commit: <date> — "<commit message>"

| Check | Result |
|---|---|
| Commits since last state update | <count> |
| Commit content matches recorded phase | ✅ / ⚠️ |
| All completed stories have corresponding commits | ✅ / ⚠️ |
```

### 2b — Epic/Story File Validation (markdown mode only)

Skip this section if `trackingMode` is `"github"`.

1. For each epic in `state.json → epics`, locate the epic directory.
2. Read the epic markdown file and each story markdown file listed in state.
3. Compare the status fields:
   - If state says a story is `"done"` but the markdown file still shows `"in-progress"` or `"planned"`, flag it.
   - If a markdown file says `"done"` but state still shows `"planned"`, flag it.
   - If an epic directory or story file referenced in state does **not** exist on disk, flag it.
   - If story files exist on disk that are **not** recorded in `state.json`, flag them.
4. Report findings:

```
## Epic/Story File Validation

| Epic | Story | State Status | File Status | Match |
|---|---|---|---|---|
| <epic> | <story> | done | in-progress | ⚠️ |
| <epic> | <story> | in-progress | in-progress | ✅ |
```

### 2c — Discrepancy Resolution

After reporting all discrepancies:

- If **no discrepancies** were found, proceed to Phase 3.
- If **discrepancies were found**, present them to the user and ask:
  > "The state file is out of sync with the repository. Would you like me to update `state.json` to reflect the actual repository state, or would you prefer to resolve these manually?"
  - If the user chooses automatic reconciliation: update `state.json` to match on-disk reality (git history takes precedence for phase determination; markdown files take precedence for story status in markdown mode).
  - If the user chooses manual resolution: stop and wait for instructions.

### 2d — Branch and Working-Tree Status

1. Run `git branch --show-current` and `git status --short`.
2. Determine whether the current work is a continuation or a new task:
   - If uncommitted changes match the active story/phase in `state.json`, this is a continuation — continue on the current branch.
   - If the changes look like leftover work from a previous task and the user wants to start something new, ask how to proceed before making further changes: commit, stash, push, or move the work to a new branch.
   - If the tree is clean but the current branch has unpushed commits, report them and ask whether to push before starting anything new.
3. If this is a brand-new task (no active story in `state.json`, or the user explicitly starts new work), recommend creating a new branch from `main` before making changes.

### 2e — Harness Validation

Before recommending the next action, validate the harness state:

1. Run `cadet-agent state migrate` (idempotent) so a v1 state is upgraded to v2 before inspection.
2. Run `cadet-agent state validate --format json`. Report any schema errors or warnings.
3. Load the active run: `cadet-agent harness report --format json`. Report:
   - consumed vs. remaining context, token, tool, retry, time, and cost budgets;
   - the run status (ok / warning / failed / exhausted / blocked);
   - any unresolved escalation (budget exhaustion, deterministic failure, stale evidence).
4. Check gate evidence freshness for the current work item:
   - For each claimed `true` gate, confirm a matching, non-expired, non-superseded evidence record.
   - Flag any gate whose evidence has a stale input tree hash, a different work item, or changed acceptance criteria.
5. Determine the **next legal transition** and whether its required gates are evidence-backed. Use `cadet-agent state transition --to <phase> --dry-run`, which reports the same verdict as a real transition without writing anything — a rejection lists the exact missing or stale gates. **Always pass `--dry-run` here:** without it the command applies the transition and writes `state.json`, which mutates finalised state during what is only meant to be an inspection.
6. Report harness findings as warnings — do not silently reconcile.

## Phase 3 — Determine Next Action

Based on `currentPhase` (after any reconciliation from Phase 2), determine the next action:

| Current Phase | Next Action |
|---|---|
| `context-resolution` | Ask the user what they want to work on. Classify the change (large/small/no_test_required), set `workflowPath`, then transition to `requirements` (large) or `implementation` (small). |
| `requirements` | Invoke the Requirements skill — the requirements document is in progress or needs to be created. |
| `architecture` | Invoke the Architecture skill — the technical design is in progress or needs to be created. |
| `spikes` | List planned/in-progress spikes from `state.json → spikes`. Ask which spike to work on, then invoke the Spike skill. |
| `story-breakdown` | Invoke the Story Breakdown skill — epics need to be broken into stories. |
| `implementation` | Identify the current in-progress story. If none is `in-progress`, pick the first `planned` story. Invoke the TDD skill for that story. |
| `review` | Identify the story that just completed implementation. Invoke the Code Review skill — the review hard gate must be satisfied before advancing. |
| `validation` | Run through the validation gates. If the epic has remaining stories, start the next one with `cadet-agent state begin --epic <epicId> --story <storyFile>` — it resets the gates, archives the finished story's evidence to `.cadet/archive/` and folds it into the coverage index first. Then transition `validation → implementation` (the next-story loop). **Never set `activeWorkItem` by hand:** that leaves the previous story's evidence inline for ever, where no gate can read it — on the audited repository it was 63 records and ~3,000 lines of dead weight. Only when no stories remain, confirm `designArtifactSyncConfirmed` and transition to `closed`. |
| `closed` | Report: "All work is complete for the current epic(s)." `closed` is terminal — there is no transition out of it. To start new work, initialise a fresh session from `context-resolution` (or a new `story-breakdown` cycle) rather than transitioning from `closed`. Ask if the user wants to start a new epic or close the session. |

## Phase 4 — Resume

1. Announce the next action to the user. Ask for confirmation before proceeding.
2. If the user confirms, update `state.json → changeHistory` with a `"resume"` entry recording the date and current phase.
3. Invoke the skill or action determined in Phase 3.
</process>

<output>
## Expected Outputs

- Structured state summary with phase, epics, stories, and gates.
- Cross-validation report (discrepancies flagged).
- Next-action recommendation.
- If state was initialized: a prompt for the user's first objective.
</output>

<completion>
## Completion

After resume completes, `.cadet/state.json` should accurately reflect the current state. The user should have a clear picture of where they are and what to do next. Do not advance any state — only report it and suggest the next action.
</completion>
