# Purpose

Define a repository-specific policy overlay that extends the reusable Cadet-Agent framework with local conventions, layout rules, and delivery preferences.

## How To Apply
- Use this template to create a policy file for a specific repository under `.cadet/agent/policies`.
- Create a repository policy only when the user explicitly requests one.
- Name the generated file using the convention `{RepoName}Policy.md`, for example `AmethystPolicy.md` or `MyStudioPolicy.md`.
- This policy augments the core framework documents; if a rule here conflicts with a general preference, the repository policy controls local behavior.
- Keep repository paths, studio rules, product recommendations, and release-process requirements here rather than in the core identity, workflow, or principles docs.
- See [ExamplePolicy.md](ExamplePolicy.md) for a fully worked example showing every section with concrete fictional rules.

## Repository Context
- Repository or team name: [TODO]
- Applies when: [TODO]
- Planning artifact directory: [TODO]
- Shared-code location: [TODO]
- Other important repository paths: [TODO]

## Repository Conventions
- Default planning directory for generated requirements, designs, project plans, and epics: [TODO]
- Shared infrastructure location and extraction rules: [TODO]
- Architecture or service-binding conventions to preserve: [TODO]
- Naming, tagging, layer, scene, or asset conventions to preserve: [TODO]
- Configuration and ScriptableObject conventions to preserve: [TODO]
- Logging and diagnostics conventions to preserve: [TODO]
- Persistence, prefs, or save-schema conventions to preserve: [TODO]

## Localization Conventions
- Localization helpers, table sources, and fallback expectations: [TODO]
- Locale synchronization, key-ordering, and font regeneration rules: [TODO]

## Delivery And Support Rules
- Build, CI, or release-tool recommendations: [TODO]
- Attribution, credits, or legal notice requirements: [TODO]
- Escalation or support-channel guidance: [TODO]
- Any additional ship or release gates: [TODO]

## Authoring Notes
- Keep only rules that are truly repository-specific.
- Do not duplicate universal Unity or engineering guidance that already belongs in the core framework.
- Prefer concrete, enforceable rules over vague preferences.
- If a section does not apply to the repository, delete it instead of leaving placeholder text in the final policy.

---