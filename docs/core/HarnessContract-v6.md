# Harness Contract v6 — reachability

Status: current
Predecessors: [HarnessContract.md](./HarnessContract.md) (v4, the frozen invariants),
[HarnessContract-v4.md](./HarnessContract-v4.md) (AC↔test coverage),
[HarnessContract-v5.md](./HarnessContract-v5.md) (git-backed gate evidence)

## Why this contract exists

Every gate in v4 asks whether work is *correct*, *compiled*, *analysed*, *tracked* and
*reviewed*. None of them asks whether it is **reachable** — whether a user or operator can
actually get to it. So a project can pass every gate for sixteen stories in a row and have
nothing anyone can run, and each individual story looks green while it happens.

That is not hypothetical. The failure has a name in practice — "tested but not reachable" — and it
has recurred across many stories and several epics while auditing a consumer project. The shapes it
took there, stated without naming it, because the shapes are what generalise:

| Delivered, complete, and correct | Why nobody could reach it |
| --- | --- |
| a resource loop with its FSM, its conservation suite and its deterministic timing | nothing joined it to a scene; it was reachable only from tests |
| a production gate with a passing suite on both paths | the same — no composition root and no scene instantiated it |
| a visual registry that resolved `(race, role)` correctly | no host bound a registry, so "units now render" was never observable |
| a UI action with its command, its sink seam and its router | no scene passed a sink, so the button could not be pressed |
| a death presentation effect, bounded and unit-tested | the entity was removed on the same tick a view could have observed the death, so the effect never fired |

Each was found by a human reviewer noticing, and each was filed as Low or informational and
deferred to a later story — which is exactly how the pattern compounds: the same project passed
every gate for sixteen stories in a row with almost nothing a user could run. Its own architecture
record eventually named the class: *"a claim that is tested but not reachable"*. And its local
policy states the lesson this contract is built on:

> when a mistake recurs after being documented, the fix is a check, not another paragraph.

So this contract adds a check — and, because a check that cannot fail is worse than no check, it
also states precisely what it proves and what it does not.

## 1. The declaration

Every story declares its reachability in a single machine-readable line in its header block:

```
Reachability: witnessed — <what a user or operator does, and what they see>
Reachability: deferred to <work-item id> — <why it cannot be witnessed yet>
```

Rules:

- **Required.** A story with no declaration, or an empty one, is a gap — not a default.
  Silence is not reachability, in the same way that an acceptance criterion declaring no test
  is not coverage (v4 §C10).
- **Exactly two forms.** A third form is refused rather than ignored: a declaration the tool
  does not understand is indistinguishable from no declaration, and a story that is wrong in a
  new way must not read as a story that is fine.
- **A deferral names an owner and a reason.** `deferred to <work item>` without a reason is
  refused, because an unexplained deferral is how a gap becomes permanent.
- **The declaration lives in the story**, which is the single source of truth — the same
  placement, and for the same reason, as the declared-test mapping.

`Reachability` is deliberately not called "playable" or "visible": a CLI, a served page, a
rendered frame and a Unity Play mode are all instances of "reachable", and the framework is
not Unity-specific.

## 2. The gate, and its opt-in

Gate name: **`reachabilityAddressed`**, appended to the frozen gate list (§C3) and required on
`review -> validation` — the same point as the review gates, because reachability is a claim
about a delivered, reviewed story, whereas at implementation time the wiring may legitimately
not exist yet.

**It is required only when the repository opts in**, via `.cadet/harness.json`:

```json
{ "reachability": { "enabled": true } }
```

Absent or `enabled: false` is byte-identical to pre-v6 behaviour: the gate is not part of any
transition, and `harness verify-reachability` reports without writing state. This is the same
compatibility device as `strictClosure.enabled` (v3 §2) and `allowEmptyFreshness`, and it
exists for the same reason: every existing consumer has stories written before the declaration
existed, and a framework update must not block an in-flight story on a new requirement. The
kickoff asks the question once per run and records the answer, so opting in is a choice rather
than an edit someone has to discover.

Satisfied by: a `witnessed` declaration, or a `deferred to` declaration whose target exists and
is not already finished. An infrastructure story that legitimately produces nothing reachable
yet satisfies it by declaring an owned deferral — that is what the deferral form is for.

**Re-examined at closure.** Because a deferral is a claim about the future, `validation -> closed`
re-derives the declaration against the current state when strict closure is on: a deferral whose
target has landed, one whose target has vanished, or a cycle that has since formed refuses closure
exactly as it was refused at verify time. The re-derivation re-reads the declaration rather than
re-checking evidence freshness — the record is legitimately created during `review`, so the
phase- and recency-staleness machinery would wrongly reject it here.

**Manual confirmation and exceptions.** Under `strictClosure.enabled`, manual confirmation is
refused for this gate by default (`disallowManualFor`): the declaration check always runs, even
with no probe configured, so a manual assertion can add nothing and can skip the declaration
entirely. A scoped `gate-exception` remains the documented escape hatch, subject to the usual
categories and expiry.

## 3. The probe

