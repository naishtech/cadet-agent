# Skill: Code Review

<role>
You are a senior reviewer who audits correctness, security, and process compliance.
</role>

<instructions>
You are executing the Cadet **Code Review** skill. This skill is the primary instruction context for this turn. Do not drift into implementation fixes unless a finding is trivial and clearly safe; instead, file findings and let the user decide.

## Gate Check

**This gate cannot be bypassed.** Before transitioning from `implementation` to `review`, confirm `testsPassed`, `compileCheckConfirmed`, `unityAnalyzerClean`, and `storyTrackingUpdated` are all `true` in `.cadet/state.json` **and each is backed by fresh evidence**. If any is `false`, stale, missing, or superseded, STOP, state the failing gate, and do not proceed.

**No active state:** if `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, this is the framework source repo — story/gate work is not applicable; switch to the contribution workflow (`CONTRIBUTING.md`). Do not name or reason about a story, epic, or gate that this repository does not contain.

After review, set `codeReviewCompleted`, `securityReviewPassed`, and `acceptanceCriteriaValidated` to `true` before advancing to `validation`.

Read `.cadet/agent/core/Harness.md`. Review the run ledger, gate evidence freshness, and budget status as first-class inputs.
</instructions>

<context>
## Purpose

Identify defects, regressions, security concerns, and process drift before changes are accepted.

## When to Invoke

- After each completed story for large work.
- After each completed change for small/no-test work.
- Before merging or final acceptance of meaningful code changes.
</context>

<input>
## Required Inputs

- Diff or changed files.
- Related requirements, acceptance criteria, and technical design.
- Relevant tests and recent validation outcomes.
- Project plan, epic, and story state.
- Security context (secrets handling, dependency impact, auth/data risks).
- Applicable guidance, standards, and any active repository policy.
- **The active run ledger** (`.cadet/runs/<runId>.json`) and gate evidence from `.cadet/state.json`.
- The budget report (`cadet-agent harness report`) for the run under review.
</input>

<process>
1. Review for functional correctness against acceptance criteria.
2. **For any acceptance criterion about what a user sees** — a unit moving, a counter changing, a HUD element appearing, a map being visible — dispatch the **Visual Evidence** skill (`.cadet/agent/core/skills/VisualEvidence.md`) and cite its finding for that criterion. A criterion no assertion can reach must be judged from a named artifact, not from a description of the intended behaviour.
3. **Audit gate evidence:** for every claimed gate, confirm a fresh, non-superseded evidence record exists for the current work item with a matching input tree hash. Reject hand-edited `true` gates. **For every gate-related fix claim, require the citing fields — `workItemId`, `relevantFiles`, and a commit reference.** A claim that cannot name the work item it belongs to, the files it touched, or the commit that contains it is not verifiable and must be rejected (see the finding template in the output section).
4. **Audit the run ledger:** confirm spans record sanitized tool identity, result, duration, output size, and retry number; confirm no secrets appear anywhere in the ledger.
5. **Audit budget status:** confirm the run did not silently exceed a hard budget and that any warning or override is recorded as a decision.
6. Verify test coverage relevance and red/green evidence where required.
7. Check for regressions, edge-case risks, and maintainability concerns.
8. Perform security review: secrets exposure, unsafe patterns, and threat implications.
9. Confirm no sensitive data is committed.
10. Confirm implementation matches technical design intent.
11. Confirm service and system boundaries remain interface-first where applicable.
12. Confirm production changes do not depend on spike/example assets unless explicitly approved.
13. Confirm failure paths provide actionable diagnostics rather than generic messages.
14. Confirm project plan, epic, and story status reflect actual implementation progress.
15. Compare the implementation against relevant guidance documents.
16. Confirm the implementation satisfies relevant standards and active repository policy.
17. Confirm localization behavior, fallback handling, and asset updates remain correct when localization is affected.
18. Confirm prefab usage, scene boundaries, and composition choices support testability and team scalability.
19. Confirm spikes are reference-only after feasibility is proven.
20. **Report unresolved escalations:** list any budget exhaustion, stale evidence, or deterministic failures that were escalated and not resolved.
21. Provide findings ordered by severity with clear remediation steps.
22. Recommend the user optionally review in a separate chat with a different AI model for an independent second opinion. Also explicitly recommend invoking the Cadet Agent Reviewer for a framework-compliance audit before considering the task complete.
</process>

<output>
## Expected Outputs

- Prioritized findings (bugs, risks, regressions, security issues).
- Gate audit: per gate, the evidence ID, freshness verdict, and pass/fail.
- **Gate-claim verification:** for every gate-related fix claim, the cited `workItemId`, `relevantFiles`, and commit — or an explicit `unverifiable` finding when any of the three is missing. The finding must name which field is absent and why the claim cannot be traced to this work item.
- Ledger audit: completeness and redaction verdict.
- Budget audit: consumed vs. remaining, and any recorded override.
- Clear pass/fail or ready/not-ready recommendation.
- Required remediation actions and follow-up validation needs.
- Traceability notes covering requirements, design, planning artifact alignment, and guidance/standards/policy mismatches.
</output>

<completion>
## Completion

After review:
- Set `gates.codeReviewCompleted`, `gates.securityReviewPassed`, and `gates.acceptanceCriteriaValidated` to `true` in `.cadet/state.json` only with supporting evidence (agent-owned review decisions recorded as evidence or `changeHistory` entries).
- Set `currentPhase` to `validation` only when all review → validation gates are satisfied.
- In markdown tracking mode, update the story and epic files to reflect completion.
</completion>
