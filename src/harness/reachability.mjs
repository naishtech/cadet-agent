import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Mechanical reachability verification (Harness contract v6).
 *
 * Closes a defect class the framework previously had no check for at all: work
 * that is fully tested and fully compiled while being reachable from nothing.
 * Every gate could be green for many stories in a row and no user could reach a
 * single one of them, because nothing asserted that a delivered capability is
 * WIRED to anything a user or operator can touch.
 *
 * Three responsibilities:
 *   1. parseReachabilityDeclaration — read a story's declared reachability: how
 *      its deliverable becomes witnessable, or which work item will make it so.
 *   2. validateReachabilityDeclaration — check the declaration against the work
 *      items that exist, so a deferral cannot name a phantom target.
 *   3. reconcileDeferrals — the falsifiability check. A deferral is a claim
 *      about the future, so it is re-examined once its target is `done`: a
 *      deferral that outlives its owner is a gap wearing a plan's clothes.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it cannot know how a given project wires
 * things, so a `witnessed` declaration is treated as a STATEMENT, not a proof.
 * The proof comes from the project's own command
 * (`reachability.command` in .cadet/harness.json), which the CLI runs and whose
 * exit code is the verdict. That split is the point: a generic rule that tried
 * to guess per-project wiring would be wrong often enough to be switched off,
 * which is how a check erodes. No project command configured means the
 * declaration level is all that is enforceable, and the CLI says so rather than
 * implying a stronger guarantee.
 *
 * Nothing here passes on missing input: a story that declares nothing is a
 * failure, not a default. Silence is not reachability, exactly as an acceptance
 * criterion that declares no test is not coverage.
 */

export const REACHABILITY_KINDS = Object.freeze(['witnessed', 'deferred']);

/** Bound on how much of a story is scanned, mirroring the report bound in verify-acs. */
export const DEFAULT_MAX_STORY_BYTES = 1024 * 1024;

/** Bound on sibling stories scanned for the deferral graph. */
export const DEFAULT_MAX_SIBLING_STORIES = 200;

/**
 * Normalize a work-item reference so `epic::story.md`, `story.md` and a bare
 * epic id can be compared.
 *
 * The canonical form is `epicKey::storyFile` (what state.json stores). Anything
 * else is resolved leniently: a bare file name matches an existing story file,
 * and an epic key matches that epic. Case-insensitive, because a hand-written
 * deferral target is prose-adjacent and casing drift is not the defect this
 * check exists to catch.
 */
