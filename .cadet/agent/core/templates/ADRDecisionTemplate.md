# ADR: <slot id="title" note="short, descriptive, imperative"/>

<slot id="adrNumber" fmt="NNNN"/>
Status: <slot id="status" opt="Proposed|Accepted|Superseded">Proposed</slot>
Author: <slot id="author"/> · Date: <slot id="date"/>
Supersedes: <slot id="supersedes" fmt="ADR-NNNN"/> · Superseded by: <slot id="supersededBy" fmt="ADR-NNNN"/>

## Context
<slot id="currentState"/>
<slot id="constraints"/>
<slot id="stakeholders"/>

## Options Considered
<slot id="options" repeat="true" header="Option|Summary|Pros|Cons">
| <slot id="name"/> | <slot id="summary"/> | <slot id="pros"/> | <slot id="cons"/> |
</slot>

## Decision
<slot id="decision" note="imperative mood — 'Use X for Y', no hedging"/>

## Rationale
<slot id="rationale" note="why this over alternatives; evidence that tipped the balance"/>

## Invariants
<slot id="invariants" repeat="true" note="rules future changes must respect"/>

## Consequences
- Easier: <slot id="easier"/>
- Harder: <slot id="harder"/>
- Risk: <slot id="risk"/>
