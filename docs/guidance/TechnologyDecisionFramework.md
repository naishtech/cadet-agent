# Technology Decision Framework

Purpose: Provide a technology-agnostic, structured approach to version, stability, and dependency decisions. Use this to make consistent, justified recommendations and to surface the right ADRs regardless of the engine, language, or platform.

## Backlinks
- Docs index: [index](../index.md)
- Architecture skill: [Architecture](../core/skills/Architecture.md)
- ADR template: [ADRDecisionTemplate](../templates/ADRDecisionTemplate.md)

## How To Use

For each significant technology choice, apply the decision flow below. When a decision is made, record it as an ADR under `.cadet/agent/project-plans/adr/`. If the flow recommends a choice that conflicts with an active repository policy, the policy wins — state the exception explicitly.

---

## Core Decision Framework

### 1. Version Strategy

The first question for any dependency or platform: **which version are we targeting?**

| Strategy | Rule | When to use |
|---|---|---|
| **Latest stable** | Use the most recent stable release. | Greenfield projects, prototypes, solo dev, no legacy constraints. |
| **LTS / Long-Term Support** | Use the most recent LTS or equivalent supported release. | Projects that will ship, teams, production intent, enterprise. Available LTS channels vary by technology (Unity LTS, Node.js LTS, .NET LTS, Ubuntu LTS). |
| **Pinned** | Lock to a specific version. Record why in an ADR. | Legacy dependency, team standardization, CI reproducibility, a specific bug or feature tie. |
| **Bleeding edge** | Use latest release including preview/beta if it unblocks critical work. | Prototypes, R&D, blocked on a feature only available in a newer release. |

**Default recommendation:** LTS for production, latest stable for prototypes. Never pin without an ADR explaining why.

### 2. Stability Tier

For any library, package, or feature: **is it stable enough for the current project phase?**

| Tier | Rule | Phase |
|---|---|---|
| **Stable / GA** | Safe for any phase. No restrictions. | All phases. |
| **Preview / Beta** | Allow only when the user explicitly approves after being told the stability risk. | Prototypes, R&D, behind a feature flag in production. |
| **Experimental / Alpha** | Allow in spikes and prototypes only. Must document which feature is experimental and why it's needed in an ADR. | Spikes, prototypes. |
| **Deprecated** | Do not introduce. If already present, add migration to stable equivalent to the backlog. | Migration only. |

**Default recommendation:** Stable for production paths. Preview/experimental allowed in prototypes with ADR documentation. Deprecated is never introduced.

### 3. Platform and Ecosystem Fit

For any external dependency: **does it fit the target ecosystem?**

| Question | Check |
|---|---|
| **Is it the platform's native/recommended solution?** | Prefer the platform's first-party solution unless there is a concrete reason to choose a third-party alternative. Record the reason in an ADR. |
| **Is it actively maintained?** | Check: last release date, open issue count, contributor activity. Prefer dependencies with releases in the last 6 months. |
| **Is the license compatible?** | Check the license against the project's constraints. Raise concerns immediately if GPL or other restrictive licenses appear in a commercial project. |
| **Does it have healthy community or commercial support?** | Prefer dependencies with documentation, examples, and an active user base. Solo-maintainer projects carry bus-factor risk — flag it. |

### 4. User Choice — Required When Multiple Viable Options Exist

When a technology category has **more than one viable option** (both stable, both fit the ecosystem), do not silently pick one. **Ask the user.** Present the viable options with a clear default recommendation and concise tradeoffs, then let the user decide.

| Scenario | Action |
|---|---|
| **Only one viable option** | Recommend it directly. State why alternatives were eliminated. |
| **Multiple viable options** | Present the top 2–3 options. State the default recommendation with rationale. Ask the user to choose. |
| **User doesn't know or defers** | Apply the default recommendation. Record the decision and note that the user deferred. |
| **User's choice differs from the default** | Apply the user's choice. Record the override in an ADR with the user's reason. |

**Example prompt pattern:**

