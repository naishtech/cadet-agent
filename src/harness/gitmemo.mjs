/**
 * Cadet-Agent sealed gate evidence — commit-message trailers.
 *
 * Gate evidence has two lifecycles fused in v2/v3: a handful of records are
 * live, and every record the harness has ever written is retained forever inside
 * `.cadet/state.json`. On a real consumer project that grew the state document to
 * 2 MB, 72% of it evidence, with 823 of 832 records superseded or failed — and
 * because `state.json` is rewritten by the very command that records a gate, the
 * cost of each write scaled with all accumulated history (see the CADET_MACHINERY
 * note in util.mjs, which exists to work around exactly this).
 *
 * The fix is to stop storing history in the cursor. A work item's records are
 * written into the commit that closes it, as git trailers. The commit object then
 * carries the evidence, and because the trailers are part of the object, editing
 * one changes the SHA: a sealed record is self-verifying in a way an array entry
 * inside a rewritten JSON file never could be.
 *
 * Why trailers rather than `git notes` or tags:
 *   - a note is not fetched or pushed by default and can be rewritten silently,
 *     so it cannot support an immutability claim;
 *   - per-gate tags would add hundreds of refs to the namespace;
 *   - a trailer is in the commit object, so the seal is the hash itself, and the
 *     existing optional `commit` field on an evidence record finally means
 *     something in both directions.
 *
 * Cadet still does not commit (contract C5). `state seal` produces a message file
 * that a human or agent then commits with `git commit -F <file>`.
 *
 * Contract: docs/core/HarnessContract-v5.md.
 */

import { spawnSync } from 'node:child_process';

/** Prefix every trailer shares, so a message can be scanned cheaply. */
export const TRAILER_PREFIX = 'Cadet-';

/** The trailer that opens an evidence block. */
export const BLOCK_TRAILER = 'Cadet-Gate';

/** `git log --grep` argument that bounds a scan to commits carrying evidence. */
export const TRAILER_GREP = BLOCK_TRAILER;

/**
 * Field table. `kind` decides how a value is written and read back:
 *   - `string`  plain when unambiguous, JSON-quoted otherwise
 *   - `number` / `boolean`  literal, `null` for absent
 *   - `array` / `object`  always JSON, so a comma in a filename cannot
 *     be mistaken for a separator
 *
 * Two flags control how a missing value is handled, and they are not the same
 * question:
 *
 *   - `always` (write side): emit the line even when the value is null. Required
 *     for the fields whose *key presence* the contract demands — `command` and
 *     `result` may be null but must be present — so a round trip cannot turn a
 *     declared-null into a missing key and change the record's validity.
 *   - `fill` (read side): materialise the key as null when it is absent, so a
 *     record recovered from a commit is shaped like the record that was sealed.
 *
 * Fields with neither flag are v3-optional and *not* nullable in the schema
 * (`reason`, `environment`, `scope`, `source`). They are simply omitted when
 * absent: filling them with null would produce a record that fails validation for
 * having a null where the schema requires a string.
 */
