# Purpose

Define how SOLID principles are applied in Unity and C# codebases to improve maintainability, testability, and safe iteration.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Standard Description
This standard adapts SOLID for Unity workflows, where MonoBehaviours, ScriptableObjects, services, and runtime systems must remain modular and testable. It emphasizes small responsibilities, explicit dependencies, and clear extension points over tightly coupled scene logic. Preferred Unity idioms and implementation patterns live in the guidance layer, not in this standard.

## Rules
- Keep MonoBehaviours thin and focused on orchestration, not business-heavy logic.
- Apply single responsibility by separating gameplay rules, presentation, input handling, and persistence concerns.
- Use clear boundaries so systems can evolve without broad rewrites.
- Prefer composition and interfaces over inheritance-heavy abstraction when extending behavior.
- Depend on abstractions for cross-system coordination and integration points.
- Minimize hidden dependencies by making required collaborators explicit.
- Avoid public static mutable fields; use singletons only when truly necessary and documented.
- Break large changes into small composable units aligned with plan and epic tasks.
- Keep architecture choices synchronized with technical design documentation.

## Validation Checklist
- Classes and components have clear single-purpose scope.
- Cross-system dependencies are explicit and justified.
- Core logic is testable without heavy scene setup where feasible.
- New features extend existing systems without fragile edits across unrelated modules.
- Interfaces and boundaries are used where substitution and testability require them.
- Static mutable global state is avoided or explicitly justified.
- Refactors are documented and reflected in design and planning artifacts.

## Common Violations
- Large MonoBehaviour classes containing input, state, UI, and gameplay logic together.
- Direct hard coupling between unrelated systems.
- Scene-dependent logic that is difficult to test in isolation.
- Repeated conditional branches replacing proper extension points.
- Hidden global state dependencies that complicate debugging and testing.
- Unnecessary singleton expansion and public static mutable state.
- Architectural drift from approved technical design.

## Review Questions
- Does each component have one clear responsibility?
- Can this behavior be extended without rewriting stable code?
- Are dependencies explicit, minimal, and test-friendly?
- Is core logic isolated enough for unit or focused integration tests?
- Does this implementation align with documented design boundaries?

---
