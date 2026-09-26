/**
 * Change inventory — what a story actually touched, and how much.
 *
 * Why this exists: the Change Report's file table has to be *the same table*
 * every run. When the agent assembled that list by hand — a `git status` here, a
 * remembered path there — the result varied by run: a file dropped, a status
 * guessed, a link that did not resolve, a line count invented. The rows are the
 * part of the report that is mechanically knowable, so they are computed here
 * and the agent supplies only the prose that is not.
 *
 * This is a read-only probe. It runs `git` and parses output; it never writes.
 *
 * Availability contract: mirrors `gitChangedFiles` (`util.mjs`). Returns
 * `{ available: false, reason }` when git cannot be asked — "not a repository"
 * and "no changes" must not look alike, so callers state the limitation rather
 * than reporting an empty change set as a clean one.
 */

import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative } from 'node:path';

/** Default report directory, from which file links are made relative. */
export const DEFAULT_REPORT_DIR = '.cadet/reports';

/**
 * Cadet's own bookkeeping. A story's change report should not lead with the
 * ledger and state files its own gate checks rewrote. Same set and same reason
 * as `util.mjs#CADET_MACHINERY`.
 */
const CADET_MACHINERY = ['.cadet/state.json', '.cadet/runs/', '.cadet/archive/'];

function isCadetMachinery(relPath) {
  return CADET_MACHINERY.some((p) => (p.endsWith('/') ? relPath.startsWith(p) : relPath === p));
}

/**
 * Collapse porcelain's two status columns (`XY`) to the single letter the
 * report shows. The staged column wins when it says something, because that is
 * the status the eventual commit will carry; the worktree column is the
 * fallback. `??` is an untracked file, which a reader reads as "added".
 */
const STATUS_LETTERS = { R: 'R', C: 'R', A: 'A', D: 'D', M: 'M', T: 'M' };

function statusFromPorcelain(xy) {
  if (xy === '??') return 'A';
  const [staged, unstaged] = xy;
  return STATUS_LETTERS[staged] || STATUS_LETTERS[unstaged] || 'M';
}

/**
 * Normalize a `--numstat` path field, which spells renames three ways:
 * `new`, `old => new`, and `dir/{old => new}/file`. Only the new path is kept,
 * matching the name-status side, so the two maps join on the same key.
 */
function normalizeNumstatPath(raw) {
  const path = String(raw || '').trim();
  if (!path.includes(' => ')) return path;
  const braced = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/{2,}/g, '/');
  return path.split(' => ').pop().trim();
}

function defaultGitRunner(cmd, args) {
  try {
    return spawnSync(cmd, args, { encoding: 'utf-8', windowsHide: true });
  } catch {
    return null;
  }
}

/**
 * Run one git command and return its stdout, or `{ error }` describing why the
 * question could not be asked. Every call goes through here so a single probe
 * failure is reported the same way regardless of which command failed.
 */
function runGit(cwd, args, runner) {
  let res;
  try {
    res = runner('git', ['-C', cwd, ...args]);
  } catch (err) {
    return { error: `git invocation failed: ${err.message}` };
  }
  if (!res) return { error: 'git is not available' };
  if (res.error || res.status === null) {
    return { error: 'git is not installed or could not be executed' };
  }
  if (res.status !== 0) {
    return { error: String(res.stderr || '').trim() || `git exited ${res.status}` };
  }
  return { stdout: String(res.stdout || '') };
}

/**
 * Files and statuses for the change set. Untracked files appear only in the
 * working-tree form; a `--range` diff is a commit-to-commit question and cannot
 * see them.
 */
function readNameStatus(cwd, { runner, range }) {
  if (range) {
    const res = runGit(cwd, ['diff', '--name-status', range, '--'], runner);
    if (res.error) return { error: res.error };
    const files = [];
    for (const line of res.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      // "M\tpath" — or "R100\told\tnew", where the new path is the one that exists.
      const fields = line.split('\t');
      if (fields.length < 2) continue;
      const path = fields[fields.length - 1].trim();
      if (!path) continue;
      files.push({ path: path.replace(/\\/g, '/'), status: fields[0][0] });
    }
    return { files };
  }

  const res = runGit(cwd, ['status', '--porcelain', '--untracked-files=all'], runner);
  if (res.error) return { error: res.error };
  const files = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Porcelain v1: XY<space>path, with renames written "old -> new".
    const xy = line.slice(0, 2);
    let path = line.slice(3).trim();
    if (path.includes(' -> ')) path = path.split(' -> ').pop().trim();
    path = path.replace(/^"|"$/g, '');
    if (!path) continue;
    files.push({ path: path.replace(/\\/g, '/'), status: statusFromPorcelain(xy) });
  }
  return { files };
}

