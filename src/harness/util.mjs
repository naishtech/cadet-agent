/**
 * Shared harness primitives: UUIDv4, SHA-256 over UTF-8 bytes, tree hashing,
 * deterministic JSON serialization, and UTC timestamps.
 *
 * Contract: docs/core/HarnessContract.md §2 (identifiers, hashes).
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** UUIDv4 identifier. */
export function newId() {
  return randomUUID();
}

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

/** SHA-256 hex digest over UTF-8 bytes. */
export function sha256(value) {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

/** SHA-256 hex digest over raw bytes (Buffers are hashed as-is). */
export function sha256Bytes(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Hash of a file's exact bytes, or null when the file is missing. */
export function hashFile(path) {
  if (!existsSync(path)) return null;
  try {
    return sha256Bytes(readFileSync(path));
  } catch {
    return null;
  }
}

/**
 * Deterministic hash of a set of `(relativePath, fileHash)` pairs.
 * Pairs are sorted by path so the hash is order-independent and stable across
 * platforms. Files without a resolvable hash are recorded as `missing`.
 */
export function hashTree(pairs) {
  const normalized = [...pairs]
    .map(({ path, hash }) => ({
      path: String(path).replace(/\\/g, '/'),
      hash: hash || 'missing',
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(JSON.stringify(normalized));
}

/**
 * Hash an acceptance-criteria document or list. `criteria` may be a string or an
 * array of strings; a stable serialization is used either way.
 */
export function hashCriteria(criteria) {
  if (criteria === null || criteria === undefined) return sha256('[]');
  const arr = Array.isArray(criteria) ? criteria.map(String) : [String(criteria)];
  return sha256(JSON.stringify(arr));
}

/** ISO-8601 UTC timestamp for a Date or "now". */
export function timestamp(at = new Date()) {
  return (at instanceof Date ? at : new Date(at)).toISOString();
}

/** Current time provider; injectable for deterministic tests. */
export function nowMs() {
  return Date.now();
}

/**
 * Canonical JSON with sorted keys. Used for stable hashes and for comparing
 * evidence records without key-order noise.
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

export { canonicalJson as stableStringify };

/**
 * List the files changed in the working tree relative to HEAD, using git.
 * Returns forward-slash relative paths. Returns an empty array when git is
 * unavailable or the directory is not a repository — callers must not assume
 * freshness coverage in that case; use `gitChangedFiles` when the distinction
 * between "no changes" and "no git" matters.
 */
export function changedFiles(cwd, { runner = defaultGitRunner } = {}) {
  return gitChangedFiles(cwd, { runner }).files;
}

/**
 * Cadet's own bookkeeping — never a meaningful verification input.
 *
 * `state.json` is rewritten by the very command that records a gate, and
 * `runs/*.json` gains a new ledger on every harness invocation. If either were
 * auto-detected as a relevant file, the evidence hash would describe a file the
 * recording itself mutates: the gate would be stale the moment it was written,
 * and the resulting record would certify no story code. Excluded here, at the
 * single scan used by both `harness verify` and `harness confirm`.
 *
 * `.cadet/archive/` is excluded for the same reason, one level out: it is the
 * append-only home of sealed evidence, so compaction writes it. Left in, a
 * compaction run would invalidate every live record it had just archived.
 */
const CADET_MACHINERY = ['.cadet/state.json', '.cadet/runs/', '.cadet/archive/'];

/** True when a repository-relative path is Cadet's own bookkeeping. */
function isCadetMachinery(relPath) {
  return CADET_MACHINERY.some((p) => (p.endsWith('/') ? relPath.startsWith(p) : relPath === p));
}

/**
 * List changed files and report whether git was actually queryable.
 * Returns `{ available, files, reason }`. `available: false` means freshness
 * coverage could not be established and callers must fail safe.
 *
 * Cadet's own machinery (`.cadet/state.json`, `.cadet/runs/**`) is filtered out
 * of `files`; see `CADET_MACHINERY`.
 */
export function gitChangedFiles(cwd, { runner = defaultGitRunner } = {}) {
  let res;
  try {
    res = runner('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=all']);
  } catch (err) {
    return { available: false, files: [], reason: `git invocation failed: ${err.message}` };
  }
  if (!res) {
    return { available: false, files: [], reason: 'git is not available' };
  }
  if (res.error || res.status === null) {
    return { available: false, files: [], reason: 'git is not installed or could not be executed' };
  }
  if (res.status !== 0) {
    // Not a repository, or git refused the query.
    return { available: false, files: [], reason: String(res.stderr || '').trim() || `git exited ${res.status}` };
  }
  const files = new Set();
  for (const line of String(res.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Porcelain v1: XY<space>path (rename: "old -> new").
    let path = line.slice(3).trim();
    if (path.includes(' -> ')) path = path.split(' -> ').pop().trim();
    path = path.replace(/^"|"$/g, '');
    if (!path) continue;
    const rel = path.replace(/\\/g, '/');
    if (isCadetMachinery(rel)) continue;
    files.add(rel);
  }
  return { available: true, files: [...files].sort(), reason: null };
}

function defaultGitRunner(cmd, args) {
  try {
    return spawnSync(cmd, args, { encoding: 'utf-8', windowsHide: true });
  } catch {
    return null;
  }
}

