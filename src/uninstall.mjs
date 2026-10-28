/**
 * Uninstall — remove exactly what the install record proves this project received.
 *
 * The record (`.cadet/agent/install.json`) lists every file the installer wrote,
 * with its sha256. This module deletes a file only when its hash still matches,
 * so a consumer's edited adapter, patched script or hand-tuned prompt survives.
 *
 * Three rules shape the whole file:
 *
 *   1. The record is the only source of truth. No record means no deletion; the
 *      command says so and stops. Guessing at what "Cadet probably wrote" is how
 *      an uninstall eats a project.
 *   2. User data is never a candidate. Policies, plans, state, reports, handoffs
 *      and the archive are not in the record, and the protected-path check
 *      refuses them even if a corrupt record names them.
 *   3. What cannot be hashed is reported, not deleted silently. Downloaded
 *      tools, build output and logs are named so the user can decide.
 */

import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

import { readInstallRecord, installRecordPath } from './install.mjs';

/** Paths that belong to the consumer, whatever a record claims. */
export const PROTECTED_PREFIXES = Object.freeze([
  '.cadet/agent/policies',
  '.cadet/agent/project-plans',
  '.cadet/state.json',
  '.cadet/reports',
  '.cadet/handoffs',
  '.cadet/archive',
  '.cadet/runs',
  '.cadet/context',
]);

/** Build output a component generates, which no record can hash. */
const GENERATED_DIRS = Object.freeze({
  'engine.unreal.plugin': ['Plugins/CadetBuild/Binaries', 'Plugins/CadetBuild/Intermediate'],
});

/** Things an uninstall leaves behind, because they are not the install's. */
const LEFTOVER_CANDIDATES = Object.freeze([
  { path: 'Assets/Covyne/Cadet/CLI', why: 'downloaded tools (Cosmos, SteamCMD, BuildPatchTool) or logs' },
  { path: 'Plugins/CadetBuild/CLI', why: 'downloaded tools (Cosmos, SteamCMD, BuildPatchTool) or logs' },
  { path: 'Logs', why: 'build logs written by the CLI' },
  { path: 'Saved/Logs', why: 'Unreal build logs' },
  { path: 'Assets/Config/Covyne/Cadet/VDF', why: 'generated Steam depot files' },
]);

function isProtected(rel) {
  return PROTECTED_PREFIXES.some((p) => rel === p || rel.startsWith(p + '/'));
}

function hashOf(full) {
  return createHash('sha256').update(readFileSync(full)).digest('hex');
}

/**
 * Split the record's files into what may go, what changed, and what is already
 * gone. Pure: reads the disk, writes nothing.
 */
export function classifyRecord(record, { targetDir, force = false } = {}) {
  const remove = [];
  const keepModified = [];
  const keepProtected = [];
  const absent = [];

  for (const entry of record?.files || []) {
    const rel = String(entry?.path || '').replace(/\\/g, '/');
    if (!rel) continue;

    if (isProtected(rel)) {
      keepProtected.push(rel);
      continue;
    }

    const full = join(targetDir, rel);
    let stat = null;
    try { stat = statSync(full); } catch { stat = null; }
    if (!stat || !stat.isFile()) {
      absent.push(rel);
      continue;
    }

    let matches = false;
    try { matches = hashOf(full) === entry.sha256; } catch { matches = false; }

    if (matches || force) remove.push(rel);
    else keepModified.push(rel);
  }

  return { remove, keepModified, keepProtected, absent };
}

/** Generated directories that belong to the installed components. */
export function generatedDirs(record, { targetDir } = {}) {
  const dirs = [];
  for (const component of record?.components || []) {
    for (const rel of GENERATED_DIRS[component] || []) {
      if (existsSync(join(targetDir, rel))) dirs.push(rel);
    }
  }
  return dirs;
}

/** Directories the install created that are now empty. */
export function emptyInstallDirs(record, { targetDir } = {}) {
  const candidates = [...(record?.dirs || [])]
    .map((d) => String(d).replace(/\\/g, '/'))
    .filter(Boolean)
    .sort((a, b) => b.split('/').length - a.split('/').length);
  const empty = [];
  for (const rel of candidates) {
    const full = join(targetDir, rel);
    try {
      if (statSync(full).isDirectory() && readdirSync(full).length === 0) empty.push(rel);
    } catch { /* gone or not a directory */ }
  }
  return empty;
}

