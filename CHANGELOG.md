# Changelog

All notable changes to Cadet-Agent are documented here. Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## Version bump policy
- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, or documentation-only clarifications that do not change agent behavior.
- **Minor** (`0.X.0`): new skill, standard, template, guidance document, or structural reorganization that adds capability or improves routing without breaking existing consumer installs.
- **Major** (`X.0.0`): breaking change to managed paths in `FrameworkManifest.json`, removal of an existing skill or standard, or a workflow routing change that invalidates prior planning artifacts.

Consumers should update `FrameworkManifest.json → frameworkVersion` in their installed copies when syncing a new package.

---

## [Unreleased]

## [0.43.1] — 2026-09-23

### Fixed

- **`state migrate` and `state compact` failed outright with `EXDEV` whenever the project sat on a different volume than the OS temp directory.** `migrateStateFile` staged its temporary file in `os.tmpdir()` and then renamed it onto the target, but `renameSync` is atomic only *within* one filesystem — so on the common Windows layout of a temp directory on `C:` and the project on `D:` or `E:`, the swap could not happen at all. The failure was worse than a no-op: the archive is written *before* the document that stops referencing it, so a failed run left `.cadet/archive/**` and a `.bak` behind while `state.json` stayed unmigrated. The temp file is now a sibling of `state.json`, which is same-volume by construction. Only `migrate`/`compact` were affected — `writeJsonAtomic`, used by `state transition`, `harness confirm`, and `harness verify`, already staged a sibling. A regression test asserts the temp file is a sibling of the target, verified non-vacuous against the old code.
  - Invisible to the test suite because every test writes to the same volume as the temp dir, and invisible to the in-memory migration dry run because no rename occurs there. A stale `const dir = dirname(statePath)` on the line above the bug was the tell: the intent was `join(dir, …)`, and `tmpdir()` was written instead.

## [0.43.0] — 2026-09-23

### Added

- **Gate evidence history no longer lives in `state.json` (contract v5, state schema v4).** A real consumer repository had grown its state document to **2,082,151 bytes**, of which `gateEvidence` was 72% (832 records) and `changeHistory` 16% (340 entries) — while the actual session cursor was **0.2%**. Of the 832 evidence records, **9 were live**; 738 were `superseded` and 85 `failed`, and nothing in the framework ever pruned either array (`harness cleanup` covers `.cadet/runs/` only).
  - **The root cause, in the repository's own words.** `src/harness/util.mjs` already had to exclude `.cadet/state.json` from change detection because it "is rewritten by the very command that records a gate". Evidence was stored inside the file that recording evidence rewrites, so the cost of every write grew with all accumulated history. Two documents with opposite lifecycles — a small mutable cursor and two unbounded append-only logs — were fused into one file.
  - **Evidence now has three homes, bounded by the work item.** *Live* (`state.json → gateEvidence`) holds only the **active** work item's records, including ones with no commit to cite (`manual-confirmation`, the compile fallback, the mid-story green run) so a gate is still satisfiable on an uncommitted tree. *Sealed* records live in the **closing commit's trailers**, where the commit id is the seal. *Archived* records live in append-only `.cadet/archive/evidence/<work-item>.jsonl`.
  - **Sealing into commits is tamper-evident, which an array entry never was.** Trailers are part of the commit object, so editing one changes the SHA and the citation stops resolving. This is why trailers were chosen over `git notes` (not pushed by default, silently rewritable) and over per-gate tags (hundreds of refs). It also makes the existing optional `commit` field meaningful in both directions: evidence cites a commit, and the commit carries the evidence.
  - **C5 is preserved: Cadet still never commits.** `state seal` writes a message file; the user or agent runs `git commit -F <path>`.
  - **`evidenceCoverage` keeps the `done`-story coverage rule answerable offline.** Without it, compaction would be indistinguishable from evidence loss and the framework would accuse a correctly compacted repository of closing stories with no evidence. It has an error path of its own, because an index that silently reads as empty would report *every* completed story as unevidenced.
  - **`gateExceptions` is now a first-class field.** Exceptions are live state — scoped to a work item and bounded by `expiresAt` — and filing live state in a history array is how that array grew without bound. Both homes are read, so a v1–v3 document validates identically.
  - **`changeHistory` is bounded, not retired — and the first draft of this change got that wrong.** Eight skills instruct the agent to record an artifact path there ("record the requirements document path in `changeHistory`") and `Resume` cross-checks the log's last entry against commit history, so removing the field would have made those instructions false and taken away a facility with no replacement. The measured problem was not the field but its **contents**: of 340 entries, **116 handoff entries averaged 1.9 KB each and were 65% of the log (223,557 bytes)**, every one duplicating a file already written to `.cadet/handoffs/`, plus 162 machine-generated transition lines (17,624 bytes) already covered by `lastTransition`. v4 therefore: writes **no** history line on a transition, makes a handoff entry a **path reference rather than a pasted summary** (which is what the `Handoff` skill always specified), and bounds compaction to the most recent 25 entries with the overflow appended to `.cadet/archive/history.jsonl`. A story-boundary reset still writes one short line, and gate exceptions are promoted *before* the trim, so bounding the log can never swallow live state.
  - **`state reset` now summarises before it clears.** Clearing `gateEvidence` with nothing kept behind is exactly how the audited project reached eight `done` stories with zero records while validation reported clean; the records are now folded into the index at the moment they leave.
  - **New commands:** `state seal`, `state compact --keep <bound>`, `state migrate --to 4`, and `state validate --verify-sealed`. `--keep` is a content-bearing bound required when unattended, matching `cleanup`'s `--older-than-ms`. `--verify-sealed` is **additive by construction** — it can only clear an error a real sealed record backs, never raise a new one, and unavailable git is a warning rather than a silent pass.
  - **Crash-safety ordering, pinned by tests.** Compaction validates the slimmer document, *then* appends the archive, *then* writes the backup, *then* renames — so records leaving `gateEvidence` are never in neither place. A throwing archive write leaves `state.json` and the backup untouched, preserving `atomicFailure`.
  - **One writer per invariant.** `appendEvidence` maintains the array and the index together, `recordEvidence` adds supersede-and-flip on top, and `harness confirm`, `harness verify`, and `harness verify-acs` all route through them instead of each building `gateEvidence` by hand. Recompute (`buildEvidenceCoverage`) and merge (`mergeEvidenceCoverage`) are deliberately separate functions: conflating them silently doubles every count on a second compaction, and an over-reporting index is worse than none because it looks authoritative.
  - **Migration does not fabricate history.** The existing records cite no commit, and rewriting or inventing commits is not an option, so they are **archived** and only new evidence gets the git tier. `state migrate --to 4` promotes exceptions, archives non-active evidence, builds the index, and refuses to bump a document unless a target is asked for — the version stamp decides which semantics apply, so a read never silently moves it.
  - **Test coverage:** `test/harness-git-evidence.test.mjs` (round trip, required-key presence, values that break line-oriented formats, bounds/truncation, multi-block, unavailable-git fail-safe, a real `git log` round trip, and that altering a trailer changes the commit id) and `test/harness-state-v4.test.mjs` (live scoping with `keep: always` as the non-vacuity control, compaction safety, index integrity, history retirement with a v2 parity guard, migration and ordering). Two pre-existing assertions pinned `STATE_VERSION === 3` and were updated.
  - **Known limits, stated in the contract rather than hidden:** squash merges collapse per-story trailers (the coverage index keeps the citation); rebasing unpublished work invalidates sealed records for in-flight stories only; and `state validate` does not read git by default, so validation stays environment-independent.

