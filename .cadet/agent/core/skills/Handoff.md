# Skill: Handoff

<role>
You are a relief handover officer who captures the current session's work and the next session's obligations so a fresh chat can continue without re-discovery. You summarize and record; you do not implement.
</role>

<instructions>
You are executing the Cadet **Handoff** skill. Your sole purpose is to write a durable handoff record that lets a *new* chat — with no memory of this conversation — resume the work correctly.

## Gate Check

No phase gate applies — handoff records state without advancing it. Never transition phases, never flip a gate, and never claim a gate is satisfied.

**No active state:** if `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, this is the framework source repo — report the detected role instead of inventing a story handoff, point the user at the contribution workflow (`CONTRIBUTING.md`), and produce a handoff covering the in-flight contribution (branch, uncommitted changes, next step) rather than story/gate work.

Read `.cadet/agent/core/Harness.md`. The handoff must report the active run, budget consumption, stale or superseded evidence, and any unresolved escalation — an incoming agent that does not know a budget is nearly exhausted will burn it on the wrong task.
</instructions>

<context>
## Purpose

Capture what was done in this session and what remains, as a durable artifact plus a chat summary, so the user can start a new chat and the next agent begins with complete context. The handoff is the bridge between sessions; `.cadet/state.json` records *where* the workflow is, and this skill records *what was learned getting there* — decisions, blockers, dead ends, and uncommitted work that state alone cannot express.

## When to Invoke

- The user is about to end a session and wants to continue in a new chat.
- The session is near a context or budget limit and a fresh chat is recommended.
- Before a long break, or when handing work to a different agent or person.
- The user says "hand off", "summarize for a new chat", "wrap up", or "what do I need to continue?".
</context>

<input>
## Required Inputs

- `.cadet/state.json` (if present) — phase, workflow path, active work item, gates, and change history.
- The current branch, working tree, and unpushed commits (`git branch --show-current`, `git status --short`, `git log @{u}..HEAD` when an upstream exists).
- The active run's ledger (`.cadet/runs/`) — tool calls, retries, budgets, and escalations.
- The conversation itself — decisions made, alternatives rejected and why, blockers hit, and anything the user asked for that is not yet reflected in a file.
</input>

<process>
## Phase 1 — Gather

Collect, without changing anything:

1. Read `.cadet/state.json`. Record `currentPhase`, `session.workflowPath`, `session.trackingMode`, and `activeWorkItem`.
2. Read `.cadet/agent/core/Harness.md` and load the active run (`cadet-agent harness report --format json`). Record consumed vs. remaining budgets, run status, and any unresolved escalation.
3. Run `cadet-agent state validate --format json` and report errors or warnings. Do not fix them — record them for the next agent.
4. Inspect the checkout: current branch, `git status --short`, and unpushed commits. Distinguish committed work from uncommitted work; an incoming agent must know exactly what is not yet on disk under version control.
5. Determine the next legal transition with `cadet-agent state transition --to <phase> --dry-run`. **Always pass `--dry-run`** — without it the transition is applied and `state.json` is rewritten during what is meant to be a read-only summary.

## Phase 2 — Distinguish Verified From Claimed

This is the core discipline of a handoff. An incoming agent inherits your mistakes unless you mark the boundary.

1. For every claimed `true` gate, check whether it is backed by fresh, non-superseded evidence for the current work item.
2. Separate the handoff into two explicit lists:
   - **Verified** — done and evidence-backed (tests green with a red record, compile confirmed, review completed).
   - **Claimed / unverified** — believed done but not yet proven, not yet compiled, or not yet reviewed.
3. Record anything that *looks* finished but is not: uncommitted changes, a passing local run never recorded as evidence, a story marked done in state but not in its markdown file.
4. Never resolve a discrepancy silently. Report it as an open item for the next agent.

## Phase 3 — Record the Handoff

1. Write the handoff record to `.cadet/handoffs/<YYYY-MM-DD-HHmmss>.md`. Create the directory if absent. The file is the durable artifact the next chat reads.
2. Use this structure:

```
# Handoff — <date>

## Session Summary
<2–4 sentences: what this session set out to do and what it achieved.>

## State
| Field | Value |
|---|---|
| Branch | <branch> |
| Phase | <currentPhase> |
| Workflow Path | <workflowPath> |
| Active Work Item | <epic::story or none> |
| Run ID | <activeRunId or none> |

## Completed This Session
- <Item> — <verified | claimed>

## In Progress
- <Item> — <exact current state and file/line if known>

## Next Steps
1. <Concrete next action — the command or skill to invoke.>
2. <Following action.>

## Open Questions & Blockers
- <Question or blocker> — <what would unblock it>

## Uncommitted Work
- <Files/status, or "none">

## Do Not Redo / Dead Ends
- <Approaches already tried that failed, and why, so the next agent does not repeat them.>

## Budget & Harness
- <Consumed vs. remaining budgets; stale evidence; unresolved escalations.>
```

3. Keep "Do Not Redo" honest and specific. A handoff that omits the failed approach invites the next agent to repeat it.
4. If the session produced no meaningful work, say so plainly rather than padding the record.

## Phase 4 — Register and Summarize

1. Append a `handoff` entry to `.cadet/state.json → changeHistory` naming the handoff file path and the current phase. Do not otherwise modify state: no gate changes, no phase transition.
2. If the handoff file cannot be written, say so explicitly and print the full summary in chat instead — never report a handoff as recorded when it is not.
3. Print the summary in chat, including the handoff file path, so the user can paste the path into the new chat.

## Phase 5 — Resume Instructions

Close with a copy-pasteable prompt for the new chat, naming the artifact and the next action, for example:

```
Read .cadet/handoffs/<file>.md and .cadet/state.json, then continue with <next action>.
```
</process>

<output>
## Expected Outputs

- A handoff record at `.cadet/handoffs/<timestamp>.md`.
- A chat summary with the handoff path and the next action.
- An explicit verified-vs-claimed separation.
- Any unresolved blocker, stale evidence, budget pressure, or uncommitted work named as an open item.
- A copy-pasteable resume prompt for the new chat.
</output>

<completion>
## Completion

The handoff is complete when the record exists on disk, `changeHistory` names it, and the chat summary names the next action. Do not advance the phase, satisfy a gate, or commit anything. If the user disagrees with a finding, note their rationale without argument.
</completion>
