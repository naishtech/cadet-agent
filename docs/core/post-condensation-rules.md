# Post-Condensation Rules — Rationale

Rules added to `cadet-agent.md` after the v0.5.0 framework condensation. The condensed file contains only the executable instruction; this document captures the why.

---

## Artifact Commit Prompt

**Rule:** After creating significant planning artifacts (requirements, technical design, project plan, epics), ask the user if they want to commit them to a new git branch and create a PR. If git is not installed, recommend installing it.

**Why:** Planning artifacts are valuable IP that should be version-controlled from the moment they're created. Without this prompt, users often leave requirements and designs as untracked local files, losing history and the ability to review changes. A gentle prompt — not a mandate — keeps the user in control while surfacing the option at the right moment.

**When it applies:** After each artifact is produced and approved, before moving to the next workflow step.

**Example:**
> "The requirements document is complete. Would you like me to commit this to a new git branch and create a PR for review?"

---

## Pre-Commit Compile Check

**Rule:** Before offering to commit any code or artifacts, ask the user to focus the Unity window and confirm the project compiles without errors. If there are compile errors or broken tests, ask the user to paste them in the chat and fix them before committing. Do not offer to commit or push code that does not compile or has failing tests.

**Why:** Committing non-compiling code poisons the repository for everyone else on the team — broken builds block other developers, break CI pipelines, and erode trust in the agent's output. Since the agent cannot observe Unity's compile state directly, it must rely on the user as the gate. This rule turns a blind spot into an explicit checkpoint.

**Why the agent can't check itself:** Unity compilation happens inside the Unity Editor process, which the agent has no visibility into. The user is the only observer of the compile result.

**When it applies:** Before any offer to commit, regardless of change size or workflow path.

**Example:**
> "Before we commit, please focus the Unity window and confirm the project compiles. If you see any errors, paste them here and I'll help fix them."

---

## GUID Generation Rule

**Rule:** Never hand-craft GUIDs or UUIDs in Unity asset files. Always use Unity's built-in GUID generation (`AssetDatabase.GenerateUniqueAssetPath` or the Editor's asset creation pipeline). Hand-crafted GUIDs cause collisions, break asset references, and produce cryptic errors.

**Why:** Unity uses GUIDs internally to reference assets. A hand-crafted GUID that collides with an existing one silently breaks the asset database. These bugs are extremely difficult to diagnose because they manifest as "missing reference" errors with no obvious cause. Unity's GUID generation is deterministic and collision-safe.

**When it applies:** Any time the agent generates or modifies `.meta` files, `.asset` files, or any Unity serialized asset that contains GUID fields.

**Anti-pattern:**
```csharp
// NEVER do this:
guid = Guid.NewGuid().ToString("N");  // or any hand-crafted GUID
```

**Correct approach:**
```csharp
// Let Unity generate it:
var path = AssetDatabase.GenerateUniqueAssetPath("Assets/NewAsset.asset");
AssetDatabase.CreateAsset(myAsset, path);
```

---

## Decommission on Refactor

**Rule:** When a refactor or major design change replaces or removes existing functionality (e.g., switching APIs, replacing a subsystem, retiring a pattern), identify any obsolete code, interfaces, integrations, or assets that should be decommissioned. Ask the user whether cleanup and decommissioning should be included in the plan before proceeding with implementation.

**Why:** Refactors that introduce new implementations without removing old ones create dead code, zombie integrations, and maintenance debt. Old API connections left in place after migration, unused interfaces after a pattern change, and orphaned assets after a subsystem replacement all bloat the codebase and confuse future contributors. The agent is well-positioned to trace what becomes obsolete during a change, but the user must decide whether to scope cleanup into the current work or defer it.

**When it applies:** Any time the agent proposes or the user requests a refactor, major design change, API migration, subsystem replacement, or pattern retirement.

**Example:**
> "This change replaces the old `ILegacyPaymentGateway` with `IPaymentService`. I've identified the following that should be decommissioned: the `LegacyPaymentGateway` implementation class, the `PaymentGatewayFactory` that only creates legacy instances, and the `LegacyGatewayConfig` asset. Should I include cleanup and removal of these in the implementation plan?"

---

## Story Breakdown Rule

**Rule:** Implementation work is scoped to stories, not epics. Epics are grouping containers for related stories. After epics are created, each epic must be broken down into small, independently implementable stories before any code is written. Only stories are worked on individually, reviewed, and committed.

**Why:** Epics are too large for effective review and safe commits. Working at the epic level produces big-bang code drops that are hard to review, risky to merge, and painful to roll back. Breaking epics into stories creates natural checkpoints: each story is a small, reviewable increment with its own code review, compile check, and commit. This reduces review fatigue, catches issues earlier, and keeps the codebase always in a buildable state.

**When it applies:** All large-change workflows. After epics are decomposed, the agent must break each epic into stories before writing any implementation code.

**Example:**
> "Epic 1 (Player Movement) contains three stories: 1) basic horizontal movement with input, 2) jump and gravity, 3) collision response. Let's start with Story 1. After it's implemented, tested, and reviewed, we'll move to Story 2."

---

## Story Completion Tracking

**Rule:** After a story passes all tests and code review, update the story markdown file to mark it as complete. Update the parent epic file to reflect the completed story count and overall progress. Do not move to the next story until the current story's documents reflect its completion.

**Why:** Without explicit completion tracking, story and epic documents become stale the moment implementation begins. The next session or a different developer looking at the planning artifacts cannot tell which stories are done, which are in progress, and which haven't started. Updating documents at story completion creates a reliable audit trail and keeps planning artifacts useful as a dashboard of project progress.

**When it applies:** After every story's TDD cycle and code review pass, before moving to the next story or offering to commit.

**Example:**
> "Story 1 (basic horizontal movement) is complete — all tests pass and code review is clean. I've updated `epic-1-stories.md` to mark Story 1 as [x] done and updated the epic progress tracker. Ready to commit and move to Story 2."

---

## Design-Change Feedback Loop

**Rule:** When a story hits a blocker that cannot be resolved within the current design (e.g., a missing interface, an incompatible integration, a flawed architectural assumption), do not force the implementation. Pause the story, document the blocker, and trace it upstream: update the technical design, propagate changes to epics and stories (adding, removing, or modifying stories as needed), then resume with the revised story. Apply the decommission rule if the design change makes existing code obsolete.

**Why:** Forcing implementation around a design flaw compounds technical debt. The story-level workflow is a fast feedback mechanism — a story that can't be completed signals that the design or plan has a gap. Ignoring that signal and hacking around the blocker creates fragile code that drifts from the documented design. Pausing and fixing the design upstream keeps the codebase, design docs, and plan artifacts aligned.

**When it applies:** Any time a story encounters a blocker rooted in the design, architecture, or plan rather than in implementation details.

**Example:**
> "Story 2 (jump and gravity) is blocked — the current design assumes `Rigidbody`-based physics, but the jump mechanic requires a custom kinematic controller. I need to update the technical design to add a `CharacterMotor` component, which will add a new story for the motor implementation and modify Story 2 to integrate with it. The old `Rigidbody` movement code in Story 1 will also need decommissioning. Should I update the design and revise the stories?"
