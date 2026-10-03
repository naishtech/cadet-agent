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
  record explicitly allows that phase. One exception: a gate in a transition's **`revalidate`
  set is not phase-scoped** — it is judged on its `inputTreeHash`, `criteriaHash`, and expiry,
  because the question revalidation asks is whether the gate is still true, not which phase
  recorded it. A transition's own `gates` stay phase-scoped. (`requireFreshRevalidation` is a
  separate rule on the same set: it additionally demands a record newer than the last
  transition, and only that rule can force a re-record of an unchanged gate.)
- `inputTreeHash` = SHA-256 over sorted `(relative path, file hash)` pairs of relevant files,
  excluding generated run artifacts.
- A gate exception is scoped to **one work item and one transition**, expires when that
  transition completes or at `expiresAt`, and never propagates to a new story.
- **Strict closure** (`strictClosure.enabled`, opt-in, default off). When enabled, a transition
  also re-derives the gates already satisfied in earlier phases, so a gate cannot go stale
  during a long `review`/`validation` and still be carried into closure. Re-derivation is
  deliberately **not phase-scoped**: it asks whether the gate is still true — its input tree,
  criteria hash, and expiry — not which phase wrote the record down, so the phase stamp alone
  never forces a gate to be re-recorded. **What still does is `requireFreshRevalidation`
  (default on)**: it independently requires a record *newer than the last transition*, so a
  repository that wants an unchanged tree to carry a gate across a transition sets it to
  `false`. Verified on a real project — with it on, all seven revalidated gates are refused for
  recency; with it off, only a genuinely changed input tree is refused. When strict closure is
  disabled, behaviour is identical to v2. See `docs/core/HarnessContract-v3.md` §1–§2.

## 2a. Manual-confirmation quality
A `manual-confirmation` record is a human assertion. It binds to the same relevant files as an
automated record — those given by `--files`, or the working tree's changed files when the flag is
omitted. Its `expiresAt` is an *additional* bound, not its only one. Under `strictClosure.enabled` it must
carry:

- `reason` — why automation was unavailable;
- `expiresAt` — a concrete bound (`null` is rejected: declaring the key is not declaring a bound);
- `environment` — `{ projectPath?, editorVersion?, tool?, ... }` describing what was verified;
- `scope` — a non-empty array naming what the confirmation covers.

`strictClosure.disallowManualFor` names the gates a manual confirmation may **not** satisfy. The default
list is `testsPassed`, `acceptanceCriteriaValidated`, `reachabilityAddressed` and
`architectureFitnessPassed`: each has an automated path in every environment Cadet supports, so a hand
record would substitute for something available.

The gates deliberately outside that list, and why:

- `compileCheckConfirmed`, `unityAnalyzerClean`, `storyTrackingUpdated` — their automated path can be
  absent (no Unity CLI, no project script), so forbidding manual confirmation would leave the gate
  unsatisfiable rather than stricter.
- `designReviewCompleted` — a review is a judgement, so the reviewer, agent or person, may record it with
  `harness confirm --gate designReviewCompleted` and the strict-closure metadata.
- `humanAcceptanceConfirmed` — no command produces it at all, so a list that forbade it by hand would leave
  it unsatisfiable, and `validatePolicy` refuses such a list.

A judgement gate (`codeReviewCompleted`, `securityReviewPassed`, `designArtifactSyncConfirmed`) may always
be recorded by a human. A project whose declared checks cannot run uses a `tooling-gap` exception that
names who accepted it, which is a different statement from "a person verified this". Prefer
`cadet-agent harness confirm` over hand-editing state: it enforces these rules at creation time and writes
the ledger and state atomically.

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

## 2c. Where evidence lives (state v4)
Evidence has three homes, and the boundary between them is the work item.

- **Live, in `state.json → gateEvidence`** — the **active work item's live records**, and what
  `state transition` reads. It includes records with no commit to cite: a `manual-confirmation`, a
  `compileCheckConfirmed` fallback, and the mid-story green run, because a gate must be satisfiable on a
  tree that has not been committed yet.
  - **"Live" excludes history.** The *newest record per gate*, every `passed`/`manual-confirmation`
    record and every `failed` record stay inline (red-before-green reads the prior red); `superseded`
    records, and `blocked` ones that are not the newest for their gate, belong in the archive.
    `state compact` applies this bound; `--retain-all` opts out.
  - **The story boundary is a command, not an edit.** `cadet-agent state begin --epic <id> --story <file>`
    resets the gates, archives the finished story's records and folds them into the coverage index.
    Setting `activeWorkItem` by hand leaves the previous story's records inline for ever, where
    `evidenceFreshness` rejects them as belonging to another work item — unreadable by every gate, and
    therefore pure weight.
