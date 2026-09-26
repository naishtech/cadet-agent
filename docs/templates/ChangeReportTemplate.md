# Change Report Template

Purpose: The reader-facing summary of what one story changed and why, written at the end of the review phase. It answers four questions in a fixed order — what changed, why each file changed, how to review it, and what proves it. The table shape is fixed so the report reads the same every time; only the prose adapts to the reader's learner tier. File paths below are placeholders shown as code, not links.

---

# Change Report: [Story title]

- **Report ID:** [CHG-1]
- **Story:** `[path to the story markdown]`
- **Epic:** `[path to epic.md]` · **Work item:** [epic-N::story-M.md]
- **Branch:** [branch] · **Range:** working-tree | [base]...HEAD
- **Reader tier:** New | Guided | Independent | Advanced
- **Generated:** [ISO-8601 timestamp]

## What changed, and why

[TODO — 2-4 sentences: the intent of the story, and what this change achieves. Written for the reader tier above, without file-by-file detail.]

## Files changed

[TODO — derived, not authored. Take the rows from `cadet-agent harness changes --format json`, one per file it lists, in its order, and use each link verbatim.]

| File | Type | Lines | What changed | Why |
|---|---|---|---|---|
| `[path/to/File.cs]` | [A/M/D/R] | [+N/-N, or new] | [TODO — what the file now does, not a restatement of the diff] | [TODO — why it had to change; the column that carries the tier's depth] |

## Acceptance criteria ↔ changes

| AC | Files | Evidence | Verdict |
|---|---|---|---|
| [AC-N] | `[path/to/File.cs]` | [evidence id, test id, or visual finding] | [met/not met/deferred] |

## Guided review

[TODO — the order to read this change in. Order by dependency, not by file size: a reader must not arrive at a file whose premise they have not met.]

| Order | Read | What to look for |
|---|---|---|
| [1] | `[path/to/File.cs]` | [TODO — what to look for at this stop, and why it comes here] |

## Verification

| Gate | Verdict | Evidence |
|---|---|---|
| [gate name] | [pass/fail/exception] | [evidence id, commit reference, or manual-confirmation id] |

## Not changed, and why

- `[path/to/Something.cs]` — [TODO — why it was deliberately left alone. Delete this section if it is genuinely empty.]

## Review notes

- [TODO — anything the reader should know that fits no other section: an incidental finding, a risk, a follow-up worth filing, a judgement call, an open question. Mark unverified claims as unverified. Delete this section when there is nothing worth saying.]

## Limits

- [TODO — what this report cannot prove: the inventory was unavailable, gitignored paths are absent, a range diff could not see untracked files, or a claim rests on something no artifact reaches.]

## Change History

| Date | Change | Reason |
|---|---|---|
| [TODO] | [TODO] | [TODO] |

---
