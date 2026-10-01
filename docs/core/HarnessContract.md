# Harness Contract (v4)

> Status: **frozen** 2026-09-13 (v2 frozen 2026-09-11; v4 frozen 2026-09-13).
> Canonical runtime rules live in `.cadet/agent/core/Harness.md`. This document freezes
> the data contract and the compatibility invariants that later phases are tested against.
>
> **v3 revision.** Contract v3 adds strict closure, manual-confirmation quality constraints,
> and a gate-exception taxonomy. All three are opt-in via `strictClosure.enabled`; with the
> flag absent or `false`, behaviour is identical to v2 and a v2 document remains valid.
> The full v3 rationale, the transition `revalidate` sets, the taxonomy table, the CLI
> contract, and the test matrix are in [HarnessContract-v3.md](HarnessContract-v3.md).
>
> **v4 revision.** Contract v4 makes the acceptance-criterion → test mapping mechanical:
> a story records the exact test identifiers that prove each AC, and under
> `strictClosure.enabled` `acceptanceCriteriaValidated` cannot be set while a declared test
> is absent from the run's test inventory. Also opt-in via `strictClosure.enabled`. The full
> v4 rationale, extraction rules, coverage artifact, and CLI contract are in
> [HarnessContract-v4.md](HarnessContract-v4.md).
>
> **Post-v6 corrections (2026-09-26).** Three changes from a consumer audit, each a correction
> to a mechanical check rather than a new capability:
> **(1)** `harness verify-acs` no longer binds the generated test report into its `inputTreeHash`
> / `relevantFiles`. A report is an *output* of the run, so a repository whose test script
> rewrites a fixed report path staled the AC record the moment it re-ran the tests — the evidence
> was invalidated by the very command that produced its inventory. The record now binds the story
> (repo-relative) and the declared test names (`criteriaHash`); the report is kept as
> `artifactPath` for audit only.
> **(2)** strict-closure revalidation is no longer phase-scoped. A revalidated gate is judged on
> its `inputTreeHash`, `criteriaHash`, and expiry, not on the phase that recorded it; a
> transition's own `gates` keep the phase scope. The phase stamp therefore never forces a gate
> to be re-recorded, which is what the old behaviour did — it rejected every record written in
> an earlier phase even when nothing had changed. `requireFreshRevalidation` (default on) is a
> **separate** rule on the same set and is unaffected: it independently requires a record newer
> than the last transition, so it remains the one deliberate control for "re-run the gate at
> this transition". Both halves are field-verified: with the knob on, all seven revalidated
> gates are refused for recency; with it off, only a gate whose input tree actually changed is
> refused.
> **(3)** `--expect-phase <phase>` on the six gate-recording commands (`harness verify`, `harness confirm`, `verify-acs`, `verify-reachability`, `verify-architecture`, `verify-design-review`) refuses to write evidence
> when the current phase is not the expected one.
>
> **State growth (2026-09-26).** Contract v5's Tier A was not a bound in practice, and nothing said
> so. `gateEvidence` is scoped to the active work item, but nothing pruned *within* one, and the
> story boundary was a hand-edit — `Resume` said "set `activeWorkItem`, reset gates", a sentence that
> never mentions evidence, while `resetGatesForNewWorkItem` (which clears it correctly) had no
> caller. The result went unnoticed because `validateState` only ever asked whether a claimed-true
> gate's own record was bound to the active item, never whether foreign records were sitting in the
> array. Measured on the audited repository: **135 records for one work item, 115 of them
> `superseded`, 63 of them a closed work item's, 81% of an 8,000-line document.** Three changes:
> the story boundary is now `state begin --epic --story` (archives the outgoing records *before* the
> document is written, folds them into the coverage index); `state compact` retains the newest
> record per gate plus every `passed`/`manual-confirmation`/`failed` record and archives the rest,
> with `--retain-all` to opt out; and `state validate` **warns** on foreign records and on an
> over-long array (warns, because foreign records are unreadable by every gate and a pre-existing
> document cannot repair itself in place). See `HarnessContract-v5.md` C14 and Tier A.