## [0.41.0] — 2026-09-18

### Added

- **New phase skill: `VisualEvidence`** (`.cadet/agent/core/skills/VisualEvidence.md`), dispatched from **Debugging**, **Code Review**, and **Spike**. It turns a rendered frame into a *citable finding* for claims no assertion can reach — visibility, position, layout, and UI state.
  - **Why it exists.** A whole class of defect is invisible to every other check in the framework: a mesh can exist, be enabled, be inside the frustum, have a valid material, and still be drawn nowhere because its faces point the wrong way; a unit can walk the correct path and arrive at the wrong cell; a counter can increment correctly in data and never appear on screen. In each case every automated check answers a *different* question, and the missing question is "what does it look like?" — which no assertion asks, because a rendered frame is not reachable from a test. The framework previously had no skill that mentioned visual, image, screenshot, or PNG evidence anywhere.
  - **Capture is produced, not scavenged.** The skill works an acquisition ladder: use an existing capture mechanism; if none exists, say so and **recommend building one or recommend a manual screenshot**; if the frame can only come from a running game, **ask the user to start the editor and Play, name the exact in-game state to reach, and ask them to capture at that moment**. Reaching for an old screenshot is explicitly forbidden — a frame from an unidentified build cannot support a claim about the current code.
  - **Outcomes are honest.** A finding carries one of `passed`, `failed`, `blocked`, `inconclusive`, or `visionUnavailable`, plus the question it answered, the success condition decided *before* inspection, and a required statement of **what the frame cannot prove**.
  - **An image-incapable model calls it out and continues.** `visionUnavailable` is deliberately **not** the same as `blocked`: the skill records the limitation and the artifact path, and the story, fix, and review all proceed. It never silently becomes a pass, and it never halts unrelated work.
  - **Findings bind to the source, not the image.** The rendered file is a generated artifact, so the evidence record binds to the scene/prefab/renderer that produced it — a later edit to any of those correctly invalidates the record.
- **New template: `VisualEvidenceTemplate.md`** (`.cadet/agent/core/templates/`) — the finding artifact, including capture route, build identity, and a required recommendation block when no frame could be produced.
- **Adapters** for the new skill on every supported surface: `.github/prompts/cadet-visual-evidence.prompt.md`, `.claude/skills/cadet-visual-evidence/`, and `.agents/skills/cadet-visual-evidence/`.
- **Dispatch wiring.** A `Visual Evidence` row in the Skill Inventory table (`cadet-agent.md`) and a contract row in `Harness.md` §11, plus one-line dispatch pointers in `Debugging.md`, `CodeReview.md`, and `Spike.md` (which reference the skill rather than restating it).
- **Test coverage** for the new skill: a harness-contract assertion in `test/skills.test.mjs` (named artifact, statement of what the frame cannot prove, and the `visionUnavailable` outcome), plus adapter parity and size-budget coverage in `test/adapters.test.mjs`.

## [0.40.0] — 2026-09-16

### Added

- **The read-only guarantee is now swept across flags, not just asserted per command.** The registry's `mutates: false` commands are exercised against every write-shaped flag in the CLI (`--write-coverage`, `--report`, `--inventory`, `--matrix`, `--story`, `--format`, `--dry-run`) and must produce zero filesystem writes in every combination — 28 command×flag pairs, up from 2 invocations per command. A command can no longer be read-only by default and write when handed a flag. Verified non-vacuous: injecting a real write into `harness report` fails the sweep with the offending filename.
- **Three tests pin `state migrate`'s `atomicFailure` guarantee**, which was declared in the registry but asserted by nothing. A migration that fails validation writes nothing at all; a pre-existing good backup is not clobbered by a failed retry; a successful migration still writes its backup. Verified non-vacuous by reintroducing the original backup-before-validate ordering, which fails two of them.

### Changed

- **Handoff records are now named chronologically: `<YYYY-MM-DD-HHmm>-<description>.md`** (e.g. `2026-09-16-0123-fix-cleanup-guard.md`). The previous `<YYYY-MM-DD-HHmmss>.md` had no description, so a directory of handoffs was unreadable without opening each file, and the latest was not obvious at a glance.
  - The **date leads the name deliberately**. A time-first shape (`01:23-YYYY-MM-DD-…`) cannot sort across days: `23:59-2026-09-15` sorts *after* `00:01-2026-09-16`, so a plain `ls` would not show the true latest. This is asserted by a test, alongside the rule that a handoff filename may never contain `:` — it is illegal on Windows, where the write would fail for a consumer even though a POSIX shell accepts it.
  - Same-minute collisions append a numeric suffix rather than overwriting: a handoff is never destroyed to make room for a new one.
  - `.cadet/handoffs` is a preserved path, so existing records are untouched; the new format applies to newly written handoffs only.

## [0.39.0] — 2026-09-16

## [0.38.0] — 2026-09-16

Every command now **declares whether it writes**, and the declaration is enforced by the dispatcher and asserted by tests. A consumer reported that `harness record --help` wrote a ledger — "on this CLI, checking the help is not a read-only operation." An audit found the reported bug was one instance of a class: safety was a convention the *caller* had to remember, so it protected exactly the callers who already knew.

### Added

- **Command registry (`src/harness/commands.mjs`)** — the single source of truth for `mutates`, `writes`, and unattended requirements, replacing two hand-written dispatch chains that declared nothing. `resolveCommand` / `describeAllCommands` / `checkUnattendedRequirements` are exported through the harness index.
- **`harness capabilities --format json` now returns `commands[]`**, so an agent can *ask* which commands write instead of inferring it from a name or trusting a flag it must remember to pass. The guarantee does not depend on the agent reading it: the dispatcher enforces the registry regardless.
- **Global `--dry-run`.** Previously parsed globally but honoured by exactly one command, so `harness record --dry-run` silently wrote a ledger. It is now intercepted for every registered mutating command. A new mutating command is covered the moment it is registered — there is no per-handler check to forget. `state transition` is the one declared exception (`evaluatesOnDryRun`): its dry run reports the identical verdict a real transition would, which is the flag's entire value.
- **Read-only commands are asserted, not assumed.** A table-driven test invokes every command declared `mutates: false` across its flags and asserts zero filesystem writes, so a future write in `report` or `matrix-check` fails the build rather than the user. (`matrix-check` previously carried a "Read-only" comment and nothing more.)
- **`--older-than-ms` is now required by `harness cleanup`.** It deletes run records irreversibly, and unattended agents cannot be prompted, so the bound must be content-bearing: the caller states *what* to delete, not merely *that* it approves deleting something. Without it the command refuses and deletes nothing. `--dry-run` reports what would be deleted without deleting.

### Fixed

