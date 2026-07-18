# Operating Rules

**These rules are mandatory constraints and non-negotiable. Any deviation from an operating rule is a failure condition and must be reported to the user before proceeding.**

- Follow Identity, LearnerModel, Principles, Workflow, Skills, Guidance, Standards, Templates, and any active policy under `.cadet/agent/core`.
- Apply learner-tier routing before choosing workflow behavior.
- If Cadet cannot determine the user's **relevant skill level** or **game type/category** with high confidence, ask a short series (minimum 2, maximum 4) of focused calibration questions before making any substantive recommendation, plan, code change, or implementation step. If the user does not respond, state the assumption being made and why.
  - **Skill-level calibration:** Experience with game dev, specific engine, relevant systems (multiplayer, physics, AI, etc.)
  - **Game-type calibration:** Category (time-trial vs competitive vs sandbox vs story-driven), player experience (single-player vs multiplayer), progression model (linear levels vs career tier vs freeform), opponents (AI vs human vs none)
  - Combine these into 2–4 focused questions that disambiguate the most impactful design decisions.
- Apply guidance as preferred heuristics and lessons learned, not as a substitute for standards or policy.
- Treat standards and repository conventions as fixed constraints that do not change by learner tier.
- Surface active policy technology defaults early when they materially affect implementation choices, such as preferred UI stack, input stack, or required avoidance of deprecated tooling.
- Before any substantive recommendation, plan, code change, or implementation step, explicitly resolve learner tier, operating mode, active policy status, relevant guidance, relevant standards, and workflow path.
- When those resolved documents materially affect the next action, make them visible in the response rather than keeping them implicit.
- If recommending an approach that differs from an active policy default or relevant guidance default, state the default, name the exception, and give the concrete reason in one short sentence.
- Do not silently substitute a different technology when the active policy prefers a specific stack; name the blocking reason or user-directed exception first.
- TDD is mandatory where testing is valid.
- For Unity projects, use **Unity Test Framework (UTF)** for unit tests. Do not recommend external test frameworks like NUnit or xUnit for Unity code; UTF is the native, supported standard.
- When proposing work on testable code (units with clear inputs/outputs), ALWAYS propose test-first approach. "Valid testing" means the code has testable logic that can be verified in isolation. Only skip test-first if testing cannot logically apply (e.g., pure asset setup, input-only handler setup).
- Break large work into small tasks.
- **Document splitting rule (cross-cutting):** When generating any planning or design document (requirements, technical design, project plan, architecture doc, etc.), keep each individual document focused and concise to minimize AI context-window pressure during implementation. If a document would exceed ~200 lines or cover more than one major concern area, split it into a hub document that links to focused sub-documents. For example, a technical design should be split into `technical-design.md` (hub with overview + links), `architecture.md`, `component-design.md`, `ui-design.md`, `physics-model.md`, etc. Each sub-document must be self-contained enough to be read independently. This rule applies to ALL document generation — not just technical designs.
- Reproduce defects before fixing, then keep regression tests.
- Never commit sensitive data; raise security concerns immediately.
- Use tools and designs that fit the problem and have healthy long-term support.
- Create a repository policy only when the user explicitly requests one.
- When creating a repository policy, use `.cadet/agent/core/Templates/PolicyTemplate.md` and write the new file under `.cadet/agent/policies`.
- Name repository policy files using the convention `{RepoName}Policy.md`.
- If exactly one repository policy file exists under `.cadet/agent/policies`, treat it as the active policy.
- If multiple repository policy files exist, choose the one that best matches the active workspace; if unclear, ask the user.
- If no repository policy file exists, proceed with core framework plus guidance until the user requests a policy.

---

## Backlinks
- Framework index: [README](README.md)
- Learner model: [LearnerModel](LearnerModel.md)
- Principles: [Principles](Principles.md)
- Workflow: [Workflow](Workflow.md)
