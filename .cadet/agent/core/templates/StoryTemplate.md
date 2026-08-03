# Story: <slot id="name"/>
<slot id="storyId" fmt="EPIC-N-STORY-N"/>
Parent Epic: <slot id="parentEpic" fmt="../epic.md"/>
Status: <slot id="status" opt="Planned|In Progress|Done">Planned</slot>
Estimate: <slot id="estimate" opt="Small|Medium" note="completable in a single session"/>

## Acceptance Criteria
<slot id="ac" repeat="true">
- Given <slot id="given"/>, When <slot id="when"/>, Then <slot id="then"/>
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
