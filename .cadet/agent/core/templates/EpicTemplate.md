# Epic: <slot id="name"/>

<slot id="epicId" fmt="EPIC-N"/>
Status: <slot id="status" opt="Planned|In Progress|Complete">Planned</slot>
Requirements: <slot id="requirements" fmt="link"/>
Technical Design: <slot id="technicalDesign" fmt="link"/>

## Summary
<slot id="summary" note="one paragraph — user value and why this epic exists"/>

## Stories
<slot id="stories" repeat="true">
- [<slot id="done" opt=" |x"/>] <slot id="storyName"/> — <slot id="oneLineSummary"/>
</slot>

## Coverage
<slot id="coverage" note="DERIVED — do not hand-author. Populate from each story's Declared tests via `cadet-agent harness verify-acs --story <path> --write-coverage`. A criterion with no executing test must render as an explicit gap, never as a plausible-looking row."/>

## Change History
<slot id="changelog" repeat="true" header="Date|Change|Reason">
| <slot id="date"/> | <slot id="change"/> | <slot id="reason"/> |
</slot>
