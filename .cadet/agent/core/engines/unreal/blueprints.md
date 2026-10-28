# Blueprints — Unreal pack

This page is the Unreal engine pack's reference for Blueprint and asset work: a phase skill names a capability, and this page names the command, the hazards and the conventions (`.cadet/agent/core/cadet-agent.md` § Engine Seam). Scope: reading and mutating Blueprint graphs, the pin and enum traps that make a write compile and still be wrong, function and parameter conventions, UMG widget work, Blueprint components and property writes, and how a Blueprint change is proven.

## What this page covers

- Reading a graph and understanding what a chain actually does.
- Adding, rewiring and deleting nodes without leaving strays.
- Diagnosing "pins may be incompatible types" and "unknown exec output".
- Verifying an edit landed, and knowing what artifact proves it.
- C++ source changes belong to the pack's coding capability, not here.
- Session setup, tool discovery and the `mcp_call` transport belong to the MCP capability: `.cadet/agent/core/skills/MCPSetup.md`.
- Phase process is not restated here. Requirements, test-first and review are named as capabilities, and their process lives in `.cadet/agent/core/skills/Requirements.md`, `.cadet/agent/core/skills/TDD.md` and `.cadet/agent/core/skills/CodeReview.md`; a claim about what was rendered goes to `.cadet/agent/core/skills/VisualEvidence.md`.
- Project seams: root `{{projectRoot}}`, project file `{{uproject}}`, C++ module `{{gameModule}}`.

Tools are invoked through the editor bridge: a `tools/call` request naming the toolset's tool and its arguments (see [mcp.md](mcp.md) for the transport, the session and the discovery calls).

## Commands

| Task | Command |
|---|---|
| Capture a graph before the first mutation (before-image) | `read_graph_dsl`, written by you to a file under `{{projectRoot}}/Saved/Temp/` |
| List a Blueprint's graphs | `list_graphs {blueprint:{refPath:"<asset>"}}` |
| List functions, inherited included | `list_functions {blueprint:{refPath:"<asset>"}}` |
| Find node type ids | `find_node_types {graph, type_id_filter:"<substring>", context_pins:[]}` |
| Read a node type's pins | `get_node_type_pins {graph, type_id:"<Category|Id>"}` |
| Read a graph as DSL | `read_graph_dsl {graph:{refPath:"<asset>:<Graph>"}}` |
| Write a graph from DSL | `write_graph_dsl` (same `graph` ref) |
| Enumerate every node, orphans included | `find_nodes {graph, title:""}` |
| Inspect pins and connections | `get_node_infos {nodes:[{refPath}]}` |
| Classify a node's real class | `ObjectTools.get_class` |
| Create a node | `create_node` |
| Connect or break pins | `connect_pins`, `break_pins` |
| Delete a node | `delete_node` |
| Add a function graph | `add_function_graph` |
| Add a function parameter | `add_function_param` |
| Add an event dispatcher | `add_event_dispatcher` |
| Compile a Blueprint | `compile_blueprint` |
| Save assets (no object suffix in the path) | `save_assets {asset_paths:["/Game/<Path>/<Asset>"]}` |
| List dirty packages | `AssetTools.is_dirty` |
| Set component or widget properties | `ObjectTools.set_properties` |
| Reset a property to the C++ default | `ObjectTools.reset_properties` |
| Add a component to a Blueprint | `ActorTools.add_component {owner:{refPath:"<blueprint asset>"}, component_type:{refPath:"/Script/Engine.BoxComponent"}, name:"<Name>"}` |
| Read a placed instance's components | `ActorTools.get_components`, `ActorTools.get_root_component` |
| Remove a component | `ActorTools.remove_component` |
| Reparent a Blueprint | `BlueprintTools.set_parent` |
| Measure real world size | `get_actor_bounds` |
| Switch level | `SceneTools.load_level` |
| Start a play session | `EditorAppToolset.StartPIE {options:{bSimulate:false, playMode:"PlayMode_InViewPort", warmupSeconds:N}}` |
| Capture the viewport | `CaptureEditorImage` (inline base64 PNG) |
| Create a widget Blueprint | `UMGToolset.CreateWidgetBlueprint` |
| Add, move, wrap, rename or remove widgets | `UMGToolset.AddWidget`, `MoveWidget`, `WrapWidgets`, `RenameWidget`, `RemoveWidget`, `ReplaceWidgetWithChild` |
| Expose a widget as a variable, bind an event | `UMGToolset.ToggleWidgetAsVariable`, `BindToEventProperty` |
| Read the widget tree with slots, padding and font | `UMGToolset.GetWidgetDescription` |
| Compile a widget Blueprint | `UMGToolset.CompileWidgetBlueprint` |
| List widget classes | `UMGToolset.ListWidgetClasses` |
| Read compile errors since a log marker | `compile_blueprint`'s own result, then `grep -a "<MARKER>" {{projectRoot}}/Saved/Logs/*.log` |
| Build the editor target and module | `{{buildScript}}` |
| Run the project's automated tests | `{{testCommand}}` |
| Restore an asset that git cannot restore | `git lfs checkout <path>` |
| Read a gameplay assertion marker from the log | `grep -a "<MARKER>" {{projectRoot}}/Saved/Logs/*.log` |

