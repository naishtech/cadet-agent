# Harness — Canonical Rules

Single source of truth for Cadet's execution harness: budgets, evidence, retries,
context tiers, privacy, and escalation. Skills and adapters reference this file; they must
not restate it. The frozen data contract and compatibility invariants live in
`docs/core/HarnessContract.md`; the machine-readable schemas live in `harness.schema.json`;
repository overrides live in `.cadet/harness.json`.

## 1. Evidence over assertion

A gate is `true` only when backed by **fresh, structured evidence**.

- `state.json → gates` booleans are a projection of evidence, never the source of truth.
- Every evidence record carries: `evidenceId`, `workItemId`, `acceptanceCriterionId` (when
  applicable), `phase`, `gate`, `status`, `command`, `result`, `inputTreeHash`,
  `criteriaHash`, `relevantFiles`, `createdAt`, and `expiresAt` or `freshnessPolicy`.
- **`commit` — the revision the record attests.** Optional (`null` for a record created
  without one, so v2-shaped records are unchanged), but supplied with `--commit <sha>` on
  `harness verify` and `harness confirm` when the gate is being recorded for work that is
  already committed. A gate-related fix claim must be traceable to the revision that
  contains the fix; without this field the claim can name its work item and its files but
  never the commit, and a reviewer has no structured way to check it. A **branch or tag name
  is rejected** — those move, so a citation naming one cannot be verified later, which
  defeats the purpose. Pass an abbreviated or full SHA.
- Evidence statuses: `passed`, `failed`, `blocked`, `manual-confirmation`, `superseded`.
- Evidence is immutable. Corrections create a new record and mark the old one `superseded`.
- A hand-edited `true` gate with no evidence is rejected by `cadet-agent state validate` — the gate
  must have a `passed` or `manual-confirmation` record, and `state validate` also rejects evidence
  that belongs to a different work item, has a stale input tree hash, or has expired.
- **A story marked `done` must own at least one evidence record.** `state validate` rejects a `done`
  story whose work item appears nowhere in `gateEvidence`. This asserts *coverage*, not gate
  completeness — whether each required gate was satisfied for the right phase is enforced at
  transition time, where the phase is known. Without this rule the gate checks were all scoped to the
  **active** work item, so a document could validate clean while completed stories had no evidence
  whatsoever: a story that was never verified is indistinguishable from one that was, which is the
  condition the framework exists to prevent.
- `state validate` runs the freshness check from the target directory. A caller that validates a
  state document without a root directory (for example, an in-memory check) receives an explicit
  `freshness was not verified` warning — a structural-only pass is never presented as a full check.
  The v1→v2 migration deliberately opts out with `structuralOnly`.
- Evidence records are schema-validated in full: `command`, `result`, `criteriaHash`, and a freshness
  bound (`expiresAt` or `freshnessPolicy`) are required, not just the identifier fields.
- A run record's status is derived from its budget result: exhausted, blocked, or unmeasurable-cost
  runs cannot be finalized as `ok`.
- Run ledgers and state are written atomically (temp file + rename), so an interruption cannot
  truncate a record.

## 2. Freshness

- Default scope: the **current story and current phase**.
- Evidence is invalidated by any change to a relevant file, an acceptance criterion, the
  active work item, or the verification command. A new phase invalidates evidence unless the
  record explicitly allows that phase.
- `inputTreeHash` = SHA-256 over sorted `(relative path, file hash)` pairs of relevant files,
  excluding generated run artifacts.
- A gate exception is scoped to **one work item and one transition**, expires when that
  transition completes or at `expiresAt`, and never propagates to a new story.
- **Strict closure** (`strictClosure.enabled`, opt-in, default off). When enabled, a transition
  also re-derives the gates already satisfied in earlier phases, so a gate cannot go stale
  during a long `review`/`validation` and still be carried into closure. With
  `requireFreshRevalidation`, the record must be newer than the last transition, not merely
  unexpired. When disabled, behaviour is identical to v2. See
  `docs/core/HarnessContract-v3.md` §1–§2.

## 2a. Manual-confirmation quality

A `manual-confirmation` record is a human assertion. It binds to the same relevant files as an
automated record — those given by `--files`, or the working tree's changed files when the flag is
omitted — so a later edit to any of them invalidates it. Its `expiresAt` is an *additional* bound,
not its only one. Under `strictClosure.enabled` it must carry:

