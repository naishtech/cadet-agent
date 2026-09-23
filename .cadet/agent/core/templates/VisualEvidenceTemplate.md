# Visual Evidence: <slot id="title" note="short title — what was inspected"/>

<slot id="findingId" fmt="VIS-N"/>

| | |
|---|---|
| **Outcome** | <slot id="outcome" opt="passed|failed|blocked|visionUnavailable|inconclusive">inconclusive</slot> |
| **Question** | <slot id="question" note="the one sentence the frame must answer"/> |
| **Artifact** | <slot id="artifactPath" fmt="repository-relative path to the image, or 'none produced'"/> |
| **Dimensions** | <slot id="dimensions" fmt="WxH px, byte size"/> |
| **Provenance** | <slot id="provenance" opt="clean Game-view frame|region-cropped editor grab|full editor-window grab|manual screenshot (Game view)|manual screenshot (full window)"/> |
| **Capture route** | <slot id="captureRoute" opt="existing capture mechanism|manual screenshot by user|live Play session|none available">none available</slot> |
| **Captured** | <slot id="capturedAt" fmt="ISO-8601 timestamp"/> |
| **Build / commit** | <slot id="buildIdentity" note="the revision or build the frame came from — required so the finding is tied to code. Write 'unknown' only if genuinely unavailable, and say so in Limits"/> |
| **Source under test** | <slot id="sourceFiles" note="scene/prefab/renderer that produced the frame — these are the relevant files the finding binds to"/> |
| **Dispatched from** | <slot id="invokingSkill" opt="Debugging|Code Review|Spike"/> |
| **Related work item** | <slot id="workItemId" fmt="epic-N::story-M.md or contribution"/> |

## Success condition (decided BEFORE inspection)

- **Passes if the frame shows:** <slot id="passCondition"/>
- **Fails if the frame shows:** <slot id="failCondition"/>

## Reference frame

<slot id="reference" note="path to a before/known-good frame used for comparison, or 'none available — this is a single-frame observation'"/>

## Observation

What is visible in the frame. Quote any visible text verbatim.

<slot id="observation" repeat="true"/>

## Inference

What the observation means for the question. Kept separate from the observation, so a reader can check the evidence without adopting the conclusion.

<slot id="inference" repeat="true"/>

## Limits — what this frame cannot prove

<slot id="limits" repeat="true" note="e.g. scaled Game view makes small text unreliable; a single frame cannot show motion; an IMGUI overlay may not appear in ScreenCapture; one instant cannot show a loop ran exactly once"/>

## Capture acquisition

- **Route used:** <slot id="routeUsed" opt="existing capture mechanism|manual screenshot by user|live Play session|none available"/>
- **How the frame was produced:** <slot id="captureHow" note="the mechanism/command/steps, so the same frame can be produced again"/>
- **In-game state at capture:** <slot id="inGameState" note="what was on screen when it was taken — e.g. 'simulation had run one worker round trip'"/>

### If no frame was produced — recommendation (required when Artifact is 'none produced')

- **Missing capability:** <slot id="missingCapability" note="what does not exist — e.g. 'no component writes a Game-view frame to the repository'"/>
- **Recommendation:** <slot id="captureRecommendation" note="either 'build a capture mechanism: <what it should do>' or 'take a manual screenshot', or both. Never leave this empty for a blocked finding"/>
- **Manual steps offered:** <slot id="manualSteps" note="the concrete steps given to the user — Game view capture, save path, report back"/>

## Outcome and next action

- **Outcome:** <slot id="outcomeRestated"/>
- **Unblock / follow-up:** <slot id="nextAction" note="for blocked/inconclusive: the missing input and the concrete action that would resolve it; for visionUnavailable: the artifact path, the model limitation, the two ways to close it, and confirmation that the rest of the work continued; otherwise the handing-back skill and the finding to cite"/>
- **Work continued:** <slot id="workContinued" opt="yes|n/a" note="for visionUnavailable, state explicitly that the story/fix/review proceeded despite the check being unavailable — an image-incapable model never halts unrelated work"/>
