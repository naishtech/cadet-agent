# Harness — Gate Definitions and Execution Protocol

Reference, not per-turn context. Read this file at a transition, and when a gate's route is in
doubt. The full contract is `Harness.md`; the lean runtime rules are `HarnessRuntime.md`.

## Gate definitions and execution protocol

Hard gates are structurally enforced checkpoints tracked in `.cadet/state.json → gates`. The per-transition mapping:

<gates>
  <transition from="architectureComplete" to="story-breakdown">
    <gate id="designReviewCompleted">
      The design was challenged before the work items exist, and every finding carries a disposition.
      Required on this edge only, and only when `.cadet/harness.json` sets `designReview.enabled`.
      Satisfied by `cadet-agent harness verify-design-review --artifact <path> --files <technical-design,requirements,ADRs>`:
      the artifact names its reviewer and inputs, every finding has a disposition, and a contested
      decision names the person who resolved it — an unresolved contested finding blocks the gate.
    </gate>
  </transition>
  <transition from="implementation" to="review">
    <gate id="architectureFitnessPassed">
      The project's declared executable constraints hold for the changed files.
      REQUIRED ONLY WHEN `.cadet/harness.json` declares checks under `architectureFitness` and sets
      `enabled: true`; a project that declares none sees this transition exactly as it was.
      Satisfied by `cadet-agent harness verify-architecture`, which runs the checks the repository
      declared — there is no `--command`, because a gate whose command is chosen at the call site
      proves nothing about the repository.
      This proves executable constraints (a core assembly with no engine reference, a layer that may
      not import another). It does NOT prove the design is good: that is `designReviewCompleted`.
      A required check that fails blocks review. A check that cannot complete is `blocked` — not a
      red — and its remedy is a `tooling-gap` exception naming who accepted it, never a hand record.
    </gate>
    <gate id="testsPassed">All tests for the current story pass — red/green confirmed.</gate>
    <gate id="compileCheckConfirmed">User confirmed Unity compiles without errors.</gate>
    <gate id="unityAnalyzerClean">Zero Unity analyzer diagnostics (UNT*) in changed files. Use `get_errors` tool to verify.</gate>
    <gate id="storyTrackingUpdated">Story markdown marked complete, epic progress updated.</gate>
  </transition>
  <transition from="review" to="validation">
    <gate id="codeReviewCompleted">Full review executed per CodeReview skill, findings filed.</gate>
    <gate id="securityReviewPassed">No secrets, unsafe patterns, or security concerns.</gate>
    <gate id="acceptanceCriteriaValidated">Each Given/When/Then criterion validated.</gate>
    <gate id="reachabilityAddressed">
      The story's declared reachability is honoured: it is either witnessed, or deferred to a work
      item that exists and is not already done. REQUIRED ONLY WHEN the repository opts in via
      `reachability.enabled` in `.cadet/harness.json`; with the default off this gate is not part of
      the transition. An unowned or expired deferral fails it (an owned one satisfies it), so
      infrastructure work is not blocked. Verify with `cadet-agent harness verify-reachability
      --story <path>`; when the repository configures `reachability.command`, that probe's exit code
      is the verdict, because Cadet cannot know how a given repository wires its pieces together.
    </gate>
    <gate id="userPlaythroughConfirmed">
      A person played the delivered work, and recorded what they did and what they saw.
      REQUIRED ONLY WHEN `userPlay.enabled` is set in `.cadet/harness.json`, and only on THIS edge:
      `review -> validation` is the story boundary, so the next-story loop stays unblocked and an
      epic's closure is covered by `humanAcceptanceConfirmed` alone.
      A story whose deliverable can be played declares `Play: required — <what the user does and what
      they see>`; a story that cannot be played yet declares `Play: deferred to <work item> — <why>`,
      which expires when that work item is done. Silence is neither.
      HUMAN-OWNED: no command produces this gate and `harness verify` refuses it. For a `required`
      story the only route is to ASK the person who played it — whether they played it, and whether
      anything was unexpected — and record their own answer:
      `harness confirm --gate userPlaythroughConfirmed --reason "<what they said>" --files <story>`.
      `cadet-agent harness verify-play --story <path>` records the gate for a `deferred` story and
      refuses a `required` one, so an agent can never answer this question in the person's place.
      There is deliberately no form and no artifact: a document to fill in is one more thing to write,
      read and keep in sync, and its blank fields stop a lazy agent rather than a dishonest one.
    </gate>
  </transition>
  <transition from="validation" to="closed">
    <gate id="designArtifactSyncConfirmed">Requirements, design, plan, epics mutually consistent.</gate>
    <gate id="humanAcceptanceConfirmed">
      A person accepted the delivered work. Human-owned: no command and no reviewer's record can
      stand in for them, so `harness verify` refuses this gate outright.
      Required only when `.cadet/harness.json` sets `humanAcceptance.enabled`, and NEVER on
      `validation -> implementation` — a story moving to the next one is not a release, and the
      next-story loop must stay unblocked.
      ASK the person: whether they accept the delivered work, and what they saw. Record their own
      answer with `cadet-agent harness confirm --gate humanAcceptanceConfirmed --reason "<what they
      said>" --expires-at <ISO-8601>`. There is no form and no artifact to fill in: the record is the
      person's sentence, and a record with no answer in it is refused both when it is written and
      when the state is validated. Work a user cannot reach or observe takes a `non-user-facing`
      exception naming who judged it, not a silent pass.
    </gate>
  </transition>
</gates>

### Execution protocol

1. Read `gates` from `.cadet/state.json` before phase transition.
2. Check required gates for the target transition; if any is `false`, block transition and report the failing gate(s).
3. **Evidence is required.** A gate may only be `true` when backed by a fresh, non-superseded record in `state.json → gateEvidence` (see §1). Evidence from a different work item, a changed input tree, changed acceptance criteria, an expired record, or a superseded record does not satisfy a gate.
   - Build evidence with `cadet-agent harness verify --gate <gate>` for automated checks, or record a user `manual-confirmation` when automation is unavailable.
   - `cadet-agent state transition --to <phase> --dry-run` enforces this mechanically and lists every missing or stale gate. **Always pass `--dry-run` to check** — without it the transition is applied and `state.json` is written.
4. **For `compileCheckConfirmed` and `unityAnalyzerClean`:** prefer the Unity CLI commands in `.cadet/agent/core/UnityCli.md` (`cadet-agent harness verify` runs them). If Unity CLI is unavailable, record the user's manual confirmation with project path, editor version, timestamp, and scope. The `get_errors` tool may be used as supporting context, but a `manual-confirmation` record is required for the gate.
5. Apply reset semantics exactly as current rules define (gates reset to `false` on new story/epic), then re-check before transition.

### Failure to satisfy a gate

If a gate cannot be satisfied: STOP immediately. Report which gate failed and why. Do NOT advance the phase until the user provides a resolution path. If the user explicitly directs skipping a gate, record a structured `gate-exception` in `.cadet/state.json → gateExceptions` with the gate, scope, rationale, and an expiry — scoped to one work item and one transition, never propagated to a new story.
