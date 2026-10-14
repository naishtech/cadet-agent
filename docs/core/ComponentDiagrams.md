# Component Diagrams

`cadet-agent harness diagram` renders the C# structure as UML component diagrams and colours every
component by how far the work on it has progressed. It exists to answer one question at a glance:
*what is built, what is half-built, and what has not been started* — for each package, without
reading `state.json` by hand.

## What it reads

- **C# sources** and Unity **`.asmdef`** assembly definitions under the scanned root.
- **`.cadet/state.json`** — the epics, their stories, and each story's status.
- **`.cadet/archive/evidence/*.jsonl`** — the same records after a closed work item's evidence has
  left `state.json`. Without this the archive would be invisible and finished stories would read red.

## Packages and components

| Level | Source | Fallback |
|---|---|---|
| Package | a Unity `.asmdef` (its `name`), with `references` resolved through the assembly name or the `.asmdef.meta` GUID | each top-level folder that holds C# |
| Component | a `namespace` inside a package | the containing folder for files that declare none |

Edges between components are derived, best-effort, from `using` directives: a `using` is matched to
the longest component namespace that prefixes it. This reads declarations, not the compiled type
graph, and the diagrams should be read the same way.

## Progress and colour

A component is coloured by **every** story that touched it, in **any** epic — not only the stories
of the diagram's own epic. A component finished in an earlier epic is therefore green in a later
epic's diagram too. The epic decides what a diagram *shows*; it does not decide the colour.

| Colour | Status | Meaning |
|---|---|---|
| 🔴 `#E05555` | `not-started` | no story anywhere touched it |
| 🟠 `#E8A840` | `in-progress` | some touching stories are `done`, but not all |
| 🟢 `#4A9A5A` | `done` | every touching story is `done` |

An epic that touches nothing in a package produces no diagram for that package.

## Test assemblies

Unity test assemblies are **excluded by default**. They are numerous, each usually holds a single
namespace, and their one-component diagrams crowd the index. An assembly is recognised as a test
assembly by what it references — `UnityEngine.TestRunner`, `UnityEditor.TestRunner`, or
`nunit.framework.dll` in `precompiledReferences` — not by its name, because projects name test
assemblies inconsistently. Pass `--include-tests` to keep them.

## Scope

One diagram is produced per **(package × epic)**. Each diagram shows:

- the components the epic **touched**, plus
- their **one-hop** dependencies, and
- an **elision marker** naming how many components were left out.

The one hop is computed before anything is added to the set, so a chain of three does not drag the
whole package in. This is what keeps a package with many namespaces to a small, relevant picture.

## Command

```bash
cadet-agent harness diagram                        # write the default tree
cadet-agent harness diagram --package Cadet.Core   # restrict to one package id
cadet-agent harness diagram --include-tests        # keep Unity test assemblies
cadet-agent harness diagram --cs-root src/Game     # scan a subtree instead of the target root
cadet-agent harness diagram --out ./docs/diagrams  # write somewhere else
cadet-agent harness diagram --format json          # the model, for CI and tests
```

The command is **mutating** and honours `--dry-run`. Its declared writes are `.cadet/diagrams/**`.

## Output

```
.cadet/diagrams/
  index.html                 # one link per package, with a status rollup
  .diagrams-manifest.json    # the files this command wrote, so a re-run can prune
  <package-id>/
    index.html               # the component index, then one clickable diagram per epic
    components/<slug>.html   # the drill-down page for one component
    <epic-id>.noml           # the UML source — portable, and what the tests assert
    <epic-id>.svg            # the rendered diagram
```

The HTML is self-contained (inline SVG and CSS), so a double-click renders it with no sibling assets
and no network. A re-run **prunes** the files a previous run wrote and this one did not — for example
after `--include-tests` is dropped — using the manifest, so it deletes its own output and nothing else,
even when `--out` points into a shared directory. Consumers should add `.cadet/diagrams/` to
`.gitignore`.

## Drill-down

Every component box in a package diagram is clickable and opens that component's page. The package
page also lists every component, so a component is reachable even when no diagram happens to show it.

A component page carries:

- **Files** — the `.cs` files the component owns, linked to the source.
- **Types** — the `class` / `struct` / `interface` / `enum` / `record` declarations in those files.
  This is a text scan, not a parse: a declaration must start a line and name a PascalCase identifier,
  so an unusual naming style is missed rather than guessed at.
- **Depends on** / **Used by** — its component neighbours in the package, each a link to their page.
- **Work** — the epics and stories that touched it, with their status.

The click works offline. nomnoml renders SVG and nothing else — it has no notion of pages — so it
supplies only the node identity: a node written `[<done id=c3> …]` carries `data-name="c3"` in the
SVG. The page embeds a `c3 → page` map per diagram and applies it to the inline SVG with a few lines
of inline script. The map and the SVG are generated from one model, and a test pins the two together,
because a mismatch would make a box silently unclickable.

## The renderer, and its licence

The SVG is produced by [nomnoml](https://github.com/skanaar/nomnoml) (MIT), called from Node with no
browser or DOM. It is the CLI's **only runtime dependency** — `src/harness/` was dependency-free before
this feature, and the `.noml` source it emits is genuine UML (package frame, `«…»` classifiers,
`-->` dependency arrows), not a flowchart. `graphre` (MIT) comes in transitively. npm carries both
licences with the published package.

## Tests

`test/harness-diagram.test.mjs`, over `test/fixtures/csharp-packages/`:

- the scan discovers packages, resolves references, groups namespaces, and derives `using` edges;
- attribution paints a done story's component green, an in-progress story's amber, and an untouched
  component out of scope;
- the `.noml` source is exact and deterministic;
- the rendered SVG names every component and paints each status, and is deterministic;
- the CLI writes the tree, links the packages from the root index, warns with no work record, and
  writes nothing under `--dry-run`.