## Conventions

### Graph edits

1. Assume `write_graph_dsl` **appends**: every node submitted is added and the old ones survive, fully intact.
2. Enumerate with `find_nodes {title:""}` before writing, and delete the nodes you are replacing — deletion is a separate, explicit `delete_node` step.
3. Treat a green compile as no evidence of tidiness; orphaned nodes compile fine.
4. Submit the **complete body** when a write names an existing function — a captured `read_graph_dsl` text with your statement inserted — then diff the read-back against the before-image line by line, because a dropped call still compiles.
5. Start every top-level form with `(event …)` or `(fn …)`; a bare statement is rejected and the graph is left unchanged.
6. Treat an **existing event** as destructive to edit: a write replaces its body and deletes the nodes it replaced. Check for the event first, by its displayed title, and write only events that do not exist yet.
7. Prefer a hook that is absent in every asset you must touch, and leave a populated hook to a human in the editor.
8. Never verify a graph with `read_graph_dsl` alone — it walks from entry points and omits everything unreachable.
9. Judge liveness by connections: a node whose `execute` pin has no incoming link is dead, however healthy its data pins look.
10. Expect a rejected write to fail atomically: a `RuntimeError` leaves the graph untouched and is safe to retry.
11. Never delete `K2Node_FunctionEntry_*` or `K2Node_FunctionResult_*` — a `FunctionResult` cannot be recreated by any tool, and every `(return …)` fails once it is gone.
12. Remember `connect_pins` **replaces** the existing link on a source pin; an exec output cannot be fanned out through the tool.
13. Join two chains with a `Sequence` (`then_0`, `then_1`) instead of re-pointing an occupied pin, and connect in an order that keeps each target input free.
14. Try `create_node` before giving up on an edit: it resolves class-pinned calls, macros and variable gets; it does not resolve cast nodes.
15. Write events and functions from the DSL only; when a hook needs a node appended to an existing chain, use `create_node` + `connect_pins` and then verify by connections.

### Node discovery

16. Never guess a type id or a pin name — use `find_node_types` and `get_node_type_pins`, and always pass `context_pins: []` or the request schema is echoed back.
17. Treat `type_id_filter` as a case-insensitive substring across every class: it returns cross-products, so pick the id whose prefix matches the owning class and confirm its pins.
18. Ignore the temporary introspection nodes `get_node_type_pins` reports — position `(0,0)`, no connections, never persisted, never a real edit.
19. Never classify a node by `type_id`: a variable node and a facade call to `GetX`/`SetX` share it. Use `ObjectTools.get_class` or the DSL prefix (`Variables|…` is a variable, `Class|<Class>|Fn` is a call).
20. Read compiler errors as a discovery tool — they list the options the tool would not guess for you.

