# Harness Contract v5 — Git-Backed Gate Evidence (`state.json` v4)

> Status: **implemented** (state schema v4). Extends `docs/core/HarnessContract.md` (v2),
> `docs/core/HarnessContract-v3.md` (v3), and `docs/core/HarnessContract-v4.md` (v4) and must be
> merged into the combined contract when that consolidation lands.
> Canonical runtime rules live in `.cadet/agent/core/Harness.md`.

**Version numbering.** The document series and the *state schema* series are numbered separately
from here on. v3 was the last state-schema bump; v4 (AC↔test verification) added no state fields,
so this change is doc **v5** introducing schema **v4**. Stated once so a reader does not go looking
for a `state.schema.json` that says 5.

## 0. Why this exists

`state.json` held two documents with opposite lifecycles fused into one file:

- a **small mutable cursor** — `session`, `epics`, `gates`, `activeWorkItem`, `lastTransition`; and
- **two unbounded append-only logs** — `gateEvidence` and `changeHistory`.

The cursor must be rewritten whenever a gate flips. The logs must never be rewritten. Fused, the
cost of every write grew with all accumulated history.

Measured on a real consumer repository (dolven-tactics), before this change:

| Section | Bytes | Share | Content |
|---|---:|---:|---|
| `gateEvidence` | 1,491,553 | 72% | 832 records |
| `changeHistory` | 342,566 | 16% | 340 entries |
| session + epics + gates + spikes + active | ~4,700 | 0.2% | the actual cursor |

**88% of the file was logs, 0.2% was the document `state validate` is about.** Of the 832 evidence
records, **9 were live** (5 `passed`, 4 `manual-confirmation`); 738 were `superseded` and 85
`failed`. Nothing in the framework ever pruned either array — `harness cleanup` covers only
`.cadet/runs/`.

The framework already documented the bug about itself. `src/harness/util.mjs` has to exclude
`.cadet/state.json` from change detection, with the comment:

> `state.json` is rewritten by the very command that records a gate… the evidence hash would
> describe a file the recording itself mutates: the gate would be stale the moment it was written.

That is the root cause in the repository's own words: **the evidence store was inside the file that
recording evidence rewrites.**

## 1. The model — three tiers

### Tier A — live evidence (inline, bounded by two rules)

`gateEvidence` holds the **active work item's live records**. Two independent bounds decide
"live", and the second one was missing until the size was measured:

- **Which work item** (the `keep` selector). Only the active one. Not merely conservative — it is
  provably safe for any document that was valid before compaction, because `validateState` already
  rejects a claimed-true gate whose supporting record belongs to a *different* work item. Every gate
  a valid document depends on is therefore already backed by exactly the records this keeps.
- **Which of that item's records** (the retention rule). The newest record per gate, every
  `passed` / `manual-confirmation` record, and every `failed` record. `superseded` records, and
  `blocked` ones that are not the newest for their gate, are history.

The first rule alone is not a bound: a story boundary never fires *inside* a story. The claim
originally written here — "bounded by the work item, typically a handful of records" — was wrong by
two orders of magnitude on the audited repository: **26 `testsPassed` records for one story, 135
records for one work item, 81% of an 8,000-line document**, of which 9 were live.

The **failing** record has to stay, because red-before-green reads the prior red for the same work
item and gate — which is why the retention rule keeps *every* `failed` record rather than only the
newest one for its gate. "Newest passing record per gate" would be smaller and would break that
rule, so it is deliberately not the rule.

`state compact` applies both bounds; `--retain-all` applies only the first (the pre-retention
behaviour). A record that leaves either way is archived before the document is written and its work
item is indexed in `evidenceCoverage`, so compaction is never indistinguishable from evidence loss.

### Tier B — sealed evidence (git commit trailers)

At story close, the work item's records are written into the closing commit as **trailers**. The
commit id is the seal.

Trailers are preferred over `git notes` and tags:

- they are part of the commit object, so **editing a trailer changes the SHA** — the record is
  self-verifying, which is what v2's "evidence is immutable, write-once" clause claimed and could
  not enforce;
- `git notes` are not fetched or pushed by default and can be rewritten silently, so they cannot
  support an immutability claim;
- per-gate tags would add hundreds of refs to the namespace;
- it finally makes the existing optional `commit` field meaningful in both directions: evidence
  cites a commit, and the commit carries the evidence.

**C5 is preserved: Cadet never commits.** `state seal` writes a message file; the user or agent runs
`git commit -F <file>`.

### Tier C — coverage index (inline, bounded)

`evidenceCoverage` is one small row per work item: `recordCount`, `gates`, `firstAt`, `lastAt`,
`sealedCommit`. It is what keeps "every `done` story owns at least one evidence record" answerable
**offline**, without walking git. Regenerable from Tier B via `coverageFromSealed`.

