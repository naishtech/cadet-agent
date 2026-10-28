# Editor automation — Unreal pack

The Unreal half of the MCP capability: the bridge's toolsets and tools, the sequence that turns an HTTP endpoint into a live editor session, the one read that proves a round trip, and the line at which a read becomes a mutation the user must approve.

Setup, approval and how the record is written are core: `.cadet/agent/core/skills/MCPSetup.md`. This page supplies the endpoint, the tool names and the argument shapes for Unreal.

## What this page covers

- Opening a session against the editor's bridge and discovering what it exposes.
- Reading and writing Blueprints, actors, assets, properties, widgets, data tables and StateTrees through it.
- The failure modes that make a call return nothing rather than an error.
- What proves a call worked, and what proves it changed what you meant.

Out of scope: C++ source, builds and tests ([coding.md](coding.md)); a direct file read, which is the fallback when no editor runs and never a substitute for a live read.

## The transport

The bridge plugin listens on a local HTTP endpoint — `http://127.0.0.1:8000/mcp` is the common default, and the plugin's own setting is authoritative. Every request is a JSON-RPC 2.0 POST with `Content-Type: application/json`.

| Task | Request |
|---|---|
| Open a session | `curl -sS -D- -X POST <endpoint> -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"cadet","version":"1"}}}'` — keep the `Mcp-Session-Id` response header |
| List every tool | `tools/list` with the session header; each entry carries `name`, `description` and `inputSchema` |
| One tool's schema | the entry for that name in the same `tools/list` response |
| Call a tool | `tools/call` with `{"name":"<tool>","arguments":{...}}`, session header included |
| End the session | delete the session, or let the editor drop it |

A project may ship shell wrappers around these calls — a session initialiser, a cached `tools/list`, a call helper. Use them when they exist, because they usually manage the session id and the cache; this page names the protocol, because a wrapper is the project's file and the pack cannot assume it.

## Toolsets and tools

Pass the tool name to `tools/call` as written. A toolset name is a grouping in `tools/list`, not part of the argument.

| Area | Toolset — tools |
|---|---|
| Blueprint graphs: read, write, rewire, compile | `BlueprintTools` — `read_graph_dsl`, `write_graph_dsl`, `get_connected_subgraph`, `find_nodes`, `get_node_infos`, `delete_node`, `break_pins`, `connect_pins`, `compile_blueprint`, `set_variable_instance_editable` |
| Object properties | `ObjectTools` — `get_properties`, `set_properties`, `list_properties` |
| Assets: dependencies, referencers, saving, dirtiness | `AssetTools` — `get_dependencies`, `get_referencers`, `save_assets`, `is_dirty` |
| Level actors | `SceneTools` — `find_actors`, `add_to_scene_from_asset`, `save_actor` |
| Window and viewport capture | `EditorAppToolset` — `CaptureViewport`, `CaptureEditorImage` |
| Arbitrary editor scripting (last resort) | `ProgrammaticToolset` |
| StateTree topology | `StateTreeTools` — `get_root_states`, `get_children`, `get_tasks`, `get_transitions`, `get_enter_conditions`, `get_global_tasks`, `get_evaluators`, `get_node_description`, `get_editor_data` |
| Materials and material instances | `MaterialTools`, `MaterialInstanceTools` |
| Widget trees | `UMGToolset` — `GetWidgets`, `WrapWidgets`, `AddWidget`, `MoveWidget` |
| Data tables | `DataTableTools` — `create`, `add_rows`, `set_rows` |

## Procedure

