# Planning — Unreal pack

A design for an Unreal change is priced by four things: whether it adds reflected types, whether it touches a header many translation units include, whether the editor has to close, and whether the result must be cooked or baked before anyone can see it. This page states the constraints that follow. The planning process itself — the interview, ETC, the design document, the assumption audit — lives in the core skills.

## What this page covers

The Unreal-specific planning constraints: module and `.Build.cs` boundaries, the editor-close rule before a module build, what a cook or a bake adds to the cost of a change, and which engine version a design may assume.

## Constraints

1. **Name the owning module before naming a type.** `{{gameModule}}` is the default owner. A second module is a new `.Build.cs`, an entry in `{{uproject}}` under `Modules` with a `Type` and a `LoadingPhase`, and a dependency from everyone who wants to call into it. A design that adds a module without saying why the existing one cannot hold the type has bought a permanent boundary.

2. **A module dependency is a compile-time edge, and it must stay acyclic.** List a module in `PublicDependencyModuleNames` only when a public header exposes its types; otherwise use `PrivateDependencyModuleNames`. A public edge reaches every dependent module and can close a cycle that UBT rejects outright, so the design names the edge and the reason it has to be public.

3. **A reflected type costs a full build, not a hot patch.** `UCLASS`, `USTRUCT`, `UENUM`, `UPROPERTY` and `UFUNCTION` are read by UnrealHeaderTool at build time and written into generated headers; Live Coding patches function bodies only. Plan the reflected surface of a change as one slice that ends in a build, and iterate on bodies after it.

4. **The editor stays closed for a module build.** An open editor holds `UnrealEditor-<Module>.dll` mapped, and the link step cannot replace it — LNK1104 on Windows. A plan with a C++ change therefore needs an explicit step where the editor is closed and `{{buildScript}}` runs. A plan that omits that step stalls at its first compile and blames the code.

5. **A cook is a separate acceptance path, measured in minutes to hours.** If an acceptance criterion can only be seen in a packaged build, the plan owes a cook per verification, and a cook re-runs for content changes that a code-only loop never touches. Prefer proving the criterion in the editor or in an automation test, and reserve the cook for the slice that has to ship.

6. **Lighting and shaders are bake artifacts, not source.** Moving or adding static geometry invalidates a level's lighting; a material or shader change invalidates the shader cache. Each turns one visible frame into a bake or a compile, so a plan that relights a level schedules that cost as its own slice rather than as a detail of a gameplay one.

7. **`EngineAssociation` in `{{uproject}}` is the only engine version the design may use.** An API that exists in a newer engine is not available to this change, a plugin built against another version does not load until it is rebuilt, and a deprecated symbol may already be gone. An engine upgrade is its own change with its own risk, never a side effect of a feature.

8. **A widely included public header is the most expensive thing to touch.** A header the module exports rebuilds every translation unit that includes it, and when it takes part in reflection it also forces the editor restart in constraint 3. Prefer a change local to a `.cpp`, or a new private type, over an edit to a header other modules already include.

9. **Blueprint is cheap to iterate and expensive to own.** It needs no build, but a Blueprint asset is binary: a reviewer cannot read the change as a diff, and no automation test exercises a graph the way it exercises a C++ type. Plan Blueprint for tuning, composition and designer-facing wiring; plan C++ for the logic that must be reviewed, tested or searched.

10. **A content move is a migration, not a rename.** Moving or renaming an asset rewrites the paths of everything that references it, and a reference with no redirector left behind resolves to nothing at load. Plan a move as its own slice, proved by loading the map that uses the asset rather than by reading the diff.

## Verification

- Every new type in the design names one owning module, and every module the design adds appears in `{{uproject}}` with a `LoadingPhase`, beside a `.Build.cs` that declares its dependencies.
- The structural slice ends with `{{buildScript}}` having run against a closed editor. A link error on a locked DLL is the evidence that constraint 4 was skipped, not a flaky build.
- The behavioural slice ends with `{{testCommand}}`, or with a named editor or cook artifact when no automation test can reach the criterion.
- Every engine API the design cites exists in the headers of the version `{{uproject}}` pins. Read the engine install; do not cite from memory.
- A scheduled cook or bake names its artifact — a package directory, a lightmap — and the slice's evidence points at that artifact, not at the log line that started it.
