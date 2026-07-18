# Kickoff Flow

1. **Check for persisted learner config:** Read `.cadet/cadet-local-config.md` (if present) to determine whether learner tier, game type, and operating mode are already known.
   - If `.cadet/cadet-local-config.md` exists and is valid, load learner tier, game-type answers, and operating mode from it. Skip calibration questions.
   - If the file does not exist or is stale/invalid, proceed to step 2.
2. Determine the relevant learner dimension and decide whether the user wants instruction-first or implementation-first help.
3. If the user's relevant skill level **or game type/category** is unclear, ask a short series of focused calibration questions (skill level + game type) and resolve both before substantive recommendations.
   - After resolving calibration answers, create or update `.cadet/cadet-local-config.md` with the results so future sessions skip re-asking.
4. Check whether the Git-first bootstrap gate is already complete.
5. If bootstrap is not complete, collect only the minimum bootstrap inputs needed to finish repository setup, README creation, and Unity project creation; defer detailed vision and planning until after the gate is complete.
6. After bootstrap is complete, confirm the game vision, target platforms, constraints, and success criteria.
7. Ask whether the user wants step-by-step collaboration or full-document-first review.
8. Classify work size and testing applicability:
   - **Testable logic (unit, integration, etc.):** ALWAYS propose test-first. Write tests before implementation. This is non-negotiable.
   - Large non-testable changes: Create requirements with Given/When/Then acceptance criteria, then implement + manual validation.
   - Small non-testable changes: Implement and request manual validation.
9. For large initiatives after requirements and technical design are finalized:
   - Evaluate technology choices using `.cadet/agent/core/Guidance/TechnologyDecisionFramework.md`: identify viable options, ask the user, record ADRs.
  - Use the planning path defined by the active policy when present.
  - Otherwise, ask the user where planning artifacts should live.
  - Create project plan and epic documents.
  - Keep each epic to about 10 to 12 small tasks.
  - Ensure each epic is a testable, valuable slice.
  - Apply relevant guidance documents as preferred implementation defaults unless standards or policy require otherwise.
10. Keep requirements, technical design, project plan, and epics synchronized with implementation.
11. Maintain change history, including descopes and scope pivots.
12. After each epic, ask user to check token count; if context exceeds 100k tokens, recommend a new chat.
13. For Unity code changes, ask the user to focus Unity so recompilation can occur.
14. After each epic is complete, run the review gate per `.cadet/agent/core/Workflow.md` Step 3.5 — apply the full CodeReview skill, file prioritized findings, and recommend the user optionally review the output in a separate chat with a different AI model for an independent second opinion.

---

## Backlinks
- Framework index: [README](README.md)
