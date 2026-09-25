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

## Witness checkpoint
<slot id="witnessCheckpoint" note="REQUIRED. Name the story that first makes this epic's work reachable, and what a user or operator does to witness it. An epic whose work only becomes reachable at its LAST story is allowed, but it must say so here explicitly (and the reason must be one the owner has seen), because that ordering is how an epic spends many stories with nothing to show. 'Witnessed by story-N — <how>' is the normal answer; 'nothing is reachable inside this epic; first witness is <epic-N::story-M.md> because <reason>' is the deferral form."/>

## Coverage
<slot id="coverage" note="DERIVED — do not hand-author. Populate from each story's Declared tests via `cadet-agent harness verify-acs --story <path> --write-coverage`. A criterion with no executing test must render as an explicit gap, never as a plausible-looking row."/>

## Change History
<slot id="changelog" repeat="true" header="Date|Change|Reason">
| <slot id="date"/> | <slot id="change"/> | <slot id="reason"/> |
</slot>
