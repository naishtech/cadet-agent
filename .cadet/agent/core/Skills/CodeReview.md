# Purpose

Define how Cadet-Agent reviews changes for correctness, security, maintainability, and alignment with requirements, design, and workflow artifacts.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Guidance reference: [../Guidance/UnityPatterns](../Guidance/UnityPatterns.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Objective
Identify defects, regressions, security concerns, and process drift before changes are accepted.

## When To Use
- Use before merging or final acceptance of meaningful code changes.
- Use after each completed task or epic milestone for large work.
- Use when requirements, design, and implementation may have diverged.
- Use when sensitive data handling or security posture is in question.

## Required Inputs
- Diff or changed files.
- Related requirements, acceptance criteria, and technical design.
- Relevant tests and recent validation outcomes.
- Project plan and epic task state for traceability checks.
- Security context (secrets handling, dependency impact, auth/data risks).
- Applicable guidance documents for preferred patterns and lessons learned.
- Applicable standards documents and any active repository policy.

## Multi-Model Review Recommendation

Before starting the review, **recommend the user optionally copy the design, code, or artifact under review into a separate chat instance with a different AI model.** A fresh context window avoids bias from the conversation history, and a different model provides an independent second opinion. This is especially valuable for:
- Technical designs and architecture decisions
- Security-sensitive changes
- Performance-critical code paths
- High-risk or breaking changes

## Process
1. Review for functional correctness against acceptance criteria.
2. Verify test coverage relevance and red/green evidence where required.
3. Check for regressions, edge-case risks, and maintainability concerns.
4. Perform security review: secrets exposure, unsafe patterns, and threat implications.
5. Confirm no sensitive data is committed.
6. Confirm implementation matches technical design intent.
7. Confirm service and system boundaries remain interface-first where applicable.
8. Confirm production changes do not depend on spike/example assets unless explicitly approved. See [SpikePatterns](../Guidance/SpikePatterns.md).
9. Confirm failure paths provide actionable diagnostics rather than generic messages.
10. Confirm project plan and epic status reflect actual implementation progress.
11. Compare the implementation against relevant guidance documents and note when a preferred pattern was usefully followed or deliberately rejected.
12. Confirm the implementation satisfies the relevant standards documents for testing, maintainability, security, performance, and Unity engineering quality.
13. Confirm any active repository policy is respected for naming, layout, logging, shared-code placement, and other local conventions.
14. Confirm localization behavior, fallback handling, and asset updates remain correct when localization is affected.
15. Confirm prefab usage, scene boundaries, and composition choices support testability and team scalability.
16. Confirm spikes are reference-only after feasibility is proven and check whether spike cleanup was requested after production completion. See [SpikePatterns](../Guidance/SpikePatterns.md).
17. Provide findings ordered by severity with clear remediation steps.

## Expected Outputs
- Prioritized findings (bugs, risks, regressions, security issues).
- Clear pass/fail or ready/not-ready recommendation.
- Required remediation actions and follow-up validation needs.
- Traceability notes covering requirements, design, planning artifact alignment, and guidance, standards, or policy mismatches.

## Success Criteria
- Critical and high-risk issues are identified before acceptance.
- Security concerns are explicitly surfaced to the user.
- Test evidence supports behavior claims.
- Planning and design artifacts are synchronized with implemented state.
- Review outcomes are actionable and unambiguous.
- Review confirms clean separation between production paths and reference-only spike content.
- Review distinguishes guidance recommendations from mandatory standards or policy requirements.
- Review distinguishes universal standards findings from repository-policy findings.

## Common Pitfalls
- Approving changes without validating acceptance criteria alignment.
- Ignoring missing or weak tests for behavior-critical changes.
- Treating security checks as optional.
- Focusing only on style while missing behavior or risk defects.
- Skipping verification that project-plan and epic status are current.
- Treating guidance deviations as failures when standards and policy are still satisfied.
- Mixing repository-policy violations with universal standards findings.
- Treating local conventions as universal quality rules when no active policy defines them.
- Missing localization or spike-separation regressions because the review focused only on style.

---
