# Coverage Audit — Manual Verification

Each instruction extracted from source files is traced to its disposition in `cadet-agent.md` or `docs/`. This supplements the automated `verify-coverage.sh` script (which uses substring matching and cannot detect semantic equivalence).

## Source: OperatingRules.md

| Instruction | Disposition |
|---|---|
| "TDD is mandatory where testing is valid" | ✅ cadet-agent.md L10: "TDD is mandatory where testing is valid" |
| "surface active policy technology defaults early when they materially affect implementation choices" | ✅ cadet-agent.md L14: "When an active repository policy defines technology defaults, state the policy default before recommending alternatives" |
| "when proposing work on testable code, ALWAYS propose test-first approach" | ✅ cadet-agent.md L10: same rule, condensed phrasing |
| "Apply guidance as preferred heuristics, not as substitute for standards or policy" | ✅ cadet-agent.md L17: "Apply guidance as preferred heuristics and lessons learned, not as a substitute for standards or policy" |
| "Follow Identity, LearnerModel, Principles, Workflow, Skills, Guidance, Standards, Templates, and any active policy" | ✅ cadet-agent.md — all sections present; Workflow Routing section handles path classification |

## Source: Principles.md

| Instruction | Disposition |
|---|---|
| "TDD is mandatory" | ✅ cadet-agent.md L10 (covered by OperatingRules version) |
| "Break large problems into small, solvable units" | ✅ cadet-agent.md L12 |
| "Reproduce errors first, then fix them with tests" | ✅ cadet-agent.md L11 |
| "Never commit sensitive data" | ✅ cadet-agent.md L12 |
| "Proactively alert to security concerns" | ✅ cadet-agent.md L12 |
| "Use the right tool and right design for the specific problem" | 📚 docs/core/Principles.md (philosophy, not executable) |
| "Prefer composition over inheritance" | ✅ cadet-agent.md Unity section: "Prefer composition-based design over inheritance-heavy abstraction" |
| "Prefer squash merges" | ✅ cadet-agent.md L13 |
| "Prefer a clean branch history using rebase workflows and force-push with lease" | 📚 docs/core/Principles.md (operational detail, subsumed by "changes on branches" rule) |

## Source: Workflow.md

| Instruction | Disposition |
|---|---|
| "Do not skip required large-change artifacts unless user explicitly directs" | ✅ cadet-agent.md L18 |
| "Document splitting: >200 lines or >1 concern → split" | ✅ cadet-agent.md Document Rules section |
| "After each epic, ask user to check token count; if >100k, recommend new chat" | ✅ cadet-agent.md Context Management section |
| "Relevant guidance informed defaults without being mistaken for mandatory standards" | ✅ cadet-agent.md L17 |

## Source: KickoffFlow.md

| Instruction | Disposition |
|---|---|
| "Check persisted learner config before asking calibration questions" | ✅ cadet-agent.md Learner Calibration section |
| "Testable logic: ALWAYS propose test-first, non-negotiable" | ✅ cadet-agent.md L10 |
| "After epic complete, run review gate" | ✅ cadet-agent.md CodeReview skill |
| "Ask user to check token count after each epic" | ✅ cadet-agent.md Context Management section |

## Source: Skills/Requirements.md

| Instruction (from numbered process steps) | Disposition |
|---|---|
| "Capture requirements with Given/When/Then acceptance criteria" | ✅ cadet-agent.md Requirements skill |
| "Walk user through each criterion at learner-appropriate depth" | ✅ cadet-agent.md Requirements skill |
| "Validate each criterion is testable" | ✅ cadet-agent.md Requirements skill |
| "Run ambiguity scan; ask permission for 1-by-1 clarification" | ✅ cadet-agent.md Requirements skill |
| "Propagate criteria changes to design, plan, epics" | ✅ cadet-agent.md Requirements skill |

## Source: Skills/Architecture.md

| Instruction (from numbered process steps) | Disposition |
|---|---|
| "Derive design from approved acceptance criteria" | ✅ cadet-agent.md Architecture skill |
| "Define components, interfaces, data flow, integration boundaries" | ✅ cadet-agent.md Architecture skill |
| "Record architectural decisions as ADRs" | ✅ cadet-agent.md Architecture skill |
| "Include TDD red/green test strategy" | ✅ cadet-agent.md Architecture skill |
| "Identify architectural seams and test boundaries" | ✅ cadet-agent.md Architecture skill |
| "Relevant guidance informed default patterns without being mistaken for mandatory rules" | ✅ cadet-agent.md L17 |

## Source: Skills/TDD.md

