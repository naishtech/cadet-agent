/**
 * The `Play:` declaration — can a person play this story's deliverable, and if not,
 * which work item will make it playable (contract v7 §1).
 *
 * Why this exists. Every gate in the framework can be satisfied by a command or by a
 * reviewer's judgement, so a project can go fully green for many stories in a row with
 * nothing ever on screen. The reachability gate names that risk and does not close it:
 * a `witnessed` declaration is checked for shape, and with no project probe configured
 * it passes on a sentence. The one gate that does ask a person — `humanAcceptanceConfirmed`
 * — fires at epic closure, which is the point by which every story has already been
 * marked done.
 *
 * So a story states, in one line, whether the user can play it:
 *
 *   Play: required — <what the user does, and what they should see>
 *   Play: deferred to <work item> — <why it cannot be played yet>
 *
 * A `required` declaration is satisfied only by a person's own record (the form route in
 * `play-form.mjs`); `harness verify-play` refuses to record it. A `deferred` declaration
 * is satisfied by the declaration itself, exactly as a reachability deferral is, and it
 * expires the moment its target is done — a gap with an owner and a term, never a parked
 * excuse. There is deliberately no third form: a story with no playable surface of its
 * own is still reached through the running game, so "not applicable" would be an escape
 * hatch an agent could write for itself, which is the class of check this framework keeps
 * having to delete.
 *
 * The mechanics are deliberately the same as reachability's, and the deferral-graph
 * helpers are IMPORTED rather than re-implemented: a deferral cycle spanning a `Play:`
 * edge and a `Reachability:` edge is one graph, and two copies of the walk could disagree
 * about it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  DEFAULT_MAX_STORY_BYTES,
  DEFAULT_MAX_SIBLING_STORIES,
  normalizeWorkItemRef,
  collectWorkItems,
  findDeferralCycles,
} from './reachability.mjs';

/** The two forms a `Play:` declaration may take. */
export const PLAY_KINDS = Object.freeze(['required', 'deferred']);

/**
 * Parse a story's `Play:` declaration out of its text.
 *
 * Returns `{ declared, kind, instruction, deferTo, reason, line, errors }`. The first
 * `Play:` line outside a fenced block wins, and a malformed line returns `declared:
 * false` WITH errors — a declaration that is wrong in a new way must not read as a
 * story that is fine.
 */
export function parsePlayDeclarationText(text, { maxBytes = DEFAULT_MAX_STORY_BYTES } = {}) {
  const errors = [];
  const raw = String(text ?? '');
  const scanned = raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
  const lines = scanned.split(/\r?\n/);

  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = /^Play\s*:\s*(.*)$/i.exec(trimmed);
    if (!m) continue;

    const rest = m[1].trim();
    const line = i + 1;

    if (rest === '') {
      errors.push(`line ${line}: "Play:" declares nothing — state either "required — <what the user does and sees>" or "deferred to <work item> — <why>".`);
      return { declared: false, kind: null, instruction: '', deferTo: null, reason: '', line, errors };
    }

    const deferred = /^deferred\s+to\s+(\S+)\s*(?:[—-]\s*(.*))?$/i.exec(rest);
    if (deferred) {
      const target = deferred[1].replace(/[.,;]$/, '');
      const reason = (deferred[2] || '').trim();
      if (!reason) {
        errors.push(`line ${line}: a deferral must say WHY the work cannot be played yet ("deferred to ${target} — <reason>"); an unexplained deferral is how a gap becomes permanent.`);
      }
      return { declared: true, kind: 'deferred', instruction: '', deferTo: target, reason, line, errors };
    }

    const required = /^required\s*(?:[—-]\s*(.*))?$/i.exec(rest);
    if (required) {
      const instruction = (required[1] || '').trim();
      if (instruction === '') {
        errors.push(`line ${line}: "required" must say what the user does and what they should see ("required — <how to reach it and what to look for>"); a play nobody can follow is a play that will not happen.`);
      }
      return { declared: true, kind: 'required', instruction, deferTo: null, reason: '', line, errors };
    }

    errors.push(`line ${line}: unrecognised play declaration "${rest}" — expected "required — <what the user does and sees>" or "deferred to <work item> — <why>".`);
    return { declared: false, kind: null, instruction: '', deferTo: null, reason: '', line, errors };
  }

  return { declared: false, kind: null, instruction: '', deferTo: null, reason: '', line: null, errors };
}