/** What survives, and why. Reported, never deleted. */
export function leftovers(record, { targetDir } = {}) {
  return LEFTOVER_CANDIDATES
    .filter((c) => existsSync(join(targetDir, c.path)))
    .map((c) => ({ ...c }));
}

function removeEmptyAncestors(full) {
  let dir = dirname(full);
  for (;;) {
    try { rmdirSync(dir); } catch { return; }
    dir = dirname(dir);
  }
}

/**
 * Remove what the record proves, keep what it does not.
 *
 * `--dry-run` prints the same four lists and writes nothing. A second run finds
 * no record and exits 0 with "nothing to remove", so the command is idempotent.
 */
export async function uninstall(targetDir, opts = {}) {
  const recordPath = installRecordPath(targetDir);
  const record = readInstallRecord(targetDir);

  if (!record) {
    console.log('   No install record found at ' + recordPath.replace(/\\/g, '/'));
    console.log('   Nothing to remove. If this project was installed before records existed,');
    console.log('   remove the files by hand, or run `cadet-agent init` first to create a record.');
    return { ok: true, reason: 'no-record', removed: 0 };
  }

  const { remove, keepModified, keepProtected, absent } = classifyRecord(record, {
    targetDir,
    force: opts.force === true,
  });
  const generated = generatedDirs(record, { targetDir });
  const kept = leftovers(record, { targetDir });

  const report = (label, list) => {
    if (!list.length) return;
    console.log(`   ${label}: ${list.length}`);
    for (const item of list) console.log(`     ${typeof item === 'string' ? item : item.path}`);
  };

  console.log('');
  report('Remove', remove);
  report('Keep (modified since install)', keepModified);
  report('Keep (protected path)', keepProtected);
  report('Remove (generated build output)', generated);
  report('Already absent', absent);

  if (opts.dryRun === true) {
    console.log('');
    console.log('   Dry run: nothing was deleted.');
    if (kept.length) {
      console.log('   Left behind afterwards:');
      for (const item of kept) console.log(`     ${item.path}  (${item.why})`);
    }
    return { ok: true, dryRun: true, removed: remove.length, keptModified: keepModified.length };
  }

  let removed = 0;
  for (const rel of remove) {
    try { unlinkSync(join(targetDir, rel)); removed += 1; } catch { /* locked or gone */ }
  }

  for (const rel of generated) {
    const full = join(targetDir, rel);
    try {
      for (const child of readdirSync(full, { withFileTypes: true })) {
        if (child.isFile()) unlinkSync(join(full, child.name));
      }
      rmdirSync(full);
    } catch { /* not empty: a build wrote outside our files */ }
  }

  // Directories the install created, now empty. Deepest first, and computed
  // after the deletions: an empty check before them always answers "not empty".
  const emptied = emptyInstallDirs(record, { targetDir });
  for (const rel of [...emptied, ...generated].sort((a, b) => b.split('/').length - a.split('/').length)) {
    try { rmdirSync(join(targetDir, rel)); } catch { /* still in use */ }
  }
  for (const rel of remove) removeEmptyAncestors(join(targetDir, rel));

  // The record is deleted last: until every file it names is gone, it is the
  // proof of what this run was permitted to touch.
  try { unlinkSync(recordPath); } catch { /* already gone */ }
  // With the record gone, `.cadet/agent` and `.cadet` may now be empty. The walk
  // stops at the first directory that still holds user data.
  removeEmptyAncestors(recordPath);

  console.log('');
  console.log(`✅ Removed ${removed} files.`);
  if (keepModified.length) {
    console.log(`   Kept ${keepModified.length} modified files — review them, then delete by hand.`);
  }
  if (kept.length) {
    console.log('   Left behind:');
    for (const item of kept) console.log(`     ${item.path}  (${item.why})`);
  }
  if ((record.components || []).includes('engine.unreal.plugin')) {
    console.log('   Unreal: close the editor, then reopen the project to drop the module.');
  }
  console.log('   Review the deletion with `git status`, and commit it yourself.');
  console.log('');

  return {
    ok: true,
    removed,
    keptModified: keepModified,
    keptProtected: keepProtected,
    leftovers: kept,
  };
}