1. **Confirm the endpoint first.** If nothing answers, stop the editor operation, name the prerequisite that failed and what the user must start. Never substitute a file-level guess for a live read.
2. **Open the session and keep the id.** `initialize` returns `Mcp-Session-Id` in a response header; every later call carries it. A project wrapper stores it in a file; without one, keep it in the shell for the session.
3. **Discover before calling.** `tools/list`, then read the target tool's `inputSchema` and take the argument names verbatim. An invented argument is the most common failure.
4. **Route the request to one server.** Editor state → this bridge. C++ symbols and references → whatever source-intelligence server the project configures, pointed at `{{projectRoot}}`. Git, builds and files → the terminal. Do not force one to do the other's work, and do not fall back to grep for a symbol question the index can answer.
5. **Pick the narrowest tool.** `BlueprintTools`, `ObjectTools` and `AssetTools` cover nearly all asset work; `ProgrammaticToolset` only when no dedicated tool exists.
6. **Handle a relaunched editor.** A restarted editor invalidates the session id, and every call then returns **empty with no error** — a `find_actors` for an actor that plainly exists comes back blank. A schema fetch is the one call that reports it (`Unknown session id`). Re-run `initialize`, replace the stored id, and after a relaunch poll `get_current_level` until the level has loaded instead of trusting the port.
7. **Match the parameter casing.** Some toolsets take camelCase, others snake_case; a wrong name fails loudly and prints the schema, so read it rather than guessing a second name. An empty `returnValue` with no error means check the session, not the arguments.
8. **List properties before reading them.** `list_properties` returns a schema in lowerCamelCase that does not match the C++ name. A wrong name aborts the whole batch (`the following properties could not be read`) and loses results already gathered.
9. **Work around writes that silently refuse.** `set_properties` cannot write a Blueprint variable that is not Instance Editable: it reports every property unset whatever the value shape. Flip the flag with `set_variable_instance_editable`, `compile_blueprint`, then set again.
10. **Grow an array one entry at a time.** A batch that changes an array's size and its elements at once fails as ambiguous. Append one entry per call, sending the whole array each time, and re-send every existing entry byte-identical to storage, including fields you are not setting.
11. **Save a level edit with Save All, not with the level.** An actor added from an asset writes its own external-actor package, and only `save_assets([])` persists that package and the level's actor list. Save the level alone, reload, and the actor is gone even though the save returned true.
12. **Edit the instance, not the class default.** A placed actor keeps its own copy of every exposed value, so writing the `Default__` object changes nothing in a run. Find the instance with `find_actors` (which takes all of `name`, `tag` and `collision_channels`, even when empty), then write it. With PIE running it also returns the `UEDPIE_0_` duplicate; drop any refPath containing `UEDPIE` or you edit a copy that is thrown away.
13. **Fill a data table in order.** `create` makes an empty table; `set_rows` on it fails because the rows do not exist. Order is `create` → `add_rows` → `set_rows`. Text set this way comes back `NSLOCTEXT(...)`-wrapped.
14. **Read a StateTree live, not by string archaeology.** Pass the asset as a refPath with the doubled name (`/Game/<dir>/<Name>.<Name>`); the bare path is refused. States come back as refPaths; a state's own name and type need `get_properties`, whose `returnValue` is a JSON string inside the JSON — parse it twice or every state reads `None`.
15. **Never mutate destructive graph state blind.** `write_graph_dsl` appends: superseded nodes survive as strays until `delete_node` removes them. Before the first mutation, dump the **full** `get_connected_subgraph` from the event entry point to a file. Never derive a deletion set from a filtered view, which hides the steps between the nodes you are looking at.
16. **Verify by re-deriving, not by re-reading intent.** After each mutation, re-read the entry-point subgraph and diff the reachable node set against the capture. `read_graph_dsl` serialises only exec-reachable nodes, so a clean read-back can sit on top of orphans — check with `find_nodes`.
17. **Stop before a write.** Reads, listings, schema fetches, captures and dependency queries run without asking. Anything that changes editor state — `set_properties`, `write_graph_dsl`, `delete_node`, a rewire, `add_to_scene_from_asset`, `save_assets`, any `ProgrammaticToolset` call — is a mutation: name the asset and the exact edit, get the user's confirmation, record it, then execute. No reasoning about intent reclassifies a write as a read.
18. **Expect dirty packages.** A graph read re-dirties the package it reads, so `is_dirty` still reads true after Save All for Blueprint and StateTree packages. Report the dirty list; it is a side effect of reading, not a fault.
19. **Know what git cannot undo.** `.uasset` and `.umap` are LFS-tracked: `git diff` and `git checkout` operate on the pointer. The pristine object is restored with `git lfs checkout <path>`, and the editor must not re-save over it. An unsaved graph edit is not recoverable by git.
20. **Close the editor after saving, not before.** Saving runs through the bridge, so it needs the editor alive; the restart the build page requires is a separate step, and it must not begin until every dirty package is on disk.

## Verification

- **Transport and handshake** — an `initialize` that returns a session id, and a `tools/list` that comes back non-empty, prove the server is up. The artifact is the session id with its timestamp.
- **Round trip** — ask for the editor's own state (`get_current_level`), then one trivial read, and keep the bytes and a hash. Two answers from the editor are the proof; a stanza in a client config file is not.
- **Schema match** — the `inputSchema` for the tool, saved beside the arguments you passed, proves the call was shaped from the tool's own contract rather than from memory.
- **Mutation approval** — the recorded confirmation naming the asset and the edit, timestamped before the write, is the artifact that the boundary held.
- **Graph edit completion** — `compile_blueprint` succeeding **and** the post-edit entry-point subgraph diffing clean against the pre-edit capture prove the graph is valid *and* still shaped as intended.
- **Save and close** — the save's own success report proves the packages reached disk; `is_dirty` does not. The artifact is the saved package list.
- **Visual claim** — `CaptureViewport` returns the viewport with wireframe and gizmo, so capture the game view instead, and route a claim about what a frame shows through `.cadet/agent/core/skills/VisualEvidence.md`.
- **Dirty-asset report** — the list of packages left dirty by an inspection pass, quoted with what was read, lets the user decide what to save.
