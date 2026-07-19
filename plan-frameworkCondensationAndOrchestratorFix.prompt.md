# Plan: Framework Condensation + Orchestrator Fix

TL;DR: Collapse 36+ markdown files into a single condensed `cadet-agent.md` for the LLM, move rationale/docs to a `docs/` folder for GitHub Pages, fix the orchestrator's brittle keyword-based classify to accept explicit paths from the LLM, and update the build pipeline.

---

## Phase 1 — Orchestrator: classify by explicit path (depends on nothing)

**Steps**
1. Rewrite `.cadet/orchestrator/lib/classify.sh` — replace keyword matching with path validation (`large|small|no_test_required`). Remove `orchestrator_classify()` description-based logic; accept only explicit path arg.
2. Update `.cadet/orchestrator/cadet-orchestrator` entry point — `classify` case now passes `$@` directly (path, not description).
3. Rewrite `.cadet/orchestrator/tests/test_classify.bats` — new tests:
   - valid paths accepted (`large`, `small`, `no_test_required`)
   - invalid path rejected with error
   - state is written correctly per path
4. Update `.cadet/orchestrator/tests/test_integration.bats` — replace description-based classify calls with explicit paths (e.g., `orchestrator_classify "large"`)
5. Run bats tests to verify: `bats .cadet/orchestrator/tests/`

**Relevant files**
- `.cadet/orchestrator/lib/classify.sh` — full rewrite
- `.cadet/orchestrator/cadet-orchestrator` — one-line change in classify case
- `.cadet/orchestrator/tests/test_classify.bats` — rewrite tests
- `.cadet/orchestrator/tests/test_integration.bats` — update classify calls

**Verification**
1. `bats .cadet/orchestrator/tests/` — all tests pass
2. Manual: `cadet-orchestrator init /tmp/test && cadet-orchestrator classify large && cadet-orchestrator status | jq .path` outputs `"large"`
3. Manual: `cadet-orchestrator classify bogus` returns error and exit code 1

---

## Phase 2 — Create condensed `cadet-agent.md` (depends on nothing, parallel with Phase 1)

