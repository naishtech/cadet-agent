# Visual Evidence: <slot id="title" note="short title — what was inspected"/>

<slot id="findingId" fmt="VIS-N"/>

| | |
|---|---|
| **Outcome** | <slot id="outcome" opt="passed|failed|blocked|visionUnavailable|inconclusive">inconclusive</slot> |
| **Evidence kind** | <slot id="evidenceKind" opt="still|motion">still</slot> |
| **Question** | <slot id="question" note="the one sentence the artifact must answer"/> |
| **Artifact** | <slot id="artifactPath" fmt="repository-relative path to the image, clip, or frame sequence, or 'none produced'"/> |
| **Dimensions** | <slot id="dimensions" fmt="WxH px, byte size — for motion, also duration and interval or frame rate"/> |
| **Observation window** | <slot id="motionWindow" note="motion only — the start state, end state, and trigger or interval the artifact must span; write 'n/a — static claim' for a still"/> |
| **Provenance** | <slot id="provenance" opt="clean Game-view frame|region-cropped editor grab|full editor-window grab|manual screenshot (Game view)|manual screenshot (full window)|screen recording (clip)|timed frame sequence|user-attested observation"/> |
| **Capture route** | <slot id="captureRoute" opt="existing capture mechanism|manual screenshot by user|manual recording by user|frame-sequence script|live Play session|none available">none available</slot> |
| **Captured** | <slot id="capturedAt" fmt="ISO-8601 timestamp"/> |
| **Build / commit** | <slot id="buildIdentity" note="the revision or build the artifact came from — required so the finding is tied to code. Write 'unknown' only if genuinely unavailable, and say so in Limits"/> |
| **Source under test** | <slot id="sourceFiles" note="scene/prefab/renderer that produced the artifact — these are the relevant files the finding binds to"/> |
| **Dispatched from** | <slot id="invokingSkill" opt="Debugging|Code Review|Spike"/> |
| **Related work item** | <slot id="workItemId" fmt="epic-N::story-M.md or contribution"/> |

## Success condition (decided BEFORE inspection)

- **Passes if the artifact shows:** <slot id="passCondition"/>
- **Fails if the artifact shows:** <slot id="failCondition"/>

## Reference

<slot id="reference" note="path to a before/known-good frame — or, for a temporal claim, a known-good clip of the same window — used for comparison, or 'none available — this is a single-artifact observation'"/>

## Observation

What is visible in the artifact. Quote any visible text verbatim. For a motion artifact, state the value or position at the start, at the end, and the interval between observations.

<slot id="observation" repeat="true"/>

## Inference

What the observation means for the question. Kept separate from the observation, so a reader can check the evidence without adopting the conclusion.

<slot id="inference" repeat="true"/>

## Limits — what this artifact cannot prove

<slot id="limits" repeat="true" note="e.g. scaled Game view makes small text unreliable; a single frame cannot show motion, so a temporal claim is inconclusive without a clip or frame sequence; a clip shows a change happened but not values it does not resolve; an IMGUI overlay may not appear in ScreenCapture; one instant cannot show a loop ran exactly once"/>

## Capture acquisition

- **Route used:** <slot id="routeUsed" opt="existing capture mechanism|manual screenshot by user|manual recording by user|frame-sequence script|live Play session|none available"/>
- **How the artifact was produced:** <slot id="captureHow" note="the mechanism/command/steps, so the same artifact can be produced again"/>
- **In-game state at capture:** <slot id="inGameState" note="what was on screen when it was taken — e.g. 'simulation had run one worker round trip'"/>
- **Window captured (motion):** <slot id="windowCaptured" note="motion only — when recording started and stopped relative to the change, and the frame interval or frame rate; write 'n/a — static claim' for a still"/>

### If no artifact was produced — recommendation (required when Artifact is 'none produced')

- **Missing capability:** <slot id="missingCapability" note="what does not exist — e.g. 'no component writes a Game-view frame to the repository'"/>
- **Recommendation:** <slot id="captureRecommendation" note="either 'build a capture mechanism: <what it should do>' or 'take a manual screenshot/recording', or both. Never leave this empty for a blocked finding"/>
- **Manual steps offered:** <slot id="manualSteps" note="the concrete steps given to the user — Game view capture or screen recording, save path, report back"/>

## Outcome and next action

- **Outcome:** <slot id="outcomeRestated"/>
- **Unblock / follow-up:** <slot id="nextAction" note="for blocked/inconclusive: the missing input and the concrete action that would resolve it; for a still that cannot settle a temporal claim: the motion artifact that would; for visionUnavailable: the artifact path, the model limitation, the two ways to close it, and confirmation that the rest of the work continued; otherwise the handing-back skill and the finding to cite"/>
- **Work continued:** <slot id="workContinued" opt="yes|n/a" note="for visionUnavailable, state explicitly that the story/fix/review proceeded despite the check being unavailable — an image-incapable model never halts unrelated work"/>
