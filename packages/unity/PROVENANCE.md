# Provenance — packages/unity

Copied, not merged. There is no shared history with the source repository (D9).

- Source repository: `E:/unity/projects/cadet`
- Source paths: `cadet-unity/Assets/Covyne/Cadet`, `cadet-unity/Assets/Tests`
- Source commit: `5f61d1f` — "add packagingIniOverride support + fix make.ps1 sync target"
- Source branch: `main`
- Copied: 2026-10-28
- Files: 330 under the tooling root, 142 under `Tests/`

The `Editor/`, `Scenes/`, `README.md`, `Third-Party Notices.txt` and `CLI.meta` entries come from `Assets/Covyne/Cadet`; `Tests/` comes from `Assets/Tests`.

`.meta` files are copied verbatim so that GUIDs survive and profile or prefab references in a consumer project do not break.

## Excluded

- `CLI/` contents — the CLI lives in `packages/cli` (D7). `CLI.meta` is kept so the folder's GUID is stable when the installer materialises the scripts into it.
- `cadet-unity/Doc/` — arrives in S4.1, markdown only. The folder also holds `.pdn`, `.png` and `.pdf` marketing files.
- `cadet-unity/Packages/com.unity.asset-store-tools/` — Unity Asset Store tooling. Not redistributable, and no tooling code references it.
- `cadet-unity/ProjectSettings/`, `cadet-unity/Packages/manifest.json` — the host project's settings, not the product.
- `Assets/Config/Covyne/Cadet/` — sample profiles and VDF files belong to a consumer project, not the package.

## What this replaces

`cadet-unity/Assets/Covyne/Cadet` as the home of the Unity editor tooling.