- **`harness record --help` (and every nested `--help`) wrote state.** `--help` was recognised only as `argv[2]`, so at any deeper position it fell into the parser's `rest` array and was ignored by the handler. Reproduced across the CLI: `record` appended a ledger, `cleanup` applied the retention policy and deleted records, and `migrate` wrote a `.v1.bak`. `state transition --help` was saved only by the gate check rejecting it first — with gates satisfied it would have advanced the phase. `--help`/`-h` is now a global read-only short-circuit, detected against raw argv (before parsing can consume it as another flag's value) and honoured at any depth.
- **A failed `state migrate` left a `.v1.bak` behind.** The backup was copied *before* the migrated document was validated, so a rejected migration still wrote a file the caller never got. Validation now runs first, so a failed migration leaves the tree exactly as it found it — and cannot overwrite a previous good backup.
- **A missing option value silently consumed the next flag.** `parseArgs` did `argv[++i]` unchecked, so `harness record --target --format` bound the literal string `--format` as the target directory and wrote a ledger into a directory named `--format/`, reporting success. A missing value is now a loud usage error. Negative numeric values (`--older-than-ms -1`) remain valid, and the deliberate empty-`--files ""` rejection still reports its own specific error rather than being masked.

### Changed

- **`docs/core/HarnessContract.md` C13 rewritten** from "a command documented as a check performs no writes" (scoped to `transition --dry-run`, guarded by one test) to the write-declaration invariant, naming the three properties and their guard tests. The old wording was narrow enough that the `--help` and `record --dry-run` bugs both satisfied it.
- **`Harness.md` §12 documents the write-declaration contract** and the per-command posture, including why `record` carries no unattended bound (requiring a flag to log evidence would push agents to skip logging) and why a failing `verify` still persists its ledger (it *is* the red record).
- **Compatibility note:** `harness cleanup` without `--older-than-ms` now exits 1 and deletes nothing. Callers relying on the previous unconditional behaviour must pass a bound; the pre-existing test suite was updated to the new contract.

## [0.37.0] — 2026-09-15

### Fixed

- **The `done`-story coverage check now honours a scoped exception, so the escape the docs promised actually exists.** The 0.36.0 check reported a `done` story with no evidence as an error, and its own comment said a project "can resolve it with a scoped gate exception or by re-recording" — but the implementation only consulted `gateEvidence` and never looked at `changeHistory`, so a gate exception had no effect. That is the defect class this whole line of work exists to remove: a claim the code does not support.
  - The check now treats a `gate-exception` with a **valid category** and a matching `scope` as satisfying coverage for the named story work-item ids. Scope is matched per story, so an exception for one story never excuses another; an unknown category is not a loophole and still fails validation.
  - Scope is matched explicitly rather than through `activeExceptions`, which is keyed on the *active* work item — the wrong key for a walk over every completed story.

### Added

- **`pre-harness-story` exception category.** The documented escape for the one gap that re-verification can never close: a story marked `done` whose gates were recorded before the harness existed, so no evidence for its work item was ever written.
  - **No default expiry** (`null`), unlike every other category. The fact it records is a permanent historical one, so a time-bounded exception would re-raise an identical finding every N days without anything having changed. Asserted explicitly in `harness-strict-closure.test.mjs` so a later edit cannot quietly add an expiry and turn a permanent record into a recurring chore.
  - Scope it to the work-item ids it covers (`epic-N::story-M.md`). `Harness.md` §2b documents the category, why it is unbounded, and the per-story scoping.

## [0.36.1] — 2026-09-15

### Fixed

- **`--help` now documents every harness flag.** `--commit` (added in 0.36.0) and the pre-existing `--story`, `--report`, and the new `--matrix`/`--inventory` were all absent from the option list, so the only way to discover them was to read the parser. Documentation-only; no behaviour change.

## [0.36.0] — 2026-09-15

Three gaps found by an Agent Reviewer audit of a real consumer project (a story review and PR that had already been merged). All three share a cause: a rule the framework stated but could not mechanically check, so it was satisfied by human diligence or not at all.

### Added

- **`--commit <sha>` on `harness verify` and `harness confirm`, and a `commit` field on every evidence record.** The Agent Reviewer skill already required a gate-related fix claim to cite its `workItemId`, `relevantFiles`, and **commit** — but no evidence field carried a commit and no CLI flag could supply one, so the requirement was **structurally unverifiable**: a claim could name its work item and its files and never the revision. On the audited project all eight gates of the story under review had `toolVersion: null`, and the commit appeared only inside free-text `reason`.
  - Optional and `null` by default, so existing v2-shaped records stay valid and no migration is needed.
  - A **branch or tag name is rejected** (4–40 hex characters required): those move, so a citation naming one could not be checked later. That failure mode — a citation that reads as proof and is not — is the one the field exists to prevent.
  - Validated at both creation (`createEvidence`) and validation (`state validate`) time, and declared in `harness.schema.json`.
- **`cadet-agent harness matrix-check --matrix <path> [--report <path> | --inventory <path>]`.** Mechanically reconciles a TDD matrix's test-name claims against a compiled inventory, so a row naming a test that was never written is caught at **authoring** time rather than at the validation gate two stories later.
  - Keeps two directions strictly separate: a name in a `DELIVERED` row absent from the inventory is a **defect** (exit 1), while a name in an undelivered row is an **intention** and is never reported. Collapsing them produces false failures, and a false failure is how a real check gets switched off.
  - Undelivered intentions that *have* landed are reported informationally, so a row that should have been marked `DELIVERED` is visible rather than silent.
  - Read-only — it never writes state — and it exits 1 when given no inventory rather than reporting success it cannot support.
  - Deliberately narrow in what it reads: only the declared-tests column, and within a delivered row only the text before the `DELIVERED` marker, because a row's later columns discuss the design in prose and legitimately name types and symbols in backticks.

### Fixed

- **`state validate` no longer reports a `done` story with no evidence as valid.** Every gate check was scoped to the **active** work item, so a state document could validate clean (`valid: true`, 0 errors, 0 warnings) while completed stories had no evidence records at all. On the audited project **eight** `done` stories had zero records, one of them in the epic being closed.
  - A `done` story whose work item appears nowhere in `gateEvidence` is now an error naming the story and the expected work-item id.
  - Scoped to **coverage, not gate completeness**: it asks only "is there any evidence for this story?" Whether each required gate was satisfied for the correct phase stays enforced at transition time, where the phase is known, so the transition matrix is not duplicated.
  - Stories closed before the harness existed legitimately trip this; `AgentReviewer.md` now says to report that as coverage debt with its reason rather than as evidence tampering.

### Documentation

- `Harness.md` §1 documents the `commit` field, why a symbolic revision is refused, and the new `done`-story coverage rule; §12 documents `matrix-check` and the new flag.
- `AgentReviewer.md` clarifies that a `null` commit is a **real finding about that record** rather than a schema error, warns against substituting a commit read from git history for the one the record should carry, and adds the `done`-story check to the harness audit.

## [0.35.0] — 2026-09-15

### Added

