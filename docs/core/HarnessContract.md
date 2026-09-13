# Harness Contract (v3)

> Status: **frozen** 2026-09-13 (v2 frozen 2026-09-11).
> Canonical runtime rules live in `.cadet/agent/core/Harness.md`. This document freezes
> the data contract and the compatibility invariants that later phases are tested against.
>
> **v3 revision.** Contract v3 adds strict closure, manual-confirmation quality constraints,
> and a gate-exception taxonomy. All three are opt-in via `strictClosure.enabled`; with the
> flag absent or `false`, behaviour is identical to v2 and a v2 document remains valid.
> The full v3 rationale, the transition `revalidate` sets, the taxonomy table, the CLI
> contract, and the test matrix are in [HarnessContract-v3.md](HarnessContract-v3.md).

This file is the Phase 0 deliverable: the implementation contract, the compatibility
invariants, and the contract test matrix. Any change to the items below is a breaking
change to the harness contract and must update this file plus the fixtures it references.

## 1. Compatibility invariants (must never change silently)

These are frozen as requirements. Later phases may add fields but must not change these:

| # | Invariant | Enforced by |
|---|---|---|
| C1 | Phase names stay exactly: `context-resolution`, `requirements`, `requirementsComplete`, `architecture`, `architectureComplete`, `spikes`, `story-breakdown`, `implementation`, `review`, `validation`, `closed`. | `harness-state.test.mjs` |
| C2 | Skill dispatch order is unchanged (Requirements → Architecture → Spike → StoryBreakdown → TDD → Debugging → CodeReview → Resume → MCPSetup; AgentReviewer is audit-only). | `skills.test.mjs`, `adapters.test.mjs` |
| C3 | Gate names stay exactly: `codeReviewCompleted`, `testsPassed`, `storyTrackingUpdated`, `compileCheckConfirmed`, `unityAnalyzerClean`, `acceptanceCriteriaValidated`, `securityReviewPassed`, `designArtifactSyncConfirmed`. | `skills.test.mjs`, `harness-state.test.mjs` |
| C4 | The transition table targets are unchanged: `implementation→review`, `review→validation`, `validation→closed`, and the per-transition `gates` lists are unchanged. Contract v3 adds a `revalidate` set per transition, applied **only** when `strictClosure.enabled` is true (v3 §1). | `harness-state.test.mjs` |
| C5 | User approval requirements are unchanged: no automatic commit/push/merge, no automatic approval, live-editor mutation requires explicit confirmation. | `git-guard` tests, `Harness.md` |
| C6 | Existing v1/v2 `state.json` files either validate unchanged after migration or receive a documented, atomic migration that leaves the original untouched on failure. A v2 document stays readable and is **not** retroactively invalidated by the v3 bump; v1 migrates straight to the current version. | `harness-state.test.mjs`, `harness-cli.test.mjs` |
| C7 | Adapters remain thin pointers; no adapter restates canonical content. | `adapters.test.mjs` |
| C8 | `sync` preserves `.cadet/harness.json`, `.cadet/runs/`, `.cadet/agent/policies/`, `.cadet/agent/project-plans/`, `.cadet/state.json`. | `sync.test.mjs` |
| C9 | `.cadet/.repo-role` is neither a managed nor a preserved path, and `init`/`sync` write it as `consumer-project`; `detectRepoRole` reports `framework-source` for a tree with a manifest but no state and no project-plans. | `repo-role-marker.test.mjs`, `harness-repo-role.test.mjs` |

## 2. Identifiers, hashes, freshness

- `runId`, `spanId`, `evidenceId`, `decisionId`: UUIDv4 strings.
- Content hashes: SHA-256 over UTF-8 bytes. Archive/report hashes cover the exact persisted bytes.
- Evidence record required fields: `evidenceId`, `workItemId`, `phase`, `gate`, `status`,
  `command`, `result`, `inputTreeHash`, `criteriaHash`, `relevantFiles`, `createdAt`,
  and one of `expiresAt` / `freshnessPolicy`.
- Evidence is immutable: write-once under its ID. Corrections create a new record and mark
  the old record `superseded`.
- `validateState` enforces the full field set above: `command`, `result`, `criteriaHash`, and a
  freshness bound are required (values may be `null` where the contract permits, e.g. a
  `manual-confirmation` has no command). `cadet-agent state validate` additionally rejects a
  claimed-true gate whose evidence belongs to a different work item, has a stale `inputTreeHash`,
  or has expired.
- Default freshness scope: current story + current phase. A change to a relevant file,
  acceptance criterion, active work item, or verification command invalidates evidence.
  A new phase invalidates evidence unless the record explicitly permits that phase.
- `inputTreeHash` = SHA-256 over sorted `(relative path, file hash)` pairs of relevant files,
  excluding generated run artifacts.
