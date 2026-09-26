# Change Report: <slot id="title"/>

<slot id="reportId" fmt="CHG-N"/>
Story: <slot id="storyRef" fmt="link"/>
Epic: <slot id="epicRef" fmt="link"/> · Work item: <slot id="workItemId" fmt="epic-N::story-M.md"/>
Branch: <slot id="branch"/> · Range: <slot id="range" opt="working-tree|base...HEAD">working-tree</slot>
Reader tier: <slot id="learnerTier" opt="New|Guided|Independent|Advanced"/>
Generated: <slot id="generatedAt" fmt="ISO-8601"/>

## What changed, and why

<slot id="intent" note="2-4 sentences: the intent of the story, and what this change achieves. This is the orientation the reader meets first — write it for the Reader tier above, and keep file-by-file detail out of it, because the table below carries that."/>

## Files changed

<slot id="files" repeat="true" header="File|Type|Lines|What changed|Why" note="DERIVED — do not hand-author. Populate from `cadet-agent harness changes --format json`: one row per file it lists, in its order, with its link field used verbatim so the link resolves. Never assemble this table from memory, and never drop or reorder a row — a file the inventory reports and the report omits is a change the reader cannot see.">
| <slot id="fileLink" fmt="markdown link"/> | <slot id="changeType" opt="A|M|D|R"/> | <slot id="lines" fmt="+N/-N"/> | <slot id="whatChanged" note="What the file now does that it did not before — not a restatement of the diff, which the reader can open the file for."/> | <slot id="why" note="Why this file had to change to satisfy the story. This is the adaptive column: at tiers New/Guided, name the mechanism and define any jargon; at tiers Independent/Advanced, state the constraint it satisfies."/> |
</slot>

## Acceptance criteria ↔ changes

<slot id="acMapping" repeat="true" header="AC|Files|Evidence|Verdict">
| <slot id="acId" fmt="AC-N"/> | <slot id="acFiles" note="The files that carry this criterion — the reader should be able to get from here to the code that satisfies it."/> | <slot id="acEvidence" note="The evidence record id, test identifier, or visual finding that proves it."/> | <slot id="acVerdict" opt="met|not met|deferred"/> |
</slot>

## Guided review

<slot id="walkthrough" repeat="true" header="Order|Read|What to look for" note="The order to read this change in, and what each stop is for. Order by dependency, not by file size: a reader must not arrive at a file whose premise they have not met. One row per stop, numbered from 1.">
| <slot id="order" fmt="N"/> | <slot id="stepTarget" fmt="file or area"/> | <slot id="stepLookFor" note="What to look for at this stop, and why it comes at this point in the order."/> |
</slot>

## Verification

<slot id="evidence" repeat="true" header="Gate|Verdict|Evidence">
| <slot id="gate" opt="testsPassed|compileCheckConfirmed|unityAnalyzerClean|storyTrackingUpdated|codeReviewCompleted|securityReviewPassed|acceptanceCriteriaValidated|reachabilityAddressed"/> | <slot id="gateVerdict" opt="pass|fail|exception"/> | <slot id="evidenceRef" note="The evidence record id, commit reference, or manual-confirmation id. 'exception' requires a gate-exception reference."/> |
</slot>

## Not changed, and why

<slot id="notChanged" repeat="true" note="Files or areas a reader would expect to see touched but that were not, plus anything descoped. Omit this entire section when it is genuinely empty — an empty list is not a finding, and padding it hides the cases that matter."/>

## Review notes

<slot id="notes" repeat="true" note="Anything the reader should know that no other section carries: an incidental finding, a risk, a follow-up worth filing, a judgement call you made, an open question. Mark anything unverified as unverified. Do not restate the tables, and do not record a file change or an acceptance-criterion verdict here — a note that belongs in a table hides a fact the reader expects to find there — and caveats about what this report proves belong under Limits. Omit the whole section when there is nothing worth saying; a padded Review notes section trains the reader to skip it.">
- <slot id="note" note="One observation. A few sentences are fine; if it needs a table or a file list, it belongs in a section above."/>
</slot>

## Limits

<slot id="limits" note="What this report cannot prove. State it plainly when the inventory was unavailable, when git excluded ignored paths, when a range diff could not see untracked files, or when a claim rests on something no artifact reaches. An unreported limit reads as a guarantee the report cannot give."/>

## Change History

<slot id="changelog" repeat="true" header="Date|Change|Reason">
| <slot id="date"/> | <slot id="change"/> | <slot id="reason"/> |
</slot>
