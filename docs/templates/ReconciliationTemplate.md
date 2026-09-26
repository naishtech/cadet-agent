# Reconciliation Template

Purpose: The reader-facing record of a project-wide reconciliation — whether the planning chain still agrees with itself. It separates what was **measured** (state↔disk and link inconsistencies, found by `cadet-agent harness reconcile`) from what was **judged** (contradictions and drifted intent, found by the agent), and it proposes repairs without applying them. Paths below are placeholders shown as code.

The split is the point. A judgement presented as a measurement is worse than no finding, because a reader cannot tell which rows to check. File rows in the Findings table are copied from the command verbatim; nothing in the Semantic findings table is machine-verified.

---

# Reconciliation: [Project or epic name]

- **Report ID:** [REC-1]
- **Plans directory:** `[.cadet/agent/project-plans]`
- **Scope:** whole project | one epic
- **Branch:** [branch] · **Phase:** [currentPhase] · **Workflow path:** large | small | no_test_required
- **Generated:** [ISO-8601 timestamp]

## Verdict

[TODO — consistent | findings | unknown]

[TODO — state the verdict in words a reader can act on, and what it does and does not mean. If it is `unknown`, name the artifact that could not be read and say consistency therefore cannot be certified. If it is `consistent`, say the mechanical checks passed and what the semantic pass separately concluded.]

[TODO — the `designArtifactSyncConfirmed` statement. Either the gate is supported, because the command verdict is `consistent` and the semantic pass found nothing blocking; or the gate is BLOCKED, naming the finding that blocks it. Never claim it from a run whose verdict is `findings` or `unknown`.]

## Artifact inventory

| Artifact | Present | Read | Note |
|---|---|---|---|
| `[path/to/requirements.md]` | [yes/no] | [parsed/unparsable] | [TODO — why it is missing, or what could not be parsed] |

## Findings

[TODO — derived, not authored. Copy every row from `cadet-agent harness reconcile --format json`, in its order, keeping its ids. Do not drop, reorder, merge, or reword a row, and do not add one the command did not report: the command is the measurement, this table is the reading of it.]

| ID | Severity | Artifact | Finding | Evidence |
|---|---|---|---|---|
| [R-1] | [blocking/warning/info] | `[path/to/artifact]` | [TODO — the command's detail, verbatim] | [TODO — the command's evidence, or the artifact and line you read it from] |

## Semantic findings

[TODO — the judgement pass: contradictions between documents, a design decision no story honours, an epic solving a different problem than the design intended, a requirement area with no epic, intent quietly dropped. Nothing here is machine-verified, so each row must quote the artifact and be written so a reader can check it. Omit this section when the pass found nothing, and say in Limits that it was run.]

| Severity | Artifacts | Finding | Why it matters |
|---|---|---|---|
| [blocking/warning/info] | `[path/to/a]`, `[path/to/b]` | [TODO — what disagrees, quoting the conflicting text] | [TODO — the consequence if it is left] |

## Proposed repairs

[TODO — one row per finding worth fixing, in the order the reader should apply them. Describe the exact edit so it can be applied on approval. Nothing here has been applied: this report is a proposal, and no planning artifact was modified while producing it.]

| Finding | Artifact | Proposed change |
|---|---|---|
| [R-1] | `[path/to/artifact]` | [TODO — which section, what it says now, what it should say] |

## Limits

- [TODO — what this reconciliation could not check: any artifact that could not be read; a story's `Design refs` is free text so the design-to-story link cannot be followed by a tool; the requirements `AC-NN` series and the story `AC-N` series are never cross-linked so the AC chain cannot be traced mechanically; an epic's hand-written story list was compared by hand, if at all; and every semantic finding is a judgement this report cannot prove.]

## Change History

| Date | Change | Reason |
|---|---|---|
| [TODO] | [TODO] | [TODO] |

---