This file is the Phase 0 deliverable: the implementation contract, the compatibility
invariants, and the contract test matrix. Any change to the items below is a breaking
change to the harness contract and must update this file plus the fixtures it references.

## 1. Compatibility invariants (must never change silently)

These are frozen as requirements. Later phases may add fields but must not change these:

| # | Invariant | Enforced by |
|---|---|---|
| C1 | Phase names stay exactly: `context-resolution`, `requirements`, `requirementsComplete`, `architecture`, `architectureComplete`, `spikes`, `story-breakdown`, `implementation`, `review`, `validation`, `closed`. | `harness-state.test.mjs` |
| C2 | Skill dispatch order is unchanged (Requirements → Architecture → Spike → StoryBreakdown → TDD → Debugging → CodeReview → Resume → MCPSetup; AgentReviewer is audit-only). | `skills.test.mjs`, `adapters.test.mjs` |
| C20 | **A person plays the work before the story moves on, and no command can say they did.** `userPlaythroughConfirmed` is appended to `GATES` (C3) with `owner: 'human'` in the registry — no automated path, no project command, `--command` refused — and required on `review -> validation` only, resolved by `requiredGates` at evaluation time under the opt-in `userPlay.enabled` (default false; the shipped policy file sets it true for a new consumer, because a project that has never been played is the condition the gate exists for). It is on that edge and not on `validation -> closed` because that edge IS the story boundary: the next-story loop stays unblocked, and an epic's closure is covered by `humanAcceptanceConfirmed` alone, so asking for every story's play again at closure would multiply the person's work at the moment they are accepting the finished thing. It is deliberately not revalidated at closure, for the same reason. A story declares the answer in one line of its header, in the same style as its reachability declaration: `Play: required — <what the user does in the running game, and what they should see>`, or `Play: deferred to <work item> — <why it cannot be played yet>`. A missing declaration fails (`not-declared`), a reasonless deferral and an unrecognised form are refused as `malformed` (the parser's no is the rule), a deferral to the story itself is `deferral-self`, a deferral to a work item that does not exist is `unknown-target`, and one whose target is already `done` is `deferral-target-done` — the same expiry a reachability deferral has, so "we will see it later" is a plan with a term rather than a gap. Play deferrals are walked as ONE graph with reachability deferrals, so a cycle that crosses the two declaration kinds is still one finding. There is deliberately no third form: a story with no playable surface of its own is still reached through the running game, and a `not applicable` an agent could write for itself is the escape hatch this framework keeps deleting. `harness verify-play --story <path>` records the gate for a `deferred` declaration and **refuses** a `required` one, naming the form route — an agent answering "the user played it" in a sentence would make the gate worthless. For a `required` story the only route is the person's own account: `harness play-form --story <path>` writes a form pre-filled from state (the story and its instruction, the revision, the gates still unmet), leaving blank only played-by, what-you-did-and-saw, and accepted-limitations; `harness confirm --gate userPlaythroughConfirmed --artifact <the form>` reads it back, and a form whose fields are still placeholders is refused. The form is bound to the files it covers, so editing the sources afterwards makes the record stale rather than leaving it looking current, and a form naming a different story than the active work item is refused rather than recorded against the work in flight. Reachability asks whether a person CAN reach the deliverable; this asks whether one DID — and a game can be fully tested, fully compiled and fully reviewed without ever having been played, which is the condition this gate exists to close. | `harness-user-play.test.mjs`, `harness-gate-registry.test.mjs`, `harness-policy.test.mjs` |
| C19 | **Host interception is measured per action, never inferred from a file.** `harness capabilities --verify-host` reports a level — `native`, `external` or `advisory` — for every supported host and every action the interception contract names (`git-write`, `shell-command`, `filesystem-write`, `unity-mutation`, `context-load`, `harness-routing`), with each cell recording whether it was established by `probe` or by `declared`. `native` is claimed only when the host's mechanism is configured **in this repository** **and** its probe answers correctly: the report looks for the hook's config file even when it does not run the mechanism, so a repository with no `.github/hooks/git-guard.json` reads `advisory` for Copilot's git writes rather than the `native` the static host table alone would give it — the same defect as the `hook.copilot` boolean, one level up. The probe measures EVERY variant the hook config declares, not just the one the framework happens to prefer: the shipped config declares a bash guard and a PowerShell guard, a Windows host runs the PowerShell one, and a probe that ran only bash credited a level to a script the host may never execute (and could not pass at all on a machine without bash, capping the mechanism it was measuring at `advisory`). A variant that cannot be launched here is recorded as unmeasured and named in the reason. The shipped PowerShell guard carries a UTF-8 BOM for a reason the probe's own existence made worth checking: Windows PowerShell 5.1 — the default `powershell` on every Windows machine — decodes a BOM-less UTF-8 file with the ANSI code page, so the em dash inside one of its double-quoted strings became U+201D, which 5.1 reads as a string terminator; the file failed to parse, the guard exited 0 with no decision, and nothing was intercepted on exactly the host the variant is declared for. `harness-host-interception.test.mjs` asserts the BOM and runs the guard under Windows PowerShell. The repository Git hook is the portable control and is probed for presence, for `core.hooksPath` actually pointing at it, and for correctness (it must accept a valid state document and refuse an unreadable one, in a scratch directory of its own). The previous detection — `hook.copilot` read from the presence of `.github/hooks/git-guard.json`, a file the framework itself ships — is removed, because a claim that is true in every repository and for every host measures nothing. Probes are read-only with respect to the measured repository: `harness capabilities` remains declared read-only, and the flag is included in the write-shaped-flag sweep that proves it. No parity is claimed where a host has no interception API; those routes are documented as client or OS policies and reported `advisory` or `external` (declared). | `harness-host-interception.test.mjs`, `harness-command-registry.test.mjs` |
| C18 | **Context is planned, recorded and validated — never asserted.** `harness context plan` writes `.cadet/context/plan.json` from state and the framework's layout (tier 0, the runtime contract, the phase's skill, the active story and its epic as required; reviews, requirements and the design as advisory), each entry carrying tier, authority, reason, content hash and budget effect; `budget.fits` reports whether the required set fits the declared context budget, because a plan that cannot fit is one a host truncates silently. `harness context record` writes `.cadet/context/record.json` with the loads hashed at record time and one of four levels — `enforced`, `recorded`, `estimated`, `unavailable` — where `enforced` is refused unless `--enforced-by` names an existing hook file that declares `"enforces": ["context"]`, so a host with no hook cannot claim enforcement and a hook that guards something else cannot be borrowed for it. `--transcript` takes loads from a host's own log (one JSON object per line naming a `reference`), which is the conformance path for a host without automation. `harness context validate` is read-only and answers whether a context-complete checkpoint may be claimed: it fails on a required reference never loaded, a required reference whose hash changed after the record, a record belonging to a previous work item, or a level that observed nothing (`estimated`, `unavailable` — "not verified" and "verified clean" must not look the same). Advisory context is reported and never blocks. Reports label the level as recorded and never upgrade it: a report that calls advisory loading enforced is worse than no report, because the reader stops looking. Both files are preserved paths; `sync` never touches them. | `harness-context-protocol.test.mjs`, `harness-command-registry.test.mjs` |
| C17 | **Architecture fitness is the project's own declaration, never the caller's.** `architectureFitnessPassed` is appended to `GATES` (C3) with `owner: 'automated'` and `projectCommand: false`: its evidence comes from `harness verify-architecture`, which runs the checks declared under `architectureFitness` in `.cadet/harness.json` and accepts **no `--command`**. A gate whose command arrives at the call site proves nothing about the repository, because the caller chooses the question and the answer. Each check declares a stable id, a command, repository-relative scopes, a severity, an optional artifact and the design or ADR references it enforces; the parser refuses an unknown key, a duplicate or malformed id, a missing command, an absolute or escaping path, an unknown severity, a non-positive timeout, and an `artifactFormat` with no artifact. Selection is by file scope, matched at a directory boundary so `src/Core` does not govern `src/CoreX`. Outcomes are `passed`, `failed` (non-zero exit) and `blocked` (timed out, never launched, or declared an artifact it did not write) — a required `blocked` check does not satisfy the gate and is not a red, because nothing was disproved. An `advisory` failure is recorded and never blocks. The gate is required on `implementation -> review` only when the block is enabled **and** at least one check is declared, so a project that declares nothing keeps the frozen lists (C4) unchanged, and it is re-examined at `validation -> closed` because a later story can break a dependency an earlier one satisfied. The record carries one entry per check (`checks`), each with its id, outcome, and — when the check declared one — its artifact path and hash, so the record names what proved the claim AND carries the proof's own digest. The artifacts are bound in those entries and NOT folded into `relevantFiles`, so `inputTreeHash` covers exactly the set the record stores: folding them in made the record self-inconsistent (the hash covered the judged files, the stored list was the union) and every record from a check that declares an artifact read as stale the instant it was written, which made `implementation -> review` unreachable for any project whose checks write a report. Tested by `harness-architecture.test.mjs`. The gate also follows the run's outcome: a failed or blocked run CLEARS `architectureFitnessPassed` rather than setting it, because `state validate` rejects a true gate whose latest record is not a pass, and the shipped pre-commit hook would then refuse to commit the document the framework itself wrote. This gate proves executable constraints only. Design quality remains `designReviewCompleted` (C15), and the two are separate so neither claim borrows the other's credibility. | `harness-architecture.test.mjs`, `harness-gate-registry.test.mjs` |
| C16 | **Human acceptance is a gate no command can satisfy, and the framework says so rather than pretending otherwise.** `humanAcceptanceConfirmed` is appended to `GATES` (C3) with `owner: 'human'` in the registry — the first gate of that class, and the reason the registry distinguishes `human` from `agent` instead of calling both "manual": an agent gate records a reviewer's judgement, a human gate records a person's own decision, and no reviewer's record stands in for it. `harness verify` refuses it and `--command` is refused for it, so passing tests cannot satisfy it. It is required on `validation -> closed` only, resolved by `requiredGates` at evaluation time under the opt-in `humanAcceptance.enabled` (default false; the shipped policy file sets it true for a new consumer), and never on `validation -> implementation`, so the next-story loop stays unblocked. A person records it in two commands and retypes nothing: `harness acceptance-form --epic <id>` writes a form pre-filled from state (the epic, its stories and statuses, the revision and editor version, the files it covers, and what the record says is still outstanding), leaving blank only accepted-by, witness and accepted limitations; `harness confirm --gate humanAcceptanceConfirmed --artifact <the form>` reads it back. There is no flag route — the acceptance is a file a person can open later, not a command line nobody can — so a caller passing `--witness` or `--limitations` is refused by name. The record must carry a non-empty `witness` (what a person did and saw) and `limitations` (what they accepted as missing, or the literal `none`); both are refused at capture when they are blank or still a placeholder, and required again by state validation, because a hand-edited record is exactly what this gate must not be satisfiable by. The shape lives in `templates/HumanAcceptanceTemplate.md`, which the generator reads, so the template and the generated form cannot drift into two formats. A repository whose work a user cannot reach or observe takes the `non-user-facing` exception category, which is unbounded — it states a property of the work item, not a gap in the evidence, so a time bound would only re-raise a finding nothing has changed — and which requires a `closureReviewNote` naming who accepted the judgement and what would change it. `MANUAL_ONLY_GATES` (formerly `AGENT_OWNED_GATES`, renamed when the human class arrived) is the derived list of gates with no automated builder; `validatePolicy` refuses a `disallowManualFor` that names one, because forbidding manual confirmation where manual confirmation is the only route leaves the gate unsatisfiable. | `harness-human-acceptance.test.mjs`, `harness-gate-registry.test.mjs`, `harness-strict-closure.test.mjs` |
| C3 | Gate names stay exactly: `codeReviewCompleted`, `testsPassed`, `storyTrackingUpdated`, `compileCheckConfirmed`, `unityAnalyzerClean`, `acceptanceCriteriaValidated`, `securityReviewPassed`, `designArtifactSyncConfirmed`. **APPEND-ONLY, and two appends have happened**: `reachabilityAddressed` was added by contract v6 (v6 §2), and `designReviewCompleted` by the design-review change (C15). An append is not a change to this invariant — no existing name moved or changed meaning — but this list is the authoritative one, so it is updated in the same change that appends, never later. The authoritative list is now: `codeReviewCompleted`, `testsPassed`, `storyTrackingUpdated`, `compileCheckConfirmed`, `unityAnalyzerClean`, `acceptanceCriteriaValidated`, `securityReviewPassed`, `designArtifactSyncConfirmed`, `reachabilityAddressed`, `designReviewCompleted`, `humanAcceptanceConfirmed`, `architectureFitnessPassed`. Every recorded gate name from every earlier version must keep resolving. | `skills.test.mjs`, `harness-state.test.mjs`, `harness-policy.test.mjs` |
| C4 | The transition table targets are unchanged: `implementation→review`, `review→validation`, `validation→closed`, and the per-transition `gates` lists are unchanged. Contract v3 adds a `revalidate` set per transition, applied **only** when `strictClosure.enabled` is true (v3 §1). **Conditional append (v6)**: when `reachability.enabled` is true, `review→validation` additionally requires `reachabilityAddressed` — appended at evaluation time (`requiredGates`), not in the table, so with the switch off the lists are exactly as declared; the same mechanism carries `designReviewCompleted` on `architectureComplete→story-breakdown` (C15) and `architectureFitnessPassed` on `implementation→review` (C17), which is why the lists in this invariant are still the ones declared here; and under strict closure the declaration is re-examined at `validation→closed` (v6 §4). A `revalidate` gate is **phase-independent** (post-v6 correction): it is judged on its `inputTreeHash`, `criteriaHash`, and expiry, not on the phase that recorded it, while a transition's own `gates` remain phase-scoped. `requireFreshRevalidation` still applies to the `revalidate` set independently. | `harness-state.test.mjs`, `harness-strict-closure.test.mjs` |
| C5 | User approval requirements are unchanged: no automatic commit/push/merge, no automatic approval, live-editor mutation requires explicit confirmation. | `git-guard` tests, `Harness.md` |
| C6 | Existing v1/v2 `state.json` files either validate unchanged after migration or receive a documented, atomic migration that leaves the original untouched on failure. A v2 document stays readable and is **not** retroactively invalidated by the v3 bump; v1 migrates straight to the current version. | `harness-state.test.mjs`, `harness-cli.test.mjs` |
| C7 | Adapters remain thin pointers; no adapter restates canonical content. | `adapters.test.mjs` |
| C8 | `sync` preserves `.cadet/harness.json`, `.cadet/runs/`, `.cadet/agent/policies/`, `.cadet/agent/project-plans/`, `.cadet/state.json`. `.cadet/harness.json` is additionally a **create-only seed**: the package carries the framework's own policy file, so a new consumer starts from a declared policy instead of an unwritten compiled default, and an existing copy is never overwritten. It is therefore in `managedPaths` (so it ships) and in `createOnlyPaths` (so install and sync write it only when absent), and NOT in `preservedPaths` — a preserved path is skipped at extraction and would never be created. The seeded file declares the new-consumer defaults: strict closure ON (`revalidateOnClosure` on, the recency rule `requireFreshRevalidation` OFF so an unchanged tree carries a gate across a transition, reason/scope/environment/expiry required on manual evidence, a 24-hour manual validity, and manual confirmation prohibited for `testsPassed`, `acceptanceCriteriaValidated` and `reachabilityAddressed`, whose automated path exists in every environment). The compiled fallback in `DEFAULT_STRICT_CLOSURE` names the same three gates, so the shipped file and the code cannot disagree about what may be satisfied by hand and a `reachability` block that installation turns on for a new Unity project (`detectUnityProject`: `ProjectSettings/ProjectVersion.txt`, else `Assets/` with `Packages/manifest.json`). A consumer that already owns the file is never touched. A consumer that owns the file keeps its own values, which is the override path. | `sync.test.mjs`, `adapters.test.mjs`, `policy-seed.test.mjs` |
| C9 | `.cadet/.repo-role` is neither a managed nor a preserved path, and `init`/`sync` write it as `consumer-project`; `detectRepoRole` reports `framework-source` for a tree with a manifest but no state and no project-plans. | `repo-role-marker.test.mjs`, `harness-repo-role.test.mjs` |
| C10 | The story artifact records, for each acceptance criterion, a stable AC id and the declared test identifier(s) that prove it. The story is the single source of truth for the coverage claim; the epic coverage view is derived from it. | `harness-verify-acs.test.mjs`, `skills.test.mjs` |
| C11 | Under `strictClosure.enabled`, `acceptanceCriteriaValidated` cannot be satisfied while any declared test is absent from the test inventory of the run that satisfied `testsPassed`, or while an AC declares no test. An unknown/empty inventory satisfies nothing. | `harness-verify-acs.test.mjs` |
| C12 | `criteriaHash` for AC coverage is computed over the AC ids **and their declared test identifiers**, so renaming a declared test invalidates evidence bound to the old name. | `harness-verify-acs.test.mjs` |
| C15 | **The formal design review is required on the architecture edge into story breakdown, and its artifact has a checked structure.** The requirement is on ONE edge, `architectureComplete -> story-breakdown`, and the transition matrix also allows `architectureComplete -> spikes -> story-breakdown`, so a detour through `spikes` reaches breakdown without the review. That is a deliberate placement (see the plan §5.3: keying transitions on `(from, to)` was rejected as a larger change for one colliding pair) and it is stated here because the invariant's own headline would otherwise overstate what is enforced. The artifact contract itself:** `designReviewCompleted` is appended to `GATES` (C3) and required on exactly one edge, `architectureComplete -> story-breakdown`, resolved by `conditionalEdgeGates` at evaluation time rather than declared in the transitions table — because `requiredGates` resolves a transition by its TARGET phase and `story-breakdown` is reached from `spikes` too, so a table entry would gate the wrong route. Enforcement is opt-in (`designReview.enabled`, default false; the shipped policy file sets it true for a new consumer), and with it off the edge behaves exactly as before. The evidence is produced by `harness verify-design-review`, which requires the artifact to name its reviewer and inputs, to carry a `## Findings` section whose every row has a known disposition (`accepted`, `rejected`, `deferred`, `contested`), to give a reference for the dispositions that claim something exists elsewhere, and to name a resolver for every contested finding. The command binds the artifact and the inputs given by `--files`, so changing the design stales the review. It cannot judge the design's merit and does not claim to. | `harness-design-review.test.mjs` |
| C14 | **Every gate declares one evidence contract, and only a contract that IS a project command accepts `--command`.** The registry (`src/harness/gates.mjs`) is the single source of truth for a gate's owner (`automated`, `agent`, `human`), the command that may produce its evidence, whether a project may replace that command, whether a human assertion is meaningful, and what the record binds. `harness verify` resolves the contract before it runs anything: an unknown gate name is refused, and `--command` is refused for every gate whose contract is not a project command — naming the path that does work instead. Unchanged by this: the four gates whose evidence IS a repository command (`testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`, `storyTrackingUpdated`) still accept `--command`, and the four commands whose evidence comes from a file rather than a command (`harness verify-acs`, `verify-reachability`, `verify-architecture`, `verify-design-review`) REFUSE `--command` with `command-not-accepted` — the flag was parsed globally and then ignored by them, so it exited 0 having done nothing, which is the silently swallowed option this CLI's own parser comments call worse than a rejected one. Automated evidence is stamped with the gate's contract id (`testsPassed@1`), and `evidenceFreshness` refuses a record whose contract id differs from the current one, so a change to a builder's rules refuses the old records instead of re-reading them; a record that declares no contract predates the field and is accepted. The four gates with no automated builder (`codeReviewCompleted`, `securityReviewPassed`, `designArtifactSyncConfirmed`, `humanAcceptanceConfirmed`) are recorded by a reviewer, and either an agent or a human may make that record — the framework does not force a judgement onto an agent. (`humanAcceptanceConfirmed` is recorded from its generated form: see C16.) `strictClosure.disallowManualFor` still refuses to list one of them, because a manual confirmation is their only route and forbidding it would leave the gate unsatisfiable. | `harness-gate-registry.test.mjs`, `harness-strict-closure.test.mjs` |
| C13 | **Every command declares whether it writes, and the declaration is enforced rather than trusted.** The CLI exposes a command registry (`src/harness/commands.mjs`) that is the single source of truth for `mutates`, `writes`, and any required unattended bound. Three properties follow, and each is mechanically checked: (1) `--help` is honoured at any depth and performs no writes; (2) `--dry-run` is honoured globally and *automatically* for every registered mutating command — a command cannot "forget" to check it, and `state transition` is the one declared exception (`evaluatesOnDryRun`) because its dry run reports the identical verdict to a real transition rather than a bare acknowledgement; (3) every command declared `mutates: false` performs zero filesystem writes across its documented flags. Commands that may run unattended but act irreversibly must additionally require a content-bearing bound (e.g. `cleanup` requires `--older-than-ms`), never a bare confirmation flag. A failed `migrate` leaves the tree exactly as it found it, backup included. Only the gated transitions in `TRANSITIONS` plus the declared ungated forward edges are legal; `closed` is terminal, so a transition out of it is rejected rather than silently allowed. The declared edges include the next-story loop `validation → implementation` (`NEXT_STORY → yes → IMPL`). and (4) a `--files` entry naming a path the command itself writes — the run ledger or `.cadet/state.json` — is REFUSED before any handler runs, because `inputTreeHash` covers the binding and the command's own write changes the file, so such a record read as stale at the instant it was written (a consumer hit exactly that on 2026-10-01 and had to re-record one gate twice before its boundary was allowed). The refusal is derived from each command's own `writes` declaration, so a new command and a new output are covered when they are registered rather than when someone remembers them. | `harness-command-registry.test.mjs`, `harness-help-side-effects.test.mjs`, `harness-transition-dryrun.test.mjs`, `harness-self-bound-files.test.mjs` |

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
  **Exception (revalidation):** a gate in a transition's `revalidate` set is not phase-scoped —
  it is judged on its `inputTreeHash`, `criteriaHash`, and expiry, because revalidation asks
  whether the gate is still true, not which phase recorded it. A transition's own `gates` remain
  phase-scoped. `requireFreshRevalidation` is a separate rule over the same set: it additionally
  requires a record newer than the last transition, and it is the only rule that can force an
  unchanged gate to be re-recorded.
