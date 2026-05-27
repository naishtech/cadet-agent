# Purpose

Capture preferred localization patterns and lessons learned so Cadet can favor resilient multilingual workflows without turning every implementation preference into a hard standard.

## Backlinks
- Identity reference: [../Identity](../Identity.md)
- Learner model reference: [../LearnerModel](../LearnerModel.md)
- Principles reference: [../Principles](../Principles.md)
- Workflow reference: [../Workflow](../Workflow.md)
- Architecture skill: [../Skills/Architecture](../Skills/Architecture.md)

## Guidance Role
- This document records preferred localization heuristics, not mandatory rules.
- Use these patterns when they improve translator workflow, runtime resilience, and maintainability.
- When an active repository policy defines localization handling, that policy wins.

## Preferred Localization Patterns
- Prefer routing user-facing strings through the project localization helper or tables rather than hardcoding UI text.
- Prefer graceful fallback behavior when tables, keys, or optional localization dependencies are missing.
- Prefer structured, consistent key organization so future additions remain readable and predictable.
- Prefer workflows that are version-control-friendly and translator-friendly when text data changes often.
- Prefer identifying localization impact early in requirements and design so content, UI, and validation are planned together.
- Prefer validating non-Latin glyph coverage when new character sets are introduced.
- Prefer explicit cache reload or refresh hooks when localized sources can change during editor sessions.

## When To Defer
- Defer to standards for the required quality bar around validation and fallback safety.
- Defer to an active repository policy when the repo defines locale files, key ordering, or TMP asset update conventions.
- Defer to the simplest viable localization path when the feature is internal-only and never user-facing.

## Anti-Patterns
- Treating localization as a last-minute polish step after user-facing strings are already scattered through the codebase.
- Turning every localization helper preference into a hard rule when the repository already provides a different valid path.
- Ignoring font, glyph, or fallback implications when adding a new language.
- Treating guidance-level workflow preferences as mandatory when policy or existing infrastructure says otherwise.

---