- `reason` — why automation was unavailable;
- `expiresAt` — a concrete bound (`null` is rejected: declaring the key is not declaring a bound);
- `environment` — `{ projectPath?, editorVersion?, tool?, ... }` describing what was verified;
- `scope` — a non-empty array naming what the confirmation covers.

`strictClosure.disallowManualFor` lists gates that may never be satisfied by human assertion
(default: `testsPassed`, which is automatable everywhere). `compileCheckConfirmed` is
deliberately not in that default list: it legitimately falls back to manual confirmation when
the Unity CLI is absent. Prefer `cadet-agent harness confirm` over hand-editing state — it
enforces these rules at creation time and writes the ledger and state atomically.

## 2b. Exception taxonomy

Under `strictClosure.enabled`, every `gate-exception` must declare a `category` from:
`manual-compile`, `budget-override`, `analyzer-fallback`, `unscoped-freshness`,
`documentation-only`, `tooling-gap`, `pre-harness-story`. The category determines the expiry window and whether a
`closureReviewNote` is required, and an unknown category is rejected with the valid set named.
A categorised exception is still scoped to one work item and one transition — the taxonomy
classifies an exception, it never widens one.

`pre-harness-story` is the documented escape for the one gap that can never be closed by
re-verification: a story marked `done` whose gates were recorded before the harness existed,
so no `gateEvidence` for its work item was ever written (see §1's `done`-story coverage rule).
It has **no default expiry**, because the fact it records is permanent and a timed exception
would only re-raise an unchanged finding. Scope it to the story work-item ids it covers
(`epic-N::story-M.md`), one entry per epic or per story; the coverage check matches on scope, so
an exception for one story never excuses another.

## 3. Budgets

Configured in `.cadet/harness.json`; defaults and hard safety ceilings are in
`src/harness/policy.mjs`. Defaults:

| Budget | Default | Warning | Hard stop |
|---|---:|---:|---:|
| Context tokens | 64,000 | 80% | 100% |
| Output tokens | 8,000 | 80% | 100% |
| Tool calls | 80 / run | 75% | 100% |
| Retries per step | 2 | 1 remaining | 0 remaining |
| Total retries | 8 / run | 75% | 100% |
| Wall-clock time | 30 min / run | 80% | 100% |
| Estimated provider cost | USD 2.00 / run | 80% | 100% |
| Downloaded archive bytes | 25 MiB | 80% | 100% |
| Decompressed archive bytes | 100 MiB | 80% | 100% |
| Archive file count | 2,000 | 80% | 100% |

- **Warning:** record a `budget-warning` span and continue.
- **Hard stop:** stop the operation, persist the ledger, and return `budget-exhausted`.
  Continuation requires a **new run** or an **explicit user-approved budget override** recorded
  in the ledger. A repository may not lower a hard safety ceiling, and may exceed one only with
  an explicit compatibility flag.
- **Hard stops are enforced in code**, not advisory: the context loader refuses an item that would
  exceed the context-token budget, and the verification loop refuses to produce a passing gate once
  any hard limit is reached.
- Unknown usage is `unknown`, never silently zero, and cannot satisfy a hard cost budget. When a cost
  budget is configured but no rate card resolves the cost, the counter is marked **unmeasurable** and
  the run is blocked (`budget-blocked`) rather than reported as within budget.

## 4. Retries

One classifier, in `src/harness/verification.mjs`. Skills provide policy, never classifications.

| Class | Triggers | Behavior |
|---|---|---|
| `deterministic` | usage/config error, assertion/test failure, compile error, analyzer finding, invalid input, reproducible timeout | **no automatic retry** |
| `transient` | network reset, unavailable service, process launch race, configured flaky signature | retry with backoff 250 ms → 1 s → 4 s, bounded by retry + wall-clock budgets |
| `repair` | a code/config repair followed by a rerun | one retry per repair; must reference the failed evidence and changed files |
| `unknown` | anything unrecognized | no automatic retry; escalate; raw error only in the bounded/redacted artifact |

Every attempt gets a span and evidence record. A retry never overwrites a failed attempt.

## 5. Verification contracts

| Gate | Command | Success | Failure |
|---|---|---|---|
| `testsPassed` | `npm test` (this repo) / `unity test <project> --format json` | exit 0 + report | nonzero; parse the report (path + hash are evidence) |
| `compileCheckConfirmed` | `unity build <project> --target StandaloneWindows64 -o <tmp> --format json` or a configured compile command | exit 0 | nonzero |
| `unityAnalyzerClean` | `unity run <project> --command <analyzer-cmd> --format json` | exit 0 + zero `UNT*` | nonzero or any `UNT*` |
| `acceptanceCriteriaValidated` | `cadet-agent harness verify-acs --story <path>` | every declared AC test appears in the run's inventory | a declared test is absent, an AC declares none, or the inventory is unknown |

- If Unity CLI is unavailable, `compileCheckConfirmed` may be satisfied by a user
  `manual-confirmation` record (project path, editor version, timestamp, scope).
- The analyzer command must be declared in `.cadet/harness.json` before the gate can be automated.
- **Evidence is bound to relevant files.** `cadet-agent harness verify` hashes the files given by
  `--files` (or the working tree's changed files by default) into the evidence `inputTreeHash`, so a
  later edit to any of them invalidates the evidence and blocks the transition.
- **Cadet's own files are never relevant files.** `.cadet/state.json` and `.cadet/runs/**` are
  excluded from the working-tree scan. `state.json` is rewritten by the very command that records a
  gate, and `runs/` gains a ledger on every harness invocation; binding evidence to either would
  make a gate stale the instant it was written and would certify no story code. Pass `--files`
  explicitly to bind evidence to the work itself rather than to whatever happens to be dirty. An
  empty `--files ""` is rejected (`empty-files`) rather than silently falling back to the scan.
- **A declared test must actually run.** Each acceptance criterion in a story records the exact
  test identifiers that prove it. Under `strictClosure.enabled`, `acceptanceCriteriaValidated`
  cannot be set while any declared test is absent from the inventory of the run that satisfied
  `testsPassed`. The check is mechanical: an unparseable report yields an *unknown* inventory,
  which proves nothing and cannot satisfy the gate. Editing a declared test name invalidates
  evidence bound to the old name, because AC ids and test names participate in `criteriaHash`.
- **Freshness cannot be silently skipped.** If Git cannot be queried and no `--files` are given,
  verification is blocked (`freshness-unavailable`) rather than recorded against an empty input tree.
  A project may opt out explicitly with `allowEmptyFreshness: true` in `.cadet/harness.json`.
- **Red-before-green is enforced, not just documented.** A `testsPassed` green result is rejected
  unless a prior failed (red) record exists for the same work item and gate — either in state or from
  an earlier attempt in the same loop. A `no_test_required` work item is exempt.
- **Hard budgets block.** Exceeding a hard limit (context tokens, output tokens, tool calls, wall-clock,
  cost) stops the operation and can never produce a passing gate. Command output is counted against
  the output-token budget (estimated from its byte length). When a configured cost budget exists
  but provider rates are unavailable, the cost is unmeasurable and the envelope cannot be confirmed —
  the run is blocked rather than treated as within budget.
- See `.cadet/agent/core/UnityCli.md` for the full command contract.

## 6. Loop contract

1. Prepare the check and record the `inputTreeHash`.
2. Run once.
3. Classify the result (§4).
4. Retry only if the class is retryable **and** budget remains.
5. Record every attempt and repair action.
6. Stop on pass, deterministic failure, timeout, or budget exhaustion.
7. Escalate with an actionable diagnostic and the next required input.

## 7. Context tiers

| Tier | Content | When |
|---|---|---|
| 0 | active policy, state, current task, required skill | always |
| 1 | acceptance criteria, active story/design, changed files, nearby tests | default for implementation/review |
| 2 | owning abstraction, direct callers/callees | only with a recorded reason |
| 3 | history, broad docs, distant references | only after an explicit budget check and reason |

- Every loaded item gets a manifest entry: path/reference, tier, reason, authority, content
  hash, byte/token estimate, load timestamp.
- Repeated content is deduplicated by hash before budget accounting.
- Context is stale when a loaded file hash changes, the active work item changes, or the
  required skill/policy version changes; re-read the affected item before using it as evidence.

## 8. Tool routing

Order: **deterministic CLI** for verification → **repository read/search** for static context →
**MCP** only for live Unity inspection or mutation. If MCP is unavailable, fall back to static
context plus CLI verification; **never pretend live inspection occurred**. Live-editor mutation
requires explicit user confirmation.

- Persisted tool output default: 64 KiB per span. Larger output is written to an artifact and
  represented by path, hash, byte count, and a 4 KiB diagnostic preview.

## 9. Privacy and redaction

- Never persist secrets, raw prompts, credentials, or unredacted tool output unless explicitly
  configured. Redaction runs before ledger persistence and before report display.
- **Artifacts are redacted before they are written.** Oversized tool output and verification
  command output are redacted, then written, and the artifact hash covers the persisted (redacted)
  bytes. The inline preview is redacted too.
- Redaction covers bearer/basic auth headers, API keys and common provider prefixes, JWTs,
  private keys/certificates, passwords and password-like keys, connection strings, cloud access
  keys, npm/GitHub tokens, and secret values nested in arrays or objects.
- Default retention: short-lived run records, keep-on-failure, **no raw prompt retention**.

## 10. Capability boundary

- The CLI enforces state, budgets, verification commands, and its own tool calls. It cannot
  observe arbitrary model-token usage or every IDE tool call.
- IDE adapters must emit explicit `harness record` events where hooks are unavailable, and
  reports must label unavailable runtime telemetry rather than inventing values.
- Copilot hooks may intercept supported shell invocations. Cursor, Continue, and Claude Code are
  capability-limited unless their host exposes a compatible hook; this limitation is visible in
  the run report. Run `cadet-agent harness capabilities` to see the active capability set.

## 11. Skill contract

Every phase skill consumes or emits harness records and blocks when its required evidence or
budget state is missing.

| Skill | Required inputs | Emitted evidence | Budget scope | Blocks when |
|---|---|---|---|---|
| Requirements | Tier 0/1 context | context manifest, assumption notes | per run | policy/state unreadable |
| Architecture | requirements evidence | context manifest, ADR links, verification plan | per run | requirements not finalized |
| Spike | unverified assumption | bounded spike evidence artifact | `maxToolCalls`, `maxWallClockMs` | spike budget exhausted |
| StoryBreakdown | design evidence | per-story verification commands + evidence outputs, AC ids + declared tests | per run | acceptance criteria unmapped or an AC declares no test |
| TDD | red record, acceptance criterion | `testsPassed` red→green evidence | `maxRetriesPerStep` | no red record for a testable change |
| Debugging | reproduce record | per-attempt spans, regression evidence | `maxTotalRetries` | deterministic failure retried blindly |
| CodeReview | run ledger, gate evidence | review decision + findings | per run | gate evidence stale/missing |
| Resume | active run, ledger | validated next legal transition | per run | illegal/stale transition requested |
| MCPSetup | Unity CLI/MCP availability | round-trip + mutation-approval evidence | per run | mutation without confirmation |
| AgentReviewer | full ledger + state | audit decision | per run | evidence-backed gates missing |

## 12. CLI surface

**Every command declares whether it writes.** The registry in `src/harness/commands.mjs` is the
single source of truth: `mutates`, `writes`, and any required unattended bound. Two consequences
matter to a skill, and neither depends on the caller remembering a flag:

- `--help` is honoured at any depth and writes nothing. "Checking the help" is always read-only.
- `--dry-run` is honoured **globally and automatically** for every mutating command. You do not need
  to know that a command supports it; passing it is sufficient, and omitting it is the only way to
  write. `state transition` is the one declared exception: its dry run returns the identical verdict
  a real transition would, rather than a bare acknowledgement.
- A command declared read-only performs no writes, ever. This is asserted for every such command, so
  a new write in `report` or `matrix-check` fails the build rather than the user.
- A command that acts irreversibly and may run unattended must require a **content-bearing bound**
  rather than a confirmation flag — `cleanup` requires `--older-than-ms`, so an agent must state
  *what* it deletes, not merely *that* it approves deleting something.

Run `cadet-agent harness capabilities --format json` to read the registry instead of inferring it.

- `cadet-agent state validate` — validate state against the v2 schema. Read-only.
- `cadet-agent state migrate` — atomically migrate v1 → v2. **On failure the tree is left exactly as found**, backup included: the backup is written only after the migrated document validates.
- `cadet-agent state transition --to <phase> [--dry-run]` — enforce the transition matrix + evidence. **`--dry-run` reports the same verdict and writes nothing** — use it for every inspection; without the flag the transition is applied and `state.json` is written. A transition is legal only when it is a gated transition in the matrix or a declared ungated forward edge (bootstrap + planning progression); `closed` is terminal, so leaving it is rejected. A rejection lists every missing or stale gate.
- `cadet-agent harness record` — append a sanitized span/evidence/decision event. Honours `--dry-run`. Append-only, so it carries no unattended bound: requiring a flag to record evidence would push agents to skip logging.
- `cadet-agent harness confirm --gate <gate> --reason <t> --expires-at <iso> --environment <k=v,...> --scope <a,b> [--files a,b] [--commit <sha>]` — record `manual-confirmation` evidence, the first-class path for a gate automation cannot satisfy. Validates the strict-closure metadata *before* writing, rejects a gate in `disallowManualFor`, bounds the validity window, and binds the record to files exactly as `harness verify` does. Writes the ledger and then `state.json` atomically; prior passing evidence for the gate is marked `superseded`, never deleted. Use this instead of hand-editing `state.json` — the rules in §2a are checked at creation time, when the human still remembers what was verified.
- `cadet-agent harness verify --gate <gate> [--files a,b] [--commit <sha>]` — run a bounded, classified verification loop. Evidence is bound to the relevant files given by `--files` (or the working tree's changed files). A `testsPassed` green result requires a prior red record. On success it records the new evidence in `state.json → gateEvidence` and flips the gate; prior passing evidence for that gate is marked `superseded`. The full attempt history is written to the run ledger. A **failing** verification still persists its ledger: that is the red record, and suppressing it would break TDD evidence.
- `cadet-agent harness verify-acs --story <path> [--report <path>] [--write-coverage]` — mechanically verify that every test a story declares for an acceptance criterion actually ran. The story is the single source of truth for the AC→test mapping; the inventory is extracted from a test report (TAP, JUnit XML, or Unity JSON), auto-detected by content. Under `strictClosure.enabled`, any declared test absent from the inventory, any AC that declares no test, or an unknown/empty inventory means `acceptanceCriteriaValidated` is **not** set and the command exits 1, listing every gap with its AC id. With strict closure off it reports and exits 0 without touching `state.json`. `--write-coverage` additionally writes a derived `*.coverage.json` artifact.
- `cadet-agent harness matrix-check --matrix <path> [--report <path> | --inventory <path>]` — reconcile a TDD matrix's **delivered** test-name claims against a compiled inventory. A matrix row is authored during architecture, before implementation, so a name can be an intention that changes or never happens while nothing re-checks the row; this is the mechanical check for that. Read-only — it never writes state, so it runs at authoring time as well as in a gate. Two directions are kept deliberately separate: a name in a `DELIVERED` row absent from the inventory is a **defect** (exit 1), while a name in an undelivered row is an **intention** and is never reported. Collapsing the two produces false failures, and a false failure is how a real check gets switched off. Undelivered intentions that *have* landed are reported informationally, so a stale row is visible rather than silent. Without `--report` or `--inventory` nothing can be proven, so the command exits 1 rather than reporting success.
- `cadet-agent harness report` — summarize budget consumption and failures (no secrets). Read-only.
- `cadet-agent harness cleanup --older-than-ms <n>` — apply the retention policy to `.cadet/runs/`. **Deletes run records irreversibly, so `--older-than-ms` is required**: an unattended agent must state the age bound it is deleting by. Without it the command refuses and deletes nothing, so a caller that does not know what the command does cannot destroy evidence by accident. `--dry-run` reports what would be deleted without deleting it.
- `cadet-agent harness capabilities` — report available CLI/Unity/MCP/hook/token/cost telemetry, plus the command registry (`commands[]`) with each command's `mutates`, `writes`, and unattended requirements. Read-only.

Every command supports `--format human|json` and returns nonzero for invalid state, failed
verification, budget exhaustion, stale evidence, or safety rejection. It never prints secrets.
An option with a missing value is a usage error, never a silently swallowed next flag: a stray
`--target --format` previously wrote a ledger into a directory named `--format/`.
