# Purpose

Capture preferred Unity performance patterns and micro-optimization heuristics that have paid off repeatedly, without turning every optimization idiom into a hard standard.

## Backlinks
- Identity reference: [../Identity](../Identity.md)
- Learner model reference: [../LearnerModel](../LearnerModel.md)
- Principles reference: [../Principles](../Principles.md)
- Workflow reference: [../Workflow](../Workflow.md)
- Performance standard: [../Standards/Performance](../Standards/Performance.md)

## Guidance Role
- This document records optimization patterns to prefer after measurement suggests they are relevant.
- Apply this guidance after the performance standard's measurement-first discipline has been followed.
- When a specific optimization is irrelevant, premature, or harmful to readability, skip it.

## Preferred Performance Patterns
- Prefer caching `WaitForSeconds` instances in hot coroutine paths when repeated allocation shows up in profiling or known-heavy loops.
- Prefer caching shader property IDs via `Shader.PropertyToID()` when shader properties are accessed repeatedly in hot paths.
- Prefer moving repeated string-keyed rendering or animation lookups behind cached identifiers when profiling indicates avoidable overhead.
- Prefer explicit ownership of frequently reused runtime objects, pools, and temporary allocations when spawn-heavy behavior is involved.
- Prefer documenting why a micro-optimization exists when the code would otherwise look arbitrary or overly clever.

## When To Defer
- Defer to profiling evidence before applying micro-optimizations broadly.
- Defer to readability when the code is not on a hot path and the optimization has no measured payoff.
- Defer to repository policy if the project has explicit optimization patterns or wrappers that should be used consistently.

## Anti-Patterns
- Treating guidance-level optimizations as mandatory even when the profiler shows no issue.
- Sprinkling micro-optimizations across cold code paths without evidence.
- Keeping opaque optimization code without comments or rationale where the intent is not obvious.
- Replacing measurement with folklore.

---