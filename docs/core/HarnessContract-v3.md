# Harness Contract v3 — Strict Closure, Manual-Confirmation Quality, Exception Taxonomy

> Status: **proposed** 2026-09-13. Supersedes nothing yet; v2 remains valid.
> Canonical runtime rules live in `.cadet/agent/core/Harness.md`. This document extends
> `docs/core/HarnessContract.md` (v2) and must be merged into it when the version bump lands.

## 0. Why this exists

Three defects in the v2 contract share one root cause: **closure can be reached without
proving that the evidence proving it is still true.**

1. `validation → closed` requires only `designArtifactSyncConfirmed`. The four
   `implementation → review` gates and the three `review → validation` gates are never
   re-read at closure, so a gate can be satisfied in `implementation`, go stale during a
   long `review`/`validation`, and closure still succeeds.
2. A `manual-confirmation` record needs only `command: null` and a free-text `result`. v2
   has no required `reason`, no mandatory expiry, no environment detail, and no explicit
   scope field. Dolven's own `state.json` demonstrates the consequence: several records
   carry `"expiresAt": null` and `"freshnessPolicy": null`, i.e. **an unbounded-evidence
   record that is nevertheless accepted as a valid freshness bound**, because
   `validateEvidenceShape` only checks that the *key* exists, not that it carries a value.
3. A `gate-exception` records a free-text `reason` and an optional `expiresAt`, but no
   `category`. Two very different situations — "this gate cannot be automated at all" and
   "this work item is a documentation-only change" — are indistinguishable, so they cannot
   be granted different expiry policies or demanded different closure review.

This is a breaking contract change. Per the v2 header, "Any change to the items below is a
breaking change to the harness contract and must update this file plus the fixtures it
references." It is therefore shipped as **one atomic change**: transition rules,
invariants, schemas, CLI, and tests together.

## 1. Compatibility invariants — v3 revisions

C1, C2, C3, C5, C7, C8, C9 are **unchanged**.

### C4 (REVISED) — transition table gains a closure revalidation set

The transition *targets* are unchanged (`implementation→review`, `review→validation`,
`validation→closed`). What changes is that a transition may declare **revalidated gates**:
gates that must be freshly satisfied *again* as a precondition of this transition, in
addition to its own `gates` list.

| Transition | `gates` (unchanged) | `revalidate` under `strictClosure` |
|---|---|---|
| `implementation→review` | testsPassed, compileCheckConfirmed, unityAnalyzerClean, storyTrackingUpdated | — (none) |
| `review→validation` | codeReviewCompleted, securityReviewPassed, acceptanceCriteriaValidated | testsPassed, compileCheckConfirmed, unityAnalyzerClean, storyTrackingUpdated |
| `validation→closed` | designArtifactSyncConfirmed | codeReviewCompleted, securityReviewPassed, acceptanceCriteriaValidated, testsPassed, compileCheckConfirmed, unityAnalyzerClean, storyTrackingUpdated |

`revalidate` is applied **only when `strictClosure.enabled` is true**. With the flag off,
behaviour is byte-identical to v2 — this is what makes the change opt-in and makes the
eventual default flip a one-line change.

Rationale for putting the first revalidation set on `review→validation` rather than only on
closure: a gate that has gone stale is cheapest to fix at the moment it is detected. Pinning
it at the last possible moment (closure) maximises the amount of work that must be redone.

### C6 (REVISED) — migration is v1 → v2 → v3, and v2 remains readable

- A v1 document migrates to v2 as before, then to v3.
- A v2 document migrates to v3 **without data loss**: v3 adds no required evidence field
  *retroactively*. Existing records keep their shape; the stricter field rules are enforced
  at `status: manual-confirmation` **creation and validation** time, gated by
  `strictClosure.enabled`. A v2 record is not retroactively invalidated by the version bump
  alone.
- The original file is still backed up on failure and left untouched if migration fails.
- `validateState` accepts `version` 1, 2, and 3.

> **Deliberate asymmetry.** The version bump allows v3 to *express* strictness; it does not
> *impose* it. Imposition happens only via `strictClosure.enabled`. This is what "opt-in
> first, then default in next schema/version" requires, and it is why Dolven's existing
> `manual-confirmation` records do not break on upgrade.

## 2. `strictClosure` policy block

Lives in `.cadet/harness.json`. Absent block == disabled == v2 behaviour.

