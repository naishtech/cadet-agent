import { readFileSync } from 'node:fs';

/**
 * Mechanical AC↔test verification (Harness contract v4).
 *
 * Closes the defect class where a recorded claim names an artifact that does not
 * exist and nothing re-checks the name: an epic's TDD matrix named tests that
 * were never written, and the drift was only noticed at the validation gate,
 * after the story had merged.
 *
 * Three responsibilities:
 *   1. parseTestInventory — extract the identifiers of tests that ACTUALLY RAN
 *      from a verification run's report (TAP, JUnit XML, Unity JSON).
 *   2. parseStoryCriteria — read the declared AC → test mapping from the story,
 *      which is the single source of truth for the coverage claim.
 *   3. compareCoverage — declared vs found, with every gap reported together.
 *
 * Nothing here "passes" on unknown input: an unparseable report yields an empty
 * inventory, which cannot satisfy coverage (Harness.md §3 — unknown is never
 * silently zero/passing).
 */

export const INVENTORY_FORMATS = Object.freeze(['tap', 'junit', 'unity-json', 'unknown']);

export const COVERAGE_STATUSES = Object.freeze(['covered', 'missing', 'undeclared']);

/** Bound on how many bytes of a report are scanned, so a huge report cannot blow the budget. */
export const DEFAULT_MAX_REPORT_BYTES = 4 * 1024 * 1024;

/** Upper bound on identifiers extracted, mirroring the archive file-count discipline. */
export const DEFAULT_MAX_INVENTORY_ENTRIES = 20000;

/**
 * Normalize a test identifier for comparison.
 *
 * Deliberately conservative: trim, collapse internal whitespace, strip a trailing
 * duplicate-index suffix such as ` (1)`. Case is preserved so `Grid_Foo` and
 * `grid_foo` do NOT match — a fuzzier rule would defeat the purpose of the check.
 * A project that needs looser matching must rename its tests, not loosen this.
 */
export function normalizeTestName(name) {
  if (name === null || name === undefined) return '';
  return String(name)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\(\d+\)$/, '');
}

/**
 * Extract the identifiers of tests that ran from a report.
 *
 * Detection is by content, so a repository needs no extra configuration.
 * Returns `{ format, names, partial, truncatedBytes }`.
 * - `format` is one of INVENTORY_FORMATS.
 * - `partial` is true when the report was truncated by a bound; a partial
 *   inventory cannot prove coverage for the truncated region.
 */
export function parseTestInventory(
  report,
  { maxBytes = DEFAULT_MAX_REPORT_BYTES, maxEntries = DEFAULT_MAX_INVENTORY_ENTRIES } = {},
) {
  if (report === null || report === undefined) {
    return { format: 'unknown', names: [], partial: false, truncatedBytes: 0 };
  }
  const text = typeof report === 'string' ? report : String(report);
  if (text.trim() === '') {
    return { format: 'unknown', names: [], partial: false, truncatedBytes: 0 };
  }

  let body = text;
  let partial = false;
  let truncatedBytes = 0;
  if (Buffer.byteLength(body, 'utf-8') > maxBytes) {
    body = Buffer.from(body, 'utf-8').subarray(0, maxBytes).toString('utf-8');
    // Drop a possibly-torn final line.
    const lastBreak = body.lastIndexOf('\n');
    if (lastBreak !== -1) body = body.slice(0, lastBreak);
    partial = true;
    truncatedBytes = Buffer.byteLength(text, 'utf-8') - maxBytes;
  }

  const trimmed = body.trim();

  // Unity JSON: a JSON document with a `tests` array of objects carrying `name`.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.tests) ? parsed.tests : null);
      if (arr) {
        const names = [];
        for (const entry of arr) {
          const n = entry && (entry.name ?? entry.fullName ?? entry.testName);
          if (n) names.push(String(n));
          if (names.length >= maxEntries) { partial = true; break; }
        }
        if (names.length > 0) {
          return { format: 'unity-json', names: dedupe(names), partial, truncatedBytes };
        }
      }
    } catch {
      // Not JSON after all — fall through to the text formats.
    }
  }

  // JUnit XML: <testcase ... name="...">
  if (/<testcase\b/i.test(body)) {
    const names = [];
    const re = /<testcase\b[^>]*?\bname\s*=\s*"([^"]*)"/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      names.push(m[1]);
      if (names.length >= maxEntries) { partial = true; break; }
    }
    return { format: 'junit', names: dedupe(names), partial, truncatedBytes };
  }

  // Node TAP: `ok N - name` / `not ok N - name`. A failing test still ran, so
  // both forms are included.
  const tapRe = /^(?:not ok|ok)\s+\d+\s+-\s+(.*)$/gm;
  const tapNames = [];
  let t;
  while ((t = tapRe.exec(body)) !== null) {
    const name = normalizeTestName(t[1]);
    if (name) tapNames.push(name);
    if (tapNames.length >= maxEntries) { partial = true; break; }
  }
  if (tapNames.length > 0) {
    return { format: 'tap', names: dedupe(tapNames), partial, truncatedBytes };
  }

  return { format: 'unknown', names: [], partial, truncatedBytes };
}

