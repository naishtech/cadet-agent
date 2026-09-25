# Kickoff Flow

1. **Detect the repository role:** Read `.cadet/state.json` and `.cadet/agent/project-plans/`. If `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, this is the framework source repo — story/gate work is not applicable; switch to the contribution workflow (`CONTRIBUTING.md`) and stop this flow. Otherwise continue with the consumer-project flow below.
2. **Check for persisted learner config:** Read `.cadet/cadet-local-config.md` (if present) to determine whether learner tier, game type, and operating mode are already known.
   - If `.cadet/cadet-local-config.md` exists and is valid, load learner tier, game-type answers, and operating mode from it. Skip calibration questions.
   - If the file does not exist or is stale/invalid, proceed to step 3.
3. Determine the relevant learner dimension and decide whether the user wants instruction-first or implementation-first help.
4. If the user's relevant skill level **or game type/category** is unclear, ask a short series of focused calibration questions (skill level + game type) and resolve both before substantive recommendations.
   - After resolving calibration answers, create or update `.cadet/cadet-local-config.md` with the results so future sessions skip re-asking.
5. Check whether the Git-first bootstrap gate is already complete.
6. If bootstrap is not complete, collect only the minimum bootstrap inputs needed to finish repository setup, README creation, and Unity project creation; defer detailed vision and planning until after the gate is complete.
7. After bootstrap is complete, confirm the game vision, target platforms, constraints, and success criteria.
8. Ask whether the user wants step-by-step collaboration or full-document-first review.
9. Classify work size and testing applicability:
   - **Testable logic (unit, integration, etc.):** ALWAYS propose test-first. Write tests before implementation. This is non-negotiable.
   - Large non-testable changes: Create requirements with Given/When/Then acceptance criteria, then implement + manual validation.
   - Small non-testable changes: Implement and request manual validation.
   - **Reachability:** ask ONCE per run whether this project's work must be reachable — a path by which a user or operator can reach and observe each deliverable — and record the answer as `reachability.enabled` in `.cadet/harness.json` (plus that project's own `reachability.command` probe, if it has one). Ask it the way the tracking mode is asked: a choice that persists, not a per-story question. Saying yes is what makes `reachabilityAddressed` a required gate on `review -> validation`, and what commits every story to a `Reachability:` declaration; saying no leaves the check reporting-only.
10. For large initiatives after requirements and technical design are finalized:
   - Evaluate technology choices using `.cadet/agent/core/Guidance/TechnologyDecisionFramework.md`: identify viable options, ask the user, record ADRs.
  - Use the planning path defined by the active policy when present.
  - Otherwise, ask the user where planning artifacts should live.
  - Create project plan and epic documents.
  - Keep each epic to about 10 to 12 small tasks.
  - Ensure each epic is a testable, valuable slice.
  - Apply relevant guidance documents as preferred implementation defaults unless standards or policy require otherwise.
11. Keep requirements, technical design, project plan, and epics synchronized with implementation.
12. Maintain change history, including descopes and scope pivots.
13. After each epic, ask user to check token count; if context exceeds 100k tokens, recommend a new chat.
14. For Unity code changes, ask the user to focus Unity so recompilation can occur.
15. After each epic is complete, run the review gate per `.cadet/agent/core/Workflow.md` Step 3.5 — apply the full CodeReview skill, file prioritized findings, and recommend the user optionally review the output in a separate chat with a different AI model for an independent second opinion.

---

## Backlinks
- Framework index: [README](README.md)