/**
 * Accumulate one count onto a prior one. A file can appear in both the staged
 * and the unstaged numstat, and those counts add. `null` means git reported no
 * number (a binary file); it stays unknown unless a real number was seen.
 */
function addCount(prior, value) {
  if (value === null) return prior === undefined ? null : prior;
  return (prior ?? 0) + value;
}

/** Added/deleted counts per path, merged across the staged and unstaged diffs. */
function mergeNumstat(target, stdout) {
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [added, deleted, ...rest] = line.split('\t');
    if (rest.length === 0) continue;
    const path = normalizeNumstatPath(rest.join('\t'));
    if (!path) continue;
    // A binary file reports "-" for both; that is genuinely unknown, not zero.
    const a = /^\d+$/.test(added) ? Number(added) : null;
    const d = /^\d+$/.test(deleted) ? Number(deleted) : null;
    const prior = target.get(path);
    target.set(path, {
      added: addCount(prior?.added, a),
      deleted: addCount(prior?.deleted, d),
    });
  }
}

function readNumstat(cwd, { runner, range }) {
  const counts = new Map();
  if (range) {
    const res = runGit(cwd, ['diff', '--numstat', range, '--'], runner);
    if (res.error) return { error: res.error };
    mergeNumstat(counts, res.stdout);
    return { counts };
  }
  const unstaged = runGit(cwd, ['diff', '--numstat', '--'], runner);
  if (unstaged.error) return { error: unstaged.error };
  mergeNumstat(counts, unstaged.stdout);
  const staged = runGit(cwd, ['diff', '--cached', '--numstat', '--'], runner);
  if (staged.error) return { error: staged.error };
  mergeNumstat(counts, staged.stdout);
  return { counts };
}

/**
 * The change inventory for a directory.
 *
 * @param {string} cwd Repository root to ask about.
 * @param {object} [options]
 * @param {Function} [options.runner] Injectable git runner, for tests.
 * @param {string|null} [options.range] Diff a base revision instead of the working tree.
 * @param {string} [options.relativeTo] Directory the `link` fields are made relative to.
 * @param {boolean} [options.includeCadet] Keep `.cadet/` bookkeeping in the list.
 * @returns {{available: boolean, files: Array, counts: object, reason: string|null}}
 */
export function gitChangeSet(cwd, {
  runner = defaultGitRunner,
  range = null,
  relativeTo = DEFAULT_REPORT_DIR,
  includeCadet = false,
} = {}) {
  const empty = { added: 0, modified: 0, deleted: 0, renamed: 0 };

  const named = readNameStatus(cwd, { runner, range });
  if (named.error) return { available: false, files: [], counts: empty, reason: named.error };

  const counted = readNumstat(cwd, { runner, range });
  if (counted.error) return { available: false, files: [], counts: empty, reason: counted.error };

  // Links are relative to the report, not the repository root: a report at
  // `.cadet/reports/x.md` must point at `../../Assets/Foo.cs` or the click does
  // nothing. Computing it here is the whole reason the link is not hand-written.
  const baseDir = isAbsolute(relativeTo) ? relativeTo : join(cwd, relativeTo);

  const seen = new Map();
  for (const file of named.files) {
    if (!includeCadet && isCadetMachinery(file.path)) continue;
    if (seen.has(file.path)) continue;
    const count = counted.counts.get(file.path);
    const linkTarget = relative(baseDir, join(cwd, file.path)).replace(/\\/g, '/');
    seen.set(file.path, {
      path: file.path,
      status: file.status,
      // Untracked files have no diff, so no count exists. Null, not zero: a
      // zero would read as "changed nothing", which is a different claim.
      added: count?.added ?? null,
      deleted: count?.deleted ?? null,
      link: `[${file.path}](${linkTarget})`,
    });
  }

  const files = [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const counts = { ...empty };
  for (const f of files) {
    if (f.status === 'A') counts.added += 1;
    else if (f.status === 'D') counts.deleted += 1;
    else if (f.status === 'R') counts.renamed += 1;
    else counts.modified += 1;
  }

  return { available: true, files, counts, reason: null };
}
