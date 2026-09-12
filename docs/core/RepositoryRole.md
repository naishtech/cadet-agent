# Repository Role

Cadet-Agent is consumed in two structurally different ways, and the framework must
behave differently in each. This page defines the boundary, how it is detected, and
what changes when a repository is the framework source.

## Why this exists

Cadet ships the *rules about* stories, epics, and gates — the gate vocabulary
(`codeReviewCompleted`, Given/When/Then criteria, story templates) is present in every
install, including the canonical framework repository. But the framework repository
itself holds **no story state and no planning artifacts**: `CONTRIBUTING.md` lists
`.cadet/agent/project-plans/` and `.cadet/agent/policies/` as "not in this repo".

An agent that reads the gate vocabulary and then looks for an active work item can be
led to reason about a story that was never there — for example, "auditing" a gate for
`story-1` in a repository that contains no stories at all. The result is a confident
finding about a file that does not exist. Detecting the repository role lets the CLI
and every phase skill state the situation explicitly instead of reporting a bare
success for a missing state file.

## The two roles

| Role | What it is | Signals |
|---|---|---|
| `consumer-project` | A Unity/game repository that installs Cadet and runs the workflow. | `.cadet/state.json` and/or `.cadet/agent/project-plans/` present |
| `framework-source` | The canonical Cadet-Agent repository (and its forks). | `.cadet/agent/core/FrameworkManifest.json` present, with neither state nor plans |

A third value, `unknown`, is reported for a directory with no Cadet install at all
(run `cadet-agent init`).

## How detection resolves

`detectRepoRole(targetDir)` in `src/harness/repo-role.mjs` resolves in this order:

1. **Marker** — `.cadet/.repo-role` (written by `init`/`sync`) wins outright, at
   **high** confidence. A malformed marker is ignored and detection falls through.
2. **Structural signals** — an existing `.cadet/state.json` **or** a
   `.cadet/agent/project-plans/` directory means `consumer-project`; a
   `FrameworkManifest.json` with neither means `framework-source`. Reported at
   **medium** confidence.
3. **Fallback** — otherwise `unknown`, at **low** confidence.

Detection never throws; an unreadable marker degrades to the structural signals.

## The marker

`install` and `sync` write `.cadet/.repo-role` containing `consumer-project`. The
marker is **neither a managed path nor a preserved path**, so a framework sync can
never delete or overwrite it (see compatibility invariant C9 in the
[Harness Contract](HarnessContract.md)). It exists so the boundary is
machine-checkable rather than inferred only from the shape of the tree.

An existing install synced by an older CLI receives the marker on its next `sync`,
even when no files changed.

## What the agent does differently

When `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, every
phase skill's Gate Check states: **this is the framework source repo — story/gate work
is not applicable; switch to the contribution workflow (`CONTRIBUTING.md`).**
`KickoffFlow.md` performs the same check as its first step and stops the consumer flow
for a framework-source checkout.

The CLI reports the role rather than a silent pass:

```
$ cadet-agent state validate
No .cadet/state.json found (nothing to validate).
   Repo role: framework-source (structural, medium confidence) —
   framework-source repository — story/gate work is not applicable here;
   use the contribution workflow (CONTRIBUTING.md).
```

`cadet-agent harness verify` includes the same `repoRole` value in its JSON result.

## Gate-related fix claims

A gate-related fix claim is held to the same standard as gate evidence: it must cite
its `workItemId`, `relevantFiles`, and commit (the fields `Harness.md` §1 requires of a
fresh evidence record). A claim that cannot name the work item it belongs to, the files
it touched, or the commit that contains it is **unverifiable** — the Code Review and
Agent Reviewer skills file it as an explicit `unverifiable` finding naming the missing
field. This is what stops a fix that happened in one repository from reading as valid in
another.

## Common pitfalls

- Editing or renaming `.cadet/.repo-role` by hand. It is written by `init`/`sync`; a
  bad value is ignored, and the structural signals take over.
- Treating `framework-source` as an error. It is the correct, expected role for this
  repository — the point is that story/gate work does not apply here.
- Adding the marker to `managedPaths` or `preservedPaths` in the manifest. It must stay
  in neither list so sync neither deletes nor specially preserves it.

## Backlinks

- [Harness Contract](HarnessContract.md) — compatibility invariants, including C9
- [Hard Gates](HardGates.md) — the gate system that applies to consumer projects
- [Workflow](Workflow.md) — the consumer-project workflow that this boundary gates
