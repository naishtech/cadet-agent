# Breakdown — Unreal pack

An Unreal epic is cut along the seams the engine enforces, not along the seams a design happens to draw. A reflected type and a function body sit on opposite sides of a build; a Blueprint and a C++ class sit on opposite sides of "can a reviewer read the change"; and a behaviour that only appears in a packaged build costs a cook every time it is proved. This page supplies the shapes a story takes when those seams apply, and the evidence that closes each one.

## What this page covers

The slice shapes Unreal work falls into — the C++ pair, the Blueprint and asset shapes, and the four shapes that exist because of replication, cooking, content moves and baked output — plus what makes an Unreal slice independently verifiable and what each shape's evidence is.

[planning.md](planning.md) prices a change. This page cuts an already-priced change into stories.

## Slice shapes

A slice is independently verifiable in Unreal when all four of these hold:

- **It ends in a signal, not a step.** A compile, an automation report, a loaded map, a launched package — something a second person can re-run or re-open. "The code is written" is not a signal.
- **It names the artifact.** The build's exit, the report directory `{{testCommand}}` writes, the map that loads, the package directory. A slice with an unnamed artifact cannot be closed, only assumed.
- **It crosses at most one seam.** A slice that adds a `UCLASS` *and* the behaviour behind it carries two signals and will be closed on the weaker one.
- **It adds a system only when `{{projectRoot}}` has none.** Search before declaring. A slice that re-creates an existing subsystem is a slice somebody deletes next month.

The shapes are listed by what they unlock, not by what is easiest. Risk ordering still applies, but Unreal constrains it: disprove the riskiest assumption with the cheapest shape that can touch it — a Blueprint prototype, a debug command, one log line — *before* the reflected surface is declared, because renaming a `UCLASS` afterwards is a full rebuild plus a content rewire.

1. **Reflected surface (C++).** Adds the declarations only: the `UCLASS`/`USTRUCT`/`UENUM`, the `UPROPERTY`/`UFUNCTION` surface, and the module that owns them (usually `{{gameModule}}`), with its `.Build.cs` already listing whatever the type depends on. Verified by `{{buildScript}}` running against a closed editor, with the generated header present for the type. There is no behaviour to test yet, so the compile *is* the acceptance — this slice is green when the link succeeds, not when a test does.

2. **Logic behind that surface (C++).** Adds function bodies for one observable behaviour, with the reflected surface unchanged. Verified by `{{testCommand}}` running the tests that name the behaviour. Because no header contract moved, the loop is incremental and Live Coding can carry the iterations, so this is the shape to iterate in.

3. **Blueprint or asset behaviour.** Adds a graph, a widget, a data asset, a tuned default. Verified by playing a named map in the editor and writing down what the person saw — a Blueprint asset is binary, so the witness, not the diff, is the evidence. A slice here that also changes a C++ contract belongs in shape 2 instead; splitting it that way is what keeps the review readable.

4. **Content move or rename.** Adds a new path and the redirectors that keep the old one resolving. Verified by loading every map and Blueprint under the project's `Content/` root that referenced the asset and finding it there, and by the old path appearing in no reference. A move that also relights or recooks the level is a separate slice, not a detail of this one.

5. **Data and configuration.** Adds rows to a `UDataTable`, entries in a `UDeveloperSettings`, `.ini` values, a curve, or a gameplay tag. Verified by reading the value back at runtime in a test, or by the witness showing the tuned behaviour, plus the asset surviving a save/load round trip — a settings slice that does not persist was never applied.

6. **Replication.** Adds the authority boundary: replicated properties, RPCs, and what a client may predict. Verified by a two-peer session — a listen server and a client — recording the server's decision and what the client saw before and after. Single-player PIE proves nothing about this shape, and treating it as proof is the usual reason a replication defect ships.

7. **Packaged-only behaviour.** Adds the thing that exists only after a cook: a shipping-only path, a packaged config, a plugin loaded at startup. Verified by a cook that completes and a packaged session that launches and shows it; the package directory is the artifact, and the log line that started the cook is not.

8. **Visual or baked output.** Adds geometry, a material, a lighting change. Verified by the bake or shader compile finishing *and* a captured frame showing the result, recorded as visual evidence. The frame is the claim; the bake log only says a bake ran.

Shapes 1 and 2 are the C++ pair and stay separate because their costs differ by orders of magnitude: a full build is minutes and wants the editor down, a body change is seconds. Shapes 3 and 8 are where Blueprint work lands, because neither leaves a diff a reviewer can read — one is witnessed by playing, the other by looking.

## Verification

What closes each shape, stated as evidence rather than as activity:

| Shape | Evidence that closes it |
|---|---|
| 1 Reflected surface | `{{buildScript}}` exit 0 with the editor closed, and the generated header present |
| 2 Logic | the automation report written by `{{testCommand}}`, naming the `{{gameModule}}.Unit.*` tests that prove each criterion |
| 3 Blueprint / asset | a named map, played, with the observed behaviour written down |
| 4 Content move | every referencing map loads, and no reference resolves to the old path |
| 5 Data and config | a test that reads the value back, or the witnessed tuned behaviour, plus a save/load round trip |
| 6 Replication | a two-peer session, with server and client observations recorded separately |
| 7 Packaged-only | a completed cook and a launched packaged session, pointing at the package directory |
| 8 Visual / baked | a completed bake or shader compile, plus a captured frame |

- A story closed by a shape's evidence it does not have — a C++ claim closed by a Blueprint witness, a packaged-only claim closed by a PIE session — is not done, whatever the story's status says.
- `{{uproject}}`'s `EngineAssociation` names the engine version every slice builds and tests against. Evidence gathered in another version's editor is evidence of a different build.
- When no shape can reach a criterion through an automation test, the story names the artifact that stands in for one — a recorded frame, a package, a map load — or the criterion is not verifiable and the story is not ready.