**Steps**
1. Create `.cadet/agent/core/cadet-agent.md` — single file containing:
   - **Identity** (2-3 lines: who Cadet is, cross-IDE Unity/C# agent)
   - **Non-negotiable rules** (~10 bullets from OperatingRules.md, stripped of rationale)
   - **Orchestrator integration** — the agent runs `cadet-orchestrator` for routing; the LLM determines the path by asking the user one question
   - **Per-skill condensed instructions** — each skill (requirements, architecture, tdd, debugging, codereview) gets ~15 lines: when invoked, what inputs, process in 3-5 steps, expected outputs
   - **Unity-specific rules** — UTF only, ask user to focus Unity for recompilation, prefab slices, localization pipeline
   - **Document splitting rule** — >200 lines or >1 concern → split
   - **Context management** — after each epic, check token count; recommend fresh chat above ~100k
2. Source the condensed content by extracting from existing files — do not invent new rules. Each line should trace to an existing source file.
3. Target ~150-200 lines total.

**Relevant files**
- `.cadet/agent/core/cadet-agent.md` — NEW file
- Source files to extract from: `Identity.md`, `OperatingRules.md`, `Workflow.md`, `Skills/*.md`, `FirstResponseFormat.md`

**Verification**
1. `wc -l .cadet/agent/core/cadet-agent.md` — under 250 lines
2. Every rule in the condensed file traces to an existing source file
3. No new rules invented

---

## Phase 2.5 — Instruction-loss verification gate (depends on Phase 2, blocks Phase 3)

This is a mandatory gate — Phase 3 MUST NOT proceed until this passes.

**Steps**
1. Create a verification script at `.cadet/orchestrator/lib/verify-coverage.sh` that:
   - Scans ALL original source files in `.cadet/agent/core/` (Identity, OperatingRules, Workflow, Skills/*, FirstResponseFormat, KickoffFlow, GitFirstRule, FrameworkSyncGate, PolicyAndGuidanceRules, TechnologyIntroductionRule) for **executable instructions**: lines containing MUST, MUST NOT, NEVER, ALWAYS, mandatory, required, non-negotiable, or that appear in numbered process steps
   - Extracts each instruction as a normalized statement (strip markdown formatting, collapse whitespace)
   - Checks each statement against `cadet-agent.md` AND the moved docs/ files for coverage
   - Outputs a report: `## Covered`, `## Moved to docs/ (rationale only)`, `## MISSING — needs action`
2. Run the script. For every item in MISSING, either:
   - Add it to `cadet-agent.md`, OR
   - Add it to the appropriate docs/ file, OR
   - Document it as a deliberate exclusion with reason in `docs/exclusions.md`
3. Re-run until MISSING section is empty
4. Commit the verification report alongside the refactor as audit evidence

**The script's matching logic:**
- Extract "instruction units" from source files (lines starting with `- ` under process/rule sections, plus lines with modal verbs)
- Normalize: lowercase, strip markdown link syntax, collapse whitespace
- For each unit, search `cadet-agent.md` for substring or semantic match
- Flag any unit not found in either `cadet-agent.md` or the docs/ destination

**Example output:**
```
## Covered in cadet-agent.md (47 instructions)
- "tdd is mandatory where testing is valid"
- "reproduce defects before fixing"
- ...

## Moved to docs/ — rationale only (23 instructions)
- "Common Pitfall: writing tests only after implementation" → docs/guidance/SpikePatterns.md
- ...

## MISSING — needs action (3 instructions)
- "After each epic, ask user to check AI token count" — not found in cadet-agent.md or docs/
- ...
```

**Relevant files**
- `.cadet/orchestrator/lib/verify-coverage.sh` — NEW verification script
- `docs/exclusions.md` — NEW (deliberate exclusions with reasons)

**Verification**
1. Script runs and produces a report with zero MISSING entries
2. Report is committed to the repo as `docs/coverage-report.md`

---

## Phase 3 — Move rationale to docs/ for GitHub Pages (depends on Phase 2.5)

**Steps**
1. Create `docs/` directory at repo root with subdirectories: `guidance/`, `standards/`, `templates/`, `core/`
2. Move files:
   - `Guidance/*.md` → `docs/guidance/`
   - `Standards/*.md` → `docs/standards/`
   - `Templates/*.md` → `docs/templates/`
   - `Identity.md`, `LearnerModel.md`, `Principles.md`, `LearnerConfigPersistence.md` → `docs/core/`
   - `PolicyAndGuidanceRules.md`, `TechnologyIntroductionRule.md` → `docs/core/`
3. Keep in `.cadet/agent/core/`:
   - `cadet-agent.md` (condensed, from Phase 2)
   - `FrameworkManifest.json`
   - `LICENSE.md`
   - `README.md` (update to point to docs/ for rationale)
   - `KickoffFlow.md`, `GitFirstRule.md`, `FrameworkSyncGate.md` (operational files — review whether to condense into cadet-agent.md or keep separate)
4. Create `docs/index.md` as GitHub Pages landing page with navigation to all sections
5. Add `.github/workflows/pages.yml` — GitHub Actions workflow to deploy `docs/` to GitHub Pages on push to main

**Relevant files**
- `docs/` — NEW directory
- `.cadet/agent/core/` — files MOVED out
- `.cadet/agent/core/README.md` — updated
- `.github/workflows/pages.yml` — NEW

**Verification**
1. `docs/` contains all moved files with correct structure
2. `.cadet/agent/core/` contains only: `cadet-agent.md`, `FrameworkManifest.json`, `LICENSE.md`, `README.md`, operational files (KickoffFlow, GitFirstRule, FrameworkSyncGate)
3. GitHub Pages deploys successfully and is navigable

---

## Phase 4 — Update build pipeline and manifest (depends on Phase 3)

**Steps**
1. Update `FrameworkManifest.json` — `managedPaths` now includes:
   - `cadet-agent.md` (new condensed file)
   - `.cadet/orchestrator/` (now part of the distributed framework)
   - Existing managed paths (AGENTS.md, IDE adapters) unchanged
   - Remove entries for files moved to docs/ (guidance, standards, templates, skills as separate files)
2. Update `package-agent.ps1`:
   - Add `.cadet/orchestrator/` to staging copy
   - Remove copy of guidance/standards/templates/skills subdirectories (now in docs/, not packaged)
   - Validate that `cadet-agent.md` exists in core before packaging
3. Update `AGENTS.md` — replace the "Source Of Truth" section to point to `cadet-agent.md` as the primary agent instruction file instead of listing all 36+ files
4. Bump version to `0.5.0` (minor: structural reorganization that changes package contents)
5. Update `CHANGELOG.md`

**Relevant files**
- `.cadet/agent/core/FrameworkManifest.json`
- `package-agent.ps1`
- `AGENTS.md`
- `CHANGELOG.md`
- `package.json`

**Verification**
1. `./package-agent.ps1` produces a zip with the new structure
2. Zip contains `cadet-agent.md`, `.cadet/orchestrator/`, but NOT guidance/standards/templates/skills as separate files
3. `Expand-Archive` into a fresh dir and verify the expected file count is significantly reduced
4. Manifest validation passes (no missing managed paths)

---

## Decisions

- **Orchestrator scripts ship in the zip**: The orchestrator becomes part of the distributed framework, not just local dev tooling. This is a deliberate change — it means consumer repos get the orchestrator, enabling the sync/update feature later.
- **Skills as separate files are removed from the package**: Their content is folded into `cadet-agent.md`. The full versions live in `docs/` for human reference.
- **Guided mode changed from "read 6+ files" to "read one file + ask user one question"**: The orchestrator handles classification that the old markdown described.
- **Out of scope for this plan**: CLI sync/update command (critique #4), CLI source override env var (critique #5), ZIP parser improvements (critique #3). These are follow-up plans.

## Further Considerations

1. **KickoffFlow.md, GitFirstRule.md, FrameworkSyncGate.md** — these are operational rules that don't fit neatly into "condensed instructions for the LLM" or "human docs." Option A: condense into cadet-agent.md (~10 lines each). Option B: keep as separate files in core/, referenced by cadet-agent.md. Recommend Option A for maximum context savings.
2. **TDD skill content** — the current `Skills/TDD.md` has concrete process (red/green cycles, bug reproduce-first). The condensed version should keep the process steps but drop the "Common Pitfalls" and "Success Criteria" sections (those move to docs/).
