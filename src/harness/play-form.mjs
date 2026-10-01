/**
 * The user-playthrough form — the only route by which `userPlaythroughConfirmed` is
 * recorded for a story whose `Play:` declaration is `required`.
 *
 * Why a form rather than a flag. The gate asks whether a PERSON played the delivered
 * work and what they saw. A flag route would let an agent answer that question with a
 * sentence, which is exactly the failure the gate exists to close; the form leaves the
 * three fields only a person can supply unfilled, and `harness confirm` refuses a form
 * that still holds a placeholder. It mirrors the human-acceptance form deliberately —
 * same shape, same refusal, one story instead of one epic.
 *
 * A `Play: deferred to <work item>` declaration never needs a form: the declaration is
 * the answer, and `harness verify-play` records it. This module is for the other half.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { isUnfilled } from './acceptance-form.mjs';

/** The gate this form records. */
export const PLAY_FORM_GATE = 'userPlaythroughConfirmed';

/** The form's file name, written beside the story it belongs to. */
export const PLAY_FORM_SUFFIX = '-UserPlaythrough.md';

/** The template, relative to the repository root. */
export const PLAY_TEMPLATE_RELATIVE = '.cadet/agent/core/templates/UserPlaythroughTemplate.md';

/**
 * The fields only a person can supply. The generator leaves all three unfilled and the
 * parser refuses a form where any of them still is one.
 */
export const PLAY_HUMAN_FIELDS = Object.freeze(['player', 'witness', 'limitations']);

/** The form's path: beside the story, whose name it extends. */
export function playFormPath(targetDir, storyPath) {
  const rel = storyPath.replace(/\\/g, '/');
  const stem = rel.endsWith('.md') ? rel.slice(0, -3) : rel;
  return join(targetDir, `${stem}${PLAY_FORM_SUFFIX}`);
}

/** Fill every `<slot id="…"/>` in the template from a value map. */
function fillSlots(text, values) {
  return text.replace(/<slot\s+id="([^"]+)"((?:"[^"]*"|[^>"])*)\/>/g, (whole, id, attrs) => {
    const value = values[id];
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Strip the template's authoring attributes from a filled form. */
function stripAttributes(text) {
  return text.replace(/<slot\s+id="([^"]+)"(?:"[^"]*"|[^>"])*\/>/g, (whole, id) => {
    const m = whole.match(/^<slot\s+id="[^"]+"[^>]*?\/>$/);
    return m ? `<slot id="${id}"/>` : whole;
  });
}

/** The machine's best answer for "which revision is this", or `unknown`. */
function revisionOf(targetDir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: targetDir, encoding: 'utf-8' });
    return out.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Build the form for one story.
 *
 * `storyPath` is repository-relative. The story itself is bound as the relevant file, so
 * editing the story after the playthrough makes the record stale rather than leaving it
 * looking current.
 */
export function buildPlayForm({ template, state, storyPath, storyRel, epicId = null, targetDir, now = new Date(), declaration = null }) {
  const storyName = storyRel.replace(/\\/g, '/').split('/').pop() || storyRel;
  const instruction = declaration && declaration.kind === 'required' && declaration.instruction
    ? declaration.instruction
    : '(the story declares no instruction — see its Play: line)';

  const candidates = [];
  candidates.push(`- \`Play:\` declaration: ${declaration && declaration.declared ? declaration.kind : 'MISSING — the story declares no Play: line'}`);
  if (state && state.gates && typeof state.gates === 'object') {
    const unmet = Object.entries(state.gates).filter(([, value]) => value !== true).map(([gate]) => gate);
    if (unmet.length > 0) candidates.push(`- gates not yet true in state.json: ${unmet.join(', ')}`);
  }
  const workItem = state && state.activeWorkItem && state.activeWorkItem.storyId
    ? `${state.activeWorkItem.epicId}::${state.activeWorkItem.storyId}`
    : '(no active work item)';

  const values = {
    story: `\`${storyName}\` (${workItem})`,
    date: now.toISOString(),
    revision: revisionOf(targetDir),
    files: storyRel.replace(/\\/g, '/'),
    environment: 'editor=<version>, scene=<path>',
    instruction,
    candidates: candidates.join('\n'),
    recording: [
      'Fill in every field above, then record it — nothing is retyped:',
      '',
      '```',
      `cadet-agent harness confirm --gate ${PLAY_FORM_GATE} \\`,
      `  --artifact <this file> \\`,
      `  --reason "<why this playthrough is the record>" --expires-at <ISO-8601>`,
      '```',
      '',
      'A form with an unfilled field is refused. The play is the person\'s; the agent only records it.',
    ].join('\n'),
  };

  return stripAttributes(fillSlots(template, values));
}

/**
 * Parse a filled form.
 *
 * Returns the values it found plus `incomplete`, the human fields still unanswered. It
 * makes no judgement about the playthrough itself — that is the gate's question, and the
 * point of the record is that the person answered it.
 */
export function parsePlayForm(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { incomplete: [...PLAY_HUMAN_FIELDS], error: 'the form is empty' };
  }
  const lines = text.split(/\r?\n/);

  const scalar = (label) => {
    const re = new RegExp(`^${label}:\\s*(.*)$`, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };

  const section = (heading) => {
    const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
    if (start < 0) return null;
    const body = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^##\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) break;
      body.push(lines[i]);
    }
    return body.join('\n').trim();
  };

  const form = {
    story: (text.match(/^#\s*User Playthrough:\s*(.+)$/m) || [])[1]?.trim() || null,
    player: scalar('Played by'),
    date: scalar('Date'),
    revision: scalar('Revision'),
    files: scalar('Files'),
    environment: scalar('Environment'),
    witness: section('What I did'),
    instruction: section('What the story claims'),
    limitations: section('Accepted limitations'),
  };

  const incomplete = PLAY_HUMAN_FIELDS.filter((field) => isUnfilled(form[field]));
  if (isUnfilled(form.story)) incomplete.push('story');

  const fileList = (form.files || '')
    .split(',')
    .map((f) => f.trim().replace(/\\/g, '/'))
    .filter((f) => f && !f.startsWith('('))
    .filter((f) => !isUnfilled(f));

  return { ...form, fileList, incomplete };
}

/** Write the form, create-only: a half-filled form is never overwritten. */
export function writePlayForm(targetDir, storyRel, text, { out = null } = {}) {
  const path = out ? join(targetDir, out) : playFormPath(targetDir, storyRel);
  if (existsSync(path)) {
    return { written: false, path, reason: 'a form already exists; edit it and record it, or move it aside to regenerate' };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return { written: true, path };
}

/** Read the template, or throw with a message a caller can print. */
export function readPlayTemplate(targetDir) {
  const path = join(targetDir, PLAY_TEMPLATE_RELATIVE);
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    throw new Error(`the playthrough template could not be read at ${PLAY_TEMPLATE_RELATIVE}: ${err.message}`);
  }
}