export function normalizeWorkItemRef(ref) {
  if (ref === null || ref === undefined) return '';
  const s = String(ref).trim().replace(/\\/g, '/');
  const withoutAnchor = s.replace(/^#/, '');
  return withoutAnchor.toLowerCase();
}

/**
 * Extract the set of work items that exist, from a state document.
 *
 * Includes stories (`epic::story`), bare story file names and epic keys, plus
 * spike ids — deferring to a spike is legitimate, because a spike is exactly how
 * an unverified assumption becomes a deliverable.
 *
 * Returns `{ refs, status }` where `refs` is a Set of normalized references and
 * `status` maps a normalized reference to `'done' | 'planned' | 'in-progress' |
 * 'complete' | 'planned'` so the caller can tell an in-flight target from a
 * finished one.
 */
export function collectWorkItems(state) {
  const refs = new Set();
  const status = new Map();

  const add = (ref, value) => {
    const key = normalizeWorkItemRef(ref);
    if (!key) return;
    refs.add(key);
    if (value) status.set(key, String(value).toLowerCase());
  };

  const epics = state && typeof state === 'object' && state.epics && typeof state.epics === 'object'
    ? state.epics
    : {};

  for (const [epicKey, epic] of Object.entries(epics)) {
    const epicStatus = epic && typeof epic === 'object' ? epic.status : undefined;
    add(epicKey, epicStatus);
    const stories = epic && typeof epic.stories === 'object' ? epic.stories : {};
    for (const [storyFile, storyStatus] of Object.entries(stories)) {
      const full = `${epicKey}::${storyFile}`;
      add(full, storyStatus);
      add(storyFile, storyStatus);
    }
  }

  const spikes = state && typeof state === 'object' && state.spikes && typeof state.spikes === 'object'
    ? state.spikes
    : {};
  for (const [spikeId, spikeStatus] of Object.entries(spikes)) {
    add(spikeId, spikeStatus);
  }

  const active = state && typeof state === 'object' ? state.activeWorkItem : null;
  if (active && active.epicId && active.storyId) {
    add(`${active.epicId}::${active.storyId}`);
    add(active.storyId);
  }

  return { refs, status };
}

/**
 * Parse a story's reachability declaration.
 *
 * Expected shape (per the story template), one line, in the story header block:
 *
 *   Reachability: witnessed — <what a user/operator does and what they see>
 *   Reachability: deferred to <work-item ref> — <why it cannot be witnessed yet>
 *
 * Returns `{ declared, kind, witness, deferTo, reason, line, errors }`.
 * `errors` is non-empty only for a MALFORMED declaration (a recognised keyword
 * with no content). A story with no declaration at all is `declared: false`,
 * which the validator reports as a gap rather than a parse error — the two are
 * different findings and the caller keeps them apart.
 *
 * Fenced code blocks are skipped, so a story may quote an example declaration in
 * a note without it being mistaken for its own.
 */
export function parseReachabilityDeclarationText(text, { maxBytes = DEFAULT_MAX_STORY_BYTES } = {}) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  const body = raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
  const lines = body.split(/\r?\n/);

  const errors = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = /^Reachability\s*:\s*(.*)$/i.exec(trimmed);
    if (!m) continue;

    const rest = m[1].trim();
    const line = i + 1;
    if (rest === '') {
      errors.push(`line ${line}: "Reachability:" declares nothing — state either "witnessed — <how>" or "deferred to <work item> — <why>".`);
      return { declared: false, kind: null, witness: null, deferTo: null, reason: '', line, errors };
    }

    const deferred = /^deferred\s+to\s+(\S+)\s*(?:[—-]\s*(.*))?$/i.exec(rest);
    if (deferred) {
      const target = deferred[1].replace(/[.,;]$/, '');
      const reason = (deferred[2] || '').trim();
      if (!reason) {
        errors.push(`line ${line}: a deferral must say WHY it cannot be witnessed yet ("deferred to ${target} — <reason>"); an unexplained deferral is how a gap becomes permanent.`);
      }
      return { declared: true, kind: 'deferred', witness: null, deferTo: target, reason, line, errors };
    }

    const witnessed = /^witnessed\s*(?:[—-]\s*(.*))?$/i.exec(rest);
    if (witnessed) {
      const witness = (witnessed[1] || '').trim();
      if (witness === '') {
        errors.push(`line ${line}: "witnessed" must say what a user or operator does and what they see ("witnessed — <how>").`);
      }
      return { declared: true, kind: 'witnessed', witness, deferTo: null, reason: '', line, errors };
    }

    // A line that begins "Reachability:" with an unrecognised form. Reported
    // rather than ignored: an ignored declaration is indistinguishable from a
    // missing one, and a story that is wrong in a new way must not read as a
    // story that is fine.
    errors.push(`line ${line}: unrecognised reachability declaration "${rest}" — expected "witnessed — <how>" or "deferred to <work item> — <why>".`);
    return { declared: false, kind: null, witness: null, deferTo: null, reason: '', line, errors };
  }

  return { declared: false, kind: null, witness: null, deferTo: null, reason: '', line: null, errors };
}

/** File variant of parseReachabilityDeclarationText. */
export function parseReachabilityDeclaration(storyPath) {
  const text = readFileSync(storyPath, 'utf-8');
  return parseReachabilityDeclarationText(text);
}

/**
 * Validate one declaration against the work items that exist.
 *
 * Returns `{ ok, code, message }`. Codes are stable so a caller can branch and a
 * test can assert the FINDING rather than the prose:
 *   malformed               — the declaration parsed with errors. Checked FIRST:
 *                             a reasonless deferral or a content-free "witnessed"
 *                             parses far enough to be typed, and must still be
 *                             refused — the parser said no, and the parser's no
 *                             is the rule (contract v6 §1).
 *   not-declared            — the story declares nothing at all.
 *   deferral-self           — a deferral names the story itself (`self`).
 *   unknown-target          — a deferral names a work item that does not exist.
 *   deferral-target-done    — a deferral names a work item that is already done,
 *                             so the witness it promised can never arrive.
 *
 * `self` is the story's own reference (bare file name, or a list of its
 * references) so a story cannot be made "reachable" by deferring to itself.
 *
 * `deferral-target-done` is the tooth that matters. A deferral is only honest
 * while its owner is still ahead; once the owner lands, the deferral is a claim
 * that has been overtaken by events, and it is reported as a gap rather than
 * inherited forever.
 */