- **Sealed, in a commit's trailers** — written by `state seal` and read back with
  `state validate --verify-sealed`. Each record's fields become `Cadet-*` trailers and **the commit id is
  the seal**: trailers are part of the commit object, so editing one changes the SHA and the citation stops
  resolving. Trailers are used rather than `git notes`, which are not pushed by default and can be
  rewritten silently.
- **Archived, in `.cadet/archive/evidence/<work-item>.jsonl`** — append-only, and the home of records that
  left `state.json` but were never sealed (every pre-v4 record, which cites no commit).

`state.json → evidenceCoverage` is a one-row-per-work-item index of everything no longer inline
(`recordCount`, `gates`, first/last timestamps, `sealedCommit`). **It is what keeps the `done`-story
coverage rule in §1 answerable without git**, so a compacted repository is never mistaken for one with
missing evidence.

Two rules follow, and both are load-bearing:

- **Nothing leaves `state.json` without being written down first.** Compaction validates the slimmer
  document, *then* appends the archive, *then* writes the backup, *then* renames. A crash between the
  writes must leave records in both places — never neither.
- **A record that cannot be bound must not satisfy a gate.** A sealed block that exceeded the output bound
  is marked `partial` and is rejected, exactly as an unscoped or stale record is.

**Cadet never commits** (C5). Sealing prepares a message file; run `git commit -F <path>` yourself. Sealing
is a `validation`/closure-time act, once per work item — not something to do on every gate, and **not**
something to leave until later: it must happen **before `state begin` moves to the next story**, because
the boundary archives the records and a record in `.cadet/archive/` can no longer be sealed. Sealed before
the boundary, a story's evidence is part of the commit that closed it; sealed afterwards, it is a file
beside the history rather than in it.

## 2d. The runtime context protocol

**Cadet never injects context into a model.** Hosts own model context, so the framework does the only
honest thing available: it states what a phase requires, lets the host report what it loaded, and
compares the two. Three commands, and the whole point is that "the agent read the skill file" stops
being an assertion nothing can check.

- `cadet-agent harness context plan` — writes `.cadet/context/plan.json`: the required references
  (tier 0 always, the runtime contract, the skill this phase dispatches, the story and its epic) and
  the advisory ones, each with a tier, an authority, a **reason**, a content hash, and its budget
  effect. `budget.fits` answers whether the required set fits the declared context budget — a plan
  that cannot fit is one a host will silently truncate, so it is reported rather than discovered.
- `cadet-agent harness context record` — writes `.cadet/context/record.json`: what was loaded, and the
  level the caller can claim. `--transcript <file>` takes the loads from a host's own log (one JSON
  object per line naming a `reference`), which is how a host with no hook can still be checked.
- `cadet-agent harness context validate` — compares the plan, the record and the files as they are
  now. **Read-only.** Exit 0 means a context-complete checkpoint may be claimed.

### The four levels, and why the difference matters

| Level | What it means | Can it certify a checkpoint? |
|---|---|---|
| `enforced` | A hook blocked substantive action until the plan was loaded. | Yes — and only with `--enforced-by <hook>`, where the hook file exists **and declares `"enforces": ["context"]`**. |
| `recorded` | The host reported what it loaded. Observed, not prevented. | Yes, if every required reference is there and unchanged. |
| `estimated` | Nobody reported; the plan was used to infer the loads. | **No.** Nothing was observed. |
| `unavailable` | No information at all. | **No.** |

A host without a hook cannot claim `enforced`: the claim is refused, and the remedy — record the run
as `recorded` — is named in the refusal. A hook that guards something else is not a context
mechanism, so naming one is refused too. This is the measured position, not a parity claim: on this
repository the only shipped hook guards git writes, so **no host can claim `enforced` context today**.

### What blocks a checkpoint

- A required reference that was never loaded.
- A required reference that **changed after** the record was taken (changed-file invalidation).
- A record taken before the current work item started (work-item invalidation — a story boundary
  invalidates the record, because it describes different context).
- A level that observed nothing (`estimated`, `unavailable`).

Advisory context never blocks. It is reported, because an advisory gap nobody reads is the same as no
plan at all — but a helpful thing that can block is a gate, and this one is not.

