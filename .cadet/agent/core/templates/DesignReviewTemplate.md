# Design Review: <slot id="title"/>

Reviewer: <slot id="reviewer" note="The name of whoever performed the review — an agent or a person. A review with no name against it cannot be asked about later."/>
Inputs: <slot id="inputs" fmt="repository-relative paths" note="The artifacts this review read: the technical design, the requirements, the ADRs, the project plan. The CLI binds these too (`--files`), so a change to any of them stales this review rather than leaving it looking current."/>
Date: <slot id="date" fmt="ISO-8601"/>

## Verdict

<slot id="verdict" opt="approved|approved-with-findings|blocked" note="Three outcomes, and they are different. `approved` means the design stands as written. `approved-with-findings` means it stands with the accepted and deferred rows applied. `blocked` means a contested decision has no resolver yet, or an assumption the design depends on could not be settled — the gate then fails, which is the point of running the review before the work items exist."/>

<slot id="verdictNote" note="One short paragraph in words a reader can act on. What was challenged, what changed as a result, and what remains open. Do not restate the table."/>

## Findings

<slot id="findings" repeat="true" header="ID|Finding|Severity|Disposition|Reference">
| <slot id="findingId" fmt="DR-N"/> | <slot id="finding" note="The challenge, stated so it can be agreed or disagreed with: an assumption that is unverified, a dependency that may not exist, a requirement with no test, architecture that earns nothing. 'Looks fine' is not a finding."/> | <slot id="severity" opt="high|medium|low"/> | <slot id="disposition" opt="accepted|rejected|deferred|contested" note="accepted = the design changes; rejected = challenged and dismissed, with the reason in the finding; deferred = a named work item owns it, so the reference cell is required; contested = the reviewers disagree or the answer is the owner's call, so it needs a named resolver under Resolution or the gate fails."/> | <slot id="reference" note="Where the disposition lands: the design section that changed, or the work item that owns a deferral. Required for accepted and deferred — those two claim something exists elsewhere."/> |
</slot>

<slot id="noFindings" opt="true" note="Only when the review genuinely found nothing. Write one sentence saying what was checked, so an empty table reads as a performed review and not as an unperformed one. Do not remove the Findings heading in either case: the heading is what the check reads."/>

## Resolution

<slot id="resolutions" repeat="true" note="One line per contested finding, and every contested finding needs one or the gate fails. The name is the point: a contested decision belongs to a person.">
- <slot id="resolutionId" fmt="DR-N"/>: <slot id="resolution" note="the decision, in one sentence"/> — resolved by <slot id="resolver" note="the person who decided"/>
</slot>
