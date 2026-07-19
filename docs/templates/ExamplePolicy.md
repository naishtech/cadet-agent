# Purpose

Demonstrate a fully completed repository policy overlay using fictional but realistic project details. Use this as a reference when creating a policy for a real repository.

> **Note:** This is a worked example. Do not install it into a live project. Copy [PolicyTemplate.md](PolicyTemplate.md) instead and fill it in using the structure shown here.

---

# Studio X — Kart Racer Policy

## How To Apply
- This policy applies to the `kart-racer` Unity repository maintained by Studio X.
- Applies when: working in VS Code or Visual Studio with Cadet-Agent installed.
- Planning artifact directory: `docs/planning/`
- Shared-code location: `Assets/_Shared/`
- Other important repository paths:
  - `Assets/Gameplay/` — per-system gameplay feature folders
  - `Assets/UI/` — all UI prefabs and UIToolkit documents
  - `Assets/StreamingAssets/Localization/` — locale JSON files

## Repository Conventions
- Default planning directory for generated requirements, designs, project plans, and epics: `docs/planning/`
- Shared infrastructure location and extraction rules: Reusable non-feature code (services, utilities, base classes) lives in `Assets/_Shared/`. Before extracting code into `_Shared`, tell the user and confirm the extraction boundary.
- Architecture or service-binding conventions to preserve: All cross-system services must be registered via `ServiceLocator.Register<T>()` at startup. Do not use direct static singletons outside of `ServiceLocator`.
- Naming, tagging, layer, scene, or asset conventions to preserve:
  - Layer names: `Default`, `Player`, `Track`, `UI`, `Trigger` — do not add new layers without discussing with the team.
  - Tags: Use only tags defined in `Assets/_Shared/Tags.cs`. Add new tags there; do not scatter string literals.
  - Scene names: follow the convention `{FeatureName}Scene` (e.g. `RaceScene`, `GarageScene`).
- Configuration and ScriptableObject conventions to preserve: All tunable gameplay values live in ScriptableObjects under `Assets/Config/`. Do not hardcode tunable values in scripts.
- Logging and diagnostics conventions to preserve: Use `GameLog.Info()`, `GameLog.Warn()`, and `GameLog.Error()` from `Assets/_Shared/Logging/GameLog.cs`. Do not use `Debug.Log` directly in production code paths.
- Persistence, prefs, or save-schema conventions to preserve: Player save data uses `SaveManager.Save<T>()` and `SaveManager.Load<T>()`. Do not write `PlayerPrefs` directly.

## Localization Conventions
- Localization helpers, table sources, and fallback expectations: All user-facing strings must go through `LocalizationHelper.Get(LocaleKey key)` defined in `Assets/_Shared/Localization/`. Missing keys must return the key name as a fallback, not an exception.
- Locale synchronization, key-ordering, and font regeneration rules:
  - The `LocaleKey` enum in `Assets/_Shared/Localization/LocaleKey.cs` is append-only; do not reorder or delete existing entries.
  - All locale JSON files under `Assets/StreamingAssets/Localization/` must be updated together for each new key.
  - When new glyphs are added for non-Latin locales, ask the user to regenerate the TMP font atlas in `Assets/Fonts/`.

## Delivery And Support Rules
- Build, CI, or release-tool recommendations: Use the `Build/build.ps1` script for all local and CI builds. Do not use the Unity Build menu directly for release builds.
- Attribution, credits, or legal notice requirements: Third-party asset credits must be listed in `CREDITS.md`. Update it when adding new store or external assets.
- Escalation or support-channel guidance: For Unity upgrade questions, open a discussion in the `#unity-upgrades` Slack channel before proceeding.
- Additional ship or release gates: All releases require a sign-off in the project's GitHub milestone before the release tag is pushed.

## Authoring Notes
- Keep only rules that are truly repository-specific.
- Do not duplicate universal Unity or engineering guidance that already belongs in the core framework.
- Prefer concrete, enforceable rules over vague preferences.

---