const FIELDS = Object.freeze([
  { key: 'gate', trailer: 'Cadet-Gate', kind: 'string', fill: true },
  { key: 'workItemId', trailer: 'Cadet-Work-Item', kind: 'string', fill: true },
  { key: 'status', trailer: 'Cadet-Status', kind: 'string', fill: true },
  { key: 'evidenceId', trailer: 'Cadet-Evidence-Id', kind: 'string', fill: true },
  { key: 'phase', trailer: 'Cadet-Phase', kind: 'string', fill: true },
  { key: 'acceptanceCriterionId', trailer: 'Cadet-Acceptance-Criterion', kind: 'string', fill: true },
  { key: 'inputTreeHash', trailer: 'Cadet-Input-Tree-Hash', kind: 'string', fill: true },
  { key: 'criteriaHash', trailer: 'Cadet-Criteria-Hash', kind: 'string', fill: true },
  { key: 'relevantFiles', trailer: 'Cadet-Relevant-Files', kind: 'array', fill: true },
  { key: 'command', trailer: 'Cadet-Command', kind: 'string', always: true, fill: true },
  { key: 'result', trailer: 'Cadet-Result', kind: 'string', always: true, fill: true },
  { key: 'exitCode', trailer: 'Cadet-Exit-Code', kind: 'number', fill: true },
  { key: 'artifactPath', trailer: 'Cadet-Artifact-Path', kind: 'string', fill: true },
  { key: 'artifactHash', trailer: 'Cadet-Artifact-Hash', kind: 'string', fill: true },
  { key: 'toolVersion', trailer: 'Cadet-Tool-Version', kind: 'string', fill: true },
  { key: 'createdAt', trailer: 'Cadet-Created-At', kind: 'string', fill: true },
  { key: 'expiresAt', trailer: 'Cadet-Expires-At', kind: 'string', always: true, fill: true },
  { key: 'freshnessPolicy', trailer: 'Cadet-Freshness-Policy', kind: 'object', fill: true },
  { key: 'reason', trailer: 'Cadet-Reason', kind: 'string' },
  { key: 'environment', trailer: 'Cadet-Environment', kind: 'object' },
  { key: 'scope', trailer: 'Cadet-Scope', kind: 'array' },
  { key: 'source', trailer: 'Cadet-Source', kind: 'string' },
  { key: 'supersededBy', trailer: 'Cadet-Superseded-By', kind: 'string', fill: true },
]);

const BY_TRAILER = new Map(FIELDS.map((f) => [f.trailer, f]));

/** Default ceiling for one commit's evidence block (bytes). */
export const DEFAULT_MAX_TRAILER_BYTES = 64 * 1024;

/**
 * Is a string safe to write unquoted?
 *
 * It must survive a line-oriented, `interpret-trailers`-compatible format: no
 * newline (it would end the trailer), no leading or trailing whitespace (git
 * strips it), and it must not look like an encoded value on the way back in —
 * a literal `null`, or something beginning with a JSON delimiter, would decode
 * as something else.
 */
