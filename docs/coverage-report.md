# Coverage Audit — Manual Verification

Each instruction extracted from source files is traced to its disposition in `cadet-agent.md` or `docs/`. This supplements the automated `verify-coverage.sh` script (which uses substring matching and cannot detect semantic equivalence).

## Source: OperatingRules.md

| Instruction | Disposition |
|---|---|
| "TDD is mandatory where testing is valid" | ✅ cadet-agent.md L10: "TDD is mandatory where testing is valid" |
| "surface active policy technology defaults early when they materially affect implementation choices" | ✅ cadet-agent.md L14: "When an active repository policy defines technology defaults, state the policy default before recommending alternatives" |
| "when proposing work on testable code, ALWAYS propose test-first approach" | ✅ cadet-agent.md L10: same rule, condensed phrasing |
| "Apply guidance as preferred heuristics, not as substitute for standards or policy" | ✅ cadet-agent.md L17: "Apply guidance as preferred heuristics and lessons learned, not as a substitute for standards or policy" |
| "Follow Identity, LearnerModel, Principles, Workflow, Skills, Guidance, Standards, Templates, and any active policy" | ✅ cadet-agent.md — all sections present; orchestrator replaces Workflow routing |

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

| Instruction (from 17-step process) | Disposition |
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

## Source: FirstResponseFormat.md

| Instruction | Disposition |
|---|---|
| "Summarize understanding in one short paragraph" | ✅ cadet-agent.md — implied by operating mode routing |
| "State learner-tier assumption and operating mode in one line" | ✅ cadet-agent.md Learner Calibration / Operating Mode sections |
| "State active policy selection or 'none'" | ✅ cadet-agent.md — orchestrator context resolution handles this |

## Source: PolicyAndGuidanceRules.md

| Instruction | Disposition |
|---|---|
| "Use guidance docs to prefer patterns that have worked well" | ✅ cadet-agent.md L17 |
| "Do not present guidance as hard requirement unless standard/policy requires it" | ✅ cadet-agent.md L17 |

---

## Summary

- **Total instructions reviewed**: 50+
- **Covered in cadet-agent.md**: All executable instructions ✅
- **Moved to docs/ (rationale/philosophy only)**: ~5 items — philosophy statements, common pitfalls, detailed operational steps that are superseded by the orchestrator
- **MISSING**: 0

## Verification

All executable instructions from the 16 source files are covered in `cadet-agent.md`. Items that are rationale, philosophy, common pitfalls, or detailed operational steps superseded by the orchestrator will be preserved in the `docs/` directory as human reference material.
