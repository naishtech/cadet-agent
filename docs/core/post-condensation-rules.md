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