function isBareString(value) {
  if (value === '') return true;
  if (value === 'null') return false;
  if (/[\r\n]/.test(value)) return false;
  if (value !== value.trim()) return false;
  return !/^["[{]/.test(value);
}

function encodeValue(value, kind) {
  if (value === null || value === undefined) return 'null';
  if (kind === 'array' || kind === 'object') return JSON.stringify(value);
  if (kind === 'number') return String(value);
  if (kind === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  return isBareString(text) ? text : JSON.stringify(text);
}

function decodeValue(raw, kind) {
  const text = raw.trim();
  if (text === 'null') return null;
  if (kind === 'array' || kind === 'object') {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (kind === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'boolean') return text === 'true';
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Encode one record as trailer lines, `Cadet-Gate` first.
 *
 * `relevantFiles` is the only field that plausibly runs long, so when the block
 * would exceed `maxBytes` it is truncated first and the record is marked
 * `partial`. A partial record still parses, but it must never satisfy a gate: it
 * no longer binds the evidence to the files it claims.
 *
 * Returns `{ lines, partial, bytes }`.
 */
export function encodeEvidenceTrailers(record, { maxBytes = DEFAULT_MAX_TRAILER_BYTES } = {}) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('encodeEvidenceTrailers requires an evidence record');
  }
  const PARTIAL_LINE = `${TRAILER_PREFIX}Partial: true`;
  const markerBytes = Buffer.byteLength(`${PARTIAL_LINE}\n`, 'utf-8');

  const render = (rec) => FIELDS
    .filter((f) => f.always || (rec[f.key] !== null && rec[f.key] !== undefined))
    .map((f) => `${f.trailer}: ${encodeValue(rec[f.key], f.kind)}`);

  const sizeOf = (lines) => Buffer.byteLength(lines.join('\n'), 'utf-8');

  let working = { ...record };
  let rendered = render(working);
  if (sizeOf(rendered) <= maxBytes) {
    return { lines: rendered, partial: false, bytes: sizeOf(rendered) };
  }

  // The block does not fit. Reserve room for the marker first: a record that was
  // truncated without saying so is worse than no record, because it still looks
  // complete and would be read as binding the evidence to a partial file list.
  const budget = Math.max(0, maxBytes - markerBytes);
  const files = Array.isArray(working.relevantFiles) ? working.relevantFiles : [];
  let kept = files.length;
  while (kept > 0 && sizeOf(rendered) > budget) {
    kept -= 1;
    working = { ...working, relevantFiles: files.slice(0, kept) };
    rendered = render(working);
  }
  if (sizeOf(rendered) > budget) {
    // Even without the file list it does not fit: the free-text fields are the
    // problem. Seal the structural fields and drop the prose.
    working = { ...working, relevantFiles: [], result: null, reason: null };
    rendered = render(working);
    if (sizeOf(rendered) > budget) {
      throw new Error(`evidence record ${record.evidenceId || '(no id)'} exceeds the ${maxBytes}-byte trailer bound even after truncation`);
    }
  }
  const lines = [...rendered, PARTIAL_LINE];
  return { lines, partial: true, bytes: sizeOf(lines) };
}

/**
 * Parse every evidence block out of a commit message.
 *
 * Deliberately tolerant: an unrecognized or malformed line is recorded as a
 * diagnostic and skipped, because a commit message is human-authored and a single
 * typo must not make the whole message unreadable. What it will *not* do is invent
 * a field — a record missing a required key is returned as-is and rejected by
 * `validateEvidenceShape` downstream, where the error path already exists.
 */
export function parseEvidenceTrailers(message) {
  const records = [];
  const diagnostics = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const record = {};
    for (const f of FIELDS) {
      if (f.key in current.values) {
        record[f.key] = current.values[f.key];
      } else if (f.fill) {
        // Required by the evidence contract, or nullable: either way the key must
        // come back so a recovered record has the shape it was sealed with.
        record[f.key] = f.kind === 'array' ? [] : null;
      }
    }
    if (current.partial) record.partial = true;
    records.push(record);
    current = null;
  };

  for (const rawLine of String(message ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(TRAILER_PREFIX)) continue;
    const sep = line.indexOf(':');
    if (sep === -1) {
      diagnostics.push(`trailer without a value: ${line}`);
      continue;
    }
    const name = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();

    if (name === `${TRAILER_PREFIX}Partial`) {
      if (current) current.partial = true;
      continue;
    }
    const field = BY_TRAILER.get(name);
    if (!field) {
      // An unknown `Cadet-*` trailer is likely a typo in a field name. Report it
      // rather than dropping it silently — a silently ignored field would let a
      // record look complete while carrying nothing.
      diagnostics.push(`unknown trailer "${name}"`);
      continue;
    }
    if (name === BLOCK_TRAILER) flush();
    if (!current) {
      if (name !== BLOCK_TRAILER) {
        diagnostics.push(`trailer "${name}" appears before any ${BLOCK_TRAILER} block`);
        continue;
      }
      current = { values: {}, partial: false };
    }
    current.values[field.key] = decodeValue(rawValue, field.kind);
  }
  flush();

  return { records, diagnostics };
}

/**
 * Run `git` and report whether it was actually usable.
 *
 * Mirrors `gitChangedFiles` in util.mjs: `available: false` means the question
 * could not be asked, which callers must not confuse with "no sealed evidence".
 * `runner` is injectable so the parser is testable without a repository.
 */
function defaultRunner(cmd, args) {
  try {
    return spawnSync(cmd, args, { encoding: 'utf-8', windowsHide: true });
  } catch {
    return null;
  }
}

/**
 * Read sealed evidence from git history.
 *
 * The scan is bounded twice: `--grep` restricts it to commits that mention the
 * trailer prefix at all, and `--max-count` caps how far back it walks. Without
 * both, a large repository would pay a full-history parse on every call — the
 * same class of unbounded growth this design exists to remove.
 *
 * `range` narrows the walk (e.g. `HEAD~20..HEAD`) and exists mainly so tests can
 * pin an exact commit set.
 *
 * Returns `{ available, records, reason, diagnostics }`.
 */
export function sealedEvidence(cwd, { workItemId = null, gate = null, maxCount = 500, range = null, runner = defaultRunner, log = null } = {}) {
  const args = ['-C', cwd, 'log', `--max-count=${maxCount}`, `--grep=${TRAILER_GREP}`, '--format=%H%x00%B%x00'];
  if (range) args.splice(3, 0, range);

  let res;
  try {
    res = runner('git', args);
  } catch (err) {
    return { available: false, records: [], reason: `git invocation failed: ${err.message}`, diagnostics: [] };
  }
  if (!res) return { available: false, records: [], reason: 'git is not available', diagnostics: [] };
  if (res.error || res.status === null) {
    return { available: false, records: [], reason: 'git is not installed or could not be executed', diagnostics: [] };
  }
  if (res.status !== 0) {
    return { available: false, records: [], reason: String(res.stderr || '').trim() || `git exited ${res.status}`, diagnostics: [] };
  }

  // A commit message cannot contain a NUL byte, so NUL is a safe field
  // separator where a printable marker would risk colliding with prose.
  const parts = String(res.stdout || '').split('\0');
  const records = [];
  const diagnostics = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const commit = parts[i].trim();
    const body = parts[i + 1];
    if (!commit || !/^[0-9a-f]{4,40}$/i.test(commit)) continue;
    const parsed = parseEvidenceTrailers(body);
    for (const d of parsed.diagnostics) diagnostics.push(`${commit.slice(0, 8)}: ${d}`);
    for (const record of parsed.records) {
      if (workItemId && record.workItemId !== workItemId) continue;
      if (gate && record.gate !== gate) continue;
      records.push({ ...record, sealedCommit: commit });
    }
  }
  if (log && diagnostics.length) log(diagnostics.join('; '));
  return { available: true, records, reason: null, diagnostics };
}

