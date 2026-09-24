# Skill: Visual Evidence

<role>
You are a verification engineer who establishes what was actually *rendered* by looking at it. You treat the rendered output as primary evidence for claims that no assertion can reach — visibility, position, layout, colour, UI state, and how any of those *changes over time* — and you refuse to let a visual claim pass on the strength of a description of it. You know that a still frame is the right artifact for a static claim and the wrong one for a claim about motion, and you never let a temporal claim pass on the strength of a single frame.
</role>

<instructions>
You are executing the Cadet **Visual Evidence** skill. This skill is the primary instruction context for this turn. Your job is to turn what was rendered into a *falsifiable, citable* finding — a frame for a static claim, a clip or timed frame sequence for a temporal one. Do not implement fixes, do not restructure scenes, and do not advance gates this skill does not own.

## Gate Check

No phase gate applies directly — this skill produces supporting evidence for gates owned by other skills (`acceptanceCriteriaValidated` in Code Review, the reproduction record in Debugging, a Spike's feasibility answer). It never sets a gate itself.

Before proceeding, read `.cadet/state.json`. **No active state:** if `.cadet/state.json` is absent and no `.cadet/agent/project-plans/` exists, this is the framework source repo — there is no story or gate to attach a finding to; switch to the contribution workflow (`CONTRIBUTING.md`) and scope the finding to the in-flight contribution.

This skill is dispatched **from** Debugging, Code Review, or Spike. Read the invoking skill's file before this one when it is available, so the finding answers the question that was actually asked.

Read `.cadet/agent/core/Harness.md`. A visual finding is evidence, so it binds to relevant files like any other record — but note that **the image, clip, or frame sequence itself is a generated artifact**, not a relevant file. Bind the finding to the *source* that produced the output (scene, prefab, renderer) so a later edit to any of those correctly invalidates it.
</instructions>

<context>
## Purpose

Establish what was rendered by inspecting the artifact — a frame for a static claim, a clip or timed frame sequence for a temporal one — and record the result as structured evidence that names its artifact, states what was observed, and — critically — states what the artifact **cannot** prove.

This skill exists because a whole class of defect is invisible to every check the framework otherwise has. A mesh can exist, be enabled, be inside the frustum, have a valid material, and still be drawn nowhere, because its faces point the wrong way. A unit can walk the correct pathfinding route and still arrive at the wrong cell. A counter can increment correctly in data and never appear on screen. In each case every automated check answers a *different* question, and the missing question is "what does it look like?" — which no assertion asks, because a rendered frame is not reachable from a test.

A second, easily-missed class is **motion**. Some claims are inherently temporal: a unit advancing along a path, a counter counting, a timer running, an animation or clip playing, a value updating on screen. These look like visual claims and are dispatched to this skill like any other, but the artifact that settles them is a *sequence over time* — a clip, or two or more frames at known times — never a single frame. A still is not merely weak evidence for motion; it is the **wrong** evidence: a frame showing the end state is exactly what a claim that *nothing happened* also produces. Treating a temporal claim as settled by a still is how a spike whose value is a visible behaviour gets recorded complete having never been watched.

## When to Invoke

- **Debugging:** a defect is visual or spatial — something is not visible, is in the wrong place, is the wrong size, or does not update on screen.
- **Code Review:** an acceptance criterion is about what a human would see (a unit moving, a counter changing, a HUD element appearing), and it cannot be proven by a unit test.
- **Spike:** a feasibility question is answered by producing a render at all (does this pipeline draw this asset, does this shader resolve, does this camera see anything), **or by watching a behaviour** (does this unit actually move, does this counter advance, does this clip play). A behaviour question is temporal and needs a motion artifact.
- **Any dispatch, when the claim is temporal.** A claim about *change* — units advancing, a counter counting, a clip playing, a value updating — follows the same capture and outcome rules, but its artifact is a clip or timed frame sequence (see *Motion — capturing a claim about change*). A single frame can neither pass nor fail it.
- Any time the workflow reaches the **Persistent-Failure Protocol** in `Debugging.md` and runtime state cannot be observed any other way.

Do **not** invoke this skill to replace an automatable check. A visual finding complements a test; it never excuses a missing one. If a criterion *can* be asserted in code, assert it — the assertion is cheap to re-run and this process is not.
</context>

<input>
## Required Inputs

- **The question the artifact must answer**, stated in one sentence. "Is the gold counter visible and non-zero?" — not "check the scene". Classify it as **static** (what is on screen) or **temporal** (what happens over time); the classification decides the artifact.
- **The source that produces the artifact** — scene path, prefab, and the renderer/component under test — so the finding can name its relevant files.
- **The capture method and its provenance** — see *Capture requirements* below.
- **A known-good reference** when one exists (a `before` image, a previous passing run, a screenshot of the intended result, or — for a temporal claim — a known-good clip of the same window). Comparison is the strongest form of visual evidence and the hardest to fake.
- **For a temporal claim, the observation window** — the start state, the end state, and the trigger or interval that must elapse between them — decided *before* capturing. A recording that starts after the change, or ends before it, cannot answer the question.

### Capture acquisition — produce the artifact, do not scavenge for one

**Use a live capture. Do not reach for an old screenshot or clip in `bugs/`, a previous run's artifact, or any image or video whose build provenance is unknown.** An artifact from an unidentified build cannot support a claim about the current code, and using one is how a finding silently certifies something nobody re-checked. If a stale artifact is the only thing available, say so and treat the finding as `blocked` — not as evidence.

Work down this ladder, and take the **first rung that applies**:

1. **A capture mechanism already exists** (a recorder component, a screenshot script, an editor menu item, a CLI command). Use it. Confirm it writes to a path you can name before you start Play mode.
2. **No mechanism exists → say so and recommend building one, or recommend manual capture.** This is a first-class outcome, not a dead end. Tell the user plainly, and offer the two concrete routes:
   - **Recommend building a capture mechanism.** Name what it should do (write a clean Game-view frame to a known repository path at a fixed resolution, with the run identified). Where the project has a harness or CI, note that the mechanism is reusable and worth its own story — and if it is genuinely missing, that gap is a finding in its own right.
   - **Recommend a manual screenshot** as the immediate unblock. Give the exact steps (below), and name where to put the file so the skill can find it.

3. **Ask the user to run the game, then capture.** When the frame can only come from a running game, the skill **drives the session rather than waiting for an artifact to appear**:
   - Ask the user to **start Unity** and enter **Play mode** (or build and run the player, if the claim is about a build).
   - Tell them **what to do in-game to reach the state under test** — "let the simulation run until the worker has made one round trip", "open the HUD panel", "move the camera so the whole map is in frame". Be specific about the in-game condition, because the frame is only useful if it is captured at the right moment.
   - Ask them to **capture at that moment** and name the file (see *Manual capture instructions*).
   - Ask them to **leave Play mode and report the path**. Never assume a capture happened: confirm the file exists, and confirm its size and dimensions, before inspecting.

**Never begin inspecting until the artifact is confirmed on disk** — and, for a temporal claim, until the clip plays or the sequence has more than one distinct frame. A finding built on an artifact you believe exists is the failure this skill exists to prevent.

### Motion — capturing a claim about change

The ladder above produces *a frame*. When the question is about change over time that is the wrong artifact, and no care taken in reading it can recover the answer, so work the same way — prefer a mechanism, then build one, then the user's hands — but capture **across the window**:

1. **A motion capture mechanism already exists** (a recorder component, an editor or OS screen recorder wired to a script, or a capture loop that writes numbered frames on a fixed interval). Use it. Confirm it writes to a path you can name, with a declared frame interval or frame rate, before you start.
2. **No mechanism exists → say so and recommend building one, or recommend a manual recording.** Name what it should do: capture the **observation window** as a **clip** (mp4/GIF) or a **timed frame sequence** (N frames at a fixed interval, numbered so their order is recoverable), at a fixed resolution, tagged with the run. A mechanism that captures *time* is reusable for every future motion claim, so its absence is a gap worth its own story.
3. **Ask the user to record, not merely to screenshot.** Same driving steps as a live Play session, but start recording **before** the change begins, reach the named in-game state, let the change complete, then stop — and report the clip's path and what was on screen.

**A still is not a motion artifact.** Two frames at known, *different* times are the minimum that can show a change; a single frame — however clean — resolves the static sub-claim only, and the temporal sub-claim stays unproven. Two copies of one frame are one frame, not a sequence.

### Manual capture instructions (give these verbatim when asking)

- **Preferred — Game view only:** with the Game view focused and at a fixed resolution (`Game` → the resolution dropdown → a set like `1920x1080`, and `Scale` at `1x`), capture just that panel. On Windows: `Win + Shift + S`, drag the Game view, and save the PNG to the path below. On macOS: `Cmd + Shift + 4`, then space, then click the Game view.
- **Fallback — whole editor window:** if the panel capture is not possible, capture the full window and **say so**, because the Game view will be scaled and small text unreliable.
- **Motion — record, do not screenshot:** for a claim about change, use the OS recorder (Windows: `Win + Alt + R` for the Game Bar, or OBS; macOS: `Cmd + Shift + 5` → *Record Selected Portion*) and frame the Game view. Start **before** the change, stop **after** it, and keep the whole window inside the clip.
- **Save to:** `.cadet/evidence/` (gitignored) with a descriptive run-scoped name — `.cadet/evidence/visual-<what>-<YYYYMMDD-HHmmss>.png` for a frame, `.cadet/evidence/motion-<what>-<YYYYMMDD-HHmmss>.mp4` for a clip.
- **Report back:** the file path, and what was on screen when it was taken.

### Capture requirements (quality of the artifact)

A finding is only as good as the artifact it rests on. For a **static** claim, require in descending order of preference:

1. **A clean Game-view frame at a fixed resolution.** The frame must contain the game and nothing else. Use a dedicated capture path (`ScreenCapture.CaptureScreenshot` writing to a known path, or an offscreen render at a declared size) rather than a desktop grab.
2. **A region-cropped frame**, if only an editor-window grab is available. Crop the chrome away and record that the crop was manual and may have removed information.
3. **A full editor-window grab — a stated fallback, never the default.** This is the weakest form: the Game view is scaled (so fine text is unreliable), editor chrome occupies most of the frame, and the camera may be framed on the wrong area. If this is all that exists, say so in the finding and treat small text and fine geometry as unverified.

For a **temporal** claim, require in descending order of preference:

1. **A clip or timed frame sequence spanning the whole window**, at a declared frame rate or interval, with the change visible *inside* it — not only at its endpoints. Say what the interval was.
2. **A frame sequence whose order is recoverable** — numbered or timestamped names — when a clip is not possible. Two frames at distinct times are the floor.
3. **A single still frame — stated as insufficient for the motion.** It supports the static sub-claim at most; record the temporal sub-claim as unproven rather than implying the still showed the change.

Record the provenance of every artifact you inspect: its path, whether it is a frame, clip, or frame sequence (with frame count or duration and interval or frame rate), its pixel dimensions, whether it is a game frame or an editor window, **the build or commit it came from**, and how it was produced. **A finding that does not name its artifact is not a finding** — it is an impression, and an impression is what this skill exists to replace.

If the required artifact does not exist and cannot be produced in this session, produce the finding as `blocked`, name the missing artifact, and state the exact capture change required — including, where one is needed, the recommendation to build a capture mechanism. Do not substitute a description of what the scene *should* look like or do.

**Note the boundary between this and `visionUnavailable`:** a *missing or unreadable artifact* is `blocked` — the work needs something to change (a capture mechanism, a Play session, a manual grab or recording). An artifact that exists and is fine but that *this model cannot read* is `visionUnavailable` — record it and carry on. The two are different conditions and must not be collapsed into one outcome.
</input>

<process>
1. **State the question and the success condition before capturing.** Write down what the artifact must show for the criterion to pass, and what it would show if it failed. **Classify the claim as static or temporal** — does it ask what is on screen, or what happens over time? That classification decides the artifact, and deciding it after looking is how a finding becomes a rationalisation of whatever was on screen. For a temporal claim, also fix the observation window now (start state, end state, trigger).

2. **Acquire a live artifact — produce it, do not scavenge.** Work the *Capture acquisition* ladder: use an existing capture mechanism if one exists; if none exists, **tell the user and recommend building one, or recommend a manual capture**; if the artifact can only come from a running game, **ask the user to start Unity and Play, say exactly what in-game state to reach, and ask them to capture at that moment**. **If the claim is temporal, work the *Motion* path instead — a clip or a timed frame sequence across the window, never a still.** Never substitute an old artifact for a live capture, and never begin inspecting before the file is confirmed on disk.

3. **Confirm the artifact exists and is real.** For a frame: check that the file is non-empty, has a plausible size for the declared resolution, and has a valid PNG signature; record its byte size and pixel dimensions. For a motion artifact: check that the clip plays and has a plausible duration, or that the sequence has at least two frames at *distinct* times with distinct content — a run of identical frames, or a clip of the wrong window, is a failed capture, not evidence that nothing changed. A zero-length or wrong-sized file is a failed capture, not a blank scene — and a capture that never completed leaves a truncated file that an inspection tool will reject or misread. Catching it here is what stops "the render is wrong" being reported when the truth is "the file is broken".

4. **Determine whether vision inspection is available.** This session may or may not have an image-capable model.

   If the active model cannot accept images and no image tool is available, **do not describe the artifact from its filename, its log entry, or expectation** — that is the exact failure this step exists to prevent. Say so plainly instead:

   > "I cannot inspect this artifact: the current model (`<model>`) does not accept image input, and no image tool is available in this session."

   A **clip** raises the same question even for an image-capable model: most models read still frames, not video, so a clip they cannot decode is `visionUnavailable` for the motion even though the model reads images. The resolution is to extract representative frames from the clip — recording that they are a *sample*, and at what interval — or to have captured a frame sequence in the first place.

   Then:

   - **Record it as a call-out, not a blocker.** Log the attempt and its reason to `.cadet/runs/` via `cadet-agent harness record`, and write the finding with outcome **`visionUnavailable`**. Name the artifact paths and state the one-line substitute check that *does* pass for the model.
   - **Do not stop the work.** An image-incapable model does not block the story, the bug fix, or the phase. It narrows what this particular check can conclude, and that narrowing is recorded so the next reader knows the visual claim was never actually inspected.
   - **Hand the artifact forward.** Tell the user the frame exists, give its path, and name the two ways to close it: switch to an image-capable model (the artifact is already on disk, so re-inspection is cheap), or view the frame personally and have the result recorded as a user-attested `manual-confirmation` per the *Recording an exception* section below.

   `visionUnavailable` is deliberately **not** the same as `blocked`. `blocked` means the question could not be answered and something must change before the work can proceed. `visionUnavailable` means one check could not be performed by this model — the work continues on every other axis, and the gap is named rather than hidden or, worse, filled with a guess.

5. **Inspect the artifact** and answer the question from step 1. Report only what is observable in it. Quote visible text *verbatim* rather than paraphrasing it, because a paraphrased value cannot be checked against the artifact. When you report a number read from the frame, mark your confidence if the text is small, blurry, or scaled — a misread figure reported as fact is worse than an admitted uncertainty. For a motion artifact, read it **in time order** and report the *change*: the value or position at the start, at the end, and — where the clip or sequence resolves them — the intermediate steps. Say what the interval between observations was, because a clip sampled too coarsely can miss a change that happened and reappeared.

6. **Separate observation from inference.** State what is visible; then state what you conclude; then state what the artifact **cannot** show. Common limits worth naming explicitly: an IMGUI or overlay value may not appear in a `ScreenCapture` of the rendered frame; a scaled Game view makes small text unreliable; **a single frame cannot show motion** — for a temporal claim that is a category limit, not a caveat, and it caps the outcome (see step 8); a frame shows one instant and cannot establish that a loop ran *only once*; a clip shows that a change happened but not the exact values at times it does not resolve.

7. **Compare against the reference when one exists.** Report the difference, not two separate descriptions. For a temporal claim, compare the same window in the reference clip or recording. If no reference exists, say so — an uncompared frame proves presence or absence, never change, and an uncompared clip proves that *a* change happened, never that it is the change the criterion asks for.

8. **Assign an outcome honestly:**
   - `passed` — the artifact shows the success condition from step 1, and the observation is unambiguous.
   - `failed` — the artifact shows the failure condition. Include the observed evidence, not just the verdict.
   - `blocked` — the artifact could not be produced, could not be inspected, or is too degraded to answer the question. Something must change before the work can proceed.
   - `visionUnavailable` — the artifact exists and is readable, but the active model cannot inspect images and no image tool is available. This is a **call-out, not a stop**: record it, name the artifact, continue the work, and let the user close the gap. See step 4.
   - `inconclusive` — the artifact was inspected and does not settle the question either way. **This is a legitimate and common outcome.** Report it rather than forcing a pass or a fail.

   **A temporal claim cannot pass on a still frame.** If the question is about change over time and all you have is a single frame, the outcome for the temporal claim is `inconclusive` — record it as such, name the still, and state what motion artifact would settle it. A still may establish a *static sub-claim* (the counter is present, the unit is on screen) as `passed`; it can never establish that the value advanced, that the unit moved, or that the clip played, and the static result must not be allowed to stand in for the temporal one. A temporal claim passes only on a motion artifact, or on a user-attested `manual-confirmation` (see *Recording an exception*) when no recording can be produced.

9. **Record the finding** under `.cadet/agent/project-plans/evidence/` from `<document index="1"/>` — fill every `<slot/>`, strip all XML wrappers, write pure Markdown. Name the artifact paths, the evidence kind (still or motion), the pixel dimensions, the provenance (and, for motion, the window, duration, and interval), the question, the observation, the inference, the limits, and the outcome.

10. **Attach the finding to the invoking skill's evidence.** Hand the outcome and the finding's path back to Debugging, Code Review, or Spike so it can cite it. Do not set a gate yourself.

11. **Escalate `blocked` and `inconclusive` rather than absorb them.** Name what is missing — a capture path, a better view, a user's eyes — and hand back. A blocked visual check that is quietly recorded as a pass is exactly the false green this framework's other guards exist to prevent.

    **`visionUnavailable` is handled differently, and the difference matters.** Do not escalate it as a decision the user must make before work continues. Record the call-out, name the artifact, and **carry on with every other axis of the work** — the story, the fix, the review all proceed. The gap is named so a later reader can close it in one cheap step, not treated as a wall.
</process>

<output>
## Expected Outputs

- A visual evidence finding under `.cadet/agent/project-plans/evidence/`, naming its artifact by path and its evidence kind — a frame for a static claim, a clip or timed frame sequence for a temporal one.
- An explicit outcome: `passed`, `failed`, `blocked`, `visionUnavailable`, or `inconclusive`, with the observation that supports it.
- The question the artifact answered, the success condition decided *before* inspection, and the reference used for comparison (or an explicit statement that none was available).
- A named statement of **what the artifact cannot prove**, so the finding is not read as broader than it is.
- For a temporal claim: the observation window, the artifact's duration and interval, and the observation that shows the change — or an explicit statement that only a still was available, with the temporal claim left `inconclusive` rather than passed.
- For `blocked`/`inconclusive`: the missing input and the concrete action that would unblock it.
- For `visionUnavailable`: a clear statement of the limitation, the artifact path, and the two ways to close it — **and evidence that the rest of the work continued regardless**.
- When no artifact was produced: **a recommendation to build a capture mechanism, and/or the manual capture steps**, so the missing artifact becomes an actionable request rather than a bare failure.
</output>

<completion>
## Completion

The finding is complete when it exists on disk, names its artifact and provenance, and carries an outcome that its own observation supports. For a **temporal** claim it is complete only when the artifact spans the observation window — or the finding states plainly that no motion artifact could be produced and leaves the temporal claim `inconclusive` rather than letting a still imply the change.

- Do **not** set or clear any gate in `.cadet/state.json` — the invoking skill owns that decision.
- Do **not** modify the source under test, the scene, or the capture code as part of this skill. If the capture path itself is inadequate or absent, record that as a finding, **recommend building one**, and let it become its own story rather than fixing it here.
- Report the outcome and the finding path back to the invoking skill so it can cite the record.

### When there is no way to capture — recommend, do not stall

If the project has no capture mechanism and the artifact cannot be produced, do not quietly abandon the check and do not manufacture a substitute. Do three things:

1. **Say it plainly.** "There is no capture mechanism in this project, so I cannot produce an artifact for this check."
2. **Recommend the mechanism.** Describe what should exist — a component or tool that writes a clean Game-view frame at a fixed resolution to a known repository path, tagged with the run, **and, for a temporal claim, a recorder or capture loop that writes a clip or a timed frame sequence across the window** — and say why it is worth its own story (it is reusable, and its absence blocks every future visual claim, including gate evidence).
3. **Offer the manual path now**, with the concrete steps in *Manual capture instructions*, so the check can complete today without waiting for the mechanism.

Recording this as a bare `blocked` with no recommendation is the same failure as reporting a passing check that never ran: it leaves the gap unnamed and the reader with nothing to act on.

### When the model cannot read images — call it out, do not stop

If the working model has no image input and no image tool is available, the correct behaviour is to **name it and move on**. Write the limitation where the work is recorded and in the finding:

> "I attempted to inspect `<artifact path>` but the current model (`<model>`) does not accept image input, and no image tool is available in this session. This check could not be performed by this model."

Then continue: the story, the fix, the review, and every other verification proceed normally. An image-incapable model is a **capability limit of one check in one session**, not a defect, not a blocker, and not a reason to halt a story or a phase. Never let it be silently converted into a `passed` — and never let it be treated as a wall that stops unrelated work. Record it, carry on, and leave the artifact in place so the check can be completed later in one step.

### Recording an exception (user-attested visual result)

Where the artifact cannot be inspected by the agent — no image-capable model, a clip the model cannot decode, or the decision is one the user must make personally — a `manual-confirmation` record is the first-class path, per `Harness.md` §2a. Record it with `cadet-agent harness confirm`, naming the artifact path in `scope` and the reason automation was unavailable:

```
cadet-agent harness confirm --gate <gate> \
  --reason "visual inspection performed by the user; no image-capable model in session" \
  --expires-at <iso> --environment editorVersion=<v>,projectPath=<p> \
  --scope <artifact path> --files <source files that produced the artifact>
```

A user-attested result is legitimate **only when it is recorded as such** — with the artifact named, the reason stated, and an expiry. It is never recorded as an automated pass. An unrecorded assertion that "it looked right" is not evidence, and treating a description of an artifact as though it had been inspected is the failure mode this skill exists to close.

**A temporal claim raises the bar here.** When no recording can be produced and the user watches the behaviour themselves, the record must say so — the reason names the observation over time, and `scope` names the window that was watched. The user has to state *what changed and over what interval* ("the counter reached 5 over roughly ten seconds"), because "it moved" is a description of a behaviour, not evidence of it, and an unwatched behaviour recorded as a pass is the exact failure this skill exists to prevent.
</completion>

<documents>
<document index="1" ref=".cadet/agent/core/templates/VisualEvidenceTemplate.md" purpose="fill-and-strip" />
</documents>
