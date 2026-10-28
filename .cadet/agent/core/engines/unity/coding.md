# Coding — Unity pack

The C# and asset conventions a Unity change must hold. The phase procedure lives in the core skills; this page adds what Unity makes true.

## What this page covers

How to write a MonoBehaviour, how to assemble a runtime object, what the analyzer rejects, and which editor step a change needs before it is real.

## Commands

| Task | Command |
|---|---|
| Compile without opening the editor | `unity build <project> --target <target> -o <out> --format json` |
| Compile check on a running editor | `unity command --project-path <root> eval "return !UnityEditor.Compilation.CompilationPipeline.isCompiling"` |
| Read analyzer diagnostics | `unity run <project> --command <analyzer-cmd> --format json` |
| Recompile after an edit | ask the user to focus the editor window; do not script it |
| Generate a real GUID for an asset file | `uuidgen`, or `powershell -Command "[guid]::NewGuid()"` on Windows |

## Conventions

1. Keep a `MonoBehaviour` thin: orchestration and lifecycle, not business logic. Put the logic in a plain class the behaviour calls, so it can be tested without a scene.
2. Prefer `[SerializeField] private` fields over public ones. A public serialized field is a second API surface that the Inspector and every caller can mutate.
3. Author tunable values as serialized private fields or a `ScriptableObject`, not as constants. Scene-tuned data belongs in the asset that holds the object.
4. Register event handlers in `OnEnable` and unregister them in `OnDisable`. `Awake` runs before the object is active, and a subscription made there outlives the object's active life.
5. Track the coroutine handle when a second start could overlap or a cancel is possible. `StopAllCoroutines` is not a design.
6. Use `TryGetComponent` with a narrow early exit when the component's presence depends on how the object was composed. Do not assume it is there because the prefab in front of you has it.
7. Prefer composition and interface seams over inheritance chains. A deep hierarchy is the shape that makes the next behaviour a base-class edit.
8. Centralise persisted keys, tags, layers and scene identifiers in an enum or a constants class. A string literal in two files is a rename waiting to fail.
9. Document an enum or identifier whose order is externally meaningful — build order, inspector index — beside its definition.
10. Never hand-craft a GUID or a `.meta` value. Generate it through the OS, and let the editor create the asset where it can.
11. An asset change (prefab, scene, material, font) is not a code change: after you edit one, the editor must reimport it before the change is visible.
12. Do not edit a scene or prefab while the editor has it open. The editor holds the in-memory copy and writes it back over your text.

## Verification

- A C# change is proven by a compile that the editor performed, and by a test that ran against it. A file that was written is not a file that compiled.
- The commit gate is `compileCheckConfirmed` plus `unityAnalyzerClean`; both are automated where the project declares the command, and both fall back to a recorded manual confirmation otherwise. See [verification.md](verification.md).
- An analyzer diagnostic is blocking, not advisory. The `UNT*` family covers null propagation on Unity objects, tag comparison cost, coroutine signatures and more; enforce them through the gate rather than by reading the list.
- After a prefab or scene edit, the evidence is a frame or a clip from the running game (the Visual Evidence skill), not the text of the asset file.