/**
 * The newest sealed record for a gate and work item, or null.
 *
 * Ordering is by `createdAt` with the commit as tie-break, matching
 * `latestEvidenceForGate`'s "most recent wins" rule so a sealed record and a live
 * one are compared on the same basis.
 */
export function latestSealedForGate(cwd, { workItemId, gate, ...rest } = {}) {
  const result = sealedEvidence(cwd, { workItemId, gate, ...rest });
  if (!result.available || result.records.length === 0) return { ...result, record: null };
  const record = result.records.reduce((a, b) => {
    const ta = Date.parse(a.createdAt ?? '') || 0;
    const tb = Date.parse(b.createdAt ?? '') || 0;
    if (ta !== tb) return ta >= tb ? a : b;
    return String(a.sealedCommit) >= String(b.sealedCommit) ? a : b;
  });
  return { ...result, record };
}

/**
 * Build the coverage index from sealed history alone.
 *
 * This is the read side of the Tier C index: `state.json` keeps a per-work-item
 * summary so the "every `done` story owns evidence" check stays answerable
 * without git, and this function is what can regenerate that summary from the
 * commits when the index is missing or suspect.
 */
export function coverageFromSealed(cwd, options = {}) {
  const result = sealedEvidence(cwd, options);
  if (!result.available) return { ...result, coverage: {} };
  const coverage = {};
  for (const record of result.records) {
    const id = record.workItemId;
    if (!id) continue;
    const row = coverage[id] || { workItemId: id, recordCount: 0, gates: [], firstAt: null, lastAt: null, sealedCommit: null };
    row.recordCount += 1;
    if (record.gate && !row.gates.includes(record.gate)) row.gates.push(record.gate);
    const at = record.createdAt ? Date.parse(record.createdAt) : NaN;
    if (Number.isFinite(at)) {
      if (!row.firstAt || at < Date.parse(row.firstAt)) row.firstAt = record.createdAt;
      if (!row.lastAt || at >= Date.parse(row.lastAt)) {
        row.lastAt = record.createdAt;
        row.sealedCommit = record.sealedCommit;
      }
    }
    coverage[id] = row;
  }
  for (const row of Object.values(coverage)) row.gates.sort();
  return { ...result, coverage };
}