Without it, compaction would be indistinguishable from evidence loss and the framework would accuse
a correctly compacted repository of having closed stories with no evidence.

### Structural corrections carried with it

- **`gateExceptions` becomes a first-class field.** Exceptions are *live state* — scoped to a work
  item and bounded by `expiresAt`, read by `activeExceptions` — and filing live state in a history
  array is how that array grew without bound. Both homes are still read, so a v1–v3 document behaves
  identically.
- **`changeHistory` is bounded, not retired.** This is worth stating explicitly, because the first
  draft of this contract retired it and that was wrong. Eight skills instruct the agent to record an
  artifact path there ("record the requirements document path in `changeHistory`"), and `Resume`
  cross-checks the log's last entry against commit history; removing the field would make those
  instructions false and take away a facility with no replacement.

  What was actually unbounded was not the field but its **contents**. Measured on the audited
  repository, of 340 entries:

  | Entry shape | Count | Bytes |
  |---|---:|---:|
  | handoff entries (free-text summary + reason) | 116 | 223,557 |
  | other authored notes | 55 | 82,774 |
  | gate exceptions | 8 | 23,190 |
  | machine phase-transition lines | 162 | 17,624 |
  | evidence-loss record, gate resets, session init | 6 | 3,604 |

  **65% of the log was 116 handoff entries averaging 1.9 KB each, every one duplicating a file
  already written to `.cadet/handoffs/`.** So v4 does three things instead of removing the field:
  1. **A transition writes no history line.** It is already in `lastTransition` and in the sealing
     commit; 162 redundant lines in that one repository.
  2. **A handoff entry is a reference, not an essay** — the path and the phase, which is what the
     `Handoff` skill always specified. The prose belongs in the handoff file.
  3. **Compaction keeps the most recent `HISTORY_ENTRIES_KEPT` (25) entries inline and appends the
     overflow to `.cadet/archive/history.jsonl`** — bounded, and never destroyed.

  A story-boundary reset still writes one short line (bounded by story count, and `lastTransition`
  does not cover it), and a gate exception is promoted *before* the log is trimmed, so trimming can
  never swallow live state.

## 2. Compatibility invariants — v5 additions

C1–C13 are unchanged. v5 adds:

| # | Invariant | Guard |
|---|---|---|
| **C14** | A v4 document's `gateEvidence` holds only the active work item's **live** records — the newest record per gate, every `passed`/`manual-confirmation` record, and every `failed` record; `superseded` history and non-newest `blocked` records live in `.cadet/archive/`. `evidenceCoverage` indexes what left; `gateExceptions` holds exceptions; and `changeHistory` stays **bounded** (most recent `HISTORY_ENTRIES_KEPT`, overflow archived). A transition adds no history line for v4. v1–v3 documents are unchanged and keep being appended to. `state begin` is the supported way to move to a new work item. `validateState` **warns** — never errors — on foreign records or an over-long array, because foreign records are unreadable by every gate check and a document that predates the check cannot repair itself in place. | `harness-state-v4.test.mjs`, `harness-state-begin.test.mjs` |
| **C15** | Evidence history is preserved when it leaves the document. A record removed from `gateEvidence` is written to `.cadet/archive/` **before** the slimmer document replaces it, and its work item is recorded in `evidenceCoverage`, so the AR-2 coverage check and the audit trail both survive compaction. | `harness-state-v4.test.mjs` |
| **C16** | Sealed evidence lives in commit trailers, encoded and decoded by `src/harness/gitmemo.mjs`. `state seal` prepares a message; it never commits. A record whose trailer block exceeded the output bound is marked `partial` and must not satisfy a gate. | `harness-git-evidence.test.mjs` |

`state validate` remains **offline by default**: it never requires git. Sealed evidence is consulted
only under `--verify-sealed`, and a read that cannot reach git is reported as a warning, never as a
silent pass and never as a new error — "not verified" and "verified clean" must not look the same.

## 3. Trailer format

One `Cadet-*` trailer per field, repeated per record, each block opened by `Cadet-Gate:`. Scalars are
written plainly when unambiguous and JSON-quoted otherwise; arrays and objects are always JSON, so a
comma inside a file name cannot be read as a list separator.

```
feat(sim): derive grid from authored map

Cadet-Gate: testsPassed
Cadet-Work-Item: epic-2-world-map-movement::story-3-derive-grid-from-authored-map.md
Cadet-Status: passed
Cadet-Evidence-Id: eae0a0e4-1ede-4cc7-a401-9c5a06912050
Cadet-Phase: implementation
Cadet-Input-Tree-Hash: 8e7f1f1fe4525187c6df9279d7bde53354504e9014b366488105009ed84158fe
Cadet-Criteria-Hash: 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
Cadet-Relevant-Files: ["Assets/Scripts/Sim/IMapSource.cs","Assets/Scripts/Sim/MapLoader.cs"]
Cadet-Command: bash ./test-gate.sh
Cadet-Result: exit 0
Cadet-Created-At: 2026-09-13T06:28:31.248Z
Cadet-Expires-At: null
```

