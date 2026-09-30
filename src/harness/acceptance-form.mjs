/**
 * Human acceptance: the form, and reading it back.
 *
 * The gate is human-owned, but the RECORD should not be homework. Typing the same
 * acceptance into a hand-written template and then into six CLI flags is duplication,
 * and duplication is what turns a gate into a documentation chore: the two copies
 * drift, the person fills both, and the one that matters is whichever the machine read.
 *
 * So the capture works the way the design review does — the artifact IS the input —
 * with one difference that makes it easy rather than merely possible: the form is
 * GENERATED from state first, so everything the framework already knows (the epic, its
 * stories, the revision, the files, the candidate limitations) is already written down
 * and the person fills only the two things only a person can say: what they did and saw,
 * and what they accepted as missing. The command to record it is printed at the bottom
 * of the form itself, with the real path in it.
 *
 * Two commands, no retyping, and they are the only route — there are no
 * `--witness`/`--limitations` flags to type the same acceptance into twice:
 *
 *   cadet-agent harness acceptance-form --epic <id>          # writes a filled-in form
 *   cadet-agent harness confirm --gate humanAcceptanceConfirmed --artifact <the form>
 *
 * The shape lives in `templates/HumanAcceptanceTemplate.md`, which the generator reads,
 * so the shipped template and the generated form cannot drift into two formats.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

/** The gate this form records. */
export const ACCEPTANCE_FORM_GATE = 'humanAcceptanceConfirmed';

/** Where a generated form goes inside an epic's own artifact directory. */
export const ACCEPTANCE_FORM_FILENAME = 'HumanAcceptance.md';

/** The template the generator fills. A managed path, so a synced repository has it. */
export const ACCEPTANCE_TEMPLATE_RELATIVE = '.cadet/agent/core/templates/HumanAcceptanceTemplate.md';

/**
 * The fields only a person can supply. The generator leaves all three as unfilled
 * slots, and the parser refuses a form where any of them still is one: a sentinel left
 * in place means the person did not answer, and recording that would put the
 * framework's own placeholder text into the record as if someone had written it.
 */
export const ACCEPTANCE_HUMAN_FIELDS = Object.freeze(['acceptor', 'witness', 'limitations']);

/**
 * A slot that the generator failed to fill is still a slot.
 *
 * Matched attribute-wise rather than up to the first `>`: a slot's `note` is prose and
 * some notes contain `>` (`revision=<sha>`, for one), so a naive `[^>]*` stops
 * mid-attribute and leaves the slot unfilled. Silent is the bad part — the form then
 * records the template's own instructions as an answer.
 */
const UNFILLED = /<slot\b/;
const slotTag = (id) => new RegExp(`<slot\\s+id="${id}"(?:[^>"]|"[^"]*")*/>`);

/** True when a captured value is empty or still the template's placeholder. */
export function isUnfilled(value) {
  return value === null || value === undefined || String(value).trim() === '' || UNFILLED.test(String(value));
}

/** The path of the generated form for an epic. */
export function acceptanceFormPath(targetDir, epicId) {
  return join(targetDir, '.cadet', 'agent', 'project-plans', epicId, ACCEPTANCE_FORM_FILENAME);
}

