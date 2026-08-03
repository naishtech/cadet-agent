# Spike: <slot id="question" note="one sentence — exact question to answer"/>

<slot id="spikeId" fmt="SPIKE-N"/>
Status: <slot id="status" opt="Planned|In Progress|Complete">Planned</slot>
Source: <slot id="source" fmt="link to requirement/design assumption"/>
Time box: <slot id="timeBox" fmt="e.g. 30 min, 2 hours"/>

## Research
Sources: <slot id="sources" note="docs, APIs, community, search results"/>

## Findings
### Capabilities
<slot id="capabilities" repeat="true"/>

### Limitations
<slot id="limitations" repeat="true"/>

## Recommendation
<slot id="recommendation" note="use | avoid | more-research, with rationale"/>

## Impact on Design
- Assumptions resolved: <slot id="assumptionsResolved" repeat="true"/>
- Design changes needed: <slot id="designChanges"/>