function dedupe(names) {
  return [...new Set(names.map((n) => String(n)))];
}

/**
 * Parse a story's acceptance criteria and their declared tests.
 *
 * Expected shape (per the story template):
 *
 *   ### AC-1: <title>
 *   - Given ..., When ..., Then ...
 *   - Declared tests:
 *     - Test_Name_One
 *     - Test_Name_Two
 *
 * or inline: `- Declared tests: Test_Name_One, Test_Name_Two`
 *
 * Returns `{ criteria: [{ id, title, tests }] }`.
 * Throws when an AC heading carries no id, or when two ACs share an id — a story
 * that cannot be parsed is not a story that can be silently accepted.
 */
export function parseStoryCriteria(storyPath) {
  const text = readFileSync(storyPath, 'utf-8');
  return parseStoryCriteriaText(text);
}

/** Text-in variant of parseStoryCriteria, for tests and in-memory use. */
export function parseStoryCriteriaText(text) {
  const lines = String(text).split(/\r?\n/);

  // Only look inside the Acceptance Criteria section, so a stray `### AC-` in
  // notes cannot be picked up.
  let start = lines.findIndex((l) => /^##\s+Acceptance Criteria\s*$/i.test(l.trim()));
  if (start === -1) return { criteria: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) { end = i; break; }
  }
  const section = lines.slice(start + 1, end);

  const criteria = [];
  const seen = new Map(); // normalized id -> original
  let current = null;

  const headingRe = /^###\s+(.*)$/;
  const declaredInlineRe = /^[-*]\s*Declared tests?\s*:\s*(.+)$/i;
  const declaredBareRe = /^[-*]\s*Declared tests?\s*:?\s*$/i;
  const bulletRe = /^[-*]\s+(.*)$/;

  for (const raw of section) {
    const line = raw.trim();
    const heading = headingRe.exec(line);
    if (heading) {
      const rest = heading[1].trim();
      const idMatch = /^(AC-[\w.-]+)\s*:?\s*(.*)$/i.exec(rest);
      if (!idMatch) {
        throw new Error(`acceptance criterion heading has no AC id: "${rest}"`);
      }
      const id = idMatch[1];
      const key = id.toUpperCase();
      if (seen.has(key)) {
        throw new Error(`duplicate AC id "${id}" in story`);
      }
      seen.set(key, id);
      current = { id, title: idMatch[2].trim(), tests: [] };
      criteria.push(current);
      continue;
    }
    if (!current) continue;

    // `- Declared tests: A, B` (inline) — check before the bare form.
    const inline = declaredInlineRe.exec(line);
    if (inline) {
      for (const name of splitTestList(inline[1])) current.tests.push(name);
      current.bareDeclaredList = true; // allow following nested bullets too
      continue;
    }

    // `- Declared tests:` on its own line — the following bullets are the tests.
    if (declaredBareRe.test(line)) {
      current.bareDeclaredList = true;
      continue;
    }

    // A nested bullet while in the declared-tests list.
    if (current.bareDeclaredList) {
      const bullet = bulletRe.exec(line);
      if (bullet) {
        current.tests.push(bullet[1].trim());
        continue;
      }
      current.bareDeclaredList = false;
    }
  }

  for (const c of criteria) {
    delete c.bareDeclaredList;
    c.tests = dedupe(c.tests.map((t) => t.trim()).filter(Boolean));
  }
  return { criteria };
}

