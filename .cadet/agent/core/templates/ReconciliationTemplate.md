# Reconciliation: <slot id="title"/>

<slot id="reportId" fmt="REC-N"/>
Plans directory: <slot id="plansDir" fmt="repository-relative path"/>
Scope: <slot id="scope" opt="whole project|one epic"/>
Branch: <slot id="branch"/> · Phase: <slot id="phase" fmt="currentPhase"/> · Workflow path: <slot id="workflowPath" opt="large|small|no_test_required"/>
Generated: <slot id="generatedAt" fmt="ISO-8601"/>

## Verdict

<slot id="verdict" opt="consistent|findings|unknown">findings</slot>

<slot id="verdictNote" note="One paragraph. State the verdict in words a reader can act on, and name what it does and does not mean. If it is `unknown`, say which artifact could not be read and that consistency therefore cannot be certified — never present a partial reading as a clean one. If it is `consistent`, say that the mechanical checks all passed and what the semantic pass concluded separately."/>

<slot id="gateStatement" note="The statement for `designArtifactSyncConfirmed`. Write one of exactly two things: that the gate is supported, because the command verdict is `consistent` and the semantic pass found nothing blocking; or that the gate is BLOCKED, naming the finding that blocks it. Never claim the gate from a run whose verdict is `findings` or `unknown`."/>

## Artifact inventory

<slot id="inventory" repeat="true" header="Artifact|Present|Read|Note">
| <slot id="artifact" fmt="repository-relative path"/> | <slot id="present" opt="yes|no"/> | <slot id="readable" opt="parsed|unparsable"/> | <slot id="artifactNote" note="Why a missing artifact is missing, or what could not be parsed. Leave empty when both columns are yes/parsed."/> |
</slot>

## Findings

<slot id="findings" repeat="true" header="ID|Severity|Artifact|Finding|Evidence" note="DERIVED — do not hand-author. Copy every row from `cadet-agent harness reconcile --format json` in its order and number them as the command did. Do not drop, reorder, merge, or reword a row, and do not add one the command did not report: the command is the measurement, this table is the reading of it. A finding the command reported and this table omits is an inconsistency the reader will not see.">
| <slot id="findingId" fmt="R-N"/> | <slot id="severity" opt="blocking|warning|info"/> | <slot id="findingArtifact" fmt="repository-relative path"/> | <slot id="findingDetail" note="the command's detail, verbatim"/> | <slot id="findingEvidence" note="the command's evidence field, or the artifact and line you read it from. 'none' is not an acceptable evidence value for a blocking finding — find the citation or say the claim is unverified."/> |
</slot>

## Semantic findings

<slot id="semantic" repeat="true" header="Severity|Artifacts|Finding|Why it matters" note="The judgement pass: contradictions between documents, a design decision no story honours, an epic solving a different problem than the design intended, a requirement area with no epic, intent quietly dropped. Nothing here is machine-verified, so every row must quote the artifact and be written so a reader can check it themselves. Keep it visibly separate from the mechanical table above — the distinction is what tells the reader which rows are proof and which are opinion. Omit the whole section when the pass found nothing, and say in Limits that it was run.">
| <slot id="semanticSeverity" opt="blocking|warning|info"/> | <slot id="semanticArtifacts" note="the artifacts that disagree, by path"/> | <slot id="semanticFinding" note="what disagrees, quoting the conflicting text"/> | <slot id="semanticWhy" note="what breaks if this is left — the consequence, not a restatement of the finding"/> |
</slot>

## Proposed repairs

<slot id="repairs" repeat="true" header="Finding|Artifact|Proposed change" note="One row per finding worth fixing, in the order the reader should apply them. Describe the exact edit — the section, the old text, the new text — so it can be applied on approval without re-deriving it. Nothing here has been applied: this report is a proposal, and no planning artifact was modified while producing it.">
| <slot id="repairFinding" fmt="R-N"/> | <slot id="repairArtifact" fmt="repository-relative path"/> | <slot id="repairChange" note="the precise edit: which section, what it says now, what it should say"/> |
</slot>

## Limits

<slot id="limits" note="What this reconciliation could not check, stated plainly. At minimum, name whichever of these apply: an artifact that could not be read; a story's `Design refs` is free text, so the design-to-story link cannot be followed by a tool; the requirements `AC-NN` series and the story `AC-N` series are never cross-linked, so the AC chain cannot be traced mechanically; an epic's hand-written story list is free text and was compared by hand, if at all; and any semantic finding is a judgement this report cannot prove. Say explicitly that closed work is not re-audited — fields a document predates are not reported against it — so a reader does not read silence as a clean bill of health. An unreported limit reads as a guarantee the report cannot give."/>

## Change History

<slot id="changelog" repeat="true" header="Date|Change|Reason">
| <slot id="date"/> | <slot id="change"/> | <slot id="reason"/> |
</slot>
