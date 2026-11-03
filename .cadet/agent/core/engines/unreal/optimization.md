# Performance Optimization — Unreal pack

## What this page covers

The Unreal pack's performance capability: how to profile a frame in this engine, the console commands that produce each number, and the frame-budget checks that turn a capture into a verdict about where the cost actually is.

A phase skill names the capability — profile the game, cut frame cost, size a memory budget — and this page names the tool, the stat and the pass convention for Unreal (`.cadet/agent/core/cadet-agent.md` § Engine Seam). Which pass to run, in what order, and when to hand control back is process, not pack business.

In scope: render cost (draw calls, material reuse, instancing, Nanite, overdraw), Niagara culling and throttling, memory budgets and texture streaming, dynamic material instances, ticking and animation update cost, and object pooling for spawn-heavy actors.

Out of scope: writing the C++ a finding calls for (`coding.md` in this pack), and reading or changing editor state — inspect it through this pack's `mcp.md`, which is what stops a recommendation from being a guess about an asset nobody opened.

Two invariants: nothing changes without a baseline taken first, and every recommendation carries a number it is measured against. If the project has no stated budget, propose one from the measured baseline, get the user to accept it, and hold to it for the rest of the work.

Editor state the commands assume: `{{uproject}}` is the project the editor and the trace host launch, and the module a fix would touch is `{{gameModule}}` — rebuilding it means the editor is closed first, per `coding.md`.

## Commands

Console commands run from the editor's console (`` ` ``) or a PIE session; the same command in a packaged build reads the same counters.

| Task | Command |
|---|---|
| Frame time and the thread split | `stat unit`, `stat unitgraph` |
| GPU breakdown for a single frame | `ProfileGPU` (`Ctrl+Shift+,`) |
| Draw calls, render thread, GPU, visibility | `stat SceneRendering`, `stat RHI`, `stat GPU`, `stat InitViews` |
| Mesh draw commands, dynamic instancing | `stat MeshDrawCommands`, `r.MeshDrawCommands.DynamicInstancing 1` |
| Niagara cost per system | `stat Niagara`, `fx.Niagara.QualityLevel <n>`, `fx.Niagara.AllowGPUParticles <0\|1>` |
| Memory pools vs measured usage | `stat Memory`, `stat MemorySummary`, `stat RHI` |
| Full memory breakdown, written to disk | `memreport -full` → `{{projectRoot}}/Saved/Profiling/MemReports/` |
| Texture memory and streaming state | `stat Texture`, `stat Streaming`, `stat TexturePool`, `r.Streaming.PoolSize <MB>` |
| Nanite cost and cluster counts | `stat Nanite`, `r.Nanite.MaxPixelsPercent <n>`, `r.Nanite.MaxCandidateClusters <n>`, `r.Nanite.ProxyTrianglePercent <n>` |
| Nanite overdraw and shader complexity views | `r.Nanite.VisualizeOverdraw`, `r.ShaderComplexity`, ViewMode → Overdraw |
| Material and DMI cost | `stat Materials`, `stat Material` |
| Tick and animation update cost | `stat Ticking`, `stat Game`, `stat Anim`, `stat Animation` |
| CPU frame timeline with GPU and bookmarks | `UnrealEditor.exe {{uproject}} -trace=cpu,gpu,frame,bookmark -tracehost=127.0.0.1`, then open the trace in Unreal Insights |
| Per-draw-call capture, overdraw, material state changes | RenderDoc — a separate install; launch the editor through it and capture one frame |
| Rebuild after a C++ fix (editor closed) | `{{buildScript}}` |
| Re-run the automated suite after a fix | `{{testCommand}}` |
| Record a baseline or a result for the report | `… \| tee {{projectRoot}}/Saved/Profiling/Optimization/<metric>-<before\|after>.txt` |

Trace artifacts land in `{{projectRoot}}/Saved/Profiling/Traces/`; memory reports in `{{projectRoot}}/Saved/Profiling/MemReports/`.

## Procedure

1. **Capture the baseline before touching anything.** Same level, same PIE resolution and scalability level, same camera position, same frame count. Record `stat unit` and `ProfileGPU`, and `memreport -full` when memory is in scope, into `Saved/Profiling/Optimization/<metric>-before.txt`. An unmeasured change is not an optimisation.
2. **Split the frame before choosing what to attack.** `stat unit` gives game thread, render thread and GPU milliseconds separately. The largest of the three names the domain: a GPU-heavy frame makes draw calls, overdraw and Niagara relevant, a game-thread-heavy frame makes ticking, animation and spawn churn relevant. Optimising the domain that is not the bottleneck produces no measured gain.
3. **Check each thread against the budget, not the sum.** At 60 Hz a frame is 16.67 ms, at 30 Hz 33.33 ms, at 120 Hz 8.33 ms, and game thread, render thread and GPU must each fit inside that on their own. Report the overshoot per thread against the target; if the project has no target, propose one from the baseline and get the user's agreement.
4. **Count draw calls and material switches.** `stat SceneRendering` and `stat MeshDrawCommands` give the count and whether dynamic instancing is on. Many unique materials on near-identical meshes inflate it: consolidate to shared materials with parameter collections instead of per-mesh materials, merge or instance repeated geometry (ISM/HISM, `MergeActors`), enable HLOD for distant LODs, and verify auto/forced LODs actually drop triangles and material work with distance. Merging removes per-instance culling and can add overdraw; LODs trade triangles for pop-in — state that trade in the recommendation.
5. **Make Niagara cost nothing when it is not visible.** Per system, inspect tick behaviour, spawn rate, particle count, GPU vs CPU, lifetime, auto-destroy and quality level. Cull by distance and visibility (`SetTickBehavior`, `SetVisibility`, `SetActive`/`Deactivate`, `bAutoDestroyWhenFinished`), pause rather than respawn an effect that will be needed again, throttle spawn rate and particle count at distance or lower quality, prefer GPU particles where supported, and replace a solid-looking effect (embers, glow, fog, decal-like) with a material or decal — a material is far cheaper than a simulation. Aggressive culling risks pop-in; material substitution looks less dynamic.
6. **Right-size the memory pools against real usage.** `memreport -full` plus `stat Memory` and `stat MemorySummary` give measured usage; compare it to the configured pools and to the target platform's ceiling. Re-size `r.TexturePoolSize`, `r.Streaming.PoolSize` and the global limits in `DefaultEngine.ini`, and review the scalability memory tiers in `DefaultDeviceProfiles.ini`. A pool far above usage wastes memory the OS could use; a starved pool streams and stutters.
7. **Audit texture footprint.** Per texture: dimensions, format, mips, Never Stream, memory size. Compute the footprint as width × height × compressed bytes per pixel × mip overhead, and flag anything over roughly 10–20 MB with its number. Re-import or resize to the size the asset is actually seen at (powers of two, mips on), confirm the format is BC-compressed — uncompressed RGBA8 is several times larger — and keep streaming on with a locked mip rather than Never Stream unless the texture genuinely must stay resident.
8. **Separate geometric from material overdraw on Nanite.** `stat Nanite` with the `r.Nanite.*` CVars, then `r.Nanite.VisualizeOverdraw` or ViewMode → Overdraw. Stacked identical meshes and intersecting shells are rasterised twice for nothing: remove the hidden overlap, merge the geometry, or mask it. Flag meshes with topology Nanite handles badly (non-manifold, interior faces, degenerate triangles, excessive vertex density) since they inflate cluster counts. Prefer ISM for repeated Nanite geometry — instances batch nearly free — and tune `r.Nanite.MaxPixelsPercent` to the detail target rather than letting it spend GPU on imperceptible detail.
9. **Count dynamic material instances.** `stat Materials` and `stat Material` show the count and state changes; the source side is `CreateDynamicMaterialInstance`, `SetScalarParameterValue` and `SetVectorParameterValue` applied per actor. Each DMI allocates a material resource and, on Nanite, **breaks batching**, because instancing cannot merge meshes with separate material instances. Reuse one DMI per material-and-parameter-set combination, share overrides through a material parameter collection, and create once and cache instead of per frame.
10. **Turn off the ticks nothing needs.** `stat Ticking`, `stat Game` and `stat Anim` show the cost; the source side is `bCanEverTick = true`, `PrimaryActorTick.bCanEverTick`, `TickComponent`, and anim graphs ticking continuously. Default ticking off and re-enable on a condition that is airtight — visible, in range, actively animating — skip when `!IsBeingRendered()`, raise `SetActorTickInterval` at distance, and keep nav queries and line traces out of `Tick`. A conditional re-enable that never fires is how this pass turns into a behaviour bug.
11. **Pool what spawns in bulk.** Find the churn (`SpawnActor`, `DestroyActor`, `SpawnSystemAtLocation`, `DestroyComponent`) on NPCs, projectiles and frequent effects. Pre-spawn a capped pool and activate/deactivate — `SetActorHiddenInGame`, `SetActorEnableCollision(false)`, tick off — which is far cheaper than destroy-then-respawn, and reset pooled state (health, animation, transform) on reuse. Pool only objects whose allocation cost justifies holding them.
12. **Re-capture under identical conditions and put the numbers side by side.** Same level, resolution, scalability and camera, into `<metric>-after.txt`. If the number did not move, the change is not an improvement: revert it or keep looking. Never report a metric you did not take — when a tool is missing (RenderDoc is not part of the engine), name the install the user has to make and the metric it will produce.
13. **Tie every finding back to a pass and a number.** Each row of the report states the metric, its before, its after, the budget, and the evidence file. A recommendation without a measurement is a suspicion, and belongs in the report as "unverified — needs an editor or profiler check".

## Verification

- **Baseline artifact** — `<metric>-before.txt` taken before the change, carrying level, resolution, scalability level and camera position, proves there is something to compare against; without it the after-number means nothing.
- **Before/after pair** — `<metric>-after.txt` captured under the same conditions proves the delta and nothing else. The artifact is the two files side by side with the delta computed, not a remembered impression of smoothness.
- **Frame-budget check** — `stat unit` showing game thread, render thread and GPU each under the frame budget (16.67 ms at 60 Hz, 8.33 ms at 120 Hz) proves the frame now fits; artifact is the stat readout with the frame number and the target it is measured against.
- **GPU pass table** — `ProfileGPU` before and after proves which pass gave the time back, and catches a cost merely moved elsewhere; artifact is the two pass tables.
- **Memory evidence** — two `memreport -full` reports prove pool usage moved relative to its configured ceiling; artifact is both reports under `Saved/Profiling/MemReports/`, with the pool-versus-usage numbers quoted.
- **CPU timeline** — an Insights trace with bookmarks marking before and after proves the game-thread delta across frames rather than a single lucky frame; artifact is the `.utrace` under `Saved/Profiling/Traces/`.
- **Per-draw-call proof** — a RenderDoc capture of one frame proves draw-call count, overdraw and material state change at the call level; artifact is the capture plus the draw-call list you cite. If RenderDoc is not installed, the finding stays unverified and says so.
- **Behaviour intact** — `{{testCommand}}` green after the change proves the optimisation did not break what it touched, and a PIE run of the affected level proves the pooled, un-ticked or culled objects still behave; artifact is the run report and the record of what was played and observed.
- **Stated gaps** — the list of metrics not captured, and why, is part of the artifact: an unmeasured claim is reported as unmeasured, never as an improvement.