- **Required-key presence survives a round trip.** `command` and `result` may be `null` but must be
  *present*, and a freshness bound must be declared, so those lines are written even when the value
  is `null`. A codec that dropped the key would turn a valid record into an invalid one on the way
  back.
- **Bounds.** A block is capped at `output.maxInlineBytes`. On overflow, `relevantFiles` is truncated
  and `Cadet-Partial: true` is written. A partial record parses but cannot satisfy a gate.
- **Tolerance.** Unknown `Cadet-*` trailers and malformed lines are reported as diagnostics and
  skipped, not fatal: a commit message is human-authored, and one typo must not make it unreadable.
- **Reading.** `git log --max-count=N --grep=Cadet-Gate --format=%H%x00%B%x00`. The scan is bounded
  twice — by `--grep` to commits that mention the prefix at all, and by `--max-count` — because an
  unbounded full-history parse on every call would reintroduce the growth this design removes. NUL is
  the field separator because a commit message cannot contain one.

## 4. State schema v4

```jsonc
{
  "version": 4,
  "stateVersion": 4,
  "session": { /* unchanged */ },
  "epics": { /* unchanged */ },
  "gates": { /* unchanged */ },
  "gateEvidence": [ /* ACTIVE WORK ITEM ONLY */ ],
  "evidenceCoverage": {
    "epic-2-world-map-movement::story-3-derive-map.md": {
      "workItemId": "…", "recordCount": 73,
      "gates": ["compileCheckConfirmed", "testsPassed"],
      "firstAt": "…", "lastAt": "…", "sealedCommit": null
    }
  },
  "gateExceptions": [ /* live, scoped, expiring */ ],
  "changeHistory": [ /* BOUNDED: most recent HISTORY_ENTRIES_KEPT entries; overflow in .cadet/archive/history.jsonl */ ],
  "activeRunId": null,
  "activeWorkItem": { "epicId": "…", "storyId": "…" },
  "lastTransition": { "from": "…", "to": "…", "at": "…" },
  "spikes": { /* unchanged */ }
}
```

`changeHistory` stays, bounded — see §1. A v4 transition writes no line into it (`lastTransition` plus
the sealing commit is the record); a story reset writes one short line; a handoff writes a path
reference, not a summary.

One writer per invariant, so no append path can drift: `appendEvidence` maintains the array and the
index together, `recordEvidence` adds supersede-and-flip on top, `compactHistory` bounds the log, and
`splitEvidence` / `buildEvidenceCoverage` recompute the index when records move.

> **A note on why recompute and merge are separate functions.** `buildEvidenceCoverage` *replaces*
> rows for the work items it is given (they are the authoritative inline set) and preserves rows for
> items it is not (they are archived). `mergeEvidenceCoverage` *adds* newly-recorded evidence.
> Conflating the two silently doubles every count on a second compaction — an over-reporting index is
> worse than none, because it looks authoritative.

## 5. CLI surface

| Command | Mutates | Notes |
|---|---|---|
| `state validate [--verify-sealed]` | no | Read-only. `--verify-sealed` can only *clear* an error a real sealed record backs, never raise a new one. |
| `state migrate [--to 4] [--keep <bound>]` | yes | Atomic; backup `.v{from}.bak`; archive written **before** the document. |
| `state compact --keep <bound> [--retain-all]` | yes | Routine housekeeping on a v4 document. `--keep` selects the **work items** that stay inline and is required when unattended. Within them the retention rule applies unless `--retain-all`. |
| `state begin --epic <id> --story <file>` | yes | The story boundary: reset every gate, archive the previous item's evidence **before** the document is written, fold it into the coverage index. Refuses a target that is already active, and a `closed` session. |
| `state seal [--work-item <id>] [--commit-msg <path>]` | yes | Writes the message file and archives the records. Does not commit. |

`--keep` is `always` \| `active` \| a comma-separated work-item list — a content-bearing bound, not a
bare confirmation flag, so an unattended agent must state *what* stays inline.

`state migrate` with no `--to` still means "migrate a v1 document forward". A v2/v3 document is **not**
silently bumped by a read or by `--to`-less migrate: the version stamp decides which semantics apply,
so moving up a version is an explicit act.

## 6. Migration

`cadet-agent state migrate --to 4`:

1. Promote `type: "gate-exception"` entries out of `changeHistory` into `gateExceptions`.
2. Split `gateEvidence` by work item; keep the active item's records inline.
3. Build `evidenceCoverage` from every record, so nothing looks unevidenced afterwards.
4. Bound `changeHistory` to its most recent `HISTORY_ENTRIES_KEPT` entries.
5. Validate the result, **then** append the archives, **then** write the backup, **then** rename.

Step 5's order is the safety argument: the records leaving `gateEvidence` exist nowhere else, so a
crash between the writes must leave them in *both* places, never neither. A failure before the rename
leaves the tree exactly as it was — the `atomicFailure` guarantee in the command registry still holds.
Overflow change-log entries go to `.cadet/archive/history.jsonl` in the same step, so bounding the log
never destroys it.

**Existing records cannot be retro-sealed.** They carry no `commit`, and fabricating or rewriting
history is not an option, so migration **archives** them and only new evidence gets the git tier.

## 7. Test matrix additions

| Area | Positive case | Negative case | Test file |
|---|---|---|---|
| Codec round trip | every field survives encode→parse | a value with a newline / leading quote / literal `null` / comma does not | `harness-git-evidence.test.mjs` |
| Required-key presence | `command`/`result`/freshness key survive as null | — (a dropped key is a validity change) | `harness-git-evidence.test.mjs` |
| Multi-block | two gate blocks in one message | trailer before any `Cadet-Gate` is reported | `harness-git-evidence.test.mjs` |
| Bound | over-long block is truncated and fits | truncated block is marked `partial` | `harness-git-evidence.test.mjs` |
| Git availability | real repo round trip through `git log` | unavailable git yields `available: false` with a reason, not "no records" | `harness-git-evidence.test.mjs` |
| Tamper evidence | — | altering a trailer changes the commit id | `harness-git-evidence.test.mjs` |
| Live scoping | only the active work item stays inline | `keep: always` is the non-vacuity control | `harness-state-v4.test.mjs` |
| Retention | newest-per-gate, every `passed`/`manual-confirmation` and every `failed` record survive compaction | a `superseded` record that is not the newest for its gate is archived; `--retain-all` keeps everything | `harness-state-v4.test.mjs` |
| Red-before-green after compaction | a compacted document still licenses a green `testsPassed` | archiving the prior red fails the green | `harness-state-v4.test.mjs` |
| Story boundary | `state begin` resets gates, archives the outgoing records, folds coverage | refuses an already-active target and a `closed` session | `harness-state-begin.test.mjs` |
| Growth warning | foreign records and an over-long array each warn, naming the work items | a clean v4 document warns about neither; a v3 document is never scoped this way | `harness-state-v4.test.mjs` |
| Compaction safety | a valid document is valid after compaction | a done story with no records *or* index row is still rejected | `harness-state-v4.test.mjs` |
| Index integrity | append merges; recompute replaces | reset does not double-count; malformed index is an error | `harness-state-v4.test.mjs` |
| History bounding | v4 transition writes no line; tail is kept | a gate exception at index 0 survives a 60-entry trim | `harness-state-v4.test.mjs` |
| History retirement guard | v4 transition leaves an existing log untouched | v2 transition still appends (parity guard) | `harness-state-v4.test.mjs` |
| Migration | v2→v4 archives, promotes, indexes | v4→v4 is a no-op; downgrade refused; malformed `--to` throws | `harness-state-v4.test.mjs` |
| Ordering | archive is written before the document | a throwing archive write leaves state.json and the backup untouched | `harness-state-v4.test.mjs` |
| Exception promotion | a scoped exception still excuses its gate | one scoped elsewhere still does not | `harness-state-v4.test.mjs` |

## 8. Known limits — stated, not hidden

1. **A trailer cannot be added to an existing commit.** Sealing therefore happens at the closing
   commit, through a generated message file — never by rewriting history or inventing commits.
2. **Squash merges collapse per-story trailers.** This repository prefers squash merges. `sealedCommit`
   in the coverage index keeps the citation, so a squashed merge leaves the index intact and the sealed
   range recoverable from the branch; the individual trailers on unpublished branch commits are not
   guaranteed to survive. This is an adoption risk to weigh.
3. **Rebasing unpublished work invalidates sealed records.** Only in-flight stories are affected, and
   their evidence is still inline in Tier A.
4. **A gate satisfied on an uncommitted tree has no commit to cite.** That is what Tier A is for. A
   git-only design would break the mid-story workflow.
5. **`state validate` does not read git by default.** Sealed evidence is a separate, opt-in check, so
   validation stays environment-independent.

## 9. Rollout

One atomic change: schema, `state.mjs`, `gitmemo.mjs`, CLI, docs, and tests together. New and migrated
documents are v4; v1–v3 remain readable indefinitely; no consumer is forced to migrate in the same
release, because `state migrate --to 4` is opt-in per repository.