export function validateReachabilityDeclaration(declaration, { workItems = null, self = null } = {}) {
  if (declaration && Array.isArray(declaration.errors) && declaration.errors.length > 0) {
    return { ok: false, code: 'malformed', message: declaration.errors.join(' ') };
  }

  if (!declaration || declaration.declared !== true) {
    return {
      ok: false,
      code: 'not-declared',
      message: 'the story declares no reachability — add "Reachability: witnessed — <how a user/operator reaches and sees this>" or "Reachability: deferred to <work item> — <why>". A story that says nothing about reachability is indistinguishable from one whose deliverable cannot be reached.',
    };
  }

  if (declaration.kind === 'witnessed') {
    return { ok: true, code: 'witnessed', message: `witnessed: ${declaration.witness}` };
  }

  // Deferred.
  const target = declaration.deferTo;
  const selfRefs = Array.isArray(self)
    ? self.map(normalizeWorkItemRef)
    : (self ? [normalizeWorkItemRef(self)] : []);
  if (selfRefs.length > 0 && selfRefs.includes(normalizeWorkItemRef(target))) {
    return {
      ok: false,
      code: 'deferral-self',
      message: `the deferral names "${target}", which is this story itself. A story cannot be made reachable by deferring to itself: declare "witnessed", or name the work item that will wire it.`,
    };
  }
  if (!workItems) {
    // No state to check against — the target cannot be verified, and "cannot
    // verify" is reported as such rather than assumed fine.
    return { ok: true, code: 'deferred-unchecked', message: `deferred to ${target} (no state document to check the target against)` };
  }

  const key = normalizeWorkItemRef(target);
  if (!workItems.refs.has(key)) {
    const known = [...workItems.refs].filter((r) => r.includes('::')).slice(0, 8);
    return {
      ok: false,
      code: 'unknown-target',
      message: `the deferral names "${target}", which is not a work item in state.json. A deferral to something that does not exist never expires and never lands. Known work items include: ${known.join(', ') || '(none)'}.`,
    };
  }

  const status = workItems.status.get(key);
  if (status === 'done' || status === 'complete') {
    return {
      ok: false,
      code: 'deferral-target-done',
      message: `the deferral names "${target}", which is already ${status}. The work item that was going to make this reachable has landed, so the deferral has expired: either this story is reachable now (declare "witnessed") or the wiring was missed when "${target}" closed.`,
    };
  }

  return { ok: true, code: 'deferred', message: `deferred to ${target} (${status || 'unknown status'})` };
}

/**
 * Build a deferral graph from a set of declarations and report every cycle.
 *
 * A chain of deferrals that closes on itself is not a plan: nothing in the loop
 * is ever witnessed, and each item can point at another to explain why. The
 * cycle is reported as one finding naming the whole chain, because naming a
 * single node would hide the shape that makes it a gap.
 *
 * `declarations` is an array of `{ id, aliases?, declaration }`. `aliases` lets
 * one node carry both the `epicKey::story.md` form and the bare file name.
 */