- State documents and run ledgers are written atomically (temp file + rename); an interrupted
  write cannot truncate the target.
- Gate exceptions are scoped to one work item + one transition, expire at transition
  completion or `expiresAt`, and never propagate to a new story.

## 3. Default budgets

| Budget | Default | Warning | Hard stop |
|---|---:|---:|---:|
| Context tokens | 64,000 | 80% | 100% |
| Output tokens | 8,000 | 80% | 100% |
| Tool calls | 80 per run | 75% | 100% |
| Retries per step | 2 | 1 remaining | 0 remaining |
| Total retries | 8 per run | 75% | 100% |
| Wall-clock time | 30 minutes per run | 80% | 100% |
| Estimated provider cost | USD 2.00 per run | 80% | 100% |
| Downloaded archive bytes | 25 MiB | 80% | 100% |
| Decompressed archive bytes | 100 MiB | 80% | 100% |
| Archive file count | 2,000 | 80% | 100% |

At a warning: record a `budget-warning` span and continue. At a hard stop: stop the
operation, persist the ledger, and return `budget-exhausted`. Continuation requires a new
run or an explicit user-approved budget override recorded in the ledger.

## 4. Token and cost estimation

- Provider usage → use it, mark `source: provider`.
- Otherwise estimate tokens as `ceil(UTF8 byte length / 3)`, mark `source: estimate`,
  `confidence: low`.
- Never report estimated USD without a configured model rate. Estimated cost =
  `inputTokens * inputRate + outputTokens * outputRate`, rounded to 4 dp, with rate-card ID
  and effective date.
- Unknown usage is `unknown`, never silently zero, and cannot satisfy a hard cost budget. When a
  cost budget is configured but no rate card resolves the cost, the counter is marked unmeasurable
  and the operation is blocked (`budget-blocked`) rather than treated as within budget.
- Hard budgets are enforceable: a context load that would exceed the context-token budget is
  refused, and a verification attempt that reaches any hard limit returns `budget-exhausted` and
  cannot produce a passing gate. Command output counts against the output-token budget, estimated
  from its byte length.
