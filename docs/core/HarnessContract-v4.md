# Harness Contract v4 — Mechanical AC↔Test Verification

> Status: **proposed** 2026-09-13. Supersedes nothing yet; v3 remains valid.
> Canonical runtime rules live in `.cadet/agent/core/Harness.md`. This document extends
> `docs/core/HarnessContract.md` (v2) and `docs/core/HarnessContract-v3.md` (v3), and must be
> merged into the contract when the version bump lands.

## 0. Why this exists

v3 closed one root cause: *"closure can be reached without proving that the evidence proving it
is still true."* This document closes a second, structurally identical root cause:

> **A recorded claim can name an artifact that does not exist, and nothing re-checks the name.**

The observed defect: an epic's TDD matrix named tests that were never written —
`Grid_DerivedFromMap_...`, `PackageManifest_HasNoDungeonArchitect...`. The matrix is authored
during architecture, recording *intended* test names. Names change during implementation. The
matrix is re-read only at the validation gate, by which point the story is already merged. So
the drift is discovered late, by a human, and the artifact that was supposed to prove coverage
instead proved nothing.

This is the same class as the `review-gate.sh` defect fixed in the repository-role change: a
gate/claim that could not fail because nothing tied it to observable reality.

### 0.1 Why "reconcile at definition-of-done" is not the fix

The obvious procedural fix — *"reconcile test names at each story's definition-of-done"* — moves
the check earlier but does not change its nature: it is still **an assertion by the author that
is never mechanically verified**. v3 §5.2 already rejected exactly this reasoning for manual
evidence:

> "manual evidence was previously created by hand. That makes the *record shape* unreviewable at
> creation time: the constraints in §3 can only be checked later… A command checks them at the
> moment of creation."

A definition-of-done checklist is a later check with extra steps. The fix must make the linkage
between an acceptance criterion and its proving test **mechanical**, so drift is a *detected
event* rather than a *remembered obligation*.

## 1. Definitions

- **AC**: an acceptance criterion, identified in the story by a stable id (`AC-1`, `AC-2`, …).
- **Declared test**: a test identifier recorded in the story against an AC — the test the author
  states proves that AC.
- **Test inventory**: the set of test identifiers that actually executed in a verification run,
  extracted from the run's test report.
- **Coverage claim**: the mapping `AC id → declared tests` plus the story path that carries it.

A story is **AC-complete** when every AC has at least one declared test, and every declared test
appears in the test inventory of the run that satisfied `testsPassed`.

## 2. Compatibility invariants — v4 additions and revisions

C1, C2, C3, C5, C7, C8 unchanged. C4, C6 as revised by v3. C9 unchanged.

### C10 — Story carries machine-readable AC ids and declared tests

The story artifact (`.cadet/agent/core/templates/StoryTemplate.md`) records, for each acceptance
criterion, a stable AC id and a list of test identifiers. The story file is the single source of
truth for the coverage claim; the epic-level matrix is derived from it and is never independently
authored.

### C11 — Declared tests must appear in the test inventory

Under `strictClosure.enabled`, `acceptanceCriteriaValidated` cannot be satisfied while any
declared test for the work item is absent from the inventory of the run that satisfied
`testsPassed`. A missing test is reported by AC id and test name, never as a generic failure.

### C12 — Test identifiers participate in `criteriaHash`

`criteriaHash` is computed over the AC strings **and their declared test identifiers**. Editing a
declared test name therefore invalidates evidence bound to the old name, exactly as editing a
relevant file invalidates `inputTreeHash`. Drift becomes self-detecting.

## 3. Test report extraction

The harness has never parsed a test report; evidence today is exit code plus captured output.
v4 introduces a bounded, format-tolerant inventory extractor.

### 3.1 Supported report shapes

Detection is by content, not by configuration, so a repository needs no extra setup:

| Format | Detection | Identifier extracted |
|---|---|---|
| Node TAP (this repo, `node --test`) | lines matching `^(ok|not ok) \d+ - (.+)$` | the test name, suffix-stripped |
| JUnit XML (Unity UTF, most CI) | `<testcase ... name="..."` | the `name` attribute |
| Unity JSON (`unity test --format json`) | JSON with a `tests` array | each entry's `name` |

Undeclared, unknown, or unparseable output yields an **empty** inventory, which is `unknown`, not
`passed` — consistent with `Harness.md` §3 ("Unknown usage is `unknown`, never silently zero").
An empty inventory therefore cannot satisfy C11.

### 3.2 Identifier normalization

Test names are compared after normalization: trim, collapse internal whitespace, strip a trailing
`(1)`-style duplicate suffix, and compare case-sensitively. Normalization is deliberately
conservative — a fuzzy match would defeat the purpose. If a project needs a looser rule it must
mangle names to match, not the reverse.

### 3.3 Bounds

Extraction reads at most `maxInlineBytes` of captured output and at most
`archive.maxFiles`-style limits for XML entry count; a report exceeding the bound is truncated
with a recorded diagnostic and the inventory is marked partial (which cannot satisfy C11 for the
truncated region).

## 4. Coverage artifact

`.cadet/agent/project-plans/<epic>/coverage.json` — derived, committed, regenerable:

```jsonc
{
  "schemaVersion": 1,
  "story": "epic-1-player-movement/story-2-grid.md",
  "generatedAt": "2026-09-13T00:00:00Z",
  "ac": [
    { "id": "AC-1", "declared": ["Grid_DerivedFromMap_IsRectangular"],
      "found": ["Grid_DerivedFromMap_IsRectangular"], "status": "covered" },
    { "id": "AC-2", "declared": ["PackageManifest_HasNoDungeonArchitect"],
      "found": [], "status": "missing" }
  ],
  "inventorySize": 42,
  "format": "tap"
}
```

