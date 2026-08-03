# Project Plan: <slot id="title"/>

<slot id="project"/>
Status: <slot id="status" opt="Draft|In Progress|Blocked|Complete">Draft</slot>
Version: <slot id="version"/> · Last Updated: <slot id="lastUpdated"/> · Owner: <slot id="owner"/>

## Plan Summary
- Goal: <slot id="goal"/>
- Delivery Strategy: <slot id="deliveryStrategy"/>
- Scope Snapshot: <slot id="scopeSnapshot"/>
- Key Risks: <slot id="keyRisks"/>

## Milestones
<slot id="milestones" repeat="true" header="Milestone ID|Name|Target Outcome|Status|Notes">
| <slot id="milestoneId"/> | <slot id="name"/> | <slot id="targetOutcome"/> | <slot id="status"/> | <slot id="notes"/> |
</slot>

## Epic Plan
<slot id="epics" repeat="true" header="Epic ID|Epic Name|Testable Value Slice|Task Count Target (10-12)|Status|Linked Epic Doc">
| <slot id="epicId"/> | <slot id="epicName"/> | <slot id="testableValueSlice"/> | <slot id="taskCountTarget"/> | <slot id="status"/> | <slot id="linkedEpicDoc"/> |
</slot>

## Sequenced Work Plan
<slot id="workPlan" repeat="true" header="Order|Epic ID|Task Group|Dependency|Validation Gate|Status">
| <slot id="order"/> | <slot id="epicId"/> | <slot id="taskGroup"/> | <slot id="dependency"/> | <slot id="validationGate"/> | <slot id="status"/> |
</slot>

## Validation and Quality Gates
- TDD coverage expectation: <slot id="tddCoverage"/>
- Acceptance criteria verification method: <slot id="acceptanceCriteriaVerification"/>
- Security checks: <slot id="securityChecks"/>
- Unity recompile checkpoints requiring user focus: <slot id="unityRecompileCheckpoints"/>

## Progress Tracking
- Completed Since Last Update: <slot id="completedSinceLastUpdate"/>
- In Progress: <slot id="inProgress"/>
- Blocked: <slot id="blocked"/>
- Next Tasks: <slot id="nextTasks"/>

## Synchronization Checklist
- Requirements and plan are aligned: <slot id="requirementsAligned"/>
- Technical design and plan are aligned: <slot id="designAligned"/>
- Epic docs and plan are aligned: <slot id="epicsAligned"/>
- Scope changes propagated to tasks: <slot id="scopeChangesPropagated"/>

## Change History
<slot id="changelog" repeat="true" header="Date|Version|Summary|Reason|Impacted Epics or Tasks|Updated By">
| <slot id="date"/> | <slot id="version"/> | <slot id="summary"/> | <slot id="reason"/> | <slot id="impactedEpics"/> | <slot id="updatedBy"/> |
</slot>
