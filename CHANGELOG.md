# Changelog

All notable changes to Cadet-Agent are documented here. Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## Version bump policy
- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, or documentation-only clarifications that do not change agent behavior.
- **Minor** (`0.X.0`): new skill, standard, template, guidance document, or structural reorganization that adds capability or improves routing without breaking existing consumer installs.
- **Major** (`X.0.0`): breaking change to managed paths in `FrameworkManifest.json`, removal of an existing skill or standard, or a workflow routing change that invalidates prior planning artifacts.

Consumers should update `FrameworkManifest.json → frameworkVersion` in their installed copies when syncing a new package.

---

## [Unreleased]

### Changed

- **Both READMEs now describe the framework the code implements.** The root `README.md` still showed
  the workflow and the CLI as they stood before the user-play and design-review gates: the phase-gating
  table and the workflow diagram omitted the `userPlaythroughConfirmed` gate and its `Play:` declaration,
  the `designReviewCompleted` gate was missing from the diagram's `architecture → story-breakdown` edge,
  `state init` and `state begin` were absent from the command list, and twelve commands of the current
  surface (`harness status`, `verify-acs`, `verify-reachability`, `verify-design-review`,
  `verify-architecture`, `verify-play`, `play-form`, `acceptance-form`, `confirm`, `changes`,
  `matrix-check`, and `context plan|record|validate`) were unlisted. Corrected against the code: the
  human-owned gates (`humanAcceptanceConfirmed`, `userPlaythroughConfirmed`) and their form route, the
  response contract and `harness status`, the two skills missing from the skills list and the cross-IDE
  matrix (Design Review, Visual Evidence), the code-review step count (17 → 23), and the packaged layout
  (`.agents/skills/`, `.githooks/pre-commit`, `AGENTS.md`, `.cadet/harness.json`). A heading that split
  the phase-gating table in two now follows it. `.cadet/agent/core/README.md` had the same gaps and
  stated two retired facts — the state schema as "v1 and v2" and a `state migrate` that upgrades
  "v1 → v2"; both now name v4.

## [0.59.1] — 2026-10-01

### Fixed

- `harness verify-play` printed its refusal one character per line. `describePlayGaps` returned a
  joined string where its sibling `describeReachabilityGaps` returns an array, and the CLI iterates
  the result — so an agent refused a gate saw `-`, then `w`, then `h`, instead of the gap. Found by
  running the released CLI against a real story; the test now asserts the shape, not just the text.

## [0.59.0] — 2026-10-01

### Added

- **The `userPlaythroughConfirmed` gate, and the story-level `Play:` declaration it reads.** Game work
  can be fully tested, fully compiled and fully reviewed without anyone ever playing it, and the one
  gate that asks a person — `humanAcceptanceConfirmed` — fires at epic closure, by which point every
  story is already marked done. A story now states
  `Play: required — <what the user does and what they see>` or
  `Play: deferred to <work item> — <why it cannot be played yet>`; the gate is required on
  `review -> validation` — the story boundary, so the next-story loop stays unblocked and an epic's
  closure is covered by the acceptance gate alone — when the repository sets `userPlay.enabled`.
  It is **human-owned**: `harness verify-play` records it only for a deferral,
  `harness play-form` writes the form, and `harness confirm --artifact` records the person's own
  account of what they played and what they saw. There is deliberately no "not applicable" form: a
  deferral names an owner and expires when that owner is done. The shipped policy file for a new
  consumer sets `userPlay.enabled: true`.
- `cadet-agent harness verify-play --story <path>` — check a story's `Play:` declaration, and record
  the gate for a deferral.
- `cadet-agent harness play-form --story <path>` — write a user-playthrough form for a story,
  pre-filled from state.
- `.cadet/agent/core/templates/UserPlaythroughTemplate.md`.

## [0.58.0] — 2026-10-01

### Changed

- **A story with evidence behind it may not read `planned`.** `validateState` refused a `done` story with no evidence record (AR-2) but not its mirror: a work item that a `storyCompletions` row records the session moving on FROM, with records behind it, could still read `planned` in `epics[].stories` — a finished story indistinguishable from one that was never started. A consumer hit exactly this (2026-10-01). The story had been implemented, reviewed, sealed with 11 evidence records, and named by its own seal commit, while all three of its tracking fields still read `planned`. `state validate` reported that document clean, the story's own `storyTrackingUpdated` record had passed (that gate checks that the three tracking sources AGREE, and they agreed on `planned`), and the drift surfaced a day later only when the machine-written completion rows were compared against those fields by hand: 8 rows, 1 mismatch. The new error is scoped to the case the row's own data makes unambiguous — a row whose `evidenceRecords` is greater than zero — because `state begin` records the outgoing item whatever its state, so a story begun and then abandoned leaves a hollow row and stays legal. `in-progress` is deliberately not checked: re-beginning an item leaves its previous row in place, so active-plus-row is a legitimate combination. It is an ERROR rather than a warning for the reason AR-2 gives, and the remedy has the same shape: say what happened — `done`, or `superseded`. The validator never runs on a transition (`evaluateTransition` does its own check against the active work item), so this reports on `state validate` and `status` and cannot block story progression. Tests: two cases in `harness-state.test.mjs`, one per side of the row.

## [0.57.0] — 2026-10-01

### Changed

- **A gate's evidence may not bind the files the command itself writes.** `--files` is hashed into the record's `inputTreeHash`, and `harness verify`, `harness confirm`, `harness verify-acs`, `harness verify-reachability`, `harness verify-design-review` and `harness verify-architecture` then write the run ledger and `.cadet/state.json`. Binding one of those made the record stale at the instant it was created — the write it describes changes a file the hash covers — so the very next `state transition --dry-run` refused the boundary with *"input tree hash changed since the evidence was recorded"*, for a record the harness itself had just written. The consumer that reported it (2026-10-01) had to re-record the same gate twice before the transition was allowed. The dispatcher now refuses such a binding **before any handler runs**, naming the paths and stating why, and it is a refusal rather than a silent filter on purpose: the caller asked for a binding that provably cannot hold, and a filtered record would claim a coverage it does not have. The check is derived from each command's own `writes` declaration in the registry (C13), so a new command and a new output are both covered the moment they are registered rather than when someone remembers. Tests: `harness-self-bound-files.test.mjs`, whose pattern coverage is GENERATED from the registry rather than hand-listed — the generated case is what caught the matcher's first version, which escaped `**` before substituting the wildcards and so reported every declaration as unmatchable. One existing test bound `.cadet/state.json` incidentally (it wanted a file that satisfied freshness, and asserted the repo role in the JSON); it now binds the manifest its own fixture already writes, and says why.

## [0.56.0] — 2026-09-30

### Changed

- **A change-log entry is a pointer, and the bound is enforced.** `changeHistory` was bounded by count and left unbounded in what each entry *contains*, so the prose came back: on the audited consumer the longest entry was a 1.2 KB retelling of a review report that it named in the same sentence, and four entries carried 2.9 KB of text between them — all of it already in `.cadet/reports/` and in git. The rule that said otherwise was written for `Handoff` after 116 handoff entries averaged 1.9 KB each, and it never applied anywhere else. An entry's text is now limited to 400 characters (`MAX_HISTORY_ENTRY_CHARS`), and `validateState` **errors** on a longer one in a v4 document rather than warning, because the documentation-only version is what let this drift back. The error is repairable in place: `state compact` archives an over-long entry wherever it sits — newest included, since recency is the wrong selector for an entry that should never have been written — into `.cadet/archive/history.jsonl`, and nothing is lost. A v1-v3 document is exempt (its log holds prose by design) and `state migrate` compacts it on the way to v4. Six skills that write to the log now state the rule the seventh already had.

- **A gate's evidence contract is declared once, and `--command` may fill only the slots whose evidence IS a project command.** `harness verify --gate X --command Y` accepted any gate name and any command. Reproduced against 0.55.0: `--gate codeReviewCompleted --command "node -e \"process.exit(0)\""` exited 0, wrote `source: "automated"` evidence and flipped an agent-owned gate to true, and `--gate totallyMadeUpGate` was accepted the same way. The new registry (`src/harness/gates.mjs`, contract C14) declares each gate's owner, the command that may produce its evidence, whether a project may replace that command, whether a human assertion is meaningful, and what the record binds. `harness verify` now refuses an unknown gate name, and refuses `--command` for every gate whose contract is not a project command — naming the path that does work (`harness verify-acs`, `harness verify-reachability`, or a manual confirmation). Unchanged: the four gates whose evidence IS a repository script still accept `--command`, which is the workflow consumers already use. Automated evidence is also stamped with the gate's contract id (`testsPassed@1`); a record written under an earlier contract is refused as stale rather than re-read as if the rules had not changed, and a record that declares no contract predates the field and stays valid.

- **The three judgement gates keep their human route, and the rule that protects it now covers all three.** `codeReviewCompleted`, `securityReviewPassed` and `designArtifactSyncConfirmed` have no automated builder, so a reviewer's record is the only evidence for them, and either an agent or a human may make it. `AGENT_OWNED_GATES` said such a gate "can never be satisfied by a human assertion", which no code enforced and a consumer's own records contradict; the comment and the refusal message now state the actual rule — `strictClosure.disallowManualFor` refuses these gates because forbidding manual confirmation would leave the gate unsatisfiable, not stricter. The list grew from `codeReviewCompleted` alone to all three, so the same protection applies to the other two, and `auditGateRegistry` fails if the policy list and the registry disagree.