### `changeHistory` entries are pointers, not prose

The log is **bounded** (`HISTORY_ENTRIES_KEPT` entries inline; the overflow is appended to
`.cadet/archive/history.jsonl` by `state compact`/`state migrate`), and it stays bounded only if
entries stay small. An entry is a **reference**: the artifact path and the phase, so the next agent
can find the record. It is never the record itself.

- A handoff records `Handoff recorded at .cadet/handoffs/<file>.md` — not the summary. On the audited
  project 116 handoff entries averaged 1.9 KB each and were 65% of a 343 KB log, every one
  duplicating a file already on disk.
- A phase transition records **nothing**: `lastTransition` and the sealing commit already say it.
- Requirements/architecture/breakdown/debug record the artifact path, not the artifact.

**The rule is enforced, not merely stated.** An entry's text may be at most 400 characters
(`MAX_HISTORY_ENTRY_CHARS`), summed across `change`, `reason` and `rationale` — bounding one field
would only relocate the prose, which is exactly what happened: on the same consumer, `reason` held
12.3 KB of the 18.9 KB the surviving log occupied. `validateState` **errors** on a longer one in a
v4 document, because
the documentation-only version of this rule is what let it drift back in through every skill except
the one it was written for. On the audited project the longest entry was a 1.2 KB retelling of a
review report that it named in the same sentence — the report was already in git.

- The error is repairable in place: `cadet-agent state compact --keep active` moves over-long
  entries to `.cadet/archive/history.jsonl` and loses nothing. `state compact` archives an
  over-long entry **wherever it sits**, newest included — recency is the wrong selector for it,
  because the newest entry is exactly the one an agent just wrote.
- A v1-v3 document is not scolded for prose in its log: those versions append prose by design, and
  `state migrate` compacts the log as it moves the document to v4.
- A short line that states a fact git cannot hold is fine. `2026-09-11: session initialised,
  workflow path 'large'` is a pointer to nothing, and it is one line. The rule is against the
  **retelling**, not against the entry.

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

A command that never launched is not one of these classes: it is recorded `blocked` (stopReason
`launch-failed`) and is never retried, because a missing interpreter does not appear on a second
attempt. See §5.

## 5. Verification contracts