```jsonc
{
  "strictClosure": {
    "enabled": false,
    "revalidateOnClosure": true,
    "requireFreshRevalidation": true,
    "manualConfirmation": {
      "requireReason": true,
      "requireExpiresAt": true,
      "requireEnvironment": true,
      "requireScope": true,
      "maxValidityMs": 86400000
    },
    "disallowManualFor": ["testsPassed"]
  }
}
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `false` | Master switch. `false` ⇒ byte-identical v2 behaviour. |
| `revalidateOnClosure` | boolean | `true` | Apply the C4 `revalidate` sets. Requires `enabled`. |
| `requireFreshRevalidation` | boolean | `true` | Revalidated gates need a record **newer than the transition that last satisfied them**, not merely an unexpired one. |
| `manualConfirmation.requireReason` | boolean | `true` | A `manual-confirmation` record must carry a non-empty `reason`. |
| `manualConfirmation.requireExpiresAt` | boolean | `true` | Must carry a concrete `expiresAt`; `null` is rejected. Closes defect 2. |
| `manualConfirmation.requireEnvironment` | boolean | `true` | Must carry `environment` with at least `projectPath` and `editorVersion` (or `tool` when no editor applies). |
| `manualConfirmation.requireScope` | boolean | `true` | Must carry a non-empty `scope` array, not just free text. |
| `manualConfirmation.maxValidityMs` | integer or null | `86400000` (24 h) | Upper bound on the validity window. Enforced from **both** `createdAt` and the present, so a record cannot be post-dated to stay valid. `null` disables the bound. |
| `manualConfirmation.clockSkewToleranceMs` | integer | `60000` (60 s) | Tolerance applied before rejecting a future-dated `createdAt`, so a writer on a slightly fast clock is not rejected. |
| `disallowManualFor` | string[] | `["testsPassed"]` | Gates that may **never** be satisfied by `manual-confirmation` once `enabled` is true. |

**Rejected at policy load time** (not silently ignored): unknown `strictClosure` keys,
unknown keys inside `manualConfirmation`, a `disallowManualFor` entry that is not a known
gate name, and `revalidateOnClosure: true` with `enabled: false` (a contradiction that would
otherwise be inert — the exact `budgets.default` failure mode from Dolven's history).

### 2.1 Why `disallowManualFor` defaults to `testsPassed` but not `compileCheckConfirmed`

`testsPassed` is automatable in every environment Cadet supports (`npm test`, `unity test`);
a manual confirmation for it is always a substitute for something available. It therefore has
no legitimate unscoped use.

`compileCheckConfirmed` legitimately *requires* manual confirmation when the Unity CLI is
absent — that is the documented v2 fallback (§6). Disallowing it by default would break the
supported no-CLI workflow, so it is left out of the default list and may be added per
repository.

## 3. Manual-confirmation quality constraints

The evidence record gains fields that `strictClosure.manualConfirmation` can require:

| Field | Present in v2? | Required when | Purpose |
|---|---|---|---|
| `reason` | no (only free-text `result`) | `requireReason` | Machine-checkable statement of *why automation was unavailable*. |
| `expiresAt` | yes, but may be `null` | `requireExpiresAt` | Bounds how long a human assertion can hold a gate open. |
| `environment` | no | `requireEnvironment` | `{ projectPath, editorVersion?, tool?, host?, os? }` — what was actually verified, and against which toolchain. |
| `scope` | no | `requireScope` | `string[]` of what the confirmation covers (files, scene, assembly, AC ids). Makes over-broad claims visible. |

`result` remains free text for human audit and is **never** the machine-read field.

**Redaction (added after review finding F1).** `reason`, `result`, `scope`, `environment`
values, and the project/editor strings are free human prose that gets persisted into
`state.json` — which is committed to git. They are therefore passed through `redactString`
before the record is built, matching the rule that already applied to the run ledger. There is
no bypass option. A `--reason` containing a token or connection string is stored redacted.

### 3.1 The `null` freshness-bound defect (fixed)

v2 `validateEvidenceShape` accepts `{ expiresAt: undefined, freshnessPolicy: undefined }` as
an error, but accepts `{ expiresAt: null, freshnessPolicy: null }` as **valid** — because
only key presence is checked (state.mjs §"A freshness bound is mandatory"). Dolven's
`state.json` contains exactly this: five records with both fields `null`, and one
(`3f0146e7`) backs a claimed-true `compileCheckConfirmed`.

v3 closes this only under `strictClosure.enabled`, so the fix is opt-in:
a record that declares **neither** a usable `expiresAt` **nor** a `freshnessPolicy` does not
satisfy a gate when strict closure is on. This is the difference between "declared the field"
and "declared a bound".

## 4. Exception taxonomy

### 4.1 Categories

A `gate-exception` entry gains a required `category` when `strictClosure.enabled`:

| `category` | Meaning | Default expiry | Closure review note required |
|---|---|---|---|
| `manual-compile` | compile/analyzer gate unsatisfiable because the Unity CLI or editor is unavailable | 7 days | yes |
| `budget-override` | a hard budget was deliberately exceeded with user approval | end of run | yes |
| `analyzer-fallback` | `unityAnalyzerClean` satisfied by an alternative analyzer (e.g. NetAnalyzers CA rules where UNT* cannot be hosted) | 30 days | yes |
| `unscoped-freshness` | evidence recorded without file binding (`allowEmptyFreshness`) | 1 day | yes |
| `documentation-only` | work item changes no behaviour and is exempt from a gate on that basis | end of work item | no |
| `tooling-gap` | a required capability is genuinely absent and no fallback exists | 14 days | yes |

Unknown categories are rejected, and the error lists the valid set. This mirrors
`validatePolicy`'s treatment of unknown budget keys: a typo must fail loudly rather than
produce an exception that classifies as "other" and escapes its expiry policy.

### 4.2 Category-specific rules

- **Expiry is required and category-derived.** If a category declares a default expiry, an
  entry may shorten it but not extend it without an explicit `expiryExtendedReason`.
- **`closureReviewNote` is required** for every category marked "yes" above. This is the
  question "who decided this was acceptable, and what would make it unacceptable?" answered
  in the record, so it is auditable without interview.
- **Taxonomy is not a bypass.** A categorised exception is still scoped to one work item and
  one transition, still cannot propagate to a new story (C-§2 of v2, unchanged), and still
  cannot satisfy a gate listed in `disallowManualFor`.
- **High-risk categories are surfaced.** `budget-override` and `unscoped-freshness` are
  reported by `harness report` even when unexpired, because they indicate the harness was
  unable to do its job rather than that it did.

## 5. CLI: `cadet-agent harness confirm`

A first-class command for manual evidence, replacing hand-edited `state.json`.

```bash
cadet-agent harness confirm \
  --gate compileCheckConfirmed \
  --reason "Unity CLI unavailable in this environment; editor reports 0 errors" \
  --expires-at 2026-09-14T00:00:00Z \
  --environment "projectPath=E:/unity/projects/dolven-tactics,editorVersion=6000.6.0f1" \
  --scope "Assets/Scripts/Game/SimulationHost.cs,Assets/Scenes/Main.unity" \
  --files Assets/Scripts/Game/SimulationHost.cs,Assets/Scenes/Main.unity
