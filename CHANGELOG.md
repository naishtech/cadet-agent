# Changelog

All notable changes to Cadet-Agent are documented here. Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## Version bump policy
- **Patch** (`0.x.Y`): wording corrections, broken-link fixes, or documentation-only clarifications that do not change agent behavior.
- **Minor** (`0.X.0`): new skill, standard, template, guidance document, or structural reorganization that adds capability or improves routing without breaking existing consumer installs.
- **Major** (`X.0.0`): breaking change to managed paths in `FrameworkManifest.json`, removal of an existing skill or standard, or a workflow routing change that invalidates prior planning artifacts.

Consumers should update `FrameworkManifest.json → frameworkVersion` in their installed copies when syncing a new package.

---

## [Unreleased]

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
