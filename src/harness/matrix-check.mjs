// AR-5 — mechanical reconciliation of a TDD matrix's test-name claims against a
// compiled test inventory.
//
// THE DEFECT THIS EXISTS TO REMOVE. A TDD matrix row names the tests that prove
// an acceptance criterion. Those rows are authored during architecture, BEFORE
// implementation, so a name can be an intention that changes (or never happens)
// while nothing re-checks the row. In one real project this produced the SAME
// phantom-test-name defect three times, and all three were found late — by the
// validation gate, two stories after the claim was written. A name that does not
// exist reads as proof and is not.
//
// THE TWO DIRECTIONS, AND WHY THE DISTINCTION MATTERS.
//
//   DELIVERED rows   carry a claim: "these tests exist and prove this criterion".
//                    A name here that is absent from the inventory is a DEFECT.
//   undelivered rows carry an intention for planned work. A name here that is
//                    absent is EXPECTED and must NOT be reported.
//
// Collapsing the two produces false failures, and a false failure is how a real
// check gets switched off. This module keeps them separate and makes the
// separation the caller's explicit choice.
//
// Deliberately dependency-free and side-effect-free: it returns findings and
// never throws on content, so it can run at authoring time as well as in a gate.

/** Marker that separates a row's claims from its explanatory prose. */
const DELIVERED_MARKER = 'DELIVERED';

/**
 * A test name is `Identifier_LikeThis` — at least one underscore, both sides
 * identifier-shaped. This deliberately rejects prose symbols that appear in
 * backticks (type names such as `ViewExtent`, single letters such as `u`), which
 * is the specific false-positive class that made an earlier checker unusable.
 */
const TEST_NAME = /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/;

/** Extract every backticked token that looks like a test name. */
function backtickedTestNames(text) {
  const out = [];
  for (const m of String(text).matchAll(/`([^`]+)`/g)) {
    const name = m[1].trim();
    if (TEST_NAME.test(name)) out.push(name);
  }
  return out;
}

/** Split a markdown table row into its cells (leading/trailing pipes dropped). */
function cellsOf(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const parts = trimmed.split('|');
  // A row looks like `| a | b | c |`; the split yields ['', ' a ', ' b ', ' c ', ''].
  return parts.slice(1, -1).map((c) => c.trim());
}

/**
 * Collect test names from a TDD-matrix-style markdown document.
 *
 * Only the "declared tests" cell — the SECOND column — is read, and within a
 * DELIVERED row only the text BEFORE the marker. Both restrictions exist because
 * a matrix row's later columns discuss the design in prose and legitimately name
 * types, symbols and fractions in backticks; treating those as claims is exactly
 * the false-failure class this module was written to avoid.
 *
 * @returns {{claims: string[], intents: string[]}} deduplicated, source-ordered
 */
export function collectDeclaredTestNames(markdown) {
  const claims = [];
  const intents = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    const cells = cellsOf(line);
    if (!cells || cells.length < 2) continue;
    const declaredCell = cells[1];
    if (!declaredCell) continue;
    // A separator row (`| --- | --- |`) has no test names and no marker.
    const markerAt = declaredCell.indexOf(DELIVERED_MARKER);
    const isDelivered = markerAt !== -1;
    const scope = isDelivered ? declaredCell.slice(0, markerAt) : declaredCell;
    const names = backtickedTestNames(scope);
    (isDelivered ? claims : intents).push(...names);
  }
  return { claims: [...new Set(claims)], intents: [...new Set(intents)] };
}

/**
 * Compare collected names against a compiled inventory.
 *
 * @param {{claims: string[], intents: string[]}} collected
 * @param {Set<string>|string[]} inventory compiled test method names
 * @returns {{missingFromInventory: string[], unmatchedIntents: string[], checked: number}}
 */
export function reconcileTestNames(collected, inventory) {
  const have = inventory instanceof Set ? inventory : new Set(inventory || []);
  const claims = Array.isArray(collected?.claims) ? collected.claims : [];
  const intents = Array.isArray(collected?.intents) ? collected.intents : [];
  return {
    // Only DELIVERED claims can be defects. An intention is allowed to be absent.
    missingFromInventory: claims.filter((n) => !have.has(n)),
    // Reported separately and informationally: an intention that HAS landed is
    // not a defect, but it usually means the row is stale and should be marked
    // DELIVERED. Surfaced so the drift is visible rather than silent.
    unmatchedIntents: intents.filter((n) => have.has(n)),
    checked: claims.length,
  };
}

/**
 * Extract public test-method names from C# test sources.
 *
 * Used to build an inventory when no test report is available — for example at
 * authoring time, before anything has run. This is a NAME inventory, not a
 * pass/fail one: it proves a name exists, never that the test passes. Callers
 * that need the stronger claim must use a run report.
 */
export function inventoryFromCSharpSources(sources) {
  const names = new Set();
  const pattern = /public\s+(?:async\s+)?(?:void|Task)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const text of sources) {
    for (const m of String(text).matchAll(pattern)) names.add(m[1]);
  }
  return names;
}