| Gate | Command | Success | Failure |
|---|---|---|---|
| `testsPassed` | `npm test` (this repo) / `unity test <project> --format json` | exit 0 + report | nonzero; parse the report (path + hash are evidence). A command that never **launched** is `blocked`, not a red — see below |
| `compileCheckConfirmed` | `unity build <project> --target StandaloneWindows64 -o <tmp> --format json` or a configured compile command | exit 0 | nonzero |
| `unityAnalyzerClean` | `unity run <project> --command <analyzer-cmd> --format json` | exit 0 + zero `UNT*` | nonzero or any `UNT*` |
| `acceptanceCriteriaValidated` | `cadet-agent harness verify-acs --story <path>` | every declared AC test appears in the run's inventory | a declared test is absent, an AC declares none, or the inventory is unknown |
| `reachabilityAddressed` | `cadet-agent harness verify-reachability --story <path>` | the story's reachability is witnessed, or deferred to a work item that exists and is not done | the declaration is missing or malformed, a deferral names a phantom or already-done work item, deferrals form a cycle, or the configured `reachability.command` exits nonzero |
| `userPlaythroughConfirmed` | ask the person who played it, then `cadet-agent harness confirm --gate userPlaythroughConfirmed --reason "<their answer>" --files <story>` — or, for a `Play: deferred` story, `cadet-agent harness verify-play --story <path>` | a person played the delivered work and said what they did and what they saw, or the story's play deferral names a live work item | a `required` declaration with no person's record (no command produces one); a declaration that is missing, malformed, self-deferring, deferring to a work item that does not exist or is already done, or part of a deferral cycle |
| `architectureFitnessPassed` | `cadet-agent harness verify-architecture` (the project's own declared checks; there is no `--command`) | every required check that governs the changed files ran and reported no violation | a required check exited non-zero, or a required check could not complete (it timed out, never launched, or declared an artifact it did not write) | the project declares no checks, or none governs the changed files — then the gate is not required at all |
| `designReviewCompleted` | `cadet-agent harness verify-design-review --artifact <path> --files <design,requirements,ADRs>` | the review artifact names its reviewer and inputs, every finding has a known disposition, and every contested finding names its resolver | the artifact has no Findings section, no reviewer or no inputs; a finding id or disposition is not recognised; an `accepted`/`deferred` finding names nowhere; a contested finding has no resolution naming who decided it; or nothing was bound with `--files` |
| `humanAcceptanceConfirmed` | ask the person who accepted it, then `cadet-agent harness confirm --gate humanAcceptanceConfirmed --reason "<their answer>" --expires-at <ISO-8601>` | a person recorded what they accepted and what they saw | a command is offered for it (nothing automated can answer the question); or a record exists with no answer in it |

- If Unity CLI is unavailable, `compileCheckConfirmed` may be satisfied by a user
  `manual-confirmation` record (project path, editor version, timestamp, scope).
- The analyzer command must be declared in `.cadet/harness.json` before the gate can be automated.
- **Evidence is bound to relevant files.** `cadet-agent harness verify` hashes the files given by
  `--files` (or the working tree's changed files by default) into the evidence `inputTreeHash`; a later
  edit to any of them invalidates the evidence and blocks the transition.
- **Cadet's own files are never relevant files.** `.cadet/state.json` and `.cadet/runs/**` are excluded
  from the working-tree scan. Pass `--files` explicitly to bind evidence to the work itself rather than to
  whatever happens to be dirty. An empty `--files ""` is rejected (`empty-files`) rather than silently
  falling back to the scan.
- **A declared test must actually run.** Each acceptance criterion in a story records the exact test
  identifiers that prove it. Under `strictClosure.enabled`, `acceptanceCriteriaValidated` cannot be set
  while any declared test is absent from the inventory of the run that satisfied `testsPassed`. An
  unparseable report yields an *unknown* inventory, which proves nothing and cannot satisfy the gate.
  Editing a declared test name invalidates evidence bound to the old name, because AC ids and test names
  participate in `criteriaHash`.
- **The AC record binds the story, not the report.** `harness verify-acs` binds its evidence to the story
  — repo-relative, so the freshness re-derivation at transition time can resolve it — and to the declared
  test names via `criteriaHash`. The test report is kept as `artifactPath` for audit and is deliberately
  **not** a relevant file.
- **Freshness cannot be silently skipped.** If Git cannot be queried and no `--files` are given,
  verification is blocked (`freshness-unavailable`) rather than recorded against an empty input tree.
  A project may opt out explicitly with `allowEmptyFreshness: true` in `.cadet/harness.json`.
- **Red-before-green is enforced.** A `testsPassed` green result is rejected unless a prior failed (red)
  record exists for the same work item and gate — in state, or from an earlier attempt in the same loop.
  A `no_test_required` work item is exempt.
- **A command that never launched is not a red.** When the shell cannot find or execute the command — a
  spawn error, a program `cmd.exe` cannot resolve, a WSL stub with no installed distribution, or a shell's
  exit 126/127 convention — the attempt is recorded `blocked` with stopReason `launch-failed`, **never**
  `failed`, and it is not retried. A `blocked` record cannot satisfy red-before-green, so no green can be
  licensed by a run in which nothing executed. Before executing, a command led by a POSIX interpreter
  (`bash`, `sh`, `dash`, `zsh`, `ksh`) is resolved on Windows: if every candidate on PATH is a WSL stub,
  the gate is blocked before anything runs and the rejected path is named. The declared command is never
  rewritten. Install Git for Windows (a real `bash`), or declare a command that needs no POSIX
  interpreter.
- **Reachability is opt-in, and the switch is not the guarantee.** `reachabilityAddressed` joins
  `review -> validation` only when `.cadet/harness.json` sets `reachability.enabled: true`; with the
  default off, the gate list is exactly what the transition matrix declares. When it is on, a story must
  declare either `Reachability: witnessed — <how>` or `Reachability: deferred to <work item> — <why>`.
  **A deferral is re-examined once its target is `done`**: it then fails, at verify time and again at
  `validation -> closed` under strict closure. Under strict closure the gate may not be satisfied by
  manual confirmation (it is in the default `disallowManualFor`), because the declaration check runs even
  with no probe configured. A `witnessed` declaration is a claim, not a proof: the proof is the
  repository's own `reachability.command`, whose exit code is the verdict. With no command configured the
  check says so rather than implying a guarantee it did not establish. **A new Unity project has this gate
  on from installation**: the shipped policy file declares it off, and initialization turns it on after
  detecting `ProjectSettings/ProjectVersion.txt` (or, failing that, `Assets/` with `Packages/manifest.json`).
  A project that already owns `.cadet/harness.json` keeps it unchanged, and a non-Unity repository keeps
  the gate off.
- **Hard budgets block.** Exceeding a hard limit (context tokens, output tokens, tool calls, wall-clock,
  cost) stops the operation and can never produce a passing gate. Command output is counted against the
  output-token budget, estimated from its byte length. When a configured cost budget exists but provider
  rates are unavailable, the cost is unmeasurable: the run is blocked rather than treated as within budget.
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
| TDD | red record, acceptance criterion | `testsPassed` red→green evidence; the story's reachability declaration and its `Play:` declaration | `maxRetriesPerStep` | no red record for a testable change; a story with no reachability declaration and no owned deferral, when `reachability.enabled`; a story with no `Play:` declaration, when `userPlay.enabled` |
| Debugging | reproduce record | per-attempt spans, regression evidence | `maxTotalRetries` | deterministic failure retried blindly |
| VisualEvidence | rendered frame (static claim) or clip/timed frame sequence (temporal claim) + source under test | inspected-artifact finding (`passed`/`failed`/`blocked`/`visionUnavailable`/`inconclusive`) bound to the source, not the artifact; a temporal claim passes only on a motion artifact, never a still | per run | artifact missing or unreadable. **An image-incapable model does not block**: record `visionUnavailable` and continue |
| CodeReview | run ledger, gate evidence, the story's reachability declaration | review decision + findings, including the reachability finding — an UNOWNED gap is blocking, an owned deferral is filed | per run | gate evidence stale/missing |
| Resume | active run, ledger | validated next legal transition | per run | illegal/stale transition requested |
| MCPSetup | Unity CLI/MCP availability | round-trip + mutation-approval evidence | per run | mutation without confirmation |
| AgentReviewer | full ledger + state | audit decision | per run | evidence-backed gates missing |

## 12. CLI surface

**Every command declares whether it writes.** The registry in `src/harness/commands.mjs` is the single
source of truth: `mutates`, `writes`, and any required unattended bound. Three consequences matter, and
none depends on the caller remembering a flag:

- `--help` is honoured at any depth and writes nothing.
- `--dry-run` is honoured **globally and automatically** for every mutating command; omitting it is the
  only way to write. `state transition` is the declared exception — its dry run returns the same verdict
  a real transition would, rather than a bare acknowledgement.
- A command that acts irreversibly and may run unattended requires a **content-bearing bound** rather
  than a confirmation flag: `cleanup` requires `--older-than-ms`, and `state compact` requires `--keep`.

`cadet-agent --help` lists every command and flag, and `cadet-agent harness capabilities --format json`
carries the registry. Gate meanings and evidence rules are in §5; the test suite asserts each refusal
named below.

| Command | Writes | Key flags and behaviour |
|---|---|---|
| `cadet-agent state init` | `state.json` | `--workflow-path large\|small\|no_test_required` (default `large`), `--tracking-mode`, `--phase`, `--learner-tier`, `--operating-mode`. Refuses an existing document and an unknown value, and validates the document before writing it. |
| `cadet-agent state validate` | – | `--verify-sealed` also reads evidence out of commit trailers (§2c). It is additive: it can clear an error a real sealed record backs, and never raises a new one. A read that cannot reach git is a warning, not a silent pass. |
| `cadet-agent state migrate` | `state.json`, `.cadet/archive/`, backup | `--to <version>`, `--keep <bound>`. Atomic: a failure leaves the tree exactly as found, backup included. |
| `cadet-agent state compact` | `state.json`, `.cadet/archive/` | `--keep always\|active\|<work-item ids>` (required when unattended) selects the work items that stay inline; within them the newest record per gate, every `passed`/`manual-confirmation` record and every `failed` record stay. `--retain-all` keeps every record of those items instead. |
| `cadet-agent state begin` | `state.json`, `.cadet/archive/` | `--epic`, `--story`. Resets every gate, archives the previous item's evidence **before** the document is written, folds it into `evidenceCoverage`, and drops expired exceptions. Refuses an already-active target, and a `closed` session. |
| `cadet-agent state seal` | `.cadet/archive/`, `*.commit-msg` | `--work-item`, `--commit-msg`. **Cadet never commits** (C5): it prepares the message file for `git commit -F`; the commit stays the user's action. |
| `cadet-agent state transition` | `state.json` | `--to <phase>`, `--dry-run`. Legal only for a gated transition or a declared ungated forward edge; `closed` is terminal, so leaving it is rejected. A rejection lists every missing or stale gate. |
| `cadet-agent harness record` | `.cadet/runs/` | Append-only span/evidence/decision event. No unattended bound: requiring a flag to record evidence would push agents to skip logging. |
| `cadet-agent harness confirm` | `.cadet/runs/`, `state.json` | `--gate --reason --expires-at --environment --scope [--files --commit --expect-phase]`. Validates the strict-closure metadata **before** writing, refuses a gate in `disallowManualFor`, and marks prior passing evidence `superseded` rather than deleting it. |
| `cadet-agent harness verify` | `.cadet/runs/`, `state.json` | `--gate [--files --commit --expect-phase]`. Binds `--files` (or the changed files) into the input-tree hash. A green `testsPassed` needs a prior red; a failure still persists its ledger, because that ledger is the red record. |
| `cadet-agent harness verify-acs` | `.cadet/runs/`, `state.json`, `*.coverage.json` | `--story [--report --write-coverage --expect-phase]`. Under strict closure, a declared test that did not run, an AC that declares no test, or an unknown inventory leaves `acceptanceCriteriaValidated` unset and exits 1. |
| `cadet-agent harness verify-reachability` | `.cadet/runs/`, `state.json` | `--story [--expect-phase]`. Checks the declaration and runs the configured `reachability.command`. Opt-in (`reachability.enabled`). |
| `cadet-agent harness verify-design-review` | `.cadet/runs/`, `state.json` | `--artifact --files`. Binds the artifact and its inputs, so an edited design makes the review stale. It never writes the artifact. Opt-in (`designReview.enabled`). |
| `cadet-agent harness verify-architecture` | `.cadet/runs/`, `state.json` | No `--command`: the checks come from `.cadet/harness.json`. A declared artifact that is missing, or unparseable as `json`, leaves the check `blocked` rather than passed. Opt-in (`architectureFitness.enabled` and at least one check). |
| `cadet-agent harness verify-play` | `.cadet/runs/`, `state.json` | `--story`. Refuses a missing or malformed declaration, a deferral to a work item that does not exist or is `done`, and a deferral cycle. It records only a `deferred` declaration; a `required` one is refused, and the refusal names the route that can record it — a person, asked and recorded with `harness confirm --reason`. Opt-in (`userPlay.enabled`). |
| `cadet-agent harness matrix-check` | – | `--matrix [--report\|--inventory]`. A `DELIVERED` row missing from the inventory is a defect (exit 1); an undelivered row is an intention and is never reported. With no inventory nothing is proven, so it exits 1. |
| `cadet-agent harness context plan` / `record` / `validate` | `.cadet/context/plan.json` / `record.json` / – | `plan` writes what the phase requires; `record` writes what the host loaded and the level it can claim (`--level`, `--loaded`, `--enforced-by`, `--transcript`, `--host`); `validate` is read-only. §2d. |
| `cadet-agent harness status` | – | The one-line health line: `cadet-agent: ok`, or the problem in its place. |
| `cadet-agent harness changes` | – | `--range`, `--relative-to`, `--include-cadet`. The changed-file inventory the Change Report uses. |
| `cadet-agent harness report` | – | Budget consumption and failures, never secrets. |
| `cadet-agent harness reconcile` | – | `--plans-dir`. Reports the provable inconsistencies; never repairs one. |
| `cadet-agent harness cleanup` | `.cadet/runs/` | `--older-than-ms` is required: the caller states the age bound it deletes by, so an agent that does not know the command cannot destroy evidence by accident. `--dry-run` reports what would go and deletes nothing. |
| `cadet-agent harness capabilities` | – | `--verify-host` probes the configured host controls and reports the measured level; `--format json` includes the command registry. |
| `cadet-agent init` / `cadet-agent sync` | framework files, `AGENTS.md` | `--target`, `--agents-md keep\|overwrite\|merge`, `--yes`. |

`--expect-phase <phase>` (accepted by every command that records gate evidence) refuses to record unless
`state.json`'s current phase matches, and refuses a value naming no known phase.

Every command supports `--format human|json` and returns nonzero for invalid state, failed verification,
budget exhaustion, stale evidence, or safety rejection. It never prints secrets. An option with a missing
value is a usage error, never a silently swallowed next flag.