function splitTestList(text) {
  return text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Compare a story's declared tests against a run's inventory.
 *
 * Returns `{ ok, ac: [{ id, declared, found, status }], orphaned, inventorySize, format }`.
 * `status` is `covered` (all declared found), `missing` (some declared absent),
 * or `undeclared` (the AC declares no test at all).
 *
 * `orphaned` is the INVERSE direction: tests that ran but are declared on no AC.
 * This module previously checked only declared→delivered, so a delivered test
 * attached to no criterion was invisible — the drift that recurred three times
 * before this was added. Note the status name `undeclared` does NOT cover this
 * case: it means "this AC declares no tests", not "this test is on no AC".
 *
 * `orphaned` deliberately does NOT affect `ok`. Consumers legitimately have
 * helper tests and parameterised fixtures that belong to no single criterion, so
 * making orphans fatal would break every existing story. Callers that want
 * enforcement pass `--strict-orphans` (see describeCoverageGaps and cli.mjs).
 *
 * Every gap is reported together; the caller renders all of them, never just the
 * first.
 */
export function compareCoverage(criteria, inventory) {
  const found = new Set((inventory?.names || []).map((n) => normalizeTestName(n)));
  const ac = [];
  let ok = true;

  // Union of everything declared anywhere, so a test declared on any AC is not
  // an orphan just because it is not on the AC being examined.
  const declaredAnywhere = new Set();

  for (const c of criteria) {
    const declared = (c.tests || []).map((t) => String(t));
    for (const t of declared) declaredAnywhere.add(normalizeTestName(t));
    if (declared.length === 0) {
      ok = false;
      ac.push({ id: c.id, declared: [], found: [], status: 'undeclared' });
      continue;
    }
    const present = declared.filter((t) => found.has(normalizeTestName(t)));
    const status = present.length === declared.length ? 'covered' : 'missing';
    if (status !== 'covered') ok = false;
    ac.push({ id: c.id, declared, found: present, status });
  }

  // Preserve report order and the report's own spelling, deduped by normalized
  // name so an inventory that repeats a test does not repeat the warning.
  const orphaned = [];
  const seenOrphan = new Set();
  for (const raw of inventory?.names || []) {
    const key = normalizeTestName(raw);
    if (!key || declaredAnywhere.has(key) || seenOrphan.has(key)) continue;
    seenOrphan.add(key);
    orphaned.push(key);
  }

  return {
    ok,
    ac,
    orphaned,
    inventorySize: (inventory?.names || []).length,
    format: inventory?.format || 'unknown',
  };
}

/**
 * Format the gaps as concrete, actionable lines (spec §5.1 step 4).
 *
 * `includeOrphans` appends the inverse-direction gaps. It is opt-in so the
 * default call site keeps its previous output shape, and so a caller can report
 * orphans without treating them as failures.
 */
export function describeCoverageGaps(coverage, { includeOrphans = false } = {}) {
  const lines = [];
  for (const entry of coverage.ac) {
    if (entry.status === 'undeclared') {
      lines.push(`   ${entry.id}: declares no test — record the test identifier(s) that prove this criterion.`);
    } else if (entry.status === 'missing') {
      const found = new Set(entry.found.map((n) => normalizeTestName(n)));
      const absent = entry.declared.filter((t) => !found.has(normalizeTestName(t)));
      for (const t of absent) {
        lines.push(`   ${entry.id}: declared test "${t}" did not appear in the test report — either it was renamed (update the story) or it was never written.`);
      }
    }
  }
  if (includeOrphans) {
    for (const t of coverage.orphaned || []) {
      lines.push(`   "${t}" ran but is declared on no acceptance criterion — attach it to the criterion it proves, or remove it.`);
    }
  }
  return lines;
}
