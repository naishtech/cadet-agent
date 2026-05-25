# Purpose

Define performance standards for Unity projects so delivered features remain testable, scalable, and playable on target hardware.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Standard Description
This standard governs runtime performance for gameplay, rendering, memory, and asset loading. It enforces measurement-first optimization, small validated improvements, and preservation of frame-time budgets across implementation and iteration. Preferred micro-optimization idioms live in the guidance layer, not in this standard.

## Rules
- Profile before optimizing and after every meaningful optimization change.
- Use Unity Profiler as the primary source of truth for CPU, GPU, memory, GC, and rendering hotspots.
- Optimize for frame time stability, not only average FPS.
- Define target-platform budgets for frame time, memory, and GC allocation.
- Avoid per-frame allocations in hot paths and gameplay loops.
- Prefer object pooling for frequently spawned/despawned runtime objects.
- Use incremental, testable optimization steps and re-measure after each step.
- Validate expensive rendering behavior with Frame Debugger and appropriate batching strategy.
- Use Memory Profiler snapshots when diagnosing leaks, spikes, or asset retention issues.
- Keep optimization changes aligned with requirements and technical design artifacts.

## Validation Checklist
- Baseline profile captured before optimization work.
- Post-change profile captured and compared to baseline.
- CPU hotspots and GC spikes reviewed in Unity Profiler.
- GPU/render cost inspected with Frame Debugger when rendering is affected.
- Memory usage and retention inspected with Memory Profiler for memory-related work.
- Frame-time stability checked in representative gameplay scenarios.
- Target-platform build tested, not only in Editor.
- Performance-related plan and design documents updated with findings and decisions.

## Common Violations
- Optimizing based on assumptions without profiling evidence.
- Treating FPS average as sufficient without frame-time analysis.
- Introducing per-frame allocations in `Update` or similar hot paths.
- Running heavy logic on main thread when safer alternatives exist.
- Ignoring platform-specific constraints and only testing in Editor.
- Merging optimization changes without documenting measurement outcomes.

## Review Questions
- What baseline metrics were captured before this change?
- What measurable improvement (or regression) was observed after the change?
- Were GC allocations in hot paths reduced or eliminated?
- Did profiling include target hardware or representative environments?
- Are optimization tradeoffs documented and synchronized with design and plan artifacts?

---