### Added
- **Independent audit round: five defects found, five fixed, each pinned by a test that fails without the fix.** An adversarial AgentReviewer pass over the uncommitted work reported four blocking and six material findings; each was reproduced before it was acted on, and the ones that reproduced are fixed here. (Two of its blocking findings were the same defects the Phase 9 fixtures had already surfaced — the missing `state init` and the unsatisfiable acceptance route — and are recorded above.)
  - **`harness capabilities` claimed `native` for Copilot in a repository with no hook at all.** `levelFor` read the level straight out of the static host table, so an empty repository was reported as natively protected — the `hook.copilot` defect C19 removed, one level up. The declared level now checks for the hook's config file in the repository being measured (and for `.githooks/pre-commit` on the portable path), naming the file it looked for. A repository without it reads `advisory`; a repository with it reads `native`, marked `declared`, until `--verify-host` measures it.
  - **A check that declared an `artifact` made `architectureFitnessPassed` permanently stale.** The record's `inputTreeHash` was computed over the judged files while the stored `relevantFiles` was the union of those files and the artifact paths; freshness re-derives the hash from the record's own list, so every such record read as "input tree hash changed since the evidence was recorded" the instant it was written, and `implementation -> review` was unreachable for any project whose checks write a report. The record now hashes exactly the set it stores, and the artifacts stay bound in `checks[].artifactPath` + `artifactHash`, which is what C17 always described.
  - **`harness verify-architecture` set the gate true on a failed run, writing a document the framework itself rejects.** A required check exiting non-zero cleared nothing: the command wrote `gates.architectureFitnessPassed = true` beside its `failed` record, and `state validate` then refused the document ("gate is true but has no supporting evidence record") — which the shipped pre-commit hook turns into a refused commit in the consumer's repository. `recordEvidence` now takes `{ setGate }` and the architecture command passes the run's outcome, so a failure also invalidates an earlier pass instead of leaving it standing.
  - **`--witness` and `--limitations` were silently discarded, not refused.** C16 claims a caller passing them "is refused by name"; neither had a `parseArgs` case, so both fell into `opts.rest`, the command exited 0, and the form's values were recorded while the caller's were dropped. They are now parsed and refused with `flag-removed`, naming the form command — a discarded field that looked accepted is the failure this framework exists to prevent.
  - **`--command` was accepted and ignored by four commands.** `harness verify-acs`, `verify-reachability`, `verify-architecture` and `verify-design-review` read their evidence from a file, and C17 states that `verify-architecture` "accepts no `--command`" — but the flag was parsed globally and then never consulted, so it exited 0 having done nothing. All four now refuse it with `command-not-accepted`, matching `harness verify`'s `gate-not-overridable`.