Cadet cannot know how a given repository wires its pieces together, so a `witnessed`
declaration is a **claim, not a proof**. The proof is the repository's own probe:

```json
{ "reachability": { "enabled": true, "command": "<the project's own reachability check>" } }
```

When `command` is configured, `harness verify-reachability` runs it and **its exit code is the
verdict**. This is the framework's established seam — `testCommand`, `compileCommand` and
`analyzerCommand` all delegate to project-owned commands for the same reason — and it is what
lets the check be real rather than a rubber stamp. A project-specific check beats a generic
rule, because a generic rule that guesses wrong is a rule that gets switched off.

Setting `command` while `enabled` is `false` is **rejected as inert**, and a blank `command` is
rejected outright: a probe that can never run reads as a guard that exists.

With no probe configured, the command says so plainly (`no project probe configured — the
declaration is checked, the wiring is not proven`) rather than implying a guarantee it did not
establish.

## 4. Falsifiability: deferrals expire

A deferral is a claim about the future, so it must be able to become false. Two rules:

1. **A deferral whose target is `done` fails.** The work item that was going to make the story
   reachable has landed, so either the story is reachable now (declare `witnessed`) or the
   wiring was missed when the owner closed. Without this rule a deferral can be inherited
   forever and the escape hatch becomes the new normal.
2. **A cycle of deferrals fails.** `story-1 → story-2 → story-1` witnesses nothing: each item
   points at another to explain why it is not reachable. The cycle is reported once, naming the
   whole chain, because naming a single node would hide the shape that makes it a gap. The graph
   is built from the story and its sibling stories, and the epic-key aliases come from the
   work-item index in state.json — every `epicKey::story.md` form that actually exists — so both
   the long form and the bare file name resolve to the same node regardless of where the story
   files physically sit. Deriving the epic key from the directory name alone would silently miss
   real cycles whenever a story's parent directory is not named after its epic (a bare relative
   `--story` path has dirname `.`), which is the exact miss this rule exists to prevent. A story
   deferring to itself is refused outright (`deferral-self`).

A deferral to a **spike** is legitimate: a spike is exactly how an unverified assumption
becomes a deliverable, so spike ids are valid targets.

3. **The declaration is re-examined at closure.** Under strict closure, `validation -> closed`
   re-derives the declaration against the current state (§2), so an expired deferral cannot
   ride through to a closed story.

## 5. What this contract does NOT prove

Stated here so no reader infers more than the check delivers:

- With **no probe configured**, a `witnessed` declaration is documentation. The gate proves the
  declaration exists and is well-formed, not that the claim is true.
- Cadet does not verify that the described witness *works* — only the repository's probe can do
  that, and only for the properties the project chose to encode.
- The check is per story. An epic whose work only becomes reachable at its last story passes
  every individual story's check; that ordering is caught by the **witness checkpoint** the
  epic template requires and by CodeReview, not by this gate.

The limit is documented rather than papered over, because a green gate that is believed to mean
more than it does is worse than an honest report of a weaker guarantee.

## 6. Compatibility

- **No existing gate changes meaning.** `reachabilityAddressed` is appended; the eight v4 names
  keep their semantics.
- **Default OFF**, per §2, so a project that does not opt in sees an unchanged transition
  matrix and unchanged `state.json` behaviour. A state document written before v6 lacks the new
  gate key, which is not an error — unknown keys warn, missing keys are filled by migration.
- **Story/epic templates gain a required field**, which is a template change only: existing
  artifacts are not retroactively invalid. Convert a story when it is implemented, the same
  migration policy the declared-test format uses.
- **Transitions are unchanged in shape.** `requiredGates(target)` keeps its single-argument
  behaviour; the new gate joins only when the caller passes the resolved policy. The CLI passes
  the policy (and, since the policy-passing fix, its `strictClosure` block) on both the pre-check
  and the applied transition, so dry-run and real transitions always judge by the same rules.
  `applyTransition` accepts the same `policy` option, so a library caller can enforce exactly
  the verdict the CLI reports; a caller that omits it gets the pre-v6 gate list, which the
  contract states rather than hides.

## 7. Where it is implemented

| Concern | Location |
| --- | --- |
| Declaration parsing, validation, deferral graph | `src/harness/reachability.mjs` |
| Policy (`reachability.enabled`, `.command`) and the gate name | `src/harness/policy.mjs` |
| Conditional gate on `review -> validation`, closure re-examination | `src/harness/state.mjs` (`requiredGates`, `recheckReachabilityAtClosure`) |
| Command registry entry, CLI handler, help | `src/harness/commands.mjs`, `src/cli.mjs` |
| Machine-readable schemas | `.cadet/agent/core/harness.schema.json` |
| Rules and duties | `.cadet/agent/core/cadet-agent.md`, `Harness.md`, `skills/{TDD,CodeReview,StoryBreakdown,Architecture}.md`, `KickoffFlow.md` |
| Templates | `.cadet/agent/core/templates/{StoryTemplate,EpicTemplate,TechnicalDesignTemplate}.md` |
| Tests | `test/harness-reachability.test.mjs` |
