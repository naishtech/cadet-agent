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

A component is coloured by the stories of that epic whose evidence `relevantFiles` land in it:

| Colour | Status | Meaning |
|---|---|---|
| 🔴 `#E05555` | `not-started` | no story of this epic touched it |
| 🟠 `#E8A840` | `in-progress` | some touching stories are `done`, but not all |
| 🟢 `#4A9A5A` | `done` | every touching story is `done` |

An epic that touches nothing in a package produces no diagram for that package.

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
cadet-agent harness diagram --cs-root src/Game     # scan a subtree instead of the target root
cadet-agent harness diagram --out ./docs/diagrams  # write somewhere else
cadet-agent harness diagram --format json          # the model, for CI and tests
```

The command is **mutating** and honours `--dry-run`. Its declared writes are `.cadet/diagrams/**`.

## Output

```
.cadet/diagrams/
  index.html                 # one link per package, with a status rollup
  <package-id>/
    index.html               # one embedded diagram per epic, plus the legend
    <epic-id>.noml           # the UML source — portable, and what the tests assert
    <epic-id>.svg            # the rendered diagram
```

The HTML is self-contained (inline SVG and CSS), so a double-click renders it with no sibling assets
and no network. Consumers should add `.cadet/diagrams/` to `.gitignore`.

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