/** File variant of parsePlayDeclarationText. */
export function parsePlayDeclaration(storyPath) {
  const text = readFileSync(storyPath, 'utf-8');
  return parsePlayDeclarationText(text);
}

/**
 * Validate one declaration against the work items that exist.
 *
 * Returns `{ ok, code, message }`. Codes are stable, so a caller branches and a test
 * asserts the FINDING rather than the prose:
 *   malformed            — the parser rejected the line. Checked first: a reasonless
 *                          deferral parses far enough to be typed and must still be
 *                          refused, because the parser's no is the rule.
 *   not-declared         — the story declares nothing at all. Silence is not coverage.
 *   deferral-self        — a deferral names the story itself.
 *   unknown-target       — a deferral names a work item that does not exist.
 *   deferral-target-done — a deferral names a work item that is already done, so the
 *                          playthrough it promised can never arrive.
 *
 * A `required` declaration with a non-empty instruction is valid: the play itself is the
 * person's, and the gate is what records whether they made it.
 */
export function validatePlayDeclaration(declaration, { workItems = null, self = null } = {}) {
  const d = declaration || {};

  if (Array.isArray(d.errors) && d.errors.length > 0) {
    return { ok: false, code: 'malformed', message: d.errors.join(' ') };
  }
  if (!d.declared) {
    return {
      ok: false,
      code: 'not-declared',
      message: 'the story declares no "Play:" line, so nothing says whether a person can play it. A story that cannot be played yet says so: "Play: deferred to <work item> — <why>".',
    };
  }

  if (d.kind === 'required') {
    // The code matters: `harness verify-play` branches on it to REFUSE recording a playable
    // story's gate. Returning null here would let this command set the gate for a story only a
    // person can settle, which is the hole the gate exists to close.
    return { ok: true, code: 'required', message: `play required: ${d.instruction}` };
  }

  const target = d.deferTo;
  const selfRefs = new Set(
    (Array.isArray(self) ? self : [self])
      .filter((value) => typeof value === 'string' && value.trim() !== '')
      .map((value) => normalizeWorkItemRef(value)),
  );

  if (selfRefs.has(normalizeWorkItemRef(target))) {
    return {
      ok: false,
      code: 'deferral-self',
      message: `the deferral names "${target}", which is this story itself. A story cannot become playable by deferring to itself: declare "required", or name the work item that will make it playable.`,
    };
  }

  if (!workItems) {
    // No state to check against — the target cannot be verified, and "cannot verify"
    // is reported as such rather than assumed fine.
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
      message: `the deferral names "${target}", which is already ${status}. The work item that was going to make this story playable has landed, so the deferral has expired: either the work can be played now (declare "required") or the playable surface was missed when "${target}" closed.`,
    };
  }

  return { ok: true, code: 'deferred', message: `play deferred to ${target} (${status || 'unknown status'})` };
}

/**
 * The `Play:` declarations of a story's own epic directory, for the deferral graph.
 *
 * The same shape as `readSiblingDeclarations` in `reachability.mjs`, parsing `Play:`
 * lines instead: a cycle can only be found if every sibling's edge is read.
 */
export function readSiblingPlayDeclarations(storyPath, { max = DEFAULT_MAX_SIBLING_STORIES, workItems = null } = {}) {
  const dir = dirname(storyPath);
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
    if (seen.has(id) || out.length >= max) return;
    seen.add(id);
    try {
      out.push({ id: name, aliases: aliasesFor(name), path, declaration: parsePlayDeclaration(path) });
    } catch {
      // A file that cannot be read is not this verdict's business.
    }
  };

  add(basename(storyPath), storyPath);

  let entries = null;
  try {
    entries = readdirSync(dir);
  } catch {
    entries = null;
  }

  for (const entry of entries || []) {
    if (out.length >= max) break;
    if (!entry.endsWith('.md')) continue;
    if (entry === basename(storyPath)) continue;
    add(entry, join(dir, entry));
  }

  return out;
}

/** One paragraph naming every play gap, for a human-readable failure. */
export function describePlayGaps({ validation, cycles = [], story } = {}) {
  const lines = [];
  if (validation && !validation.ok) lines.push(`- ${story || 'the story'}: ${validation.message}`);
  for (const cycle of cycles) {
    lines.push(`- the play deferrals form a cycle, so none of these can ever be played: ${cycle.join(' → ')}`);
  }
  return lines.join('\n');
}

/** Re-exported so the CLI and its tests need one import for both halves of the walk. */
export { collectWorkItems, findDeferralCycles };
