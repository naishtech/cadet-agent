# Provenance — packages/unreal

Copied, not merged. There is no shared history with the source repository (D9).

- Source repository: a private game project (path withheld)
- Source path: `Plugins/CadetBuild`
- Source commit: `2ad46a07` — "docs(handoff): the montage table is done, and its two-hour trap is written down"
- Copied: 2026-10-28
- Files: 26

## Excluded

- `Binaries/` — build output, including `Binaries/HostProject`.
- `Intermediate/` — build output.
- `Saved/` — local UnrealBuildTool configuration.
- `CLI/` — the vendored copy of the CLI. It lives in `packages/cli` (D7), and the installer materialises it into `Plugins/CadetBuild/CLI/`.

## Verified at copy time

Every file is byte-identical to its source.

## What this replaces

the vendor copy inside that game project as the only copy of the Unreal plugin.