`status` ∈ `covered | missing | undeclared`. `undeclared` means the AC declares no test (a C10
violation). The artifact is **derived**, so it is never hand-edited; regenerating it is cheap and
idempotent apart from `generatedAt`.

## 5. CLI: `cadet-agent harness verify-acs`

```bash
cadet-agent harness verify-acs \
  --story .cadet/agent/project-plans/epic-1-player-movement/story-2-grid.md \
  --report .cadet/runs/<runId>/artifacts/<artifact> \
  [--run <runId>] [--write-coverage] [--format json]
```

### 5.1 Behaviour contract

1. **Parse the story** into AC ids and declared tests. A story with an AC that has no id, or a
   duplicate id, is rejected with exit 1 naming the offending AC.
2. **Resolve the inventory.** `--report` names an artifact directly; otherwise the report of the
   most recent passing `testsPassed` evidence for the work item is used. If neither resolves, the
   command is blocked (`no-test-report`), not passed.
3. **Compare** declared against inventory under §3.2 normalization.
4. **Report every gap together.** All missing tests are listed, each with its AC id, in one
   message — not just the first.
5. **Gate on the result.** With `strictClosure.enabled`, any `missing` or `undeclared` AC means
   `acceptanceCriteriaValidated` is **not** set and the command exits 1. With the flag off, the
   command reports and exits 0 but writes nothing to `state.json` — byte-identical v2/v3
   behaviour.
6. **Write evidence when it passes.** On success under strict closure, an
   `acceptanceCriteriaValidated` evidence record is created (the AC ids + inventory hash form the
   `criteriaHash`), the gate is flipped, and prior passing evidence for the gate is superseded —
   the same lifecycle as any other gate.
7. **`--write-coverage`** additionally writes the §4 artifact.
8. **`--format json`** returns `{ ok, story, ac, inventorySize, format, gateSet, coveragePath }`.

### 5.2 Relationship to `acceptanceCriteriaValidated`

v2/v3 classify `acceptanceCriteriaValidated` as agent-owned
(`docs/core/UnityCli.md`). v4 makes it **command-backed when strict closure is on**, without
removing the agent-owned path when the gate is legitimately a judgement call (e.g. an AC that is
manual by nature). A manual `acceptanceCriteriaValidated` remains possible, but under strict
closure it must pass the §3 manual-confirmation quality rules from v3 — which is what stops
"validated" from being a bare assertion again.

## 6. Why the epic matrix is derived, not authored

The defect's root cause is that the matrix was a **second, independent copy** of the coverage
claim. Two copies drift. v4 keeps one copy — the story — and derives the matrix. This mirrors the
repository-role fix: rather than asking a human to keep two things in sync, remove the second
thing.

The epic template's matrix section becomes a **generated view**; a story without declared tests
renders as an explicit gap rather than a plausible-looking row.

## 7. Contract test matrix additions

| Area | Positive case | Negative case | Test file |
|---|---|---|---|
| Report extraction | TAP, JUnit XML, and Unity JSON each yield identifiers | unknown format yields empty inventory, status `unknown` | `harness-verify-acs.test.mjs` |
| Normalization | trailing suffix and whitespace collapse match | case difference does not match | `harness-verify-acs.test.mjs` |
| Extraction bounds | report under the bound is fully read | oversized report marks inventory partial | `harness-verify-acs.test.mjs` |
| Story parsing | AC ids and declared tests extracted | missing/duplicate AC id rejected naming the AC | `harness-verify-acs.test.mjs` |
| Coverage comparison | all declared found ⇒ covered | one missing ⇒ `missing`, reported with its AC id | `harness-verify-acs.test.mjs` |
| All-gaps reporting | multiple gaps listed together | — (single message requirement) | `harness-verify-acs.test.mjs` |
| Strict off | reports and exits 0, state untouched | — (v3 parity guard) | `harness-verify-acs.test.mjs` |
| Strict on | covered ⇒ gate set, evidence written, prior superseded | missing ⇒ gate not set, exit 1 | `harness-verify-acs.test.mjs` |
| `criteriaHash` binding (C12) | renamed declared test invalidates prior evidence | unchanged names keep evidence valid | `harness-verify-acs.test.mjs` |
| Manual AC path | strict manual confirmation accepted with v3 quality fields | bare assertion rejected under strict | `harness-verify-acs.test.mjs` |
| C10 template | story template exposes AC id + declared-tests fields | story missing them is an `undeclared` AC | `skills.test.mjs` (updated) |

## 8. Rollout

1. **This change (v0.32.0):** extraction, coverage artifact, `verify-acs`, C10–C12 present and
   honoured, default **off** via `strictClosure.enabled`. A v3 document stays valid; a story
   without declared tests is not retroactively invalidated.
2. **Next schema/version:** flip strictness default; `state validate` reports stories whose
   matrix has gaps, so the flip is a reviewed migration.
3. **Removal (v1.0.0):** delete the flag and the non-strict path.

## 9. Assumptions

- **verified** — this repository's own suite emits TAP (`node --test`), so extraction is
  testable against a real report.
- **reasonable** — Unity UTF emits JUnit XML; the documented `unity test --format json` shape has
  a `tests` array. Both are treated as content-detected, not required.
- **unverified** — no consumer repository currently records declared tests, so the first real use
  is also the adoption path. The default-off rollout is what makes this safe; a spike against a
  real consumer repo should precede the default flip (step 2), not this change.
