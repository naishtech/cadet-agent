# Technical Design: <slot id="title"/>

<slot id="project"/>
Status: <slot id="status" opt="Draft|In Review|Final">Draft</slot>
Version: <slot id="version"/> · Last Updated: <slot id="lastUpdated"/> · Author: <slot id="author"/>

## Design Summary
- Overview: <slot id="overview"/>
- Objectives: <slot id="objectives"/>
- Scope Boundaries: <slot id="scopeBoundaries"/>
- Success Metrics: <slot id="successMetrics"/>

## Requirements Mapping
<slot id="requirementsMapping" repeat="true" header="Requirement ID|Design Section|Notes">
| <slot id="requirementId"/> | <slot id="designSection"/> | <slot id="notes"/> |
</slot>

## Current State
- Existing Architecture: <slot id="existingArchitecture"/>
- Technical Constraints: <slot id="technicalConstraints"/>
- Pain Points: <slot id="painPoints"/>

## Proposed Design
- Component Changes: <slot id="componentChanges"/>
- Data Flow: <slot id="dataFlow"/>
- Interfaces and Contracts: <slot id="interfaces"/>
- Error Handling Strategy: <slot id="errorHandling"/>
- Security Considerations: <slot id="securityConsiderations"/>
- Performance Considerations: <slot id="performanceConsiderations"/>

## Technology Choices
- Proposed Technology: <slot id="proposedTechnology"/>
- Long-Term Support Evaluation: <slot id="ltsEvaluation"/>
- Community and Support Evaluation: <slot id="supportEvaluation"/>
- User Familiarity and Consent Notes: <slot id="familiarityNotes"/>
- Alternatives Considered: <slot id="alternatives"/>

## TDD Strategy (Red/Green)
<slot id="testMatrix" repeat="true" header="Acceptance Criteria ID|Failing Test (Red)|Implementation Step (Green)|Regression Coverage">
| <slot id="acceptanceCriteriaId"/> | <slot id="failingTest"/> | <slot id="implementationStep"/> | <slot id="regressionCoverage"/> |
</slot>

## Rollout and Migration
- Rollout Plan: <slot id="rolloutPlan"/>
- Migration Steps: <slot id="migrationSteps"/>
- Fallback or Rollback Plan: <slot id="fallbackPlan"/>

## Traceability to Planning
- Planned project phases: <slot id="plannedPhases"/>
- Linked epic IDs: <slot id="linkedEpics"/>
- Initial task decomposition notes: <slot id="taskDecomposition"/>

## Review and Approval
- Reviewer(s): <slot id="reviewers"/>
- Review Notes: <slot id="reviewNotes"/>
- Approval Decision: <slot id="approvalDecision"/>
- Approval Date: <slot id="approvalDate"/>

## Change History
<slot id="changelog" repeat="true" header="Date|Version|Summary|Reason|Impacted Requirements|Updated By">
| <slot id="date"/> | <slot id="version"/> | <slot id="summary"/> | <slot id="reason"/> | <slot id="impactedRequirements"/> | <slot id="updatedBy"/> |
</slot>