export function findDeferralCycles(declarations) {
  // An entry may carry ALIASES (`epicKey::story.md` and the bare `story.md` are
  // the same node). Without them, a deferral written in the long form and a
  // sibling found by file name would be two disconnected nodes and a real cycle
  // would go unreported - a check that cannot see the edge it exists to find.
  const aliasToNode = new Map();
  for (const entry of declarations || []) {
    if (!entry || !entry.id) continue;
    const ids = [entry.id, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
    for (const alias of ids) aliasToNode.set(normalizeWorkItemRef(alias), normalizeWorkItemRef(entry.id));
  }

  const resolve = (ref) => aliasToNode.get(normalizeWorkItemRef(ref)) ?? normalizeWorkItemRef(ref);

  const target = new Map();
  for (const entry of declarations || []) {
    if (entry && entry.declaration && entry.declaration.kind === 'deferred' && entry.declaration.deferTo) {
      target.set(normalizeWorkItemRef(entry.id), resolve(entry.declaration.deferTo));
    }
  }

  const cycles = [];
  const seenCycleKeys = new Set();

  for (const start of target.keys()) {
    const path = [];
    const onPath = new Set();
    let node = start;

    while (node && target.has(node)) {
      if (onPath.has(node)) {
        const at = path.indexOf(node);
        const chain = path.slice(at);
        // Canonicalize so the same cycle found from two entry points is one finding.
        const key = [...chain].sort().join('|');
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push([...chain, node]);
        }
        break;
      }
      onPath.add(node);
      path.push(node);
      node = target.get(node);
    }
  }

  return cycles;
}

/**
 * Read a story and every sibling `story-*.md` in its directory, and parse each
 * declaration, so the deferral graph covers the epic rather than one story. The
 * story itself is ALWAYS a node — its own declaration must participate in the
 * cycle graph even when its file name does not match the `story-*` pattern.
 *
 * Aliases tie the `epicKey::story.md` form and the bare file name to ONE node;
 * without them a real cycle written in the long form goes unreported (contract
 * v6 §4.2). The epic key is taken from the caller's work-item index when
 * supplied — every `epicKey::name` ref that actually exists in state.json —
 * because deriving it from the directory name is only a heuristic: a bare
 * relative filename has dirname `.`, and any other layout may not be named
 * after the epic at all. The directory-name derivation remains as a fallback
 * for callers without state.
 *
 * Returns `[{ id, aliases, path, declaration }]`. Unreadable files are skipped
 * rather than fatal: the check is about the story under test, and an unreadable
 * sibling must not turn a reachability verdict into a filesystem error.
 */
export function readSiblingDeclarations(storyPath, { max = DEFAULT_MAX_SIBLING_STORIES, workItems = null } = {}) {
  const dir = dirname(storyPath);
  // Heuristic fallback: the epic directory's own name is often the epic key
  // state.json uses. Unreliable on its own — see the docstring above.
  const dirKey = dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';

  const aliasesFor = (name) => {
    const key = normalizeWorkItemRef(name);
    const aliases = new Set();
    if (dirKey) aliases.add(normalizeWorkItemRef(`${dirKey}::${name}`));
    if (workItems && workItems.refs) {
      for (const ref of workItems.refs) {
        if (ref.endsWith(`::${key}`)) aliases.add(ref);
      }
    }
    aliases.delete(key);
    return [...aliases];
  };

  const out = [];
  const seen = new Set();
  const add = (name, path) => {
    const id = normalizeWorkItemRef(name);
    if (seen.has(id)) return;
    seen.add(id);
    try {
      out.push({
        id: name,
        aliases: aliasesFor(name),
        path,
        declaration: parseReachabilityDeclaration(path),
      });
    } catch {
      // A file that cannot be read is not this verdict's business.
    }
  };

  // The story itself, always — its own deferral edges are the ones being judged.
  add(basename(storyPath), storyPath);

  let entries = null;
  try {
    entries = readdirSync(dir);
  } catch {
    entries = null;
  }
  if (entries) {
    for (const name of entries.sort()) {
      if (out.length >= max) break;
      if (!/^story-.*\.md$/i.test(name)) continue;
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      add(name, path);
    }
  }
  return out;
}

/**
 * Format reachability gaps as concrete, actionable lines, in the shape
 * `describeCoverageGaps` uses for AC gaps so the two read consistently in a
 * terminal.
 */
export function describeReachabilityGaps({ validation, cycles = [], story } = {}) {
  const lines = [];
  if (validation && validation.ok !== true) {
    lines.push(`   reachability: ${validation.message}`);
  }
  for (const cycle of cycles) {
    lines.push(`   reachability deferral cycle: ${cycle.join(' -> ')} — nothing in this loop can ever be witnessed; at least one item must become "witnessed" or the chain is a gap.`);
  }
  if (lines.length > 0 && story) {
    lines.unshift(`   story: ${story}`);
  }
  return lines;
}