```

### 5.1 Behaviour contract

1. **Validate before writing.** Under `strictClosure.enabled`, a missing `--reason`,
   `--expires-at`, `--environment`, or `--scope` is rejected with exit code 1 and a message
   naming every missing field (not just the first).
2. **Reject disallowed gates.** `--gate` in `disallowManualFor` is rejected with exit 1 and
   the reason, pointing at the automated command instead.
3. **Bound the validity window.** `expiresAt - now > maxValidityMs` is rejected with exit 1,
   stating the limit and the requested value.
4. **Bind to files.** `--files` (or working-tree changed files) is hashed into
   `inputTreeHash` exactly as `harness verify` does. If freshness cannot be established and
   `allowEmptyFreshness` is false, the command is blocked (`freshness-unavailable`), matching
   `harness verify`.
5. **Write both stores atomically, and in an order that cannot lose data.** The evidence
   record is appended to `state.json → gateEvidence` and the gate flipped, and the ledger
   entry is written, such that **an interruption between the two leaves a consistent state**.
   Implementation: the ledger is persisted first (it is append-only and references the
   evidence id), then `state.json` is written with a single atomic temp-file + rename. A
   crash after the ledger write and before the state write leaves an orphan ledger record —
   harmless and detectable — never a state document that claims a gate it cannot back.
   This ordering choice is deliberately the *conservative* one: fail toward "less proven",
   never toward "claimed but unbacked".
6. **Supersede, never overwrite.** Prior passing evidence for the same gate is marked
   `superseded` with `supersededBy`, per v2 immutability.
7. **Never auto-approve.** The record carries `approvedBy`, defaulting to the invoking user.
   The command does not itself constitute user approval of anything else (C5 unchanged).
8. **`--format json`** returns `{ ok, gate, evidenceId, runId, stateUpdated, superseded }`.

### 5.2 Why a command rather than a documented procedure

Dolven's `state.json` shows manual evidence was previously created by hand. That makes the
*record shape* unreviewable at creation time: the constraints in §3 can only be checked later,
by `state validate`, after the work item has moved on. A command checks them at the moment of
creation, when the human still remembers what was verified.

## 6. Contract test matrix additions

| Area | Positive case | Negative case | Test file |
|---|---|---|---|
| Strict closure off | v2 behaviour byte-identical with flag absent | — (regression guard for the whole change) | `harness-strict-closure.test.mjs` |
| Closure revalidation | fresh revalidation satisfies `validation→closed` | gate valid at `implementation` but stale at closure is rejected | `harness-strict-closure.test.mjs` |
| Revalidation recency | record newer than last transition accepted | unexpired but older record rejected (`requireFreshRevalidation`) | `harness-strict-closure.test.mjs` |
| Manual-confirmation quality | full record (reason/expiresAt/environment/scope) accepted | each field missing in turn is rejected, and all are reported together | `harness-strict-closure.test.mjs` |
| Null freshness bound | `freshnessPolicy.scope` present accepted | `expiresAt: null` + `freshnessPolicy: null` rejected under strict | `harness-strict-closure.test.mjs` |
| `disallowManualFor` | gate not in list accepts manual | `testsPassed` manual rejected with pointer to automation | `harness-strict-closure.test.mjs` |
| Validity window | `expiresAt` within `maxValidityMs` accepted | beyond the bound rejected | `harness-strict-closure.test.mjs` |
| Exception taxonomy | each category accepted with its expiry + note | unknown category rejected listing valid set; missing `closureReviewNote` rejected | `harness-strict-closure.test.mjs` |
| Taxonomy expiry | entry shortening default expiry accepted | entry extending it without `expiryExtendedReason` rejected | `harness-strict-closure.test.mjs` |
| Policy load | valid `strictClosure` block resolves | unknown key/contradictory block rejected at load | `harness-strict-closure.test.mjs` |
| CLI `harness confirm` | writes ledger + state, flips gate, supersedes prior | disallowed gate / missing metadata / over-long validity each exit 1 | `harness-confirm-cli.test.mjs` |
| `state validate` honours policy (review F4) | strict rules enforced when `harness.json` enables them | a strict-violating state reports `valid: false` | `harness-confirm-cli.test.mjs` |
| Secret redaction in state (review F1) | `--reason` is stored redacted | a raw token never appears in `state.json` | `harness-confirm-cli.test.mjs` |
| Deterministic validity boundary (review F2) | overage rejected regardless of process latency | future-dated `createdAt` rejected | `harness-confirm-cli.test.mjs` |
| `scope` item validation (review F3) | `string[]` accepted | non-string items rejected, matching the schema | `harness-confirm-cli.test.mjs` |
| v2→v3 migration | v2 document migrates losslessly, existing evidence intact | malformed document left untouched | `harness-strict-closure.test.mjs` |
| C4 frozen table | required gates per transition unchanged | `revalidate` sets match the table above | `harness-state.test.mjs` (updated) |

## 7. Rollout

1. **This change (v0.31.0):** `strictClosure` present and honoured, default **off**.
   Contract doc, schemas, CLI, tests updated atomically. Dolven's existing state validates
   unchanged, and `state transition --to closed` behaves exactly as it does today.
2. **Next schema/version (v0.32.0):** flip `enabled` default to `true`; provide a
   `state migrate --to v3 --strict` that flags legacy manual-confirmation records that would
   fail strict validation, so the default flip is a reviewed migration rather than a
   surprise failure.
3. **Removal (v1.0.0):** delete the flag and the v2 code path.

Step 2 deliberately does *not* happen here. Making strictness the default before repositories
have had a release in which to add `reason`/`expiresAt`/`environment`/`scope` to their manual
records would convert a quality improvement into an outage.
