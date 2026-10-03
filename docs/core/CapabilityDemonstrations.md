# Capability Demonstrations

Every claim on this page has a command you can run and an observed result. Nothing here is a
summary of the design.

## How to run them

```
pwsh -File package-agent.ps1                    # build cadet-agent.zip (the drivers read it)
node scripts/demonstrations/install-walk.mjs    # install into clean fixtures
node scripts/demonstrations/gated-walk.mjs      # one work item, gated at every boundary
```

Both drivers build throwaway fixtures, print one `PASS` or `FAIL` line per expectation, and exit
non-zero if anything fails. A regression in any behaviour below therefore fails a command, not a
paragraph. Add `--keep` to inspect the fixture afterwards.

## What the runs showed

| Claim | Demonstrated by | Observed | Limitation |
|---|---|---|---|
| Install into a clean Node repository | `install-walk.mjs` | `init` exits 0; 15 skill files, the harness contract, the Git hook and `AGENTS.md` are extracted; the policy seed parses | GitHub's API and the asset hosting are not exercised. The driver serves the built package from a local double of the release API, so everything downstream of the download is the shipped code. |
| The seed turns the new gates on, and leaves reachability off in a non-Unity repository | `install-walk.mjs` | `designReview.enabled` true, `humanAcceptance.enabled` true, `reachability.enabled` false | — |
| Install into a clean Unity repository | `install-walk.mjs` | As above, and `reachability.enabled` true — from `ProjectSettings/ProjectVersion.txt` | — |
| A consumer's own policy file is never overwritten | `install-walk.mjs` | A consumer edit into `.cadet/harness.json` survives a `sync` byte-identically | — |
| Nothing is tracked until a work item exists | `install-walk.mjs` | `state validate` reports "nothing to validate" and exits 0; a command that needs state exits 2 and names the missing document | — |
| The first state document can be created by a command | `state init`, pinned by `harness-state-init.test.mjs` | A valid v4 document is written; a second `state init` is refused with `state-exists` and the file stays byte-identical; an unknown value is refused before anything is written | This command did not exist. The walk found that gap — see below. |
| Interception is measured per host and per action, never inferred from a file | `harness capabilities --verify-host` | Seven hosts × six actions, each cell `native`, `external` or `advisory`, marked `probe` or `declared`; Copilot's guard verifies as `native` for git writes | The repository Git hook is present in this repository but `core.hooksPath` is unset, so the measured level stays `advisory` and the remedy is named. |
| A boundary refuses until its gates are satisfied, and names them | `gated-walk.mjs` | `story-breakdown` refused naming `designReviewCompleted`; `review` refused naming 5; `validation` refused naming 4; `closed` refused naming 2 | — |
| The design review is required before story breakdown | `gated-walk.mjs` | The edge refuses, `harness verify-design-review` records it from the reviewed artifact, the edge opens | The gate covers `architectureComplete -> story-breakdown`. A detour through `spikes` reaches the same phase ungated — see the limitations below. |
| `testsPassed` needs a red run before a green one | `gated-walk.mjs` | The test fails while the implementation is absent, the framework records the red attempt, and the green run after the implementation passes | — |
| A gate's automated route is the only one it accepts | `gated-walk.mjs` | `testsPassed` by hand is refused (`manual-disallowed`); a judgement gate with a project command is refused; `true` as a command is not a test run | — |
| Four automated routes work as documented | `gated-walk.mjs` | `harness verify` (tests), `harness verify-acs` (the report the tests produced), `harness verify-reachability` (the story's declaration), `harness verify-architecture` (the project's declared checks) | `verify-acs` needs a story with an `## Acceptance Criteria` section and a TAP or JUnit report. |
| A violated architecture constraint blocks and names the offender | `gated-walk.mjs` | The check fails on a real forbidden reference, the gate does not pass | The check is the project's own command. Cadet runs it and reads the exit code; it does not know architecture. |
| An incomplete design review is refused | `gated-walk.mjs` | A finding row with an unknown disposition is refused before the gate is recorded | — |
| An undeclared reachability claim is refused | `gated-walk.mjs` | A story with no declaration fails the check | With no project probe, the enforceable level is the declaration, and the command says so. |
| Human acceptance is the person's own answer | `gated-walk.mjs` | `harness confirm --gate humanAcceptanceConfirmed --reason "<what they said>"` records it and `closed` opens; an empty answer is refused | The acceptance is a person's record. The walk speaks as the person would; the framework never writes it. |
| Evidence is prepared for a commit | `gated-walk.mjs` | `state seal` prepares 15 records as commit trailers | Verifying the trailers needs a commit, which the walk does not make. |

## Defects these runs found