> For input handling, two options are viable:
> - **New Input System** (recommended) — cross-platform, gamepad support, rebindable controls
> - **Legacy Input Manager** — simpler API, zero setup, best for keyboard-only prototypes
>
> Which would you prefer?

### 5. Learner-Tier Override

Learner tier shapes how options are presented, not just which option is chosen:

| Tier | Override |
|---|---|
| **Tier 0 (beginner)** | Default to the simplest option. Still ask the user, but frame one option as the clear recommendation with a short why. |
| **Tier 1 (intermediate)** | Present options with tradeoffs. Recommend a default but let the user weigh the pros/cons. |
| **Tier 2+ (advanced)** | Present all viable options with full tradeoff analysis. The user may override any recommendation — record the override in an ADR. |

---

## Illustrative Examples

These examples apply the framework to common Unity decisions — the same pattern works for any engine or platform.

### Example: Render Pipeline (Unity)

| Option | Stability | Ecosystem fit | Learner default |
|---|---|---|---|
| **Built-in RP** | Stable | Native, simplest | Tier-0 |
| **URP** | Stable | Native, recommended for most projects | — |
| **HDRP** | Stable | Native, high-end only | — |

**User ask:** "For rendering: Built-in (simplest), URP (recommended for most projects), or HDRP (high-end only)?"
**Default:** URP. Built-in for Tier-0.

### Example: Input System (Unity)

| Option | Stability | Ecosystem fit |
|---|---|---|
| **Legacy Input** | Stable | Native, simplest API |
| **New Input System** | Stable | Native, feature-complete |

**User ask:** "For input: Legacy Input Manager (simpler, keyboard-only) or New Input System (gamepad support, rebindable controls)?"
**Default:** New Input System. Legacy for Tier-0 keyboard-only prototypes.

### Example: Networking (Unity)

| Option | Stability | Ecosystem fit |
|---|---|---|
| **Netcode for GameObjects** | Stable | Unity-first, official support, beginner-friendly |
| **Mirror** | Stable | Community-driven, mature, wide adoption |
| **FishNet** | Stable | Performance-focused, advanced features |
| **Photon Fusion** | Stable | Managed hosting, quick setup |
| **No networking** | N/A | Single-player or local multiplayer only |

**User ask:** "For multiplayer: Netcode for GameObjects (recommended, official Unity support), Mirror (community-driven, mature), or no networking for now?"
**Default:** Netcode for GameObjects. Ask clarifying questions about scale, server model, and hosting before committing.

### Example: UI System (Unity)

| Option | Stability | Ecosystem fit |
|---|---|---|
| **Unity UI (uGUI)** | Stable | Native, mature, best for game HUDs |
| **UI Toolkit** | Stable | Native, CSS-like, best for editor tools and data-heavy UI |

**User ask:** "For UI: uGUI (recommended for game HUDs, mature) or UI Toolkit (better for editor tools and data-dense panels)?"
**Default:** uGUI for gameplay HUDs. UI Toolkit for editor windows.

---

## Decision Flow

When making a technology choice:

1. **Check active policy** — does the repository policy already prescribe a version or stack? If yes, apply it and skip the rest.
2. **Apply version strategy** — latest stable vs LTS vs pinned. Default: LTS for production, latest stable for prototypes.
3. **Check stability tier** — stable vs preview vs experimental vs deprecated. Default: stable only in production paths.
4. **Check ecosystem fit** — native/recommended, maintained, licensed, supported.
5. **Identify viable options** — apply the checks above to filter down to the options that are stable, maintained, and ecosystem-appropriate.
6. **Ask the user** — if multiple viable options remain, present them with a clear default recommendation and concise tradeoffs. Let the user choose. If only one option is viable, recommend it directly with rationale.
7. **Apply learner-tier override** — frame the ask at the user's experience level. Tier-0 gets a strong recommendation; Tier-2+ gets full tradeoff analysis.
8. **Record the ADR** — create an ADR under `.cadet/agent/project-plans/adr/` for every significant technology decision. Use [ADRDecisionTemplate](../templates/ADRDecisionTemplate.md).

---

## Backlinks
- Docs index: [index](../index.md)