- **The shipped PowerShell guard did not run at all on Windows, and the probe that should have noticed only ran bash.** `.github/hooks/scripts/git-guard.ps1` is UTF-8 without a BOM and contains an em dash inside a double-quoted string. Windows PowerShell 5.1 — the default `powershell` on every Windows machine, and the interpreter a Copilot host uses for the declared PowerShell variant — decodes a BOM-less UTF-8 file with the ANSI code page, so byte `0x94` became U+201D, which it reads as a string terminator: `Missing closing '}' in statement block`, exit 0, no decision, nothing intercepted on exactly the host the variant is declared for. The BOM is added (the repository's own `package-agent.ps1` already had one), and the guard now parses and answers correctly under Windows PowerShell. `probeHostHook` measures EVERY variant the hook config declares rather than bash alone — a variant that cannot be launched here is recorded as unmeasured and named in the reason — so a Windows host with no bash on PATH can now reach `native` through the PowerShell guard instead of being capped at `advisory`. `probeRepoGitHook` also refuses to judge an enclosing work tree: if its scratch directory sits inside one, `git rev-parse --show-toplevel` would have returned that repository, and the probe would have validated a state document it never wrote.
- **Documentation corrected against the code**: C14 named three gates with no automated builder where `MANUAL_ONLY_GATES` and the registry hold four (`humanAcceptanceConfirmed` was missing); C15's headline said the design review "is required before story breakdown" when the requirement is on the `architectureComplete -> story-breakdown` edge and the legal `spikes` detour is ungated (the placement is deliberate, and the consequence is now stated in the invariant and in `docs/core/CapabilityDemonstrations.md`); the contract still said "the four gate-recording commands" where six now record evidence; and C17 now states the artifact binding exactly as the code implements it.

- **`cadet-agent state init` — the first state document, as a command.** `cadet-agent init` installs the framework, and then every entry point refused with "Initialise state before starting a work item" while nothing could initialise it: `state begin`, `state transition`, `state seal`, `state compact` and `harness confirm` all need a document that no command wrote. The only route was a hand-written one, which is the pattern this framework refuses everywhere else, and the instruction that described it (`skills/Resume.md`) wrote `version: 1` with `session.workflowPath: null` — a document `state validate` rejects (`workflowPath is required`). So a new consumer's FIRST document was unaudited, and following the instruction literally produced an invalid one, in the file every gate reads. `state init` takes `--workflow-path` (required by the schema; default `large`), `--tracking-mode`, `--phase`, `--learner-tier` and `--operating-mode`, refuses an unknown value before writing anything, refuses to overwrite an existing document (`state-exists`, file left byte-identical), and validates the document before it reaches disk. `cadet-agent.md` and `skills/Resume.md` now name the command instead of describing a hand-write.
- **Fixed: `harness verify-acs` resolved `--story` and `--report` against the process working directory** while binding its record to `<target>/<story>`. The command was unusable from outside the project with `--target`, and a file of the same name under the working directory would have had its criteria attested against the target's path — the silently-inert binding `verify-reachability`'s own comment warns about. Both paths now resolve against the target, like every other path flag in the CLI.
- **Fixed: the human-acceptance route was unsatisfiable under the shipped policy.** `harness confirm` required `--scope` and `--environment` (strict closure) and then refused them beside `--artifact` as "a second, competing source", so `humanAcceptanceConfirmed` failed whichever way it was called — and the shipped seed enables strict closure, so this was the position of every new consumer. The two fields the form carries are now exempt from the metadata requirement when the artifact is present; `--reason` and `--expires-at` remain required, `--scope` beside the artifact is still refused, and the form's printed next-step names the two fields a caller must pass. Every existing test used a policy with strict closure off, which is why the suite did not catch it; three tests now pin the shipped-policy path.
- **Fixed: the packager validated a file it never shipped.** `.githooks/pre-commit` was listed in `FrameworkManifest.json` and checked as present by `package-agent.ps1`, and no staging rule carried it, so the portable control never reached the package. A test now asserts every managed path lands under a root the packager stages, so the next new root cannot be validated and forgotten.
- **`docs/core/CapabilityDemonstrations.md` and two runnable drivers** (`scripts/demonstrations/install-walk.mjs`, `scripts/demonstrations/gated-walk.mjs`). The walk drives the real CLI in a throwaway repository: it shows each boundary refusing and naming its gates, satisfies each gate through its documented route (the project's own command, a checked artifact, or a named human record), and shows the boundary open — including the design-review gate, red-before-green on `testsPassed`, the four automated routes, and the acceptance recorded from the generated form. It also demonstrates the refusals that make the gates worth having: by-hand `testsPassed`, a project command on a judgement gate, `true` as a test run, an incomplete design review, a violated architecture constraint, and an undeclared reachability claim. Both drivers exit non-zero on any failed expectation. The page records each claim with its command and observed result, and states the limitations plainly — including that the design-review gate covers `architectureComplete -> story-breakdown` while the legal `spikes` detour is ungated, and that `state.epics` has no writer.


- **Host interception is measured per action, not inferred from a file.** `harness capabilities` read `Copilot hook: installed` from `existsSync('.github/hooks/git-guard.json')` — a file the framework itself ships — so the claim was true in every consumer repository, for every host, whether or not the host ever consulted the hook. A claim that cannot be false is not a measurement. There is now a host registry (`src/harness/hosts.mjs`) declaring, for each of the seven supported hosts and each of the six contract actions (`git-write`, `shell-command`, `filesystem-write`, `unity-mutation`, `context-load`, `harness-routing`), a level — `native`, `external` or `advisory` — and whether it was established by a **probe** or by a **declaration**. `harness capabilities --verify-host` runs the probes: the host hook is fed a synthetic git write and a read-only command and must answer `ask` and nothing respectively, and a configured hook that does not decide drops the action it covered to `advisory` with the reason attached; the repository Git hook is checked for presence, for `core.hooksPath` actually pointing at it, and for correctness (accept a valid state document, refuse an unreadable one) in a scratch directory of its own. The old per-repository boolean is gone. New: `.githooks/pre-commit`, the portable control that protects a commit for every client including the ones with no interception API — it validates `.cadet/state.json` (full `state validate` with the CLI, a JSON parse without it), deliberately does not run the test suite and deliberately does not refuse a commit for unmet gates, since the gate system refuses the transition and a hook that blocked work in progress would be turned off within a week. The framework does not install it — `git config core.hooksPath .githooks` changes the repository owner's configuration. `docs/core/HostInterception.md` publishes the matrix, the probes, the client policies for hosts with no interception API, and what cannot be intercepted at all; `README.md`'s cross-IDE table now separates skill parity (real) from enforcement parity (measured, and not equal). See `docs/core/HarnessContract.md` C19.


- **The runtime context protocol: plan, record, validate.** `ContextManifest` existed and nothing in production built one — it was imported only by a re-export and the tests — so "the agent read the skill file" was an assertion no part of the framework could check. Three commands close that. `harness context plan` writes what the phase requires, derived from state and the framework's own layout rather than a new policy key: tier 0, the runtime contract, the skill the phase dispatches (a table that mirrors the Skill Inventory, with a test that every phase maps to a file that exists), the active story and its epic — each with a tier, an authority, a reason, a content hash and its budget effect, and `budget.fits` to say whether the required set fits the declared context budget. A plan is a reading rather than a load, so it deliberately lifts the load bounds and reports against them instead of throwing. `harness context record` writes what the host actually loaded, hashed at record time (which is what makes a later edit detectable), with a level it can honestly claim: `enforced` is refused unless `--enforced-by` names an existing hook **that declares `"enforces": ["context"]`** — so a host with no hook cannot claim enforcement, and the repository's existing git-guard cannot be borrowed as one — while `recorded`, `estimated` and `unavailable` are always permitted and carry their own meaning. `--transcript` takes the loads from a host's own log, which is how a host without automation is still checked. `harness context validate` is read-only and answers the only question that matters: may a context-complete checkpoint be claimed? It fails on a required reference never loaded, one whose hash changed after the record (changed-file invalidation), a record taken before the current work item (work-item invalidation), or a level that observed nothing — `estimated` and `unavailable` cannot certify, because "not verified" and "verified clean" must not look the same. Advisory context is reported and never blocks. `harness report` carries the level as recorded and never upgrades it. Both files are preserved paths. Per-phase adapters were left as pointers: the protocol is stated once in `Harness.md` §2d, `KickoffFlow.md` and the dispatch rules, and the adapter size guard rejects the restatement. See `docs/core/HarnessContract.md` C18.


- **Architecture fitness: a project's executable constraints, run as a gate.** `architectureFitnessPassed` is appended to `GATES` and required on `implementation -> review` — but only when the project enables the block *and* declares at least one check, so a repository that declares nothing keeps the frozen transition lists exactly as the contract states them. The checks live in `.cadet/harness.json`: a stable id, a command, the repository-relative scopes it governs, a severity, a timeout, design or ADR references, and optionally an artifact it must write and the format to read it as. `harness verify-architecture` runs the checks that govern the changed files and accepts **no `--command`** — a gate whose command is chosen at the call site proves nothing about the repository, because the caller picks both the question and the answer. Three outcomes, and the difference between the last two is the point: `failed` (the check ran and reported a violation), `blocked` (it timed out, never launched, or declared an artifact it did not write — so nothing was disproved, it is not a red, and its remedy is a `tooling-gap` exception rather than a hand record), and `passed`. An `advisory` check never blocks but is always recorded. The record carries one entry per check, so a claim that "the constraints hold" names which checks proved it, and the declared artifacts are bound by path and hash without being folded into `inputTreeHash`. It proves executable constraints only — design quality stays with `designReviewCompleted`, and the two are separate so neither borrows the other's credibility. Under strict closure the gate is re-examined at `validation -> closed`, because a later story can break a dependency an earlier one satisfied, and it joins the `disallowManualFor` default list for the same reason the mechanical gates do: the project declared the check that proves it, so a hand record would substitute for something available. Samples for a C# dependency-direction check and a forbidden `UnityEditor` reference are in `docs/core/ArchitectureFitness.md`. See `docs/core/HarnessContract.md` C17.


- **Human acceptance is now a gate: `humanAcceptanceConfirmed`, owned by a person.** It answers the one question no test can — did a person accept what was built — and nothing automated can stand in for them: `harness verify` refuses the gate and `--command` is refused for it, so passing tests cannot satisfy it. It is required on `validation -> closed` only, resolved at evaluation time under the opt-in `humanAcceptance.enabled` (the shipped policy file sets it true for a new consumer), and **never** on `validation -> implementation`, so the next-story loop stays unblocked; with the flag off, closure behaves exactly as before. Capturing it is two commands and no retyping: `harness acceptance-form --epic <id>` writes a form pre-filled from state (the epic, its stories and their statuses, the revision and editor version, the files it covers, and what the record says is still outstanding), leaving blank only the three fields a person must answer — accepted by, witness, accepted limitations — and printing the exact command that records it. `harness confirm --gate humanAcceptanceConfirmed --artifact <the form>` then reads that file, binds the files it names, and records the gate; the witness and limitations are required at creation by the CLI and again by state validation, because a hand-edited record is exactly what this gate must not be satisfiable by. A form still holding a placeholder is refused, a form is never overwritten once someone has started it, and the form generation writes no state. There is no flag route: `--witness` and `--limitations` were dropped after the form shipped, because two routes to one gate means the weaker route defines the gate, and the flag route's only advantage was skipping the file — at the cost of an acceptance no person can open later. Mixing `--scope` or `--environment` with `--artifact` is refused, so the record never has two competing sources. The shape lives in `templates/HumanAcceptanceTemplate.md`, which the generator reads, so the shipped template and the generated form cannot drift into two formats. An acceptance with no witness is a signature on nothing, and a limitation nobody wrote down is discovered later by surprise. Work a user cannot reach or observe takes the new `non-user-facing` exception category instead, which carries no expiry — it states a property of the work item, not a gap in the evidence — and which requires a closure review note naming who judged it and what would change that judgement. `acceptanceCriteriaValidated` keeps its meaning as test evidence and is not reused for this. Two supporting changes: `AGENT_OWNED_GATES` is renamed `MANUAL_ONLY_GATES` and now holds the human gate as well, because the list means "gates with no automated builder" — the fact that makes forbidding manual confirmation unsatisfiable rather than stricter — and the registry's ownership classes now distinguish `human` from `agent`, which the name had been conflating. See `docs/core/HarnessContract.md` C16.

- **A formal design review is now a gate: `designReviewCompleted`.** A review that runs after the work items exist can only rank work that is going to happen anyway, so the new gate sits on the one edge where it still changes the outcome: `architectureComplete -> story-breakdown`. It is required only when `.cadet/harness.json` sets `designReview.enabled` (the shipped policy file turns it on for a new consumer, so a new project's first story breakdown follows a review), and it is placed by a conditional append rather than a transitions-table entry, because `requiredGates` resolves by target phase and `story-breakdown` is also reached from `spikes` — an entry in the table would have gated the spike route too. The `DesignReview` skill challenges requirements traceability, unverified assumptions, unnecessary architecture, reachability and verification plans, and records findings with dispositions. The evidence comes from `cadet-agent harness verify-design-review --artifact <path> --files <design,requirements,ADRs>`, which checks that the artifact names its reviewer and inputs, that every finding carries a known disposition, that `accepted` and `deferred` findings name where they land, and that every contested finding names the person who resolved it — an unresolved contested decision blocks the gate, which is what the review is for. The artifact and its inputs are bound to the record, so editing the design stales the review. A human reviewer may also record the gate directly (`harness confirm --gate designReviewCompleted`), because a review is a judgement and the framework does not force a judgement onto an agent; the command is the stronger route, not the only one. Read-only discovery of the change is unchanged: with the flag off the command reports and writes nothing, and the edge behaves exactly as it did before. New in the package: `skills/DesignReview.md`, `templates/DesignReviewTemplate.md`, and the five adapter files.

- **A new Unity consumer gets the reachability gate on.** The package cannot know at build time whether a consumer is Unity, so the shipped policy file declares `reachability.enabled: false`; installation now detects the project and turns that block on for a new Unity consumer. Detection is conservative and offline: `ProjectSettings/ProjectVersion.txt` is authoritative, and `Assets/` together with `Packages/manifest.json` is accepted only when it is absent. Three properties are asserted by tests: a non-Unity repository is left exactly as seeded (the gate would ask for declarations where no user-facing runtime exists), a consumer that already owns `.cadet/harness.json` is never touched, and the edit either lands whole or the file is left byte-identical with a stated reason. `command` stays `null`, so the check is a declaration and the record says `no project probe configured` rather than implying proof; a project that configures a probe gets `project probe exit <n>` in the record instead. This is the initialization half of the reachability default; the audit re-measurement that preceded it found all eleven of its findings already closed, so no repair shipped with it.

- **The default `disallowManualFor` list now names `acceptanceCriteriaValidated` too.** One list, three gates: `testsPassed`, `acceptanceCriteriaValidated` and `reachabilityAddressed`. Each of the three can prove itself mechanically in every environment Cadet supports, so a `manual-confirmation` for one is always a substitute for something available; `harness verify-acs` derives the test inventory from the run report, which is what gives the AC gate its meaning. `compileCheckConfirmed`, `unityAnalyzerClean` and `storyTrackingUpdated` stay out of the list on purpose — their automated path can be absent (no Unity CLI, no project script), so forbidding manual confirmation would leave them unsatisfiable rather than stricter. The schema default, the compiled fallback, the shipped policy file and `Harness.md` now name the same three gates.

- **`.cadet/harness.json` ships as a create-only seed, carrying the new-consumer defaults.** Init and sync write the framework's own policy file when a consumer has none, and never overwrite one that exists, so a new consumer starts from a declared policy rather than an unwritten compiled default. It moves from `preservedPaths` to `managedPaths` + `createOnlyPaths`: a preserved path is skipped at extraction and would never be created. The seed declares strict closure ON — fresh revalidation at closure, reason/scope/environment/expiry required on manual evidence, a 24-hour manual validity, and manual confirmation prohibited for `testsPassed`, `acceptanceCriteriaValidated` and `reachabilityAddressed` — and the recency rule `requireFreshRevalidation` OFF, so a gate whose bound files are unchanged carries across a transition instead of being re-recorded at every one. (`revalidateOnClosure` stays on: a gate whose files DID change is still refused, which is the property the recency rule was buying at the price of a forced re-run per transition. A consumer that wants the literal re-run sets the key to `true` in its own file.) — plus a `reachability` block that stays off until the Unity detection in the reachability phase turns it on. Two consequences: a consumer that already owns `.cadet/harness.json` keeps its own values byte-for-byte (the seed cannot reach it), and a consumer with no policy file receives these defaults at its next sync. No read-only `sync --recommend-policy-migration` report is built: the framework has one known consumer and it owns a file, so the report would carry a single caller.

## [0.55.0] — 2026-09-29

### Changed

- **The Response Contract is one line: `cadet-agent: ok`, or the problem in its place.** It replaces the six-field status table shipped in 0.52.0 (`Item`, `Phase`, `Gates open`, `Blocking`, `You owe`, `Next`). The table obeyed the contract's own rule — *no line that cannot change a decision the reader is making* — for two of its six fields: `Item` and `Phase` change about once per story, `Gates open` is a progress bar for the framework rather than for the work, and `Next` restates the prose that follows it. So the contract printed six lines on every reply to fund the rare turn where one of them mattered. Deleted with the table: the `Tier/mode` line on a session's first reply, and the "keep the same fields, in the same order, as labelled lines" clause, which existed only to render the table. **The reply now carries the work, and `cadet-agent.md` states what each stage must carry** — planning stages carry the decisions taken, the alternatives rejected and why, the questions that need the owner, and what the plan now says; build stages carry what changed and why, what the checks show, and what is unverified or deferred. `docs/coverage-report.md` records where each retired row went. Unchanged: the hard-gate rule (a failing gate is still stated and still blocks), the nine gates, evidence immutability, red-before-green, the reachability gate and the human commit gate.

- **New read-only command: `cadet-agent harness status`.** It derives the health line instead of asserting it, composing checks that already exist — `validateState` (schema, freshness, expiry) and the run ledger — so the framework's only per-reply output is evidence rather than a claim. `cadet-agent: ok` means the record is readable, valid and fresh and no recorded run stopped on a budget or failed to run. **A gate unmet because the work is unfinished is not a problem**: the four implementation gates are unmet for most of every story, so the line reports only what is wrong — a missing record in a consumer repository, an unreadable or invalid record, or a last run whose status is `exhausted` or `blocked`. A `failed` run is a RED and is never a problem, because that is how TDD works. `--format json` carries the problems, each with what it blocks and what resolves it; the exit code carries the same verdict as the line. Declared `mutates: false`, so the registry guard asserts it writes nothing under any flag.

## [0.54.0] — 2026-09-28

### Changed

- **Every reply now uses Simplified Technical English (ASD-STE100).** The Response Contract bounded what a reply says. It said nothing about how the reply reads, so a compliant reply could still be one long, nominalised sentence that a reader must decode twice. The contract now requires one idea per sentence, the active voice, a verb rather than a noun ("we decided", not "a decision was made"), one word for one meaning — write `format`, not "shape", when you mean a format — and exact technical names for record ids, file paths, commands and code. It also gives the sentence length: 20 words or less for a procedure sentence, 25 or less for a description sentence. The language deletes no fact; it makes the fact shorter, and a cause that matters gets its own sentence. A skill whose reply must carry content, such as `PlanningReview`'s questions, keeps it: the language shortens the content, it does not remove it.

## [0.53.0] — 2026-09-28

### Fixed

- **`verify-acs` and `verify-reachability` accepted `--commit` and silently dropped it, so two of the gates the citation policy covers could never carry a citation.** The CLI parses `--commit` for every command (`src/cli.mjs`), but only the `harness verify` and `harness confirm` builders ever put it on a record: the `acceptanceCriteriaValidated` and `reachabilityAddressed` builders constructed their evidence with no `commit` field at all. So `policies/gate-commit-citation.md` — *"every gate record must cite the revision it attests"* — was **unsatisfiable by construction** for those two gates: a repository that re-recorded them to add the citation got a fresh record that still read `commit: null`, with the flag eaten silently and the command exiting 0, which reads as success. Both builders now pass the value through `createEvidence`, which normalizes it and refuses a branch or tag name for the same reason `verify`/`confirm` do — those move, so a citation naming one cannot be checked later.
  - **Found in the field, not by a test:** no test in the suite had ever passed `--commit`, which is how the flag stayed dropped since AR-1 introduced it. `test/harness-verify-acs.test.mjs` and `test/harness-reachability.test.mjs` gain the first three each — the revision is recorded on the evidence and the record still passes `state validate`; the citation stays `null` when none is passed, because uncommitted work may leave it null; and `--commit main` exits 1, names the 4–40 character hex rule, and **writes no record at all** rather than storing a revision it cannot check.

## [0.52.0] — 2026-09-28

### Changed

- **The required response format is the status block, and `FirstResponseFormat.md` is retired.** That file carried a required format — `cadet-agent.md` called it "Required response structure" — that no session produced, no skill read and nothing enforced. Two of its three lines restated context the reader already had: the objective paragraph paraphrased the work item under work, and the policy line asserted a fact about the repository that cannot change a decision (a repository with several topic-named policy files has no single policy to name, and the convention that defines one — `{RepoName}Policy.md`, exactly one file — is not what repositories hold). Replies now open with the status block — `Item`, `Phase`, `Gates open`, `Blocking`, `You owe`, `Next`, unmet and actionable rows only — followed by one line per change saying what changed and why, with evidence record ids inline: the Change Report at reply scale, without headings, AC tables, or a restatement of the story. Learner tier and operating mode survive as a `Tier/mode` line on a session's **first** reply, and a policy is named only when it decided a change. Resolving the active policy stays mandatory; asserting it every reply is not. On a client that cannot render a table the fields are kept, in order, as labelled lines.
  - **What this does not touch:** no gate, no transition edge, no command, no state shape and no schema changes — output only. `docs/coverage-report.md` records where each retired instruction went, including the one deliberately dropped.

## [0.51.0] — 2026-09-28

### Added

- **`state begin` now records the story it finished — the boundary, as a record.** There is no story-level terminal transition: `closed` means the *epic* is finished, so a story completing while its epic is still open had no vocabulary at all, and every boundary ended in a judgement call about which edge was legal — a call with no correct answer, because none of the edges means "this story is finished". A session spent a full decision cycle on it and closed nothing. The boundary now names the outcome: `state.json` gains `storyCompletions`, one bounded row per work item the session moved on from — `{ workItemId, completedAt, evidenceRecords }`. It records what *happened* (the session moved on from this item) rather than a verdict, and `evidenceRecords` makes a completion with nothing behind it visible instead of implied. Non-terminal and additive: **no transition edge, no gate, nothing that can block**, and `closed` keeps its epic meaning. Re-beginning a work item replaces its row rather than appending, so the array stays bounded the way the rest of this version is. `state validate` rejects a malformed marker, and `state begin` reports the completion on both the human and JSON paths. **Docs corrected with it:** `Workflow.md` still told agents to "set `activeWorkItem` to the next story" by hand — the same defect `0.49.0` fixed in `Resume` — and now states the rule plainly: `closed` is epic-level, a finished story is expressed by the boundary, and no story-level terminal transition is needed.
  - **Test coverage:** `test/harness-state-begin.test.mjs` — the outgoing work item is recorded with its timestamp and evidence count, on the JSON and human paths; one row per work item, replaced rather than accumulated across two boundaries; no row when nothing was active; the produced document still validates, and a malformed marker is an error.

### Changed

- **The `designArtifactSyncConfirmed` claim condition is now "no unexcused blocking finding", not "verdict `consistent`".** `skills/Reconciliation.md` and both reconciliation templates allowed the gate to be claimed only from a `consistent` verdict — but that verdict folds **warnings** into inconsistency, so a repository with one permanently expected warning could never claim the gate again, however much it fixed. The condition was unreachable by construction, and the only route left was a `harness confirm` manual confirmation restating the same adverse fact at every closure: a ritual, not evidence, and the single largest recurring cost in the audited session. The rule now matches what the gate means — the chain's *record* can be trusted — rather than what the command can certify: claimable when no unexcused blocking finding remains and the semantic pass is clean, with the blocking count stated and the honoured (`excused-gap`) rows named in the statement. `unknown` still never certifies, and an advisory `warning` never blocks: a warning is an inconsistency that would mislead a reader, not a record that cannot be trusted. Both templates now also require the verdict to be stated in words when it is `findings` with no blocking rows, because `findings` alone does not tell a reader whether the chain is untrustworthy or merely imperfect.

### Fixed

- **The reconciler reported the framework's own recorded decisions as blocking.** `done-without-evidence` was decided from `state.evidenceCoverage` alone and never consulted `gateExceptions`, contradicting this module's own header — *"an accepted historical gap is a recorded gate-exception, not silence."* On the audited consumer that made **8 of 8 blocking findings permanent**: every run re-reported eight stories whose evidence gap had been reviewed, categorised and accepted on 2026-09-15, so the blocking section of every report was 100% rows nobody could act on, and each run cost a fresh human triage of the same eight. The finding is now **excused rather than silenced** — the gap is still reported, as `info`, naming the exception's gate, category, date and rationale. The match is the one a transition already uses: `state.mjs` gains `activeExceptionEntries`, which `activeExceptions` is now a projection of, so the reconciler and the transition table cannot disagree about what is excused. An exception naming a different work item, or one that has expired, excuses nothing.
  - **Field-verified against the real consumer:** 28 findings, **blocking 8 → 0**, with the eight rows present as `info` naming `storyTrackingUpdated` / `pre-harness-story` / 2026-09-15 and quoting the recorded rationale. The total is unchanged at 28 — nothing was dropped, only re-labelled.
  - **Test coverage:** `test/harness-reconcile.test.mjs` — the excused gap is reported as `info` with the exception named and the summary carries no blocking rows; an exception naming another work item still blocks; an expired exception still blocks; an exception kept in `changeHistory` (the v1–v3 home) is honoured too.

- **`harness reconcile --story` could not scope, and manufactured its own blocking findings.** The scope was derived as the *parent directory* of whatever path it was given, so an epic **directory** resolved to `"epics"` — a key matching no epic — and an epic path therefore scoped nothing while reporting everything. A story path scoped the disk set correctly, but the state↔disk loop still iterated **every** epic in `state.json` and emitted `missing-epic-dir` (blocking) for each one absent from the now-scoped set. Measured on the consumer: **12–13 false blocking findings** about epics the run was never asked about, which also made `consistent` unreachable for any scoped run by construction. The scope is now resolved from what a caller actually has to hand — a story path, an epic directory, an epic key, or `epic.md` — and applied to both directions of the comparison.
  - **A scope that names nothing is refused** rather than silently answered with a different epic set: `reconcileArtifacts` returns `ok: false` listing the known epics, and the CLI exits 2 like every other bad argument. An epic tracked in `state.json` with no directory is *not* a refusal — that is the `missing-epic-dir` finding, which is the point of asking.
  - **Field-verified against the real consumer:** a run scoped to the epic under work reports 1 epic, 6 stories, **verdict `consistent`** and 0 blocking — previously 12–13 blocking rows about other epics.
  - **Test coverage:** `test/harness-reconcile.test.mjs` — a scoped run does not report unscoped epics as missing (the unscoped run still reports exactly two); a directory, a key and an `epic.md` path all scope to the same epic; a scoped epic tracked in state but absent from disk still yields `missing-epic-dir`; a scope naming no epic refuses with the known epics listed and exits 2.

- **The reconcile test fixture silently dropped state fields it did not recognise.** `stateDoc` destructured four keys and discarded the rest, so a fixture that set `gateExceptions` was reconciling a state document in which the exception did not exist — three new tests passed without testing anything until the positive case caught it. Unknown keys now pass through.

## [0.50.0] — 2026-09-27

### Added

- **Hermes Agent as a sixth supported IDE.** [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) (Nous Research's open-source agent CLI) discovers project skills in `.agents/skills/` — the same cross-client root Deep Code uses — so the existing adapters are shared, not duplicated: no new adapter files and no `.hermes/` directory in consumer installs. `FrameworkManifest.json` adds `hermes` to `supportedIDEs`; `test/adapters.test.mjs` registers a `hermes` entry with a drift guard that keeps its skill maps in lockstep with Deep Code's and asserts no `.hermes/` directory ships; the installer prints Hermes next steps (`hermes skills trust` to enable project skills, command approval policies as the git-guard substitute); `package-agent.ps1` comments name both clients on the shared root. The shared base adapter's Git Guard section is now client-neutral (Deep Code permissions vs Hermes approval policies). New docs: `docs/guidance/Hermes.md` (discovery, trust, invocation, approval policies, MCP, configuration) and `.cadet/agent/docs/hermes.md` (per-IDE setup guide); `README.md` gains the sixth parity column and a Hermes verification request; `ADAPTERS.md` rows note the shared registration.

## [0.49.0] — 2026-09-26

### Fixed

- **`state.json` had no bound inside a single work item, and the story boundary never touched evidence.** Contract v5 scopes `gateEvidence` to the active work item, but nothing pruned *within* one — and the boundary itself was a hand-edit. `Resume` said "set `activeWorkItem`, reset gates", a sentence that never mentions evidence, while `resetGatesForNewWorkItem` — the function that clears it correctly — had no caller anywhere in `src/`. Nothing surfaced the result, because `state validate` only ever asked whether a claimed-true gate's *own* record was bound to the active item, never whether foreign records were sitting in the array. Measured on the audited repository: **7,986 lines**, of which `gateEvidence` was 6,495 (81%) holding **135 records — 115 `superseded`, 63 of them a closed work item's, 9 live**. Two fixes: `state compact` now applies a within-work-item retention rule as well as the cross-work-item one — it keeps the newest record per gate, every `passed`/`manual-confirmation` record, and every `failed` record (red-before-green reads the prior red), archives the rest to `.cadet/archive/`, and reports the counts, with `--retain-all` to opt out — and `state validate` now **warns** when `gateEvidence` holds records for another work item, or more than 60 records, naming the work items and pointing at the command.
  - **Warnings, not errors, and deliberately so.** A foreign record is rejected by `evidenceFreshness` and cannot satisfy any gate, so this is hygiene rather than a safety violation; and an error would invalidate every existing document on upgrade for a condition no reader can repair in place. Only v4 documents are scoped this way — a v1–v3 document keeps every record inline by design.
  - **Test coverage:** `test/harness-state-v4.test.mjs` gains the retained-set cases (newest-per-gate survives; `passed`/`manual-confirmation`/`failed` survive; a non-newest `superseded` record is archived; `--retain-all` keeps everything; red-before-green is still satisfiable after compaction) and the warning cases (foreign records warn and name the work items; an over-long array warns; a clean v4 document warns about neither; a v3 document is never scoped).

### Added

- **`state begin --epic <epicId> --story <storyFile>` — the story boundary, as a command.** Starting the next story was a sentence in `Resume` carried out by hand-editing `state.json`, which is why the previous story's evidence stayed inline for ever. `resetGatesForNewWorkItem` already did the job correctly — cleared the evidence, folded it into the coverage index first, dropped expired exceptions, wrote one boundary line — and was unreachable. It now has a door: `state begin` resets every gate, **archives the outgoing records before the document is written** (nothing leaves `state.json` without being written down first, the same ordering `compact` uses), folds them into `evidenceCoverage`, and refuses a target that is already the active work item or a session that is `closed`. The documented cause was updated with it: `Resume` now says to run `state begin`, and says explicitly not to set `activeWorkItem` by hand.
  - **Test coverage:** `test/harness-state-begin.test.mjs` — gate reset, the outgoing records archived with the document written only afterwards, coverage folded, the already-active and `closed` refusals, and the registry declaring it mutating so C13's write guard covers it.

## [0.48.0] — 2026-09-26

### Fixed

- **Re-running the tests no longer invalidates the AC-coverage record those tests produced.** `harness verify-acs` bound the test report it had read into its evidence `inputTreeHash` *and* `relevantFiles`. A repository whose test script rewrites a fixed report path (a `test-results-junit.xml` and friends) therefore staled `acceptanceCriteriaValidated` the moment it re-ran the tests — the evidence was invalidated by the very command that produced its inventory, and it broke `review → validation` at every closure. A report is an *output* of the run, not an input, so it is now kept as `artifactPath` for audit and is deliberately **not** a relevant file. The record binds the story — recorded repo-relative, so the freshness re-derivation at transition time resolves it under the root instead of silently hashing a missing file and matching itself — and the declared test names, which already participate in `criteriaHash`. This is the same class Harness §5 already excludes for `.cadet/state.json` and `.cadet/runs/**`: "binding evidence to either would make a gate stale the instant it was written".
  - **Test coverage:** a regression test in `test/harness-verify-acs.test.mjs` rewrites the report and proves the input tree is unchanged, proves an edit to the story still invalidates it, proves the recorded hash re-derives from the recorded files (a live binding, not an inert one), and re-runs `state validate` over the produced document. **Field-verified against a real project:** the pristine build records `relevantFiles` as `[<story>, "test-results-junit.xml"]` and `state validate` then fails with *"backed by stale evidence: the input tree hash no longer matches the current files"* once the report is rewritten; the patched build records the story alone, keeps the report as `artifactPath`, and stays valid across the same rewrite.

- **Strict-closure revalidation no longer demands a gate be re-recorded because of its phase.** Under `strictClosure.enabled` a transition re-derives the gates satisfied in earlier phases — but the freshness check also required the record's `phase` to equal the phase being left, so an implementation gate failed re-derivation at `review` and failed it again at `validation`. Revalidation now asks the question it means to ask — *is this gate still true now?* — which the input-tree hash, the criteria hash, and the expiry answer, rather than "which phase wrote the record down?", which is the one fact revalidation is not doubting. A transition's own `gates` remain phase-scoped, so a record still has to be written in the phase it belongs to.
  - **This removes one forcing rule, not both — and the docs now say so.** `requireFreshRevalidation` (default on) independently requires a record *newer than the last transition*, so a repository that leaves it on still re-runs a gate at every transition. The phase stamp alone never does. A repository that wants an unchanged tree to carry a gate across a transition sets the knob to `false`; nothing else needs to change. The earlier draft of this entry claimed the re-runs were gone outright; a field test on real data disproved that, and the wording was corrected rather than the finding.
  - **Field-verified against a real 135-record project** (`strictClosure` on, `requireFreshRevalidation` on, `reachability` on). With the knob left `true`, the patched tool refuses all seven revalidated gates on recency alone — every phase reason is gone, and the refusal is now attributable to exactly one rule. With it `false`, six of the seven are carried across the transition from the phase they were written in, and the single remaining refusal names a genuinely changed input tree. The same run measured the cost this addresses: that project's `state.json` holds **26 `testsPassed` records** — `implementation/failed×9, implementation/superseded×10, review/superseded×4, validation/superseded×2, validation/passed×1` — and the same shape for `compileCheckConfirmed`, `unityAnalyzerClean` and `storyTrackingUpdated`.
  - **Test coverage:** `test/harness-strict-closure.test.mjs` accepts closure from a mix of `implementation`/`review`/`validation` records over an unchanged tree, accepts the same with `requireFreshRevalidation: false`, still refuses that same state when the recency floor applies, still rejects a revalidated gate whose input tree moved, and still rejects a *primary* gate recorded in the wrong phase.

### Added

- **`--expect-phase <phase>` — a gate can no longer be recorded into a phase the caller did not intend.** `state transition` already refuses with `allowed: false` and exit 1; the failure this closes is a caller that does not read that signal. Chained with `;` and piped through a filter, the next command's success reads as the transition's, and the following gates get recorded into the phase that was never left — the verdict was correct and ignored, and the record was written anyway. The flag is accepted by every command that records gate evidence (`harness verify`, `harness confirm`, `harness verify-acs`, `harness verify-reachability`) and refuses *before* any write when the current phase is not the expected one, or when the value names no known phase. It is opt-in, so omitting it changes nothing, and a mismatch writes nothing at all.
  - **Test coverage:** `test/harness-expect-phase.test.mjs` — a mismatch refuses in all four commands and leaves state byte-identical with no ledger written, the matching phase lets the command through, the guard is inert when omitted, and an unknown phase is a usage error.

## [0.47.0] — 2026-09-26

### Added

- **`/cadet-reconcile` — does the planning chain still agree with itself?** Every per-story check can pass while the chain as a whole stops making sense: a story is renamed and its neighbours still point at the old file, a story is marked done in state while its markdown says planned, a deferral names a work item that finished three stories ago, an epic directory exists that no plan mentions. Each is a claim in one artifact that another artifact contradicts, and nothing looked at more than one document at a time.
  - **It gives `designArtifactSyncConfirmed` its first real check.** That gate — "Requirements, design, plan, epics mutually consistent" — is the *only* gate on `validation → closed`, and before this nothing in `src/` could back it: the name appeared only in `policy.mjs`'s gate list and transition matrix, and `UnityCli.md` lists it as "Non-automated (agent-owned)". It was satisfied by assertion.
  - **The mechanical half is a read-only command, `cadet-agent harness reconcile`.** It reads the planning tree and reports what it can *prove*: a missing required document, an epic or story state tracks with no file (or a file state does not track), a story's markdown status disagreeing with `state.json`, a story whose `Parent Epic` does not resolve, an epic whose `Requirements`/`Technical Design` link is dangling, an epic with no stories, a missing witness checkpoint, a deferral whose target is already done, and a story marked done with no evidence indexed against it. Registered in the command registry, so C13's write guard covers it; `--plans-dir` exists because a repository policy may relocate the artifacts and the policy file is not machine-readable.
  - **The honesty rule is enforced, not encouraged.** `verdict` is `unknown` whenever any artifact or required field could not be read, because a clean verdict must never be reachable from input the command could not parse. Only blocking and warning findings make a chain inconsistent — an advisory finding cannot, or no project could ever be called consistent.
  - **The judgement half is the skill, and it is kept visibly separate.** `Reconciliation.md` runs the command, copies its findings verbatim as the floor of the report, then reads the chain and reports what no tool can see: contradictory requirements, a design decision no story honours, an epic solving a different problem than the design intended, a requirement area with no epic, an epic's hand-written story list that has gone stale. Every judgement quotes its artifact. The two passes never merge into one table, because a judgement dressed as a measurement is worse than no finding — a reader cannot tell which rows to check. This split is the whole design: a prose-only "check the artifacts agree" skill would be the shape `docs/core/HarnessContract-v4.md` §0.1 already names as *"an assertion by the author that is never mechanically verified"*.
  - **It reports; it never repairs.** The skill proposes the exact edit per finding and asks for approval. An agent that rewrites the technical design to match the stories destroys the original intent the reconciliation exists to protect — and loses the record of the drift, which is the finding. The report goes to `.cadet/reports/<YYYY-MM-DD>-reconciliation.md`, and the gate is backed only when the command verdict is `consistent` *and* the semantic pass found nothing blocking.
  - **Validated against a real 88-story project, which is where the first version was wrong.** Run against `dolven-tactics`, the initial implementation reported 15 blocking findings for epics that existed one directory deeper (`<project>/epics/epic-N/`), two more for documents that existed under other names (`mvp-requirements.md`), and ~120 warnings for fields that predated the templates. A check that fires on a correct project is worse than no check — it teaches the reader to ignore the output — so discovery is now by content and not by path (an epic is any directory containing `epic.md`; a required document is matched by filename pattern anywhere under the plans directory), and gaps are reported for work that is still **open**: a reachability declaration is owed by a story in flight, a witness checkpoint by an epic that is not closed, and a `done` story's evidence always, because a completion claim must be traceable whenever it was made and the framework's answer to an accepted historical gap is a recorded gate-exception, not silence. On the same run: 38 findings, of which 8 blocking are real — the eight earliest stories are marked done with no evidence indexed against them, and no exception records that as accepted.
  - **Two framework bugs came out of that run.** `StoryTemplate.md` wrote `Parent Epic: ../epic.md`, which resolves to a file that does not exist in the documented layout where a story sits *beside* its `epic.md` — all 88 stories in that project carry the unresolvable value, and the template now writes `epic.md` instead. The reconciler accepts both forms so it does not cry wolf over the existing ones, while still reporting a genuinely wrong filename. Separately, an epic's `Requirements`/`Technical Design` field holding several links separated by `·` with parenthetical notes was parsed as a single path, so a working link was reported dangling; a link field is now satisfied when any candidate in it resolves.
  - **Read-only was proved, not asserted.** Two runs against that repository (human and `--format json`) left all 5,771 files byte-identical — same set, same sizes, same modification times, `.git` included.
  - **Test coverage:** `test/harness-reconcile.test.mjs` (38 tests) — one fixture per check code, the nested-and-renamed real-world layout, the legacy `../epic.md` tolerance, multi-link epic fields both ways, the open-work scoping in each direction, plus the self-deferral and unknown-target cases, order and id stability, `--story` scoping, `--plans-dir`, and a no-writes snapshot. `test/skills.test.mjs` pins the skill↔template wiring, the measured/judged split, the gate refusal, and a guard that fails if either report template regrows unmarked body text. `test/adapters.test.mjs` covers the five new adapters; the contract test matrix records the command.

- **Every story now ends with a Change Report: which files changed, why each one changed, and what proves it.** The end-of-story summary had no canonical shape, so the reader got a slightly different freeform account each time — a bullet list one run, prose the next, occasionally nothing — and had to diff the tree to answer the only question that matters. `.cadet/agent/core/templates/ChangeReportTemplate.md` fixes the shape: an intent paragraph, a per-file table, an acceptance-criterion mapping, a guided reading order, the gate evidence, a "not changed, and why" section, a bounded review-notes section, and an explicit statement of what the report cannot prove.
  - **The structure is fixed; only the prose adapts.** The table's columns never vary, which is what makes the report skimmable and consistent run to run. Depth is the one axis that moves: at tiers New/Guided the `why` column names the mechanism and defines jargon, at Independent/Advanced it states the constraint. A tier never changes a column or drops a row.
  - **One deliberate escape hatch, and it is bounded.** A story can surface something that fits no section — an incidental finding, a risk, a follow-up worth filing, a judgement call, an open question — and without a home it gets either smuggled into a table row or dropped. `Review notes` is that home. It is bounded rather than free-form: bullets, marked unverified when unverified, forbidden from restating a table or recording a file change or AC verdict, with anything about what the report proves pushed to `Limits`. That keeps the catch-all from quietly replacing the uniform shape that makes the report worth reading, and it is omissible — a padded notes section is one the reader learns to skip.
  - **The rows are measured, not remembered.** `cadet-agent harness changes` (new, read-only, registered in the command registry so C13's write guard covers it) emits the file list as JSON: repo-relative path, `A`/`M`/`D`/`R` status, added/deleted counts, and a markdown link computed relative to the report directory so it actually resolves. The agent supplies only what git cannot know — why each file had to change. A missing git reports `available: false` with a reason rather than an empty change set, because "cannot tell" and "nothing changed" must not look alike; the report then declares the limit instead of listing files from memory.
  - **It is produced by `CodeReview`, which is non-skippable.** `CodeReview.md` gains a `<documents>` reference to the template and a process step that writes `.cadet/reports/<YYYY-MM-DD>-<epic>-<story>.md`, so the report lands after every story rather than when someone remembers to ask. The filename follows the handoff convention — date-first so a plain `ls` is chronological, no colon, never overwriting an existing report. `.cadet/reports` is added to `preservedPaths`, so a framework sync cannot clobber a consumer's own change record.
  - **Test coverage:** `test/harness-changes.test.mjs` — status-column collapsing, untracked files reporting no line count rather than zero, staged/unstaged count merging, both rename spellings joining on the same path, binary files staying unknown, link depth for a nested report directory, stable path ordering, the `.cadet` bookkeeping filter, the range-diff path, both unavailability shapes, and an end-to-end run against a real temporary git repository that also proves the command writes nothing. `test/skills.test.mjs` pins the skill↔template wiring and the preserved path; `test/harness-command-registry.test.mjs` covers the new command's read-only declaration, and the contract test matrix records it.

## [0.46.0] — 2026-09-25

### Fixed

- **A command that never launched is no longer recorded as a red, closing a way to satisfy `testsPassed` without running a test.** `runCommand` spawns gate commands with `shell: true`, so on Windows the string is handed to `cmd.exe`, where a bare `bash` resolves by PATH — frequently to the Windows Subsystem for Linux stub at `C:\Windows\System32\bash.exe`, which exits non-zero without exec'ing a shell. The attempt was recorded `failed`, and `failed` is exactly the record `testsPassed` demands before it accepts a green, so the gate could be satisfied by a run in which nothing executed. Reproduced on Windows before the fix: `bash run-tests.sh` exited 127 in ~96 ms with `bash: run-tests.sh: No such file or directory`, and feeding that record to the loop as `priorEvidence` made a green `testsPassed` return `passed`.
  - **A launch failure is now `blocked`, never `failed`.** Detection uses shell- and launcher-level facts rather than guesswork: a spawn error, `cmd.exe`'s "is not recognized as an internal or external command", the WSL launcher's `execvpe(` failure or "has no installed distributions", and the POSIX exit codes 126/127 for "could not execute" / "command not found". The evidence status becomes `blocked` with stopReason `launch-failed` and a diagnostic naming the cause, so the record satisfies no gate and no red. It is not retried, because a missing interpreter does not appear on a second attempt.
  - **The interpreter is resolved before execution, so the reported case is refused rather than mis-recorded.** A command led by `bash`, `sh`, `dash`, `zsh`, or `ksh` is resolved on Windows through the existing `where`/`which` machinery (now exposed as `routing.whichAll`), rejecting the WSL shims by path and probing that a remaining candidate can execute. When every candidate is a stub the gate is blocked before anything runs, and the rejected path is named. The check is deliberately narrow — a POSIX interpreter leader, on Windows only — so `cmd` builtins and ordinary executables are never second-guessed, and the declared command is never rewritten: the declaration stays the auditable record.
  - **This is a gate-integrity fix, not a shell-safety one, and the same stub hazard had already been worked around once.** The `git-guard.sh` regression in 0.45.0 was the test suite picking up the same WSL stub; it was fixed there by probing candidates in order. The verification path was left trusting the exit code, which is where the forged red came from.
  - **Test coverage:** `test/harness-launch-failure.test.mjs` (27 tests) — every launch-failure shape, and every counter-case that must still read as a genuine failure (an assertion error, a plain non-zero test exit, a successful run); interpreter resolution in isolation, including the stub-only refusal and the "real candidate that cannot execute" refusal; the loop's status mapping and non-retry; and the integrity property itself, that a `blocked` launch failure can neither be a red drawn from state nor license a green in the same loop. `docs/guidance/HarnessTroubleshooting.md` gains a "Command never launched" section, and the rule is stated in `.cadet/agent/core/Harness.md` §4/§5 and in the harness contract §4/§5.

## [0.45.0] — 2026-09-25

### Added

- **Reachability is now a gate: delivered work must be reachable, or declare who will make it so (contract v6).** Every gate asked whether work was *correct*, *compiled*, *analysed*, *tracked* and *reviewed*. None asked whether a user or operator could actually get to it — so a project could pass every gate for sixteen stories in a row with almost nothing anyone could run, and each individual story looked green while it happened. The failure has a name in practice — **"tested but not reachable"** — and it had recurred across several epics of an audited consumer project: a loop with its FSM and conservation suite but nothing joining it to a scene; a production gate with both paths tested and no composition root; a visual registry that resolved correctly with no host to bind one; a UI action with its sink seam and no scene passing a sink; a death effect no view could observe because the entity was removed on the same tick. Each was found by a human reviewer noticing, each was filed Low or informational, and each was deferred to a later story — which is how the pattern compounds.
  - **The declaration.** A story states `Reachability: witnessed — <what a user or operator does, and what they see>`, or `Reachability: deferred to <work-item id> — <why>`. Required by `StoryTemplate.md`; silence is not reachability, exactly as an acceptance criterion declaring no test is not coverage. An unexplained deferral is refused, because an unexplained deferral is how a gap becomes permanent. `EpicTemplate.md` gains a required **Witness checkpoint** — an epic that only becomes reachable at its *last* story must say so in writing, with the reason — and `TechnicalDesignTemplate.md`'s rollout slot now asks for the witness checkpoint per slice and names the composition-root-last rollout as the shape it exists to reject.
  - **The gate is opt-in, deliberately.** `reachabilityAddressed` is appended to the frozen gate list (C3) and is required on `review -> validation` **only when** `.cadet/harness.json` sets `reachability.enabled: true`. Making it mandatory in the matrix would block every in-flight story in every consumer on a framework update — the one thing a compatibility-preserving change must not do — so it uses the same device as `strictClosure.enabled` and `allowEmptyFreshness`: default off is byte-identical to previous behaviour. With the switch off, `requiredGates(target)` returns exactly the list the matrix declares, so the existing single-argument call path and its tests are untouched. `KickoffFlow.md` now asks the question **once per run** and records the answer, so opting in is a choice rather than a discovery.
  - **The probe is the proof.** Cadet cannot know how a given repository wires its pieces together, so a `witnessed` declaration is a claim and not a proof. `reachability.command` in `.cadet/harness.json` is the repository's own probe; when configured, `harness verify-reachability` runs it and **its exit code is the verdict** — the same seam as `testCommand`/`compileCommand`/`analyzerCommand`, and what keeps the check from being a rubber stamp. Setting a command while the policy is disabled, or setting a blank one, is rejected as inert. With no probe configured the command says so plainly (`the declaration is checked, the wiring is not proven`) and the contract states the limitation rather than implying more.
  - **A deferral can become false, which is what stops the escape hatch becoming the norm.** A deferral naming a work item that does not exist fails (it never expires and never lands), and **a deferral whose target is already `done` fails** — the owner landed, so either the story is reachable now or the wiring was missed when the owner closed. Deferring to a **spike** is legitimate and accepted, because a spike is how an unverified assumption becomes a deliverable.
  - **A cycle of deferrals is a gap, not a plan.** `story-1 → story-2 → story-1` witnesses nothing; each item points at another to explain why it is not reachable. The cycle is reported once, naming the whole chain, and the deferral graph resolves the `epicKey::story.md` form and the bare file name to one node — without that, a real cycle written in the long form would go unreported.
  - **Severity is ownership, and that is the change that matters.** `CodeReview.md` now makes an **unowned** gap — a deliverable nothing can reach, with no recorded owner for wiring it — a **blocking** finding, where the historical treatment was Low/informational. An **owned**, tracked deferral is filed and does not block, so infrastructure work is not held up for being infrastructure.
  - **Sequencing, where the cause actually lives.** `Architecture.md` requires the rollout to name, per slice, what a user or operator does to see that slice — and states that "the composition root registers it" is part of the deliverable, not a later chore. `StoryBreakdown.md` carries the epic-level checkpoint and the per-story declaration into the harness contract. The Unity rules in `cadet-agent.md` state the instance directly: a runtime system that nothing registers is not reachable, and "it has tests" is not reachability. `Harness.md` gains the §5 verification-contract row, the §11 skill evidence, and the §12 command description.
  - **New command:** `harness verify-reachability --story <path>` (`src/harness/reachability.mjs`), registered in the command registry as mutating with its writes declared; it records `reachabilityAddressed` on success, and with the policy off it reports and writes nothing.
  - **Backward compatibility.** No existing gate changed meaning; the new one is an append. A state document written before v6 lacks the key, which is not an error (unknown keys warn; migration fills missing ones). Templates gain a required field, which is a template change only — existing artifacts are not retroactively invalidated, and a story is converted when it is implemented, the same migration policy the declared-test format uses. The `C3` invariant in `docs/core/HarnessContract.md` is updated in the same change that appends, with the append stated explicitly rather than left to be inferred from the enum.
  - **Test coverage:** `test/harness-reachability.test.mjs` (30 tests) — declaration parsing including the fenced-example case that must *not* be read as the story's own, the empty/unexplained/unrecognised forms, deferral validation against real vs phantom vs already-done targets, cycle detection including the alias case that would otherwise hide it, the policy's inert-probe and blank-command rejections, and the CLI end to end: reporting-only with the policy off, gate recorded with it on and the resulting state accepted by `state validate`, a probe's exit code deciding the verdict, and the gate appearing in the missing-gate list of a refused `review -> validation`. `test/harness-policy.test.mjs`'s frozen-gate assertion was updated for the append.
  - **Phase placement, and why the command must be run in `review`.** `reachabilityAddressed` is a review-phase gate, so `harness verify-reachability` must be run while `currentPhase` is `review`, **not** during implementation. A record is bound to the phase it was created in, so one made during implementation is rejected as stale when the `review → validation` transition is checked — verified by experiment before the docs were written, not assumed. `TDD.md` therefore only *writes the declaration*, and `CodeReview.md` runs the verification; both say so explicitly, because the failure mode is silent until the transition is refused.
  - **Every gate enumeration was corrected in the same change**, since a stale list is a check that cannot see the gate it omits: `docs/core/HardGates.md` (the review→validation table, the two workflow-path tables, and its "these three gates" wording), `docs/core/Workflow.md` Step 3.5, both copies of `UnityCli.md` (the gate is largely automatable, so the "three automatable / five agent-owned" split was wrong), `README.md`'s transition table and workflow diagram, `CodeReview.md`'s completion step, `docs/coverage-report.md`, and both `state.schema.json` files (the eight gates were described; the ninth was not). **One pre-existing omission was corrected in passing**: `HardGates.md`'s implementation→review table never listed `unityAnalyzerClean`, although the transition requires it — reported here rather than fixed silently.
  - **Known limits, stated in the contract rather than hidden:** with no probe configured a `witnessed` declaration is documentation, not proof; the check does not verify that the described witness *works*; and the check is per story, so an epic that only becomes reachable at its last story passes every individual story's check — that ordering is caught by the epic's witness checkpoint and by review, not by the gate.

### Changed

- **The frozen gate list has one more name: `reachabilityAddressed`.** Append-only — no existing name moved or changed meaning — and the list in `docs/core/HarnessContract.md` (C3) is updated in the same change that appends. `skills.test.mjs` and `harness-state.test.mjs` continue to cover the invariant; `harness-policy.test.mjs` pins the new set.
- **`docs/core/HarnessContract-v6.md` is the new contract**, linked from `docs/index.md`: the declaration format, the gate and its opt-in, the probe contract, the falsifiability and cycle rules, what the check does **not** prove, and the compatibility story.

### Fixed

Audit-driven fixes to the reachability gate's transitions and hard gates (all found by driving the CLI against fixture repositories, every guard observed failing first):

- **A reasonless deferral is now refused even when its target exists.** The validator consulted the parser's errors only for an untyped declaration, so `Reachability: deferred to story-2.md` (no reason) was accepted whenever `story-2.md` happened to be a real work item — the exact case contract v6 §1 says to refuse. The errors check now runs first, which also refuses a content-free `witnessed` declaration. `validateReachabilityDeclaration` additionally refuses a deferral that names the story itself (`deferral-self`), implementing the code the module docstring already promised.
- **Long-form deferral cycles are no longer missed because of directory layout.** The cycle graph derived its epic-key aliases from the story's parent directory name, so a bare relative `--story` path (dirname `.`) — or any layout where the parent directory is not named after the epic — silently failed to connect `epicKey::story.md` deferrals to their nodes, and a real cycle passed green. Aliases now come from the work-item index in state.json (every `epicKey::name` that actually exists), the story itself is always a node, and the directory-name derivation remains only as a fallback for callers without state.
- **The declaration is re-examined at `validation -> closed`.** Under strict closure, closure re-derives the story's declaration against the current state: a deferral whose target landed while the story sat in validation, a vanished target, or a since-formed cycle now refuse closure. The re-derivation re-reads the declaration instead of applying the phase/recency freshness machinery, which would wrongly reject a record legitimately created during `review`.
- **`applyTransition` accepts the resolved policy**, so a library caller can enforce exactly the verdict the CLI reports; the CLI passes the same policy and `strictClosure` block to both its pre-check and the applied transition. **Behaviour fix in passing (pre-existing):** `state transition` never applied strict closure at all — the CLI passed only `rootDir`, while `resolveStrict` reads `context.strictClosure` — so the CLI now passes the resolved `strictClosure` block too, and strict-closure repositories get the v3 closure revalidation they opted into on the CLI path as well.
- **Reachability evidence binds to the repo-relative story path.** An absolute `--story` path stored `relevantFiles` that never resolve under the root at check time, so record-time and check-time input-tree hashes were both computed over a missing file and matched — the staleness binding was silently inert and a story rewritten after recording stayed green. `--story` is now resolved against `--target` and the relative path is stored.
- **Manual confirmation of `reachabilityAddressed` is refused under strictClosure by default** (added to the default `disallowManualFor`): the declaration check always runs, so a manual assertion can only skip it. The `manual-disallowed` error now points at `harness verify-reachability --story <path>` for this gate rather than at `harness verify --gate reachabilityAddressed`, which is blocked for it.
- **`harness.schema.json` agrees with the resolver**: the `reachability.command` property rejects blank/whitespace values (`pattern: \S`) and an `allOf`/`if` clause requires `enabled: true` when a command is present — both previously schema-valid shapes that `resolveReachability` rejects.
- **C4 states the conditional append** the same way C3 states the append-only gate list, and the v6 contract documents the closure re-examination, the manual-confirmation posture, and the policy-passing behaviour.
- **The `git-guard.sh` hook tests now resolve a working bash instead of assuming `bash` from PATH.** On Windows, `spawnSync('bash')` frequently picks up the WSL stub, which exits 1 without running the script, so the seven script tests failed on any machine with Git for Windows installed but no WSL distribution. The suite now probes candidates in order — a `CADET_TEST_BASH` override, the standard Git for Windows install locations, then `bash` from PATH (the real bash on POSIX CI) — validates each with a trivial command, and skips the script tests with a visible reason only when no usable bash exists at all; the decision-logic tests are unaffected.


## [0.44.0] — 2026-09-24

### Added

- **Motion is now a first-class artifact in the `VisualEvidence` skill** (`.cadet/agent/core/skills/VisualEvidence.md`) and its template. The skill already stated that "a single frame cannot show motion", but then offered **no artifact, no capture rung, and no outcome rule** for a claim that is inherently temporal — so a project inventing its own capture path was the expected behaviour, and a spike whose value was a visible behaviour could be recorded complete having never been seen.
  - **Why it mattered.** The motivating failure was a consumer project where a spike was closed claiming a visible behaviour had been verified, from a still frame that could not show it. A still showing the end state is exactly what a claim that *nothing happened* also produces, so the artifact the skill required could not distinguish the claim from its negation.
  - **Static vs temporal is decided before capture.** The question is classified as static (*what is on screen* → a frame) or temporal (*what happens over time* → a clip or timed frame sequence, spanning a declared observation window). The classification decides the artifact, and it is fixed before looking so the finding cannot be back-fitted to whatever was captured.
  - **The capture ladder has a motion rung.** Alongside the existing frame ladder, the skill specifies the motion ladder: reuse a recorder or an interval capture loop if one exists; otherwise recommend building one (a clip, or numbered frames at a fixed interval) *or* a manual screen recording; otherwise drive the user to record the whole window and report the path. The manual-capture instructions gain the OS recorder steps (Game Bar / OBS / `Cmd + Shift + 5`) and a `.cadet/evidence/motion-*.mp4` naming.
  - **An outcome rule closes the false green.** A temporal claim can no longer pass on a still: it is `inconclusive` at best, and a static sub-claim passing as `passed` must never be read as the value having advanced. A temporal claim passes only on a motion artifact, or on a user-attested `manual-confirmation` that states what changed and over what interval — "it moved" is a description, not evidence.
  - **The template carries it.** `VisualEvidenceTemplate.md` gains an evidence-kind field and motion rows (observation window, duration, interval or frame rate, window captured), and its provenance and capture-route options now include clips, timed frame sequences, and user-attested observation.
  - **Dispatch wiring.** `Harness.md` §11 gains the motion artifact and the still-cannot-pass rule; `cadet-agent.md`'s Visual Evidence row names motion; and the three dispatch pointers (`Spike.md`, `CodeReview.md`, `Debugging.md`) now say a behaviour question needs a motion artifact — the Spike pointer explicitly, because a behaviour spike is the case that was silently passing.
- **Test coverage** in `test/skills.test.mjs`: the skill must cover motion, name a temporal artifact, and state that a temporal claim cannot pass on a still; the finding template must record the evidence kind and motion fields; and `Spike.md` must require a motion artifact for a behaviour question.

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
