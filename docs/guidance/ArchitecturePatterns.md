# Purpose

Capture preferred architecture patterns and design heuristics that have worked well in Unity production so Cadet can favor them by default without treating them as mandatory standards.

## Backlinks
- Identity reference: [../Identity](../Identity.md)
- Learner model reference: [../LearnerModel](../LearnerModel.md)
- Principles reference: [../Principles](../Principles.md)
- Workflow reference: [../Workflow](../Workflow.md)
- Architecture skill: [../Skills/Architecture](../Skills/Architecture.md)

## Guidance Role
- This document records preferred architectural defaults, not hard requirements.
- Use these patterns when they improve clarity, extensibility, testability, or long-term maintainability.
- When a standard or active repository policy requires a different approach, that requirement wins.

## Preferred Architecture Patterns
- Prefer interface-first seams when they improve substitution, testing, or service boundary clarity.
- Prefer organizing larger systems by feature or domain boundaries, including separate assemblies or modules when that improves ownership clarity, compile isolation, and navigation.
- Prefer extending existing platform, transport, lifecycle, and UI pipelines before introducing a new framework or abstraction layer.
- Prefer central service binding and routing patterns when they reduce duplicated platform logic.
- Prefer explicit data flow and ownership boundaries over hidden side effects or implicit global coordination.
- Prefer composition-based feature assembly over inheritance-heavy hierarchies when gameplay behavior needs to evolve incrementally.
- Prefer recommending a quick spike for a new feature or mechanic first: get the simplest demonstrable version working end to end before investing in polish, extensibility, or production cleanup. See [SpikePatterns](SpikePatterns.md) for the full spike lifecycle rules.
- Prefer explicit state machines for game flow, connection flow, or actor modes once transitions become hard to reason about in a single script, especially when separate Enter, Update, and Exit behavior keeps change safer.
- Prefer identifying persistence, migration, rollout, and fallback behavior up front when a design touches stateful systems.
- Prefer keeping spike code and production code separate once the feasibility question has been answered.
- Prefer design notes that explain why a seam, abstraction, or extra layer exists so later changes can preserve the intent.
- Prefer service access through capability checks such as `TryGetService(...)` plus fail-fast guard clauses when runtime service availability can vary by scene, mode, or initialization state.
- Prefer safe no-op or early-return behavior when scene-dependent services or objects are unavailable and the situation is recoverable, rather than forcing avoidable hard failure.

## When To Defer
- Defer to standards for non-negotiable quality gates such as testing, security, and performance discipline.
- Defer to an active repository policy when the repo defines required shared-code locations, naming, or architecture conventions.
- Defer to simpler problem-specific designs when an architectural pattern would add indirection without clear payoff.

## Anti-Patterns
- Treating every reusable pattern as if it must become a framework.
- Adding abstraction layers before the design pressure is real.
- Mistaking preferred architecture guidance for a universal rule.
- Ignoring an active policy because a guidance pattern feels more elegant in isolation.
- Assuming services or scene objects are always available when the runtime lifecycle clearly allows them to be absent.
- Polishing or generalizing a new mechanic before proving the core interaction is actually fun, clear, or technically feasible.
- Letting a single controller script accumulate too many state transitions when an explicit state machine would make the behavior easier to extend and review.

---