### Pins, enums and literals

21. Never wire two different enum types together: a Blueprint enum asset and a C++ `UENUM` are distinct types however identical their members look.
22. Branch on the source enum's own case labels and supply the target enum's literals inside each arm, so every literal is resolved by the pin it feeds.
23. Use a `Switch on <Enum>` node instead of an equality node — `Equal(Enum)` often does not exist for a given enum, so a comparison simply fails to connect.
24. Learn each switch's vocabulary: a C++ enum switch takes display names and has no default pin (handle every member or the flow never terminates); a Blueprint enum switch takes internal `NewEnumeratorN` names and does have one.
25. Pass `:self self` explicitly inside a switch or if continuation — `self` may not resolve there and the error blames pin types.
26. Keyword every literal argument (`:bEnabled true`, `:Target 0.0`); a positional literal on a pin with a default can vanish silently.
27. Confirm literal values with `get_node_infos`, reading each input pin's `value` — the renderer omits pins left at their default, so a dropped `false` and a correct `false` look identical.
28. Write the inverted form yourself: `(if cond (return))` followed by more statements is normalised, not emitted as an early return.
29. Keep `(else …)` out of a chain that ends in `(elif …)` — nest instead.
30. Put any shared tail **before** a `switch` or repeat it in every case; statements after a branching form are treated as unreachable.
31. Make a cross-Blueprint entry point a **function**: a dispatcher's handler cannot be authored, and an unbound `Call<Name>` does nothing with no compile error and no log line.
32. Write a bound custom event in its own write, then `connect_pins` its `OutputDelegate` to the bind node's `Delegate` by index — a top-level `Delegate` argument is dropped otherwise.

### Functions and parameters

33. Treat a function parameter as a local variable and place a getter beside each consumer — no data wire leaves the function entry pin.
34. Write the getter explicitly (`Variables|Get<Param>`); a bare symbol resolves to the entry pin, and three consumers yielding three getters is intended, not duplication.
35. Point `graph` at the function's own graph, and create that graph and its parameters before writing its body.
36. Keep a parameter even when it goes unused — removing it breaks every caller's call node, including callers in Blueprints you cannot rewrite.
37. Break a struct once and reference the bound variables when node count matters; the DSL does not dedupe a break/make used twice.

### Widgets (UMG)

38. Enable the UMG toolset plugin in `{{uproject}}` and restart the editor before the first widget call.
39. Give `AddWidget` a real panel parent (VerticalBox, Overlay, CanvasPanel) — `null` and an already-occupied `Border` both fail.
40. Set widget properties with `ObjectTools.set_properties` on the widget subobject, passing object-valued properties (styles) as a plain path string.
41. Do not treat `renderTransform` scale as a size: wrap the widget in a `SizeBox` and set `widthOverride`, `heightOverride` **and** the `bOverride_*` booleans.
42. Use `Collapsed` to remove layout space; `HitTestInvisible` and `SelfHitTestInvisible` still reserve it.
43. Position a bottom-anchored block by editing the child slot's padding inside the root, read from `GetWidgetDescription`, rather than a SizeBox or an offset.
44. Reorder with `MoveWidget` (`newParent` = the same panel, `childIndex` ascending) and expect each insert to shift the rest.
45. Compile and save a widget change, and say which consumers a shared widget's change moves.
46. Stop PIE before reading or saving assets — while a session runs the asset tools report "does not exist" for every path, including `exists`, `get_asset_class` and `save_assets`.

### Components and properties

47. Add a component to a Blueprint by passing the **Blueprint asset** as `owner`; passing the CDO silently adds a duplicate, undone only with `remove_component`.
48. Verify a Blueprint-side add on a placed instance or through the returned `_GEN_VARIABLE` ref — the read tools take an actor instance and refuse a Blueprint.
49. Write one Vector axis per `set_properties` call and read back after each; the tool applies only the alphabetically first key present.
50. Do not treat `reset_properties` as "clear the override" — it restores the C++ class default, not the Blueprint's own value.
51. Set component values on the placed instance when it predates the Blueprint change; an existing instance keeps its serialized values and reloading the level does not fix it.
52. Compute world size as `2 × boxExtent × scale`, reading the root's `relativeScale3D` as the actor scale — do not apply scale twice.
53. Recompile after `set_parent`, and expect a reparent away from a native parent to drop its inherited components.

### Assets, dirty state and recovery

54. Expect reading a graph to dirty the package: report the dirty list and let the owner save, and never "clean up" read-induced dirt with `git lfs checkout`.
55. Confirm a suspiciously small size delta by diffing the graph DSL — a byte-identical DSL with a few bytes of drift is serialization noise, not an edit.
56. Warn before a sweep, which dirties every package it reads, and report the list afterwards; where a real edit and read-noise share a package, say which is which.
57. Check `git status` after Save All (`save_assets([])`): it re-serialises every package the session read, not only the edited ones.
58. Reserve `git lfs checkout` for genuine corruption — `*.uasset` and `*.umap` are LFS pointers, so `git diff` and `git checkout` cannot restore an asset, and the editor must not re-save over a restored file.
59. Restart the editor before wiring a call to something added in this session — a rebuilt `{{gameModule}}` function or a new Blueprint function both fail to resolve until the relaunch, even when the module build succeeded.
60. Derive timed data tables from measured runs, not assumed semantics: a row's delay is usually an offset from the previous row, and only the last row's duration does double duty.

## Verification

A Blueprint change is proven by enumeration and a compile, in this order.

1. **Before-image captured.** `read_graph_dsl` written to `{{projectRoot}}/Saved/Temp/MCP/<name>.before.json`, plus the `find_nodes {title:""}` count. That file is the artifact: without it there is nothing to diff against.
2. **Deletion set identified and justified.** Each node to remove has an unconnected `execute` pin, and no `FunctionEntry`/`FunctionResult` is in the set.
3. **Written, then enumerated again.** `find_nodes {title:""}` must return exactly the intended node set — no more, no fewer. A graph that reads clean and enumerates long is the normal failure, and the count is what catches it.
4. **Chain read back by connections.** `get_node_infos` on every node, checking each `execute`/`then`/`else` pin's `connected_pins`. The DSL render is a rendering, not a serialisation: it can re-attribute the tail of a chain.
5. **Compiled and saved.** `compile_blueprint`, then `save_assets` — a compiled Blueprint is still dirty in memory only. A green compile alone is not a pass; orphans and a dropped call both compile.
6. **Referencers compiled.** Compile every consumer, not just the asset: a DSL string grep is not an audit, because a variable get can render without the variable's name. Compile each consumer through the bridge, run `{{testCommand}}` for the project's automated tests, and treat `{{buildScript}}` as proof of the C++ side only — a module build does not compile a Blueprint asset.
7. **Gameplay-facing claims proven by assertion, not pixels.** Put a check in the graph that prints a marker and grep the log for `{{projectRoot}}/Saved/Logs/*.log`; one play session answers one question, and a captured frame has reported "no change" where an assertion answered. Layout and viewport geometry drift between sessions, so an assertion is the durable evidence; when the claim is genuinely about what was rendered, that is the Visual Evidence capability (`.cadet/agent/core/skills/VisualEvidence.md`).
8. **Dirty assets reported.** The list from `AssetTools.is_dirty`, split into edits and read-noise, so the owner can save.

The run leaves: the before-image JSON, the post-edit node enumeration, a compile result, a saved package, and a marker line in the log for any runtime claim.
