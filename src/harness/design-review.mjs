/**
 * Design-review artifact — the record a formal review leaves behind, and the
 * mechanical contract the gate checks.
 *
 * What this enforces, and what it does not:
 *
 *   - It enforces STRUCTURE and the absence of an unresolved blocker: the artifact
 *     names its reviewer and inputs, lists findings with a disposition each, gives a
 *     reference for the dispositions that claim something exists elsewhere, and
 *     names a resolver for every contested finding.
 *   - It does NOT judge the review's quality, the design's merit, or whether the
 *     reviewer really read anything. Those are judgements, and a check that claimed
 *     to make them would be a prose assertion dressed as a test — the failure mode
 *     `HarnessContract.md` §0.1 names. The framework's answer is that a named
 *     reviewer, bound inputs and a recorded disposition make a bad review visible,
 *     not impossible.
 *
 * Why the shape is fixed at all: a review whose findings have no disposition is a
 * list of worries, and a contested design decision with no resolver is the thing the
 * gate exists to stop. Both are cheap to require and impossible to require later.
 *
 * Contract: docs/core/HarnessContract.md C15.
 */

/** The dispositions a finding may carry. */
export const FINDING_DISPOSITIONS = Object.freeze(['accepted', 'rejected', 'deferred', 'contested']);

/** Dispositions whose claim points at something else, so they must say where. */
const DISPOSITIONS_NEEDING_REFERENCE = Object.freeze(['accepted', 'deferred']);

const FINDING_ID = /^DR-\d+$/;

function cellsOf(line) {
  // A markdown table row: leading and trailing pipes are optional in the wild, so
  // split on the pipes and drop the empty ends rather than requiring both.
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  return trimmed.split('|').slice(1, -1).map((c) => c.trim());
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
}

/**
 * Parse a design-review artifact.
 *
 * Returns `{ reviewer, inputs, findings, contested, resolved, errors }`. `errors` is
 * the list of structural problems, each with a stable `code` so a caller can branch
 * and a test can assert the finding rather than the prose.
 */
export function parseDesignReviewArtifact(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  const lines = raw.split(/\r?\n/);

  let reviewer = null;
  let inputs = null;
  let sectionPresent = false;
  let inFindings = false;
  let inResolution = false;
  const findings = [];
  const resolutions = new Map();
  const errors = [];

  for (const line of lines) {
    const trimmed = line.trim();

    const rev = /^\*{0,2}Reviewer\*{0,2}\s*:\s*(.*)$/i.exec(trimmed);
    if (rev && reviewer === null) { reviewer = rev[1].trim(); continue; }
    const inp = /^\*{0,2}Inputs\*{0,2}\s*:\s*(.*)$/i.exec(trimmed);
    if (inp && inputs === null) { inputs = inp[1].trim(); continue; }

    if (/^##\s+Findings\b/i.test(trimmed)) { sectionPresent = true; inFindings = true; inResolution = false; continue; }
    if (/^##\s+Resolution\b/i.test(trimmed)) { inResolution = true; inFindings = false; continue; }
    if (/^##\s+/.test(trimmed)) { inFindings = false; inResolution = false; continue; }

    if (inResolution) {
      // `- DR-2: the owner keeps the event bus — resolved by Dana`
      const m = /^[-*]\s*(DR-\d+)\s*:\s*(.*)$/.exec(trimmed);
      if (m) resolutions.set(m[1], m[2].trim());
      continue;
    }

    if (inFindings) {
      const cells = cellsOf(trimmed);
      if (!cells) continue;
      if (isSeparator(cells)) continue;
      if (cells[0].toLowerCase() === 'id') continue; // the header row of the table
      findings.push({
        id: cells[0],
        finding: cells[1] || '',
        severity: cells[2] || '',
        disposition: (cells[3] || '').toLowerCase(),
        reference: cells[4] || '',
      });
    }
  }

  if (!sectionPresent) {
    errors.push({ code: 'no-findings-section', message: 'the artifact has no "## Findings" section, so it cannot show that a review took place' });
  }
  if (!reviewer) {
    errors.push({ code: 'no-reviewer', message: 'the artifact does not name its reviewer (add a "Reviewer: <name>" line)' });
  }
  if (!inputs) {
    errors.push({ code: 'no-inputs', message: 'the artifact does not list its inputs (add an "Inputs: <requirements, design, ADRs>" line)' });
  }

  const seen = new Set();
  for (const f of findings) {
    if (!FINDING_ID.test(f.id)) {
      errors.push({ code: 'bad-finding-id', message: `finding id "${f.id}" is not of the form DR-<number>` });
      continue;
    }
    if (seen.has(f.id)) {
      errors.push({ code: 'duplicate-finding', message: `finding ${f.id} appears more than once` });
    }
    seen.add(f.id);
    if (f.finding === '') {
      errors.push({ code: 'empty-finding', message: `finding ${f.id} states nothing` });
    }
    if (!FINDING_DISPOSITIONS.includes(f.disposition)) {
      errors.push({
        code: 'bad-disposition',
        message: `finding ${f.id} has disposition "${f.disposition || '(none)'}"; expected one of ${FINDING_DISPOSITIONS.join(', ')}`,
      });
      continue;
    }
    if (DISPOSITIONS_NEEDING_REFERENCE.includes(f.disposition) && f.reference === '') {
      errors.push({
        code: 'no-reference',
        message: `finding ${f.id} is "${f.disposition}", which claims something exists elsewhere, so it must name where (a reference cell)`,
      });
    }
    if (f.disposition === 'contested') {
      const resolution = resolutions.get(f.id) || '';
      const named = /resolved\s+by\s+\S/i.test(resolution);
      if (!resolution || !named) {
        errors.push({
          code: 'contested-unresolved',
          message: `finding ${f.id} is contested and has no resolution naming who decided it (add "- ${f.id}: <decision> — resolved by <name>" under "## Resolution")`,
        });
      }
    }
  }

  const contested = findings.filter((f) => f.disposition === 'contested').map((f) => f.id);
  return {
    reviewer,
    inputs,
    findings,
    contested,
    resolved: contested.filter((id) => resolutions.has(id)),
    resolutions,
    errors,
  };
}

/** Human-readable failure lines, one per structural problem. */
export function describeDesignReviewGaps(parsed) {
  return parsed.errors.map((e) => `   ${e.message}`);
}