- `inputTreeHash` = SHA-256 over sorted `(relative path, file hash)` pairs of relevant files,
  excluding generated run artifacts. A generated test report is never a relevant file:
  `harness verify-acs` keeps it as `artifactPath` for audit, so re-running the tests cannot stale
  the AC record.
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
  blocked (`freshness-unavailable`) unless `allowEmptyFreshness: true` is set explicitly. For
  `harness verify-acs` the relevant files are the story alone, recorded repo-relative; the test
  report it read is not among them (see §2).
- Red-before-green is enforced: a `testsPassed` green result requires a prior failed record for the
  same work item and gate, unless the work item is `no_test_required`.
- A command that never launched cannot satisfy red-before-green. A launch failure — a spawn error, a
  `cmd.exe` "not recognized" resolution failure, a WSL stub with no installed distribution, or a
  shell's exit 126/127 command-not-found convention — is recorded `blocked` with stopReason
  `launch-failed`, never `failed`, and is not retried. A command led by a POSIX interpreter
  (`bash`, `sh`, `dash`, `zsh`, `ksh`) is resolved before execution on Windows; when every PATH
  candidate is a WSL stub the gate is blocked before anything runs.
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

A command that never launched is a separate outcome from these classes, not a fifth one: it is
recorded `blocked` (stopReason `launch-failed`) rather than `failed`, so it is never eligible as a
red and is never retried. Detection, and the pre-execution interpreter resolution that refuses a
WSL-stub-only `bash` on Windows, live in `verification.mjs` alongside the classifier.

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
| AC↔test coverage | declared tests found in the inventory ⇒ gate set | missing/undeclared test, or unknown inventory, ⇒ gate not set; strict-off writes nothing | `harness-verify-acs.test.mjs` |
| AC evidence binding | `verify-acs` binds the story and survives a rewritten report | editing the story invalidates the record; the report is not a relevant file | `harness-verify-acs.test.mjs` |
| Dry-run transition (C13) | `--dry-run` reports allowed and leaves `state.json` byte-identical | `--dry-run` rejection writes nothing; `closed → implementation` rejected; bootstrap edges still allowed | `harness-transition-dryrun.test.mjs` |
| Write declaration (C13) | every command declares `mutates`; read-only commands write nothing; `--dry-run` honoured for all mutating commands | a read-only command writes; a mutating command ignores `--dry-run`; a destructive command runs unattended without a bound; a failed `migrate` leaves a backup | `harness-command-registry.test.mjs`, `harness-help-side-effects.test.mjs` |
| Framework health line | `harness status` prints exactly one line — `cadet-agent: ok`, or the problem with its remedy — and its exit code carries the same verdict | an invalid or missing record, and a last run that is `exhausted` or `blocked`, each produce a problem line and exit 1; a `failed` (red) run does not, because a red is how TDD works; the command writes nothing under every write-shaped flag | `harness-status.test.mjs`, `harness-command-registry.test.mjs` |
| Change inventory | `harness changes` reports the changed files, statuses, counts, and links, and writes nothing | a missing git reports `available: false` with a reason, never an empty change set | `harness-changes.test.mjs`, `harness-command-registry.test.mjs` |
| Artifact reconciliation | `harness reconcile` reports state↔disk and link inconsistencies, and writes nothing. An active gate-exception covering a work item is honoured: the gap is reported as `info` naming the exception, never re-raised as `blocking`. `--story` scopes to one epic, accepting a story path, an epic directory, an epic key, or `epic.md`. | a missing plans directory or an unreadable artifact yields `available: false` / verdict `unknown`, never a clean chain; a scope naming no epic is refused (exit 2) rather than reconciled repo-wide; an exception naming a different work item does not excuse the gap; an expired exception does not excuse it | `harness-reconcile.test.mjs`, `harness-command-registry.test.mjs` |
| Strict closure off (v3) | v2 behaviour byte-identical with the flag absent | stale implementation gate does NOT block closure when off | `harness-strict-closure.test.mjs`, `harness-state.test.mjs` |
| Closure revalidation (v3) | fresh revalidation satisfies `validation→closed` | gate valid at `implementation` but stale at closure is rejected | `harness-strict-closure.test.mjs` |
| Revalidation phase scope | an earlier-phase record with an unchanged tree satisfies closure | a revalidated gate whose input tree moved is still rejected; a primary gate is still phase-scoped | `harness-strict-closure.test.mjs` |
| Revalidation recency (v3) | record newer than the last transition accepted | unexpired but older record rejected | `harness-strict-closure.test.mjs` |
| Manual-confirmation quality (v3) | full record (reason/expiresAt/environment/scope) accepted | each missing field rejected; all reported together | `harness-strict-closure.test.mjs` |
| Null freshness bound (v3) | `freshnessPolicy.scope` present accepted | `expiresAt: null` + `freshnessPolicy: null` rejected under strict | `harness-strict-closure.test.mjs` |
| `disallowManualFor` (v3) | gate not in the list accepts manual evidence | `testsPassed` manual rejected with a pointer to automation | `harness-strict-closure.test.mjs` |
| Validity window (v3) | expiry within `maxValidityMs` accepted | beyond the bound rejected | `harness-strict-closure.test.mjs` |
| Exception taxonomy (v3) | each category accepted with expiry + review note | unknown category rejected listing the valid set; missing note rejected | `harness-strict-closure.test.mjs` |
| Taxonomy expiry (v3) | shortening a category's default accepted | extending it without `expiryExtendedReason` rejected | `harness-strict-closure.test.mjs` |
| `harness confirm` (v3) | writes ledger + state, flips gate, supersedes prior evidence | disallowed gate / missing metadata / over-long validity each exit 1 and write nothing | `harness-confirm-cli.test.mjs` |
| Schema/code lockstep (v3) | schemas declare strictClosure and the taxonomy | version enum is `[1,2,3]` and defaults stay opt-in | `skills.test.mjs` |
| `--expect-phase` guard | the matching phase lets the command record | a mismatched or unknown phase refuses before any write, across all six gate-recording commands | `harness-expect-phase.test.mjs` |
