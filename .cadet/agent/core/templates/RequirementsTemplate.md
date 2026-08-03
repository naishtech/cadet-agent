# Requirements: <slot id="featureName"/>

<slot id="project"/>
Status: <slot id="status" opt="Draft|In Review|Final">Draft</slot>
Version: <slot id="version"/> · Last Updated: <slot id="lastUpdated"/> · Author: <slot id="author"/>

## Context
- Problem: <slot id="problemStatement"/>
- User Outcome: <slot id="userOutcome"/>
- Value: <slot id="businessValue"/>
- In Scope: <slot id="inScope"/>
- Out of Scope: <slot id="outOfScope"/>

## Constraints & Assumptions
- Constraints: <slot id="constraints"/>
- Dependencies: <slot id="dependencies"/>
- Risks: <slot id="risks"/>
- Assumption audit: <slot id="assumptions" repeat="true">
    <slot id="desc"/> — <slot id="classification" opt="verified|reasonable|unverified"/>
  </slot>

## Acceptance Criteria
<slot id="acceptanceCriteria" repeat="true">
### <slot id="acId" fmt="AC-NN"/>: <slot id="acTitle"/>
- Given: <slot id="given"/>
- When: <slot id="when"/>
- Then: <slot id="then"/>
- Testability: <slot id="testabilityNotes"/>
</slot>

## Non-Functional Requirements
- Performance: <slot id="nfrPerformance"/>
- Security: <slot id="nfrSecurity"/>
- Reliability: <slot id="nfrReliability"/>
- Usability: <slot id="nfrUsability"/>

## Traceability
- Design sections: <slot id="mapsToDesign"/>
- Plan phases: <slot id="mapsToPlan"/>
- Epic IDs: <slot id="mapsToEpics"/>

## Review and Approval
- Reviewer(s): <slot id="reviewers"/>
- Review Notes: <slot id="reviewNotes"/>
- Approval Decision: <slot id="approvalDecision"/>
- Approval Date: <slot id="approvalDate"/>

## Change History
<slot id="changelog" repeat="true" header="Date|Version|Summary|Reason|ImpactedAC|UpdatedBy">
| <slot id="date"/> | <slot id="version"/> | <slot id="summary"/> | <slot id="reason"/> | <slot id="impactedAC"/> | <slot id="updatedBy"/> |
</slot>