- **New first-class skill: `/cadet-handoff`.** Captures the current session's work and the next session's obligations so a user can start a fresh chat and the next agent continues without re-discovery. State alone records *where* the workflow is; a handoff records *what was learned getting there* — decisions, rejected approaches, blockers, and uncommitted work.
  - Canonical process in `.cadet/agent/core/skills/Handoff.md`, wired across all five adapter surfaces: Copilot prompt (`/cadet-handoff`), Cursor rule, Continue rule + `config.yaml` command, `.claude/skills/cadet-handoff`, and `.agents/skills/cadet-handoff`.
  - Writes a durable record to `.cadet/handoffs/<timestamp>.md`, decoupled from the published copy, and appends a `handoff` entry to `state.json → changeHistory`. `.cadet/handoffs` is a **preserved path**, so framework sync never clobbers a consumer's handoff history.
  - The skill's core discipline is separating **verified** work (evidence-backed) from **claimed/unverified** work, plus explicit sections for open questions, uncommitted work, budget state, and "do not redo" dead ends — so an incoming agent inherits no false assumptions.
  - It never advances a phase or satisfies a gate; it inspects the next legal transition with `state transition --to <phase> --dry-run` so the inspection cannot mutate state.
  - Registered in `cadet-agent.md`'s Skill Inventory and `FrameworkManifest.json` managed paths; guard tests cover the canonical skill, all five adapters, and the `--dry-run`/no-state-advance discipline.

### Fixed

- **Freshness evidence no longer binds to Cadet's own files.** `gitChangedFiles` returned every entry of `git status --porcelain --untracked-files=all` unfiltered, so the working-tree default picked up `.cadet/state.json` and `.cadet/runs/*.json` as "relevant files" whenever they were dirty. Because recording a gate rewrites `state.json`, and every harness invocation adds a ledger, the recorded evidence hashed a file the recording itself mutated: the gate was reported stale one command later (`gate is backed by stale evidence: the input tree hash no longer matches the current files`) and the record certified no story code. The trap was unwinnable by retrying — each attempt rewrote the file it had just hashed — and it fired for `harness verify` and `harness confirm` alike, including `manual-confirmation` records that the docs described as having no file binding.
  - `.cadet/state.json` and `.cadet/runs/**` are now excluded at the single scan in `gitChangedFiles` (`src/harness/util.mjs`), so both commands are fixed at once.
  - An explicitly empty `--files ""` is now rejected (`code: "empty-files"`) instead of silently falling back to the working-tree scan, which previously produced the same bad binding with no warning.
  - `Harness.md` §2a corrected: a `manual-confirmation` *does* bind to relevant files, and its expiry is an additional bound rather than its only one. §5 documents the exclusion.
  - Tests pin the exclusion, the minimised self-reference case (only `state.json` dirty), the auto-detect path, verbatim honouring of a non-empty `--files`, and the empty-`--files` rejection.

## [0.34.0] — 2026-09-14

## [0.34.0] — 2026-09-14

### Added

- **`harness verify-acs` now detects orphaned tests — the inverse of the existing declared→delivered check.** `compareCoverage` previously iterated only the acceptance criteria, so a test that *ran* but was declared on no criterion was invisible to the tool. The drift was found repeatedly by hand (four times in one project) and never by `verify-acs`, because the check only ever looked in one direction. Its `undeclared` status made this worse than a gap: the name reads as though it covers the inverse case, but it actually means "this AC declares no tests".
  - `compareCoverage` returns a new `orphaned` array (normalized names, in report order, deduped). `describeCoverageGaps` gains `{ includeOrphans: true }`.
  - Orphans are **reported by default and are not fatal**, because consumers legitimately carry helper tests and fixtures that belong to no single criterion; making them fatal would have broken every existing story. Pass `--strict-orphans` to make them fail the check (`code: "orphaned-tests"`, gate left unset).
  - Warnings are written to stderr, so an orphan stays visible even when the command succeeds and stdout is piped or parsed as JSON.
  - Tests cover the inverse direction directly, including a discrimination check that fails when the detection is removed — the assertion the old behaviour lacked.

## [0.33.1] — 2026-09-13

### Fixed

- **Restored the next-story loop: `validation → implementation`.** The workflow's next-story loop is `VALIDATE → NEXT_STORY → yes → IMPL`, but `validation → implementation` was not a declared edge. 0.33.0 tightened the transition guard (replacing the "ungated ⇒ legal" fallback with an explicit edge list) and, as a side effect, made the correct way to start the next story in an epic unreachable — leaving `closed → implementation` (now correctly illegal) as the only apparent path. `validation → implementation` is now a declared ungated forward edge.
  - `closed` remains **terminal**. It means the epic/plan is finished (`NEXT_STORY → no → CLOSED`; Resume: "All work is complete for the current epic(s)"), and it is deliberately not an escape hatch for starting the next story.
  - Removing the pointlessness of the previous list: dropped a stray `story-breakdown → story-breakdown` self-edge (same-phase transitions are already rejected) and fixed a comment typo.
  - Documented in README (phase-gating note), `docs/core/Workflow.md` (next-story vs. closure), and the Resume skill's `validation`/`closed` rows. Contract invariant C13 now names the next-story edge.

## [0.33.0] — 2026-09-13

### Added

- **`cadet-agent state transition --dry-run` — a real dry check.** The command now reports the identical verdict to a real transition and **writes nothing** (`applied: false`, `dryRun: true` in JSON). Previously the only way to ask "would this transition be allowed?" was to run the command, which **applied the transition and wrote `state.json`**.

### Fixed

- **The Resume and TDD skills instructed a mutating command as a check.** `Resume.md` said to use `state transition --to <phase>` "as a dry check", and `TDD.md` said `state transition --to review` "(dry-run style)". Neither was true: the command always applied the transition. An agent following Resume during session resume could move a finalised `closed` project back to `implementation` and append a `changeHistory` entry, corrupting state that had already been validated. Both skills now pass `--dry-run` explicitly and state that omitting it applies the transition.
- **`closed` is now terminal.** `evaluateTransition` treated any target that is not the target of a gated transition as "ungated, therefore legal" — so a transition into `implementation`, `requirements`, `architecture`, etc. was accepted **from anywhere**, including out of `closed`. The legal set is now the gated transitions plus an explicit list of ungated forward edges (bootstrap and planning progression: `context-resolution → requirements|architecture|implementation`, `requirements → architecture|requirementsComplete|spikes`, `architecture → architectureComplete|spikes`, `architectureComplete → story-breakdown|spikes`, `spikes → architecture|architectureComplete|story-breakdown`, `story-breakdown → implementation`). Anything else is rejected with a named reason.
- `src/harness/state.mjs` exports `isUngatedForwardEdge`; contract invariant **C13** ("a command documented as a check performs no writes") is enforced by `harness-transition-dryrun.test.mjs`.

## [0.32.1] — 2026-09-13

### Fixed

- **`harness verify-acs` wrote evidence its own validator rejected.** The command set `freshnessPolicy: 'current-story'` — a bare string — while the contract requires an object carrying a `scope` (`harness.schema.json#/$defs/freshnessPolicy` has `required: ["scope"]`; `validateEvidenceShape` enforces the same). It therefore exited 0 and flipped `acceptanceCriteriaValidated`, then `cadet-agent state validate` rejected the record it had just written with `gateEvidence[0].freshnessPolicy: freshnessPolicy must be an object or null`. It now writes `{ scope: 'story' }`.
  - Added a round-trip regression guard: after `verify-acs`, `state validate` must exit 0. The original test asserted the produced gate value but never validated the record that carried it, which is why CI passed on self-contradicting output.

## [0.32.0] — 2026-09-13

### Added