- The verification evidence `inputTreeHash` is computed from the relevant files (`--files`, or the
  working tree's changed files). If Git cannot be queried and no `--files` are given, verification is
  blocked (`freshness-unavailable`) unless `allowEmptyFreshness: true` is set explicitly.
- Red-before-green is enforced: a `testsPassed` green result requires a prior failed record for the
  same work item and gate, unless the work item is `no_test_required`.
- Artifacts are redacted before they are written; the artifact hash covers the persisted redacted bytes.
  Redaction has no bypass option.
- `state validate` rejects a v2 document whose `gates.<name>` is `true` without a supporting
  `passed` or `manual-confirmation` evidence record.
- A run record's `status` is derived from its budget result: exhausted, blocked, or
  unmeasurable-cost runs cannot be finalized as `ok`.

## 5. Retry classifier (single source in `verification.mjs`)

| Class | Triggers | Behavior |
|---|---|---|
| `deterministic` | usage/config error, assertion/test failure, compile error, analyzer finding, invalid input, reproducible timeout | no automatic retry |
| `transient` | network reset, unavailable service, process launch race, configured flaky signature | retry with backoff 250 ms → 1 s → 4 s, bounded by retry + wall-clock budgets |
| `repair` | code/config repair followed by rerun | one retry per repair; must reference failed evidence + changed files |
| `unknown` | anything unrecognized | no automatic retry; escalate, raw error only in bounded/redacted artifact |

Each attempt gets a span and evidence record. A retry never overwrites a failed attempt.

## 6. Canonical Unity verification contracts

- `compileCheckConfirmed`: `unity build <project> --target StandaloneWindows64 -o <tmp> --format json`;
  project-specific compile command may replace it. If Unity CLI is unavailable, a user
  `manual-confirmation` record with project path, editor version, timestamp, scope.
- `unityAnalyzerClean`: `unity run <project> --command <analyzer-cmd> --format json`; success
  requires zero `UNT*` diagnostics. Analyzer command must be declared in `.cadet/harness.json`.
- `testsPassed`: `unity test <project> --format json` (Unity) / `npm test` (this repo).
  Report path + hash required evidence.
- All three return a normalized result envelope and preserve the original exit code.

## 7. Context tiers and routing

- Tier 0: active policy, state, current task, required skill — always load.
- Tier 1: acceptance criteria, active story/design, changed files, nearby tests — default for implementation/review.
- Tier 2: owning abstraction + direct callers/callees — only with a recorded reason.
- Tier 3: history, broad docs, distant references — only after explicit budget check + reason.
- Context is stale when a loaded file hash changes, the active work item changes, or the
  required skill/policy version changes.
- Routing order: deterministic CLI for verification → repository read/search for static
  context → MCP only for live Unity inspection/mutation. MCP unavailable → fall back to
  static context + CLI verification; never pretend live inspection occurred.
- Persisted tool output default: 64 KiB per span; larger output is artifact-stored with
  path, hash, byte count, and a 4 KiB diagnostic preview.

## 8. Redaction categories

Bearer/basic auth headers, API keys + common provider prefixes, JWTs, private keys/certs,
passwords/password-like keys, connection strings, cloud access keys, npm/GitHub tokens, and
secret values nested in arrays/objects. Positive and negative fixtures required per category.
Redaction runs before ledger persistence and before report display.

## 9. Hook and archive safety

- Git guard default: `ask-on-recognized-write`. Malformed JSON or unrecognized tool input →
  structured `hook-error`, block when the host supports a deny decision. `fail-open` is
  opt-in, visible, and logged.
- ZIP extraction rejects: absolute paths, traversal after canonicalization, paths outside the
  target, filenames > 240 bytes, > 2,000 files, compressed input > 25 MiB, decompressed output
  > 100 MiB, ratio > 100:1. Validates central-directory and local-header bounds before
  allocation; verifies CRC when present.

## 10. Contract test matrix (Phase 0 → Phase 8)

| Area | Positive case | Negative case | Test file |
|---|---|---|---|
| State migration | v1 state migrates to v2 | malformed state left untouched | `harness-state.test.mjs` |
| Evidence freshness | fresh evidence satisfies gate | stale tree-hash/work-item rejected | `harness-state.test.mjs` |
| Legal transitions | valid transition accepted | illegal transition lists missing gates | `harness-state.test.mjs` |
| Gate without evidence | evidence-backed `true` accepted | hand-edited `true` rejected | `harness-state.test.mjs` |
| Retry classes | transient retries within limit | deterministic does not retry | `harness-verification.test.mjs` |
| Budget warnings/stops | warning recorded + continue | hard stop returns `budget-exhausted` | `harness-budget.test.mjs` |
| Context invalidation | duplicate content dedup | stale context flagged | `harness-context.test.mjs` |
| Routing fallbacks | CLI/read routing recorded | MCP-unavailable falls back | `harness-routing.test.mjs` |
| Redaction | safe text unchanged | each secret category redacted | `harness-redaction.test.mjs` |
| Archive limits | valid zip extracts | traversal/oversize/malformed rejected | `harness-archive.test.mjs` |
| Hook payloads | recognized write → ask | malformed JSON → hook-error | `harness-hook.test.mjs` |
| Adapter/skill pointers | pointers resolve | adapter restates canonical content | `adapters.test.mjs`, `skills.test.mjs` |
| Accounting | exact + estimated usage | unknown usage never satisfies budget | `harness-ledger.test.mjs` |
| Repository role | marker/structural detection resolves the role | malformed marker falls through; marker is not managed/preserved | `harness-repo-role.test.mjs`, `repo-role-marker.test.mjs` |
| Strict closure off (v3) | v2 behaviour byte-identical with the flag absent | stale implementation gate does NOT block closure when off | `harness-strict-closure.test.mjs`, `harness-state.test.mjs` |
| Closure revalidation (v3) | fresh revalidation satisfies `validation→closed` | gate valid at `implementation` but stale at closure is rejected | `harness-strict-closure.test.mjs` |
| Revalidation recency (v3) | record newer than the last transition accepted | unexpired but older record rejected | `harness-strict-closure.test.mjs` |
| Manual-confirmation quality (v3) | full record (reason/expiresAt/environment/scope) accepted | each missing field rejected; all reported together | `harness-strict-closure.test.mjs` |
| Null freshness bound (v3) | `freshnessPolicy.scope` present accepted | `expiresAt: null` + `freshnessPolicy: null` rejected under strict | `harness-strict-closure.test.mjs` |
| `disallowManualFor` (v3) | gate not in the list accepts manual evidence | `testsPassed` manual rejected with a pointer to automation | `harness-strict-closure.test.mjs` |
| Validity window (v3) | expiry within `maxValidityMs` accepted | beyond the bound rejected | `harness-strict-closure.test.mjs` |
| Exception taxonomy (v3) | each category accepted with expiry + review note | unknown category rejected listing the valid set; missing note rejected | `harness-strict-closure.test.mjs` |
| Taxonomy expiry (v3) | shortening a category's default accepted | extending it without `expiryExtendedReason` rejected | `harness-strict-closure.test.mjs` |
| `harness confirm` (v3) | writes ledger + state, flips gate, supersedes prior evidence | disallowed gate / missing metadata / over-long validity each exit 1 and write nothing | `harness-confirm-cli.test.mjs` |
| Schema/code lockstep (v3) | schemas declare strictClosure and the taxonomy | version enum is `[1,2,3]` and defaults stay opt-in | `skills.test.mjs` |
