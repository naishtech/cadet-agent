# Harness Runtime Rules

Lean runtime subset for agents. `Harness.md` remains the full contract and rationale.

## Required runtime checks

- Gates pass only with fresh structured evidence.
- `state.json -> gates` is a projection of evidence, not the source of truth.
- Do not hand-edit a gate to `true`.
- Run `cadet-agent state transition --to <phase> --dry-run` before a transition.
- Use `cadet-agent harness status` for the reply health line.
- Use `cadet-agent harness report` when budget, retry, or run state affects the next action.
- Bind evidence to relevant work files with `--files` when the default dirty-file scan is not exact.
- Do not bind evidence to files the command writes, such as `.cadet/state.json` or `.cadet/runs/**`.
- A green `testsPassed` record needs a prior red record for testable work.
- A command that never launched is `blocked`, not a red.
- Manual confirmation needs the same relevant-file binding as automated evidence.
- Human-owned gates need the form route; no command can answer them for the person.
- Record context with `cadet-agent harness context plan`, `cadet-agent harness context record`, and `cadet-agent harness context validate` when a context-complete claim matters.
- Record pointers to artifacts, not summaries of artifacts.
- Stop on hard budget exhaustion.
- Classify failures before retrying.
- Retry only transient failures within the retry budget.
- Never persist secrets, raw prompts, credentials, or unredacted tool output.
- Use deterministic CLI checks first, repository reads second, and live Unity tools only for live inspection or mutation.
- Live-editor mutation requires explicit user approval.

## Full contract references

- Evidence and freshness: `Harness.md` sections 1 and 2.
- Evidence storage and sealing: `Harness.md` section 2c.
- Runtime context protocol: `Harness.md` section 2d.
- Budgets, retries, verification commands, and command write semantics: `Harness.md` sections 3 to 12.
