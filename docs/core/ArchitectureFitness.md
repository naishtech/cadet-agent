# Architecture Fitness

Executable constraints, and the line between them and a design review.

## What this is, and what it is not

A project can declare checks that a machine can run: a core assembly may not reference the engine, a
domain layer may not import a view layer, a module may not reach outside its folder. Each check is a
command with a stable id. `cadet-agent harness verify-architecture` runs the checks that govern the
changed files and records `architectureFitnessPassed`.

It proves **executable constraints only**. It cannot prove that the architecture is good, that the
abstraction earns its place, or that the dependency it forbids was the right one to forbid. Those
questions belong to `designReviewCompleted`, and the two gates stay separate so that neither claim
borrows the other's credibility. A green architecture run plus a formal review says: the constraints
the project chose still hold, and a person or agent challenged the design. Neither statement implies
the other.

## Declaring checks

```json
{
  "architectureFitness": {
    "enabled": true,
    "checks": [
      {
        "id": "core-has-no-engine",
        "command": "node scripts/check-no-engine.mjs",
        "files": ["Assets/Scripts/Core/"],
        "severity": "required",
        "refs": ["ADR-0003", "technical-design.md#dependency-direction"],
        "artifact": ".cadet/architecture/no-engine.json",
        "artifactFormat": "json",
        "timeoutMs": 60000
      },
      {
        "id": "ui-does-not-own-simulation",
        "command": "node scripts/check-layer-direction.mjs",
        "files": ["Assets/Scripts/UI/"],
        "severity": "advisory"
      }
    ]
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable lowercase slug, unique in the file. A report must name the same check across runs. |
| `command` | yes | Run through the shell in `cwd`. A non-zero exit is a violation. |
| `cwd` | no | Repository-relative working directory. Default `.`. |
| `files` | no | Repository-relative paths this check governs. Empty means it always applies. Matching is at a directory boundary: `src/Core` governs `src/Core/A.cs` and does not govern `src/CoreX/B.cs`. |
| `timeoutMs` | no | Positive integer. A check that times out is `blocked`, not failed. |
| `severity` | no | `required` (default) or `advisory`. An advisory failure is reported and recorded, never blocking. |
| `refs` | no | Design sections or ADR identifiers the check enforces. Carried into the record, so a reader can ask why the constraint exists. |
| `artifact` | no | File the check must write. A declared artifact that is missing — or unparseable as JSON when `artifactFormat` is `json` — leaves the check **blocked**, not passed. An exit-zero command that wrote nothing proved nothing. The artifact is recorded per check (path and hash) and is deliberately **not** folded into the files the record hashes: a check that rewrites its own report would otherwise stale a record describing an unchanged tree. |
| `artifactFormat` | no | `json` or `text` (default). Requires `artifact`. |

**There is no command-line override.** `harness verify-architecture` accepts no `--command`: the
questions are the repository's own declaration. A gate whose command comes from the call site proves
nothing about the repository, because the caller chooses both the question and the answer.

## When the gate applies

- Required on `implementation -> review`, only when `enabled` is true **and** at least one check is
  declared. A block that is declared but off, or enabled with no checks, is inert: a project that
  declares nothing keeps the frozen transition lists exactly as the contract states them.
- Re-examined at `validation -> closed` under strict closure. A dependency an earlier story satisfied
  can be broken by a later one before the epic closes.
- The record binds the files the checks judged, so a change to a governed file makes it stale rather
  than leaving it looking current.

## Reading the outcomes

| Outcome | Meaning | Effect |
|---|---|---|
| `passed` | The check ran and reported no violation. | Satisfies its part of the gate. |
| `failed` | The check ran and reported a violation (non-zero exit). | A **required** failure blocks review. An advisory failure is recorded and does not. |
| `blocked` | The check never completed: it timed out, never launched, or declared an artifact it did not write. | Does not satisfy the gate, and it is **not** a red: nothing was disproved. The remedy is a `tooling-gap` exception naming who accepted it, not a manual record. A `blocked` or `failed` run **clears** the gate, so it also invalidates an earlier pass instead of leaving it standing. |

The distinction matters. Reporting a blocked check as a failure would call a healthy tree broken;
reporting it as a pass would call an unproven tree verified.

If no declared check governs the changed files, the gate is satisfied and the record says so
explicitly (`no check was applicable to the changed files`). That is the consequence of the project's
own scoping: a project that wants its constraints to run on every change declares a check with no
`files`, which always applies.

## Samples

Both samples are *starting points*, not shipped verifiers: they are ordinary scripts you own, and the
framework never runs anything you have not declared. The first is a dependency-direction check, the
second a forbidden-reference check.

The examples are shown for a Unity/C# repository, because that is where the plan that introduced this
gate asked for samples. The mechanism is not Unity-specific: any repository can declare any command.

### Dependency direction: the core may not reference the engine

```json
{
  "id": "core-has-no-engine",
  "command": "bash scripts/arch/no-engine-reference.sh",
  "files": ["Assets/Scripts/Core/"],
  "severity": "required",
  "refs": ["ADR-0003"],
  "artifact": ".cadet/architecture/no-engine.txt",
  "artifactFormat": "text"
}
```

`scripts/arch/no-engine-reference.sh` — one direction, one file, so a failure names the offending
line:

```bash
#!/usr/bin/env bash
# Dependency direction: the Core assembly is engine-free, so the simulation can be
# tested without Unity. A hit here is a violation, and the artifact records the count.
set -uo pipefail
OUT=".cadet/architecture/no-engine.txt"
mkdir -p "$(dirname "$OUT")"
hits=$(grep -rn --include='*.cs' -E '^\s*using\s+(UnityEngine|UnityEditor)' Assets/Scripts/Core || true)
count=$(printf '%s' "$hits" | grep -c . || true)
printf 'violations: %s\n%s\n' "$count" "$hits" > "$OUT"
[ "$count" -eq 0 ]
```

Exit `0` means no dependency line was found; exit `1` prints the findings into the artifact, and
`verify-architecture` records the artifact path and its hash.

### Forbidden reference: a runtime assembly may not reach the editor API

```json
{
  "id": "no-editor-api-in-runtime",
  "command": "bash scripts/arch/no-editor-api.sh",
  "files": ["Assets/Scripts/Runtime/"],
  "severity": "required",
  "refs": ["technical-design.md#editor-and-runtime-separation"],
  "artifact": ".cadet/architecture/editor-api.json",
  "artifactFormat": "json"
}
```

`scripts/arch/no-editor-api.sh` — the artifact is JSON, so `verify-architecture` refuses the check if
the script wrote something unparseable, which is how a silently broken check is caught:

```bash
#!/usr/bin/env bash
# UnityEditor is unavailable in a player build. A runtime assembly that references it
# compiles in the editor and fails at build time, so the constraint is checked here.
set -uo pipefail
OUT=".cadet/architecture/editor-api.json"
mkdir -p "$(dirname "$OUT")"
hits=$(grep -rn --include='*.cs' -E '^\s*using\s+UnityEditor' Assets/Scripts/Runtime || true)
count=$(printf '%s' "$hits" | grep -c . || true)
printf '{"check":"no-editor-api-in-runtime","violations":%s,"hits":%s}\n' \
  "$count" "$(printf '%s' "$hits" | jq -R -s -c 'split("\n") | map(select(length > 0))' 2>/dev/null || echo '[]')" > "$OUT"
[ "$count" -eq 0 ]
```

Either sample can be declared `advisory` while the project cleans up existing violations: the check
still runs, the failure is still recorded, and review is not blocked. That is the migration path for
adopting a constraint a codebase does not yet satisfy.

## Related

- [Hard Gates](HardGates.md) — where the gate sits in the transition matrix.
- [Harness Contract](HarnessContract.md) — C3 (the gate list) and C17 (this gate's rules).
- `.cadet/agent/core/Harness.md` — the runtime contract, including why a blocked check is not a red.
