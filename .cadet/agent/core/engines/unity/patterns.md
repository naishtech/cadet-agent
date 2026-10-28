# Patterns — Unity pack

The implementation shapes that have held up in Unity projects, and the localization rules that go with a shipped game. These are preferred patterns, not standards: an active repository policy, or a reason from the current problem, outranks them.

## What this page covers

The default shape to reach for in C#, the composition rules for runtime objects, and the localization and font rules that a user-facing string drags in.

## Runtime objects

1. Keep a `MonoBehaviour` thin. It orchestrates; the logic it calls is a plain class that a test can construct.
2. Build runtime objects as prefabs and instance them. A prefab is testable, reviewable, and diffable in a way a set of `AddComponent` calls is not.
3. Prefer `[SerializeField] private` to a public serialized field, and use `[Header]`, `[Range]` and `[Tooltip]` to make the Inspector readable.
4. Put tunable data in a `ScriptableObject` or an equivalent asset when more than one object reads it. Duplicated numbers in prefabs drift.
5. Register handlers in `OnEnable`, unregister in `OnDisable`, and prefer a named handler over a lambda where a breakpoint or a removal matters.
6. Track coroutine handles when starts can overlap or a cancel is possible.
7. Prefer `TryGetComponent` with an early exit over a bare `GetComponent` when composition decides whether the component exists.
8. Prefer composition and interfaces to a deep inheritance chain.
9. Use **multiple scenes** when a team works in parallel: scene boundaries are the merge unit Unity gives you, and one large scene is where merge conflicts go to live.
10. Avoid public static mutable state. A singleton is a decision to state and justify, not a habit.

## Localization

1. Route every user-facing string through the project's localization helper or its string tables. A hardcoded UI label is a bug that surfaces in the first translation.
2. Make a missing table, a missing key or a missing optional package fall back to readable text. A blank label is worse than an untranslated one.
3. Keep the key organization structured and stable, and respect any ordering convention the project's serializer depends on.
4. When you add a key, add it to every locale file in the same change. A key in one locale is a half-finished translation.
5. Verify glyph coverage when a new character set arrives, and ask the user to regenerate the font asset when the set changes. A missing glyph renders as a box, and no test catches it.
6. Provide an explicit refresh or reload hook when localized sources can change during an editor session.
7. Plan localization impact in requirements and design, not as polish after the strings are scattered.

## Anti-patterns

- Treating a pattern here as a rule. It is a default, and the current problem may have a better one.
- Burying authored configuration in code to avoid opening the asset that owns it.
- Applying a pattern that an active repository policy already answers differently.
- Writing code that trips an analyzer diagnostic on purpose and suppressing it instead of changing the code.

## Where the long catalogue lives

The framework repository carries the full pattern guidance at `docs/guidance/UnityPatterns.md` and `docs/guidance/LocalizationPatterns.md`. An installed project does not carry `docs/`, so this page restates what a change needs; read the catalogue in the framework repository when you need the reasoning behind a pattern.
