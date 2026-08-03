# Resume Skill

## Gate Check

Before proceeding, read `.cadet/state.json`. No specific phase gate — this skill can be invoked at any time to inspect and resume the current workflow.

## Purpose

Inspect the current project state and resume the Cadet workflow from the last recorded phase. This skill is the canonical source for session resumption — used by all IDEs (GitHub Copilot, Cursor, Continue, Claude Code).

## When to Invoke

- Starting a new chat session in any IDE.
- Returning after a break.
- The user asks "where are we?" or "what's next?"
- After a framework sync — verify state is consistent.

## Process

### Phase 1 — State Inspection

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
## Gates — Current Phase: <currentPhase>

| Gate | Required For | Status |
|---|---|---|
| <gateName> | <transition> | ✅ / ❌ |
```

   - Report any discrepancies between state.json, git history, and epic/story markdown files.

### Phase 2 — Cross-Validation (when state.json exists)

1. Compare `state.json → epics` against actual epic directories on disk.
2. Flag stories marked `done` in state that don't have corresponding completed markdown files.
3. Flag stories with completed markdown files that aren't marked `done` in state.
4. If git is available, check whether the active branch matches the active epic/story.
5. Report any discrepancies and ask the user how to reconcile.

### Phase 3 — Next Action

1. Based on `currentPhase`, suggest the next skill to invoke:
   - `context-resolution` → Ask "What would you like to work on?"
   - `requirements` → `/cadet-requirements` to continue drafting criteria
   - `requirementsComplete` → `/cadet-architecture` to begin technical design
   - `architecture` → `/cadet-architecture` to continue design
   - `architectureComplete` → `/cadet-breakdown` if no spikes, or `/cadet-spike` for unverified assumptions
   - `spikes` → `/cadet-spike` to continue spike work
   - `story-breakdown` → `/cadet-breakdown` to continue decomposition
   - `implementation` → `/cadet-tdd` to continue the active story
   - `review` → `/cadet-review` to complete the review
   - `validation` → Report: "Work is in validation — confirm design artifact sync."
   - `closed` → Ask "Start a new piece of work?"

2. If `currentPhase` is `implementation`, also report:
   - The active epic and story.
   - How many stories remain in the active epic.
   - Whether the active story has any uncommitted changes on disk.

## Expected Outputs

- Structured state summary with phase, epics, stories, and gates.
- Cross-validation report (discrepancies flagged).
- Next-action recommendation with the appropriate slash command.
- If state was initialized: a prompt for the user's first objective.

## Completion

After resume completes, `.cadet/state.json` should accurately reflect the current state. The user should have a clear picture of where they are and what to do next. Do not advance any state — only report it and suggest the next action.
