# Story: <slot id="name"/>
<slot id="storyId" fmt="EPIC-N-STORY-N"/>
Parent Epic: <slot id="parentEpic" fmt="../epic.md"/>
Status: <slot id="status" opt="Planned|In Progress|Done">Planned</slot>
Estimate: <slot id="estimate" opt="Small|Medium" note="completable in a single session"/>
Reachability: <slot id="reachability" note="REQUIRED, and one of exactly two forms: 'witnessed — <what a user or operator does and what they see>', or 'deferred to <work-item id> — <why it cannot be witnessed yet>'. Silence is not reachability. A deferral is honoured only while its target is unfinished, so it expires when that work item is done: either note it here as witnessed or fix the wiring. Infrastructure that produces nothing reachable yet declares a deferral; that is what the form is for, and it must name an owner. Verified by `cadet-agent harness verify-reachability` when the repository sets `reachability.enabled`."/>

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