- **Mechanical AC↔test verification (harness contract v4).** Closes the defect class where a recorded claim names an artifact that does not exist and nothing re-checks the name: an epic's TDD matrix named tests that were never written (`Grid_DerivedFromMap_…`, `PackageManifest_HasNoDungeonArchitect…`), and the drift was noticed only at the validation gate, after the story had merged.
  - **C10 — declared tests.** `StoryTemplate.md` now records, per acceptance criterion, a stable AC id and the exact test identifier(s) that prove it. The story is the single source of truth for the coverage claim. `EpicTemplate.md` gains a **derived** `## Coverage` view that must never be hand-authored — the second copy of the claim is what drifted.
  - **C11 — declared tests must have run.** New `cadet-agent harness verify-acs --story <path> [--report <path>] [--write-coverage]` extracts the identifiers of tests that actually executed (TAP, JUnit XML, and Unity JSON, auto-detected by content) and compares them against the story. Under `strictClosure.enabled`, any declared test absent from the inventory, any AC declaring no test, or any unknown/empty inventory means `acceptanceCriteriaValidated` is **not** set and the command exits 1, listing every gap with its AC id. With strict closure off it reports and exits 0 without touching `state.json` (v2/v3 parity).
  - **C12 — drift is self-detecting.** `criteriaHash` for AC coverage is computed over the AC ids *and* their declared test identifiers, so renaming a declared test invalidates evidence bound to the old name.
  - New `src/harness/verify-acs.mjs` (inventory extraction, story parsing, coverage comparison). An unparseable report yields an *unknown* inventory, which satisfies nothing — unknown is never silently passing (`Harness.md` §3).
  - `Harness.md` gains a verification contract row and CLI entry for `verify-acs`; the StoryBreakdown and TDD skill contracts now require declared tests at breakdown and a `verify-acs` run during TDD.
  - New `docs/core/HarnessContract-v4.md`; `docs/core/HarnessContract.md` records invariants C10–C12 and a contract test matrix row.

### Changed

- **`acceptanceCriteriaValidated` is command-backed under strict closure.** The gate was agent-owned prose; `harness verify-acs` now provides a mechanical path, and a manual confirmation for it must still pass the v3 manual-confirmation quality rules.

## [0.31.0] — 2026-09-13

## [0.30.0] — 2026-09-12

## [0.29.0] — 2026-09-12

## [0.28.0] — 2026-09-12

### Added

- **Repository-role boundary.** Cadet now distinguishes a **framework source** checkout (this repository and its forks) from a **consumer project**, so an agent cannot reason about stories, epics, or gates in a repo that has none.
  - New `src/harness/repo-role.mjs` — `detectRepoRole()` resolves the role from an explicit `.cadet/.repo-role` marker (high confidence) or structural signals: a `.cadet/state.json` or `.cadet/agent/project-plans/` means `consumer-project`, a `FrameworkManifest.json` with neither means `framework-source`.
  - `cadet-agent state validate` now reports the detected role and, when `state.json` is missing, names the repo role and points at `CONTRIBUTING.md` instead of returning a bare `ok: true`. `cadet-agent harness verify` includes `repoRole` in its JSON result.
  - `init`/`sync` write a `.cadet/.repo-role` marker (`consumer-project`). The marker is neither a managed nor a preserved path, so sync can never delete or overwrite it.
- **Documentation.** New `docs/core/RepositoryRole.md` (linked from `docs/index.md`) explains the boundary, detection order, the marker, and the gate-claim citation rule. `docs/core/HarnessContract.md` gains compatibility invariant **C9** — the marker is never managed or preserved, and `detectRepoRole` resolves `framework-source` structurally — enforced by `repo-role-marker.test.mjs`.

### Changed

- **Every phase skill and `KickoffFlow.md` now handle the no-active-state case.** A new branch — "if `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, this is the framework source repo — story/gate work is not applicable; switch to the contribution workflow (`CONTRIBUTING.md`)" — was added to the Gate Check of all ten phase skills plus the Agent Reviewer, and to step 1 of `KickoffFlow.md` (later steps renumbered).
- **Gate-related fix claims must cite their work item.** `CodeReview` and `AgentReviewer` now require every gate-related fix claim to name its `workItemId`, `relevantFiles`, and commit — the same fields `Harness.md` §1 mandates for evidence. A claim missing any of the three is filed as an explicit `unverifiable` finding.

## [0.27.0] — 2026-09-11

### Added

- **Lint command and pre-release lint gate.** `npm run lint` runs the same offline markdown-link check as CI (`lychee --offline --include-fragments`), and `npm run verify` chains `test` + `lint`. `bump-version.ps1` now runs lint before touching any file and aborts if it fails, so a broken link can never be committed or tagged; pass `-SkipLint` to override.

### Fixed

- **Broken link in `docs/index.md`.** The Planning Review skill entry pointed at a non-existent `docs/core/skills/PlanningReview.md`; it now uses the canonical GitHub URL (the pattern used for Resume/MCPSetup/AgentReviewer), which clears the CI links job.

## [0.26.0] — 2026-09-11

### Added

- **Planning Review skill.** New `PlanningReview` skill (`/cadet-planning-review`) clarifies a fuzzy, ambiguous, or contested plan before Requirements/Architecture.
  - `.cadet/agent/core/skills/PlanningReview.md` — interviews the user one question at a time and never stops until a shared understanding is reached.
  - Core mechanism: candidate questions are mapped into a **decision tree** whose edges record answer-to-question dependencies, and the tree is **re-pruned after every answer** (reachability, implicit-answer, dominance/redundancy, then re-rank), so the fewest questions are asked. Discovery-answerable questions are resolved by the agent rather than asked of the user.
  - Produces a Shared Understanding Document that feeds Requirements (large changes) or Architecture, with pruning evidence and a named riskiest assumption.
  - Adapters added for all five IDEs: Copilot prompt, Cursor rule, Continue rule + `config.yaml` command, Claude Code skill, and Deep Code skill; registered in the Skill Inventory and `FrameworkManifest.json`.

## [0.25.0] — 2026-09-11

### Added