/** The machine's best answer for "which revision is this", or `unknown`. */
function revisionOf(targetDir) {
  try {
    const r = spawnSync('git', ['-C', targetDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8', windowsHide: true });
    const sha = (r.stdout || '').trim();
    return r.status === 0 && sha ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The Unity editor version, when the repository records one. */
function editorVersionOf(targetDir) {
  try {
    const text = readFileSync(join(targetDir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf-8');
    const m = text.match(/m_EditorVersion:\s*(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * What the machine already knows, written into the form so nobody retypes it.
 *
 * The candidates section is the part that saves the most work: the limitations a person
 * would otherwise have to remember are exactly the ones the record already holds — a
 * deferral that is still open, an exception someone accepted earlier, a story that never
 * reached validation. They are listed as candidates, not as claims: the person keeps what
 * applies and deletes the rest, and the parser reads only the Accepted limitations
 * section, never this list.
 */
export function acceptanceCandidates(state) {
  const out = [];
  const epic = state?.activeWorkItem?.epicId;
  const epics = state?.epics || {};

  for (const [epicId, entry] of Object.entries(epics)) {
    for (const [story, status] of Object.entries(entry?.stories || {})) {
      if (status !== 'done' && status !== 'validated') {
        out.push(`${epicId === epic ? '' : `(${epicId}) `}${story} is "${status}", not done — say whether that is accepted or outstanding`);
      }
    }
  }

  for (const exception of state?.gateExceptions || []) {
    const expiry = exception.expiresAt ? `expires ${String(exception.expiresAt).slice(0, 10)}` : 'no expiry';
    out.push(`gate \`${exception.gate}\` was excepted as \`${exception.category}\` (${expiry})`);
  }

  if (Array.isArray(state?.gateEvidence)) {
    const deferred = state.gateEvidence.filter((e) => typeof e?.result === 'string' && /deferr/i.test(e.result));
    for (const record of deferred) {
      out.push(`\`${record.gate}\` recorded a deferral: ${String(record.result).slice(0, 120)}`);
    }
  }

  return out;
}

/**
 * Build the form for an epic by filling the shipped template's known slots.
 *
 * Blank slots the person must answer are left exactly as the template wrote them, so an
 * unfinished form is obvious to a reader and refusable by the parser — no second marker
 * convention to learn.
 */
export function buildAcceptanceForm({ template, state, epicId, targetDir, now = new Date() }) {
  if (typeof template !== 'string' || template.trim() === '') {
    throw new Error('the human-acceptance template is empty');
  }
  const stories = Object.entries(state?.epics?.[epicId]?.stories || {});
  const files = [];
  for (const [story] of stories) {
    for (const candidate of [
      join('.cadet', 'agent', 'project-plans', epicId, story),
      join('.cadet', 'agent', 'story-breakdown', story),
    ]) {
      if (existsSync(join(targetDir, candidate))) files.push(candidate.replace(/\\/g, '/'));
    }
  }

  const environment = [`revision=${revisionOf(targetDir)}`];
  const editor = editorVersionOf(targetDir);
  if (editor) environment.push(`editor=${editor}`);
  environment.push(`date=${now.toISOString().slice(0, 10)}`);

  const scopeReviewed = stories.length
    ? stories.map(([story, status]) => `- ${story} — ${status}`).join('\n')
    : '- (no stories recorded for this epic yet)';

  const candidates = acceptanceCandidates(state);
  const candidateText = candidates.length
    ? candidates.map((line) => `- ${line}`).join('\n')
    : '- (nothing outstanding in state)';

  const formRelative = acceptanceFormPath(targetDir, epicId)
    .slice(targetDir.length + 1)
    .replace(/\\/g, '/');
  const recording = [
    '1. Fill in **Accepted by**, **## Witness** and **## Accepted limitations** — the three',
    '   fields with a `<slot .../>` in them. Everything else is already written down.',
    '2. Record it:',
    '',
    '   ```',
    `   cadet-agent harness confirm --gate ${ACCEPTANCE_FORM_GATE} --artifact ${formRelative} \\`,
    '     --reason "<one line: why this was accepted>" --expires-at <ISO-8601>',
    '   ```',
    '',
    '   `--reason` and `--expires-at` are required by strict closure, and they are the only',
    '   fields to pass: the form already carries the scope and the environment, and passing',
    '   `--scope` or `--environment` as well is refused as a second, competing source.',
    '',
    '   The command reads this file, binds the files it names, and records the gate. It',
    '   refuses a form whose witness or limitations is still a placeholder, so an',
    '   unfinished form cannot be recorded by accident.',
    '3. Where a user cannot reach the work at all, do not accept it: record a',
    '   `non-user-facing` gate exception instead, naming who judged it.',
  ].join('\n');

  const filled = {
    epic: epicId,
    date: now.toISOString().slice(0, 10),
    files: files.length ? files.join(', ') : '(none found — list the files this acceptance covers)',
    environment: environment.join(', '),
    scopeReviewed,
    candidates: candidateText,
    recording,
  };

  let text = template;
  for (const [id, value] of Object.entries(filled)) {
    text = replaceSlot(text, id, value);
  }
  return { text, filled: Object.keys(filled), files };
}

/** Replace one `<slot id="x" .../>` occurrence with a value, keeping a trailing newline sane. */
function replaceSlot(text, id, value) {
  const re = slotTag(id);
  if (!re.test(text)) return text;
  return text.replace(re, value);
}

/**
 * Read a filled form back.
 *
 * Returns the values it found plus `incomplete`, the human fields still unanswered. It
 * makes no judgement about the acceptance itself — that is the point of the gate — and it
 * does not read the candidates section, which exists to help a person write the
 * limitations section, not to supply it.
 */
export function parseAcceptanceForm(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { incomplete: [...ACCEPTANCE_HUMAN_FIELDS], error: 'the form is empty' };
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
    // The epic is the form's title, so it is written once and read once. A second
    // `Epic:` line would be a copy that can disagree with the heading.
    epic: (text.match(/^#\s*Human Acceptance:\s*(.+)$/m) || [])[1]?.trim() || null,
    acceptor: scalar('Accepted by'),
    date: scalar('Date'),
    files: scalar('Files'),
    environment: scalar('Environment'),
    scopeReviewed: section('Scope reviewed'),
    witness: section('Witness'),
    limitations: section('Accepted limitations'),
  };

  const incomplete = ACCEPTANCE_HUMAN_FIELDS.filter((field) => isUnfilled(form[field]));
  if (isUnfilled(form.epic)) incomplete.push('epic');

  const fileList = (form.files || '')
    .split(',')
    .map((f) => f.trim().replace(/\\/g, '/'))
    .filter((f) => f && !f.startsWith('('))
    .filter((f) => !isUnfilled(f));

  return { ...form, fileList, incomplete };
}

/** Write the form, create-only: a half-filled form is never overwritten. */
export function writeAcceptanceForm(targetDir, epicId, text, { out = null } = {}) {
  const path = out || acceptanceFormPath(targetDir, epicId);
  if (existsSync(path)) {
    return { written: false, path, reason: 'a form already exists; edit it and record it, or move it aside to regenerate' };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return { written: true, path };
}