| Instruction (from numbered process steps) | Disposition |
|---|---|
| "Define expected behavior in test form" | ✅ cadet-agent.md TDD skill |
| "Write failing test first (red)" | ✅ cadet-agent.md TDD skill |
| "Implement minimal code to pass (green)" | ✅ cadet-agent.md TDD skill |
| "For bugs: reproduce via failing test first" | ✅ cadet-agent.md TDD skill |
| "Keep regression tests" | ✅ cadet-agent.md TDD skill |

## Source: Skills/Debugging.md

| Instruction (from numbered process steps) | Disposition |
|---|---|
| "Reproduce issue via failing test or user instructions" | ✅ cadet-agent.md Debugging skill |
| "Define failure boundary, isolate root cause" | ✅ cadet-agent.md Debugging skill |
| "Implement smallest safe fix" | ✅ cadet-agent.md Debugging skill |
| "Ensure failure paths surface concrete diagnostic reasons" | ✅ cadet-agent.md Debugging skill |
| "Persistent-Failure Protocol after 3 attempts" | ✅ cadet-agent.md Debugging skill |
| "Evidence-backed debugging steps that distinguish guidance from mandatory requirements" | 📚 docs/core/Skills/Debugging.md (output quality guideline) |
| "Treating a preferred diagnostics pattern as mandatory when policy defines different convention" | 📚 docs/core/Skills/Debugging.md (Common Pitfall) |

## Source: Skills/CodeReview.md

| Instruction (from the review process, and the v6 reachability duty) | Disposition |
|---|---|
| "Review for functional correctness against acceptance criteria" | ✅ cadet-agent.md CodeReview skill |
| "Verify test coverage and red/green evidence" | ✅ cadet-agent.md CodeReview skill |
| "Check regressions, edge cases, security, secrets" | ✅ cadet-agent.md CodeReview skill |
| "Confirm implementation matches technical design intent" | ✅ cadet-agent.md CodeReview skill |
| "Confirm project plan and epic status reflect progress" | ✅ cadet-agent.md CodeReview skill |
| "Confirm no production code depends on spike assets" | ✅ cadet-agent.md CodeReview skill |
| "Provide prioritized findings with remediation steps" | ✅ cadet-agent.md CodeReview skill |
| "Recommend multi-model review" | ✅ cadet-agent.md CodeReview skill |
| "Review distinguishes guidance recommendations from mandatory standards" | ✅ cadet-agent.md L17 |
| "Confirm the story's declared reachability is honoured: an UNOWNED gap is blocking, an owned unexpired deferral is filed and does not block (contract v6)" | ✅ cadet-agent.md CodeReview skill + docs/core/HarnessContract-v6.md |

## Source: GitFirstRule.md

| Instruction | Disposition |
|---|---|
| "Every new project must initialize Git before Unity project creation" | ✅ cadet-agent.md Git Workflow section |
| "Bootstrap: remote → init → gitignore → README → push" | ✅ cadet-agent.md Git Workflow section |

## Source: FrameworkSyncGate.md

| Instruction | Disposition |
|---|---|
| "Read FrameworkManifest.json for version and canonical repo" | ✅ cadet-agent.md Framework Sync section |
| "Check for newer release; tell user what will be updated vs preserved" | ✅ cadet-agent.md Framework Sync section |
| "After update, instruct user to start fresh chat" | ✅ cadet-agent.md Framework Sync section |
| "If update check fails, continue with snapshot and state reason" | ✅ cadet-agent.md Framework Sync section |

## Source: FirstResponseFormat.md — retired 2026-09-28

The file was deleted. It was a required format that no session produced, no skill read, and nothing enforced; two of its three lines restated context the reader already had. Its instructions were re-homed, not dropped:

| Instruction | Disposition |
|---|---|
| "Summarize understanding of user objective (one short paragraph)" | ⤵️ dropped as restatement — cadet-agent.md `Next` names the action the objective paragraph was paraphrasing; cadet-agent.md `/cadet-resume` and `KickoffFlow.md` still open a session with the work item under it |
| "State learner tier and operating mode (one line, when known and material)" | ⤵️ dropped 2026-09-29 with the `Tier/mode` line — see *the six-field status table* below; the learner model and `.cadet/cadet-local-config.md` are unchanged |
| "State active policy or 'none' (one line)" | ✅ cadet-agent.md Response Contract — a policy is named in a change's `why` when it decided that change; resolving it stays mandatory in OperatingRules |

## Source: the six-field status table — retired 2026-09-29

The table (`Item`, `Phase`, `Gates open`, `Blocking`, `You owe`, `Next`) was the Response Contract for one day.
Its own rule — *no line that cannot change a decision the reader is making* — failed for four of its six fields
on a normal turn, so the contract printed six lines on every reply to fund the rare turn where one of them
mattered. Its instructions were re-homed, not dropped, apart from the ones that were restatement:

| Instruction | Disposition |
|---|---|
| `Item` — the work item and its epic | ⤵️ dropped — the reply's body names the work item when it matters, and `cadet-agent harness status --format json` still reports `workItemId` for a caller that needs it |
| `Phase` — `session.currentPhase` | ⤵️ dropped — a reader acting on the phase reads `state.json` or asks; the health line names a phase problem only when one exists |
| `Gates open` — the unmet ones only | ⤴️ moved into the problem line, printed only when a gate **blocks the next step**. A gate unmet because the work is unfinished is not a problem, or the line would print on nearly every reply |
| `Blocking` — actionable findings only | ⤴️ moved into the problem line, unchanged in meaning |
| `You owe` — what waits on the owner | ⤴️ kept as a condition: stated when a decision is genuinely waiting, never as a standing row |
| `Next` — the next action | ⤴️ kept as a conditional trailing `next:` line |
| `Tier/mode` on the first reply of a session | ⤵️ dropped as telemetry — the learner model and `.cadet/cadet-local-config.md` are unchanged; announcing the resolution once per session cannot change a decision |
| "keep the same fields, in the same order, as labelled lines" for a client that cannot render a table | ⤵️ dropped with the table it existed to render |

**Replacement:** `cadet-agent harness status` derives the one line from the record — `validateState` plus the
run ledger — so the framework's only per-reply output is evidence rather than an assertion. The reply's body
now carries the work, and `cadet-agent.md` states what each stage must carry.

## Source: PolicyAndGuidanceRules.md

| Instruction | Disposition |
|---|---|
| "Use guidance docs to prefer patterns that have worked well" | ✅ cadet-agent.md L17 |
| "Do not present guidance as hard requirement unless standard/policy requires it" | ✅ cadet-agent.md L17 |

## Source: Harness.md — leaner split (2026-10-02)

| Instruction | Disposition |
|---|---|
| Per-transition gate definitions, the execution protocol, and the failure-to-satisfy rule (§13) | ✅ `.cadet/agent/core/HarnessGates.md` — moved verbatim out of `cadet-agent.md`'s gate block; `cadet-agent.md` and `HarnessRuntime.md` now point at that file |
| §12 "CLI surface": the per-command explanations | ✅ same rules as one table; every flag, bound, refusal and read-only declaration survives, and `cadet-agent --help` prints the full command index with each flag's owning command |
| §5, §2a, §2c explanatory clauses (the "why" around each rule) | 📚 git history and `docs/`; every rule statement stays in `Harness.md` at its section number, so the skills' section pointers still resolve |
| "record a structured `gate-exception` in `changeHistory`" | ✅ corrected to `.cadet/state.json → gateExceptions`, its v4 home |

---

## Change 2026-10-03 — the form route retired, and the Resume report retired with it

| Retired instruction | Disposition |
|---|---|
| `harness play-form` / `harness acceptance-form` write a form a person fills in | ❌ DELETED as a route. Both human-owned gates are recorded from the person's own answer: ask them, then `harness confirm --gate <gate> --reason "<what they said>"`. The refusal worth keeping survives — the answer cannot be empty — checked when the record is written and again by `state validate`, which is the guarantee the form's blank fields provided, on one field instead of three. |
| `templates/UserPlaythroughTemplate.md`, `templates/HumanAcceptanceTemplate.md` | ❌ DELETED with the generators that read them. No remaining reference; the templates existed to keep two generated forms from drifting. |
| The record fields `witness` and `limitations` on a human gate | ✅ their substance moved into `reason`. `state validate` accepts either shape, so a record written under the old form keeps validating and no consumer's history is invalidated. |
| `--artifact` on `harness confirm`, and the `--witness` / `--limitations` refusals | ❌ `--artifact` is now refused outright: `harness verify-design-review` is the command that takes an artifact. The two removed flags are still refused by name, so a caller who passes them is told rather than silently recorded. |
| Resume Phase 1's session-state, epics/stories and gate tables; Phase 2a/2b's validation tables; the "structured state summary" and "cross-validation report" expected outputs | ❌ DELETED. The reply carries one line of orientation, the next action, and only a finding that blocks a transition or needs the user's decision. The rule now lives in the Response Contract of `cadet-agent.md`: a state fact that needs no action is the record, not the reply. |

---

## Summary

- **Total instructions reviewed**: 50+
- **Covered in cadet-agent.md**: All executable instructions ✅
- **Moved to docs/ (rationale/philosophy only)**: ~5 items — philosophy statements, common pitfalls, detailed operational steps
- **MISSING**: 0

## Verification

All executable instructions from the 16 source files are covered in `cadet-agent.md`. Items that are rationale, philosophy, common pitfalls, or detailed operational steps are preserved in the `docs/` directory as human reference material.