- **Deep Code support.** Cadet-Agent now integrates with the [Deep Code](https://deepcode.vegamo.cn/) CLI (`deepcode`) as a fifth supported IDE.
  - `.agents/skills/cadet-*/SKILL.md` — 11 thin-pointer skill adapters (base, 9 phase skills, reviewer) discovered from the cross-client `.agents/skills/` root. Deep Code also scans `.deepcode/skills/` first; both roots are supported.
  - Deep Code has no PreToolUse hook, so the commit/push approval gate is enforced through `.deepcode/settings.json` `permissions.ask` (`mutate-git-log`) rather than the Copilot git-guard scripts. Documented in `docs/guidance/DeepCode.md`.
  - `FrameworkManifest.json` adds `deepcode` to `supportedIDEs` and the `.agents/skills/*` paths to `managedPaths`; `package-agent.ps1` stages them; the installer prints Deep Code next steps.
  - `test/adapters.test.mjs` covers the Deep Code adapters with the same Shape A, Shape B, size-budget, discovery, and frontmatter/naming guards as the other IDEs.
- **`AGENTS.md` is now shipped, but create-only.** A repository-root `AGENTS.md` (thin pointer to `.cadet/agent/core/cadet-agent.md`) is packaged and listed as a new manifest `createOnlyPaths` entry.
  - `init`/`sync` create it when absent and **never overwrite an existing file**. In a terminal they prompt keep/overwrite/merge (default keep); non-interactive installs always keep.
  - When kept, the installer prints a tag-pinned link so the user can still reach Cadet's version: `…/blob/vX.Y.Z/AGENTS.md`.
  - Explicit control: `--agents-md keep|overwrite|merge`; `--yes` disables prompting. `merge` uses `<!-- cadet-agent:begin -->` / `<!-- cadet-agent:end -->` markers and leaves surrounding content untouched.
  - This is a deliberate reversal of the earlier `AGENTS.md` removal: the risk was overwriting a consumer's file, which the create-only mechanism removes.

## [0.24.0] — 2026-09-11

### Added

- **Harness modernization.** Cadet-Agent now runs under an observable, bounded, evidence-backed harness while preserving every existing phase, gate, dispatch order, and approval rule.
  - `docs/core/HarnessContract.md` freezes the v2 data contract, compatibility invariants, default budgets, evidence freshness rules, the retry decision tree, context tiers, redaction categories, archive/hook safety limits, and the contract test matrix.
  - `.cadet/agent/core/Harness.md` — canonical harness rules (budgets, evidence, retries, context tiers, privacy, escalation, skill contract, CLI surface).
  - `.cadet/agent/core/harness.schema.json` — JSON Schema for policy, run ledgers, spans, evidence, decisions, and state v2.
  - `.cadet/harness.json` — repository-local budget/policy overrides (preserved by sync; conservative code defaults in `src/harness/policy.mjs`).
  - `src/harness/` — dependency-free implementation: `policy`, `budget`, `state`, `verification`, `context`, `routing`, `redaction`, `ledger`, `archive`, `hook`, `util`, and stable `index.mjs`.
  - CLI: `cadet-agent state validate|migrate|transition` and `cadet-agent harness record|verify|report|cleanup|capabilities`, each with `--format human|json` and nonzero exits for invalid state, failed verification, budget exhaustion, stale evidence, and safety rejection.
  - `.cadet/runs/<runId>.json` — sanitized run ledgers (no secrets or raw prompts by default; gitignored).
  - `docs/guidance/HarnessTroubleshooting.md` — recovery steps for stale evidence, budget exhaustion, unavailable Unity CLI, and live MCP failures.
  - `test/harness-*.test.mjs` — policy/budget, state, verification, context/routing, redaction, ledger, archive, hook, and CLI contract tests.

### Changed

- **State schema v2.** `state.schema.json` adds `stateVersion`, `activeRunId`, `activeWorkItem`, `gateEvidence`, and `lastTransition`. v1 documents remain valid input and are migrated atomically by `cadet-agent state migrate` (`.v1.bak` backup; original untouched on failure).
- **Gates are evidence-backed.** A gate may be `true` only with a fresh, non-superseded evidence record bound to the work item, input tree hash, and acceptance criteria. `cadet-agent state transition` rejects unsupported claims and lists missing/stale gates.
- **Canonical skills consume the harness.** TDD, CodeReview, Debugging, Resume, Requirements, Architecture, StoryBreakdown, Spike, MCPSetup, and AgentReviewer now require or emit harness records and block on missing evidence/budget state.
- **Installer hardening.** `src/install.mjs` delegates ZIP handling to `src/harness/archive.mjs`: containment (no absolute paths/traversal), filename/size/file-count/compression-ratio limits, header bounds validation, and CRC verification. Downloads are size- and timeout-bounded.
- **Hook fail-closed by default.** The Copilot git guard now returns a structured `hook-error` (deny) on malformed or unrecognized input instead of silently passing; `fail-open` is opt-in via `.cadet/harness.json` or `CADET_GIT_GUARD_MODE` and logs every time it allows a call.
- `FrameworkManifest.json` lists `Harness.md`/`harness.schema.json` as managed and `.cadet/harness.json`/`.cadet/runs` as preserved.
- `cadet-agent.md`: added a Harness pointer, harness paths, evidence-backed gate protocol, and harness-based context management (replacing the manual 100k-token reminder).
- `test/fixtures/state/` — valid, bare-minimum, gates-true-without-evidence, malformed, invalid-enum, and v2-minimal state fixtures.

### Fixed

- **Transitions now enforce file freshness.** `state transition` recomputes each gate's `inputTreeHash` from the evidence's `relevantFiles`, so an edit to a relevant file rejects the transition instead of passing on work-item/status checks alone.
- **Verification binds to relevant files.** `harness verify` hashes `--files` (or the working tree's changed files) into the evidence, so changes to source files invalidate the evidence. Previously it hashed the empty set.
- **Artifacts are redacted before they are written.** Oversized ledger and verification-command artifacts are redacted, then written; the artifact hash covers the persisted redacted bytes and the inline preview is redacted too.
- **Hard budgets block execution.** The context loader refuses an item that would exceed the context-token budget, and the verification loop refuses a passing gate once any hard limit (tool calls, output tokens, wall-clock, cost) is reached.
- **Red-before-green is enforced.** A `testsPassed` green result is rejected (`red-required`) unless a prior failed record exists for the same work item and gate; a `no_test_required` work item is exempt.
- **Unmeasurable cost cannot satisfy the cost envelope.** When a cost budget is configured but no rate card resolves the cost, the counter is marked unmeasurable and the run is blocked (`budget-blocked`) rather than reported as within budget.
- **State writes are atomic.** CLI transitions and verification updates write to a temp file and rename into place, so an interruption cannot truncate `state.json`.
- **Verification output counts against the output budget.** `runVerificationLoop` now adds the command's output bytes (estimated as tokens) to the `outputTokens` counter, so the output budget is enforced like the others instead of being advisory.
- **Non-Git verification fails safe.** When Git cannot be queried and no `--files` are given, `harness verify` blocks with `freshness-unavailable` instead of recording evidence against an empty input tree. `allowEmptyFreshness: true` is the explicit opt-out.
- **`state validate` rejects unbacked true gates.** A v2 document with `gates.<name>: true` and no supporting `passed`/`manual-confirmation` evidence now fails validation, not just transition.
- **Ledger finalization cannot launder a bad budget.** `RunLedger.finalize` forces exhausted and unmeasurable-cost runs to `exhausted`/`blocked`; a caller-supplied `status: 'ok'` cannot override them.
- **Artifact redaction has no bypass.** The `redactOutput` option was removed; `recordOutput` always redacts before persisting.
- **Ledger persistence is atomic.** `RunLedger.persist()` writes to a temp file and renames into place, matching the atomic state writes; an interruption cannot truncate a run record.
- **Evidence validation is complete.** `validateState` now requires and type-checks `command`, `result`, `criteriaHash`, and a freshness bound (`expiresAt` or `freshnessPolicy`), so a forged record with only identifier fields no longer passes structural validation.
- **`state validate` checks evidence binding and freshness.** A claimed-true gate is rejected when its evidence belongs to a different work item, has a stale `inputTreeHash`, or has expired — not only at transition time. The CLI passes `rootDir` so the tree comparison runs; a caller that validates without a root gets an explicit `freshness was not verified` warning instead of a silent pass, and the migration path opts out via `structuralOnly`.

### Compatibility

- No phase name, gate name, skill dispatch order, or user-approval rule changes. Existing v1 `state.json` files are migrated to v2 atomically with the original preserved on failure. Hard enforcement can be relaxed only through an explicit, documented compatibility mode (budget ceiling override; `fail-open` hook mode).

## [0.22.0] — 2026-09-11

### Changed
- **Adapters are now pointers only.** Every IDE adapter (`.claude/`, `.cursor/`, `.continue/`, `.github/`) no longer restates content that lives in `.cadet/agent/core/`.
  - Removed duplicated identity/persona lines from 22 per-phase and reviewer adapters plus the 9 command prompts in `.continue/config.yaml` (e.g. `You are executing the Cadet **TDD** skill.` and the reviewer's "You do not implement, fix, or generate code"). Core skills already state both, and state them completely.
  - Thinned the four base/dispatcher adapters, which each re-stated the skill inventory, operational-file list, important-path list, and Git Guard procedure: `.claude/skills/cadet-agent/SKILL.md` 3785 → 1105 bytes, `.cursor/rules/cadet-agent.md` 3531 → 1152, `.continue/rules/cadet-agent.md` 3680 → 1317, `.github/agents/cadet.agent.md` 2432 → 1611.
  - Net effect: the same instructions are no longer paid for twice on every turn, in every IDE. No behavioral change — gates, dispatch order, and phase names are unchanged.

### Added
- `cadet-agent.md`: new `## Operational Files` and `## Important Paths` sections, and a `### Kickoff` subsection. These facts previously existed only in adapter files (or in `README.md`), so they were moved into core before the adapters could stop duplicating them.
- `test/adapters.test.mjs`: four new guard suites — Shape A (base adapters must not re-list canonical blocks), Shape B (adapters must not restate identity/persona/role, derived generically from core `<role>`/`<instructions>` sentences), adapter size budgets, and a discovery guard that mechanically flags any sentence appearing in both an adapter and a core file. The discovery guard includes a self-test proving it can fail.

### Fixed
- `src/install.mjs`: the Claude Code next-steps output referenced `.claude\skills\cadet-agent.md`, a flat path that does not exist (the file is `.claude\skills\cadet-agent\SKILL.md`).

## [0.21.0] — 2026-08-14

### Added
- Branch status check before starting new work: `GitFirstRule.md` now requires checking the current branch and working tree (`git branch --show-current`, `git status --short`) before a new task, with options to commit, stash, push, or move leftover changes to a new branch. The same check was added to the Resume skill (step 2d) and the condensed Git Workflow rules in `cadet-agent.md`.

## [0.20.2] — 2026-08-14

### Fixed
- `src/install.mjs`: fix obsolete-file cleanup during sync so nested files under managed directories (e.g. `.cadet/agent/core/skills/`) are not deleted. `walkDir` computed relative paths from the current subdirectory instead of the walked root, so nested skills and templates were removed after extraction, leaving empty directories.

## [0.20.1] — 2026-08-14

### Fixed
- `src/install.mjs`: normalize backslash separators when reading zip entries so Windows-built packages extract correctly. Directory entries ending in `\` (e.g. `.cadet\agent\core\skills\`) were previously written as files, causing nested skills and templates to fail with `ENOTDIR` and be silently dropped.

## [0.20.0] — 2026-08-14

### Added
- Canonical `AgentReviewer.md` skill; reviewer adapters across all IDEs now point at it.
- `<role>` persona blocks and structural XML tags (`<instructions>`, `<context>`, `<input>`, `<process>`, `<output>`, `<completion>`, `<documents>`) in all core skills.
- ETC (Easy To Change) primary principle in the Architecture skill.
- Business-risk evaluation (brand risk, time to market, regulatory/compliance, opportunity cost, strategic alignment) and ask-don't-assume behavior in the Requirements skill.
- Global "never assume" rule in `cadet-agent.md`.

### Changed
- All IDE adapters (Claude Code, GitHub Copilot, Continue, Cursor) reduced to thin pointer wrappers referencing core skills.
- `<output ref="…"/>` retired in favor of `<document index="n" ref="…" purpose="fill-and-strip"/>`.
- Wrapper-only completion details folded into core skills.
- `cadet-agent.md` skill dispatch table completed to 10 skills; XML tag convention updated.
- `package-agent.ps1` hardened to stage `.claude` from `FrameworkManifest.json` managed paths.
- Tests flipped from enforcing adapter duplication to forbidding it.

### Removed
- Orphaned flat `.claude/skills/cadet-agent.md` (superseded by `.claude/skills/cadet-agent/SKILL.md`).

## [0.18.0] — 2026-08-03

### Added
- **Cross-IDE adapter suite**: full parity for Cursor, Continue, and Claude Code — all 8 skills + reviewer mode in every IDE.
  - **Cursor**: Rewritten `.cursor/rules/cadet-agent.md` with robust dispatch instructions. New `.cursor/rules/cadet-agent-reviewer.md` for reviewer-only mode.
  - **Continue**: Rewritten `.continue/rules/cadet-agent.md` with dispatch instructions. New `.continue/rules/cadet-agent-reviewer.md` for reviewer mode. New `.continue/config.yaml` with 9 custom slash commands (`/cadet-requirements` through `/cadet-agent-reviewer`).
  - **Claude Code**: Refined `.claude/skills/cadet-agent.md` base skill with dispatch table. New per-phase skills: `cadet-requirements.md`, `cadet-architecture.md`, `cadet-spike.md`, `cadet-breakdown.md`, `cadet-tdd.md`, `cadet-debug.md`, `cadet-review.md`, `cadet-resume.md`. New `cadet-agent-reviewer.md` reviewer skill.
- `test/adapters.test.mjs` — 122 automated consistency checks across all IDE adapters (file existence, canonical references, YAML frontmatter, gate checks, non-duplication, manifest coverage).
- `ADAPTERS.md` — complete adapter inventory and contract documentation.
- Cross-IDE parity matrix in `README.md`.

### Changed
- `FrameworkManifest.json`: added all new adapter paths to `managedPaths`; fixed missing `cadet-resume.prompt.md`.
- `src/install.mjs`: IDE-specific post-install messages with slash-command syntax and reviewer invocation instructions for each IDE.
- `.cadet/agent/docs/cursor.md`, `continue.md`, `claude-code.md`: updated with accurate file lists, slash-command tables, reviewer instructions, and git guard guidance.

### Fixed
- `FrameworkManifest.json` was missing `.github/prompts/cadet-resume.prompt.md` from `managedPaths`.

## [0.17.0] — 2026-08-03

### Added
- `/cadet-resume` slash-command prompt: inspects `.cadet/state.json`, cross-validates git history and epic/story files for discrepancies, then routes to the correct phase skill.
- Workflow diagram in `README.md` (Mermaid flowchart) showing the full SDLC, resume flow, hard-gate transitions, and phase-gating table.
- `docs/core/skills/Spike.md` and `docs/core/skills/StoryBreakdown.md` reference documentation.

## [0.16.0] — 2026-08-03

### Added
- Scoped Cadet skills under `.cadet/agent/core/skills/` (Requirements, Architecture, Spike, StoryBreakdown, TDD, Debugging, CodeReview).
- GitHub Copilot slash-command prompts under `.github/prompts/` (`/cadet-requirements`, `/cadet-architecture`, `/cadet-spike`, `/cadet-breakdown`, `/cadet-tdd`, `/cadet-debug`, `/cadet-review`).
- `state.schema.json` under `.cadet/agent/core/` defining session state, phases, tracking modes, and hard gates.
- `test/skills.test.mjs` verifying skill files, prompt adapters, manifest entries, thin-directive structure, and state schema.

### Changed
- `cadet-agent.md` is now a thin global directive containing identity, non-negotiable rules, workflow routing, hard-gate protocol, state management, and skill dispatch. Detailed workflow-phase instructions have moved to skill files.
- IDE adapter files updated to reference the thin directive and the skills directory.
- `package-agent.ps1` now stages `.github/prompts/` and `.cadet/agent/core/skills/` into the consumer zip.
- `FrameworkManifest.json` managed paths now include `.cadet/agent/core/skills/`, `.cadet/agent/core/state.schema.json`, and all `.github/prompts/cadet-*.prompt.md` files. `preservedPaths` now also includes `.cadet/state.json`.
- `.gitignore` now excludes user-reserved `.cadet/agent/project-plans/` and `.cadet/cadet-local-config.md` from the framework repository.
- `README.md`, `CONTRIBUTING.md`, `docs/index.md`, and `.cadet/agent/core/README.md` updated to describe the directive + skill architecture.

## [0.15.0] — 2026-08-03

### Added
- npx-based CLI (`cadet-agent`) for one-command install and sync from GitHub Releases.
- Cadet Agent Reviewer agent (`.github/agents/cadet-agent-reviewer.agent.md`).
- Git guard hooks (`.github/hooks/`) for bash and PowerShell.
- XML tag convention (`<slot/>`, `<gate/>`, `<output/>`) in `cadet-agent.md`.
- Runtime templates under `.cadet/agent/core/templates/`.
- `state.schema.json` for session state validation.
- Smoke tests for version normalization, path matching, header building, and ZIP parsing.

### Changed
- Condensed `cadet-agent.md` updated with XML tag convention, hard gates protocol, and template path policy.
- Framework version tracking moved to `FrameworkManifest.json`.
- Post-install UX now directs Copilot users to the agent picker instead of `/cadet`.

### Removed
- `AGENTS.md`, `.github/cadet-copilot-instructions.md`, `.github/prompts/`, `.cadet/orchestrator/`, `verify-coverage.sh` (deprecated by condensation and CLI).

### Fixed
- Version comparison now normalizes `v` prefix from GitHub release tags.
- ZIP extraction now awaits write stream completion.
- `GITHUB_TOKEN`/`GH_TOKEN` now sent in API requests when present.

---

## [0.5.0] — 2026-07-19

### Changed
- **Framework condensation:** Collapsed 36+ markdown files into a single `cadet-agent.md` (~150 lines) as the primary agent instruction file. Full rationale, guidance, standards, templates, and skills reference moved to `docs/` for GitHub Pages deployment.
- **Orchestrator classify:** Replaced keyword-based change classification with explicit path validation (`large|small|no_test_required`). The LLM determines the path by asking the user; the orchestrator validates and sets state.
- **Orchestrator in package:** `.cadet/orchestrator/` now ships in the distributed zip as part of `managedPaths`.
- **Build pipeline:** `package-agent.ps1` includes orchestrator directory and validates `cadet-agent.md` existence before packaging.
- **AGENTS.md:** Updated to reference `cadet-agent.md` as the single primary instruction file.
- **README.md:** Restructured to point to docs/ for full documentation.

### Added
- `verify-coverage.sh` — instruction-loss verification script for auditing condensed coverage.
- `docs/coverage-report.md` — manual audit tracing every source instruction to its disposition.
- `docs/index.md` — GitHub Pages landing page with navigation.
- `.github/workflows/pages.yml` — GitHub Actions workflow for docs deployment.

---

## [0.4.0] — 2026-07-18

### Added
- Claude Code IDE adapter: `.claude/skills/cadet-agent.md` skill file referencing the `.cadet/agent/core/` framework.
- Claude Code setup documentation at `.cadet/agent/docs/claude-code.md`.

### Changed
- Updated `FrameworkManifest.json` to include `claude-code` in `supportedIDEs` and `.claude/skills/cadet-agent.md` in `managedPaths`.
- Updated `package-agent.ps1` to package `.claude/` alongside the other IDE adapters.
- Updated `README.md` to list Claude Code as a supported IDE.

---

## [0.3.0] — 2026-07-12

### Changed
- **Breaking:** Moved `agent/` → `.cadet/agent/` so framework files live under `.cadet/` alongside the orchestrator.
- Updated `FrameworkManifest.json` managed and preserved paths to reflect new `.cadet/agent/` root.
- Updated `package-agent.ps1` to source from and package to `.cadet/agent/core/`.
- Updated all IDE adapter files (`AGENTS.md`, `.github/cadet-copilot-instructions.md`, `.cursor/rules/cadet-agent.md`, `.continue/rules/cadet-agent.md`, `.github/prompts/cadet.prompt.md`) to reference `.cadet/agent/` paths.
- Renamed `.cursor/rules/cadet-agent.mdc` → `.cursor/rules/cadet-agent.md` (old `.mdc` file is not removed by package extraction — consumers upgrading from 0.2.0 must delete the stale `.mdc` file manually).
- Updated `README.md`, `CONTRIBUTING.md` to reflect new layout.
- **Breaking:** Renamed `.github/copilot-instructions.md` → `.github/cadet-copilot-instructions.md` to avoid overwriting pre-existing Copilot instructions. Consumers upgrading from 0.2.0 must delete the stale `.github/copilot-instructions.md` and follow the activation steps in `.cadet/agent/docs/github-copilot.md`.

### Added
- `Skills/Orchestrator.md` — declarative skill document defining the orchestrator pattern for Cadet-Agent workflow coordination.
- `.cadet/orchestrator/` — bash implementation of the orchestrator with CLI entry point, JSON state management, and bats test suite (45 tests).

---

## [0.2.0] — 2026-06-01

### Added
- `agent/core/Guidance/SpikePatterns.md` — consolidated spike guidance (feasibility-question-first, separation from production, cleanup prompt after completion).
- `agent/core/Templates/ExamplePolicy.md` — worked example policy showing every PolicyTemplate section filled with concrete fictional rules.
- `CHANGELOG.md` with version bump policy.
- `CONTRIBUTING.md` covering fork/branch/PR conventions, managed-path explanation, and local build instructions.
- `.gitignore` excluding build outputs (`cadet-agent.zip`, `cadet-agent-updated.zip`).
- GitHub Actions `ci.yml` — package build and markdown link-check jobs on push/PR to `main`.
- GitHub Actions `release.yml` — tag-triggered release job that attaches `cadet-agent.zip` as a release asset.
- Manifest validation in `package-agent.ps1` that cross-checks every `managedPaths` entry against the local source tree before staging.

### Changed
- `Identity.md` — mission and scope now explicitly state Unity and C# as the primary and intended targets.
- `LearnerModel.md` — added a Scope Note confirming the model is calibrated for Unity/C# workflows.
- `Workflow.md` — renamed `## Validation` section to `## Step 4` so the step-numbered execution path is complete.
- Spike guidance in `Workflow.md`, `Principles.md`, `Guidance/ArchitecturePatterns.md`, and `Skills/CodeReview.md` slimmed to cross-references pointing to the new `SpikePatterns.md`.
- `agent/core/README.md` — version bump policy added; `SpikePatterns` added to Guidance index.
- `agent/core/Templates/PolicyTemplate.md` — added cross-reference to `ExamplePolicy.md`.
