# Story: <slot id="name"/>
<slot id="storyId" fmt="EPIC-N-STORY-N"/>
Parent Epic: <slot id="parentEpic" fmt="epic.md" note="the `epic.md` in THIS directory. A story lives beside its epic — `epic-N-slug/epic.md` and `epic-N-slug/story-M-slug.md` — so the reference is a sibling, not a parent. `../epic.md` was written here until 0.47.0 and resolves to a file that does not exist, which is why `harness reconcile` reports a bad parent only when the sibling filename is actually wrong."/>
Status: <slot id="status" opt="Planned|In Progress|Done">Planned</slot>
Estimate: <slot id="estimate" opt="Small|Medium" note="completable in a single session"/>
Reachability: <slot id="reachability" note="REQUIRED, and one of exactly two forms: 'witnessed — <what a user or operator does and what they see>', or 'deferred to <work-item id> — <why it cannot be witnessed yet>'. Silence is not reachability. A deferral is honoured only while its target is unfinished, so it expires when that work item is done: either note it here as witnessed or fix the wiring. Infrastructure that produces nothing reachable yet declares a deferral; that is what the form is for, and it must name an owner. Verified by `cadet-agent harness verify-reachability` when the repository sets `reachability.enabled`."/>
Play: <slot id="play" note="REQUIRED, and one of exactly two forms: 'required — <what the user does in the running game, and what they should see>', or 'deferred to <work-item id> — <why it cannot be played yet>'. It is the story's answer to a different question than Reachability asks: reachability says a person CAN reach the deliverable, and this says whether a person should PLAY it. A 'required' story cannot cross review -> validation until the person has played it and their own answer is recorded — ask them whether they played it and what was unexpected, then run `cadet-agent harness confirm --gate userPlaythroughConfirmed --reason \"<what they said>\" --files <this file>`. `harness verify-play` records the gate for a deferral and refuses to record it for a playable story, because a play is not something an agent can perform, and there is no form to fill in: the record is the person's sentence. A deferral is honoured only while its target is unfinished and expires when that work item is done. There is deliberately NO 'not applicable' form: a story with no playable surface of its own is still reached through the running game, and an escape hatch an agent can write for itself is how this check would stop being one. Verified by `cadet-agent harness verify-play` when the repository sets `userPlay.enabled`, and required on the story boundary when it is set."/>

## Acceptance Criteria
<slot id="ac" repeat="true">
### <slot id="acId" fmt="AC-N"/>: <slot id="acTitle"/>
- Given <slot id="given"/>, When <slot id="when"/>, Then <slot id="then"/>
- Declared tests: <slot id="declaredTests" note="exact test identifiers that prove this AC; one per line; must appear in the test report"/>
</slot>

## Scope
- In: <slot id="inScope"/>
- Out: <slot id="outOfScope"/>

## Implementation Notes
- Design refs: <slot id="designRefs"/>
- Test strategy: <slot id="testStrategy"/>
- Dependencies: <slot id="deps"/>

## Change History
<slot id="changelog" repeat="true" header="Date|Change|Reason">
| <slot id="date"/> | <slot id="change"/> | <slot id="reason"/> |
</slot>