Running the fixtures found four defects in the framework, and one in the walk itself. All five are
fixed, and four are pinned by a test that fails without the fix.

1. **No command could create the first state document.** `cadet-agent init` installed the framework,
   and then every entry point refused with "Initialise state before ..." — while nothing could
   initialise it. The only documented route was a hand-written document, and the instruction that
   described it (`skills/Resume.md`) wrote `version: 1` with a null workflow path, which
   `state validate` rejects. The document every gate reads was therefore the one document with no
   writer and no validation at creation. Fixed by `cadet-agent state init`; the two instructions now
   name it. Pinned by `harness-state-init.test.mjs`.
2. **`harness verify-acs` read its story from the wrong tree.** `--story` and `--report` resolved
   against the process working directory while the record was bound to `<target>/<story>`. The
   command failed from outside the project, and a file of the same name under the working directory
   would have been attested against the target's path — the inert binding the neighbouring
   `verify-reachability` comment warns about. Fixed; pinned by a test that runs from the framework
   repository against a fixture.
3. **The human-acceptance route was unsatisfiable under the shipped policy.** `harness confirm`
   demanded `--scope` and `--environment` from strict closure and then refused them beside
   `--artifact` as a second, competing source. Both ways of calling it failed, so
   `humanAcceptanceConfirmed` could not be satisfied at all. Every existing test used a policy with
   strict closure off, which is why the suite did not see it. Fixed by exempting the two fields the
   form supplies; pinned three ways, including that `--scope` beside the artifact is still refused
   and that a missing validity window still is too. **The route was removed on 2026-10-03**: the form and `--artifact` on `harness confirm` went with it, so an acceptance is now recorded from the person's own answer and this defect's fix is history rather than live behaviour.
4. **The packager validated a file it never shipped.** `.githooks/pre-commit` was listed in the
   manifest and checked as present, and no staging rule carried it, so it never reached the package.
   Fixed, plus a test that asserts every managed path lands under a root the packager stages.
5. **The walk asserted a green `testsPassed` with no red run.** The framework refused it, correctly:
   red-before-green is enforced. The walk now shows the red step, which is a better demonstration
   than the one it replaced.

## Stated limitations

- **The planning index has no writer.** `state.epics` is read by `resume` and `reconcile`, and no command
  writes it: the agent maintains it during planning. The walk
  registers its epic as fixture setup, and says so rather than presenting it as a framework step.
- **The design-review gate covers one edge.** It is required on
  `architectureComplete -> story-breakdown`. The transition matrix also allows
  `architectureComplete -> spikes -> story-breakdown`, and that route is not gated. This was a
  deliberate plan decision (§5.3, which rejected keying transitions on `(from, to)` as a larger
  change for one colliding pair) with this consequence, and it is stated here rather than left for a
  reader to discover.
- **No released package is involved.** `npx cadet-agent@latest`, the npm publish, the GitHub release
  API and the asset hosting are exercised only by a release. The drivers substitute a local double
  of the release API, so the download path runs and GitHub itself does not.
- **The Unity fixture has no Editor.** `compileCheckConfirmed` and `unityAnalyzerClean` are recorded
  through their documented manual fallback, because no Unity CLI exists in the walk's fixture. In a
  project with the CLI available those gates take their automated path.
- **The independent audit found what it could not verify.** An adversarial AgentReviewer pass over the
  uncommitted work reported four blocking and six material findings. Five defects reproduced and are
  fixed, each pinned by a test that fails without the fix: `harness capabilities` claiming `native` in
  a repository with no hook, an architecture record that staled itself whenever a check declared an
  `artifact`, the architecture gate being set true by a failed run, the removed `--witness` /
  `--limitations` flags being silently discarded, and `--command` being accepted and ignored by four
  commands. It also could not execute the PowerShell guard — which is how the sixth was found: the
  guard did not run at all under Windows PowerShell 5.1, because a BOM-less UTF-8 file with an em dash
  in a string fails to parse on the default Windows interpreter, and the probe that licensed the level
  only ran bash. Both are fixed; the probe now measures every declared variant.
  What the audit could not settle, and nothing here settles either: whether a real Copilot agent
  invokes the shipped `PreToolUse` hook at all (the framework measures the guard's answers, not the
  host's willingness to call it), and whether the four new opt-in switches compose when a project
  enables all of them at once. The release-dependent items below remain.

## Related

- [Host Interception](HostInterception.md) — the matrix and its probes.
- [Harness Contract](HarnessContract.md) — invariants C1–C19, each naming its tests.
- `cadet-agent-gcap-harness-product-priorities-plan.md` §Phase 9 — the task list these runs answer.
