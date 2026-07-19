# Purpose

Capture preferred Unity engineering patterns that have worked well in practice and should guide Cadet's default recommendations unless the current problem gives a better reason to choose differently.

## Backlinks
- Identity reference: [../Identity](../Identity.md)
- Learner model reference: [../LearnerModel](../LearnerModel.md)
- Principles reference: [../Principles](../Principles.md)
- Workflow reference: [../Workflow](../Workflow.md)

## Guidance Role
- This document records preferred patterns, not mandatory standards.
- Apply this guidance as a default heuristic when it improves clarity, maintainability, and production safety.
- When a relevant standard or active repository policy conflicts with a pattern here, the standard or policy wins.

## Preferred Unity Patterns
- Keep MonoBehaviours thin and focused on orchestration rather than business-heavy logic.
- Prefer prefab-based composition for reusable runtime assemblies and easier test setup.
- Prefer `[SerializeField] private` dependencies over public serialized fields so wiring stays explicit without broadening public surface area.
- Prefer authored configuration through serialized private fields for prefabs, clips, materials, timings, and other scene-tuned values instead of burying those settings in code.
- Prefer clear backing-field accessors, including expression-bodied readonly properties, when they improve readability.
- Prefer serialized structs for immutable or snapshot-like serialized payloads when they keep data flow simpler.
- Prefer named event handlers over anonymous handlers when traceability, breakpoints, and lifecycle management matter.
- Prefer registering event handlers in `OnEnable` and unregistering in `OnDisable` for lifecycle-managed Unity components.
- Prefer event decoupling patterns when they keep systems loosely coupled without obscuring ownership.
- Prefer avoiding public static mutable state and expanding singleton use only when the tradeoff is explicit and justified.
- Prefer tracking active coroutine handles when overlapping execution or cancellation would otherwise become error-prone.
- Prefer organizing Inspector sections with attributes such as `[Header]`, `[Range]`, and `[Tooltip]` when it improves authoring clarity.
- Prefer centralizing tunable data in ScriptableObjects or equivalent configuration assets when that improves reuse and iteration speed.
- Prefer composition and interface-based seams over inheritance-heavy abstraction when extending gameplay behavior.
- Prefer centralized enums or constants for persisted keys, scene identifiers, tags, layers, and similar runtime identifiers instead of scattering string literals or magic numbers.
- Prefer `TryGetComponent` with narrow early exits when component presence depends on runtime composition, rather than assuming the component is always present.
- Prefer documenting externally ordered identifiers, such as build-order or inspector-index-dependent enums, directly next to the definition so later edits do not silently break assumptions.

## When To Defer
- Defer to standards when the issue is about mandatory quality gates such as testing, security, or performance discipline.
- Defer to an active repository policy when the repository already defines a required naming, layout, logging, or serialization convention.
- Defer to the current problem when a preferred pattern would add indirection without real benefit.

## Anti-Patterns
- Treating every preferred pattern here as a universal rule.
- Ignoring a simpler design because a familiar pattern appears in this guidance.
- Applying a pattern from this document when a repository policy explicitly requires a different approach.
- Lowering code quality because a preferred pattern was omitted in one specific case.
- Replacing clear authored scene or prefab configuration with hidden hardcoded values for no practical gain.

---