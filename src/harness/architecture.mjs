/**
 * Architecture fitness — executable constraints, and the line between them and a review.
 *
 * A project declares checks: dependency direction, a forbidden reference, a layer that may
 * not import another. Each check is a command with a stable id, the files it governs, a
 * severity, and optionally an artifact it must write. This module answers the three
 * questions the gate needs:
 *
 *   1. which checks apply to the files that changed (`applicableChecks`);
 *   2. what each applicable check proved (`runArchitectureChecks`);
 *   3. does the set of results satisfy the gate (`summariseChecks`).
 *
 * What it deliberately does NOT do: decide whether the architecture is good. A command can
 * prove that `using UnityEngine` is absent from a core assembly; it cannot prove the assembly
 * was a good idea. That question belongs to `designReviewCompleted`, and the two gates are
 * separate so that neither claim borrows the other's credibility.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { runCommand } from './verification.mjs';
import { sha256 } from './util.mjs';

/** Default time a single check may run, when the check declares none. */
export const DEFAULT_CHECK_TIMEOUT_MS = 120000;

/** Every outcome a single check can reach. */
export const CHECK_STATUSES = Object.freeze(['passed', 'failed', 'blocked']);

const normalise = (path) => String(path).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Does a scope govern a path? Compared at a directory boundary.
 *
 * `src/Core` governs `src/Core/EnemyGrid.cs` and does NOT govern `src/CoreX/Other.cs`. A
 * plain `startsWith` would say yes to the second, and a check that silently governs the
 * wrong directory is worse than one that governs nothing: it reports a pass for files it
 * never looked at.
 */
export function scopeMatches(scope, path) {
  const prefix = normalise(scope).replace(/\/+$/, '');
  const target = normalise(path);
  return target === prefix || target.startsWith(`${prefix}/`);
}

/**
 * The checks that apply to a set of files, and the ones that do not.
 *
 * A check with no `files` always applies: it is a constraint on the repository rather than
 * on a directory. A check with scopes applies when any relevant file is under one of them.
 */
export function applicableChecks(checks = [], relevantFiles = []) {
  const applicable = [];
  const skipped = [];
  for (const check of checks) {
    const scopes = Array.isArray(check?.files) ? check.files : [];
    const applies = scopes.length === 0 || relevantFiles.some((file) => scopes.some((scope) => scopeMatches(scope, file)));
    (applies ? applicable : skipped).push(check);
  }
  return { applicable, skipped };
}

/**
 * Run the applicable checks and classify each outcome.
 *
 * The classification matters more than the runner:
 *
 *   - `failed` — the check ran and reported a violation (non-zero exit).
 *   - `blocked` — the check never completed: it timed out, it never launched, or it
 *     declared an artifact it did not write (or wrote unparseable JSON into). A blocked
 *     REQUIRED check does not satisfy the gate, and it is not a red: nothing was disproved.
 *     The framework draws the same line for `harness verify`, and drawing it the other way
 *     here would report a green tree as broken and a broken check as green.
 */
export async function runArchitectureChecks({
  checks = [],
  relevantFiles = [],
  rootDir = process.cwd(),
  defaultTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  runCommandImpl = runCommand,
  evidenceDir = null,
} = {}) {
  const { applicable, skipped } = applicableChecks(checks, relevantFiles);
  const results = [];

  for (const check of applicable) {
    const timeoutMs = check.timeoutMs ?? defaultTimeoutMs;
    const run = await runCommandImpl(check.command, {
      cwd: resolve(rootDir, check.cwd || '.'),
      timeoutMs,
      maxInlineBytes: 16000,
      previewBytes: 2000,
      artifactDir: evidenceDir,
    });

    let status = 'passed';
    let reason = null;
    if (run.timedOut) {
      status = 'blocked';
      reason = `timed out after ${timeoutMs}ms`;
    } else if (run.launchFailed) {
      status = 'blocked';
      reason = `the command never launched (${run.launchFailureReason || 'unknown reason'})`;
    } else if (run.exitCode !== 0) {
      status = 'failed';
      reason = `exit ${run.exitCode}`;
    }

    let artifactPath = null;
    let artifactHash = null;
    if (check.artifact) {
      const absolute = resolve(rootDir, check.artifact);
      if (!existsSync(absolute)) {
        status = status === 'passed' ? 'blocked' : status;
        reason = `${reason ? `${reason}; ` : ''}the check declared an artifact at ${check.artifact} and wrote none`;
      } else {
        const text = readFileSync(absolute, 'utf-8');
        artifactPath = normalise(check.artifact);
        artifactHash = sha256(text);
        if (check.artifactFormat === 'json') {
          try {
            JSON.parse(text);
          } catch (err) {
            status = status === 'passed' ? 'blocked' : status;
            reason = `${reason ? `${reason}; ` : ''}the artifact is not valid JSON (${err.message})`;
          }
        }
      }
    }

    results.push({
      id: check.id,
      severity: check.severity || 'required',
      status,
      command: check.command,
      cwd: check.cwd || '.',
      exitCode: run.exitCode ?? null,
      reason,
      durationMs: run.durationMs ?? null,
      artifactPath,
      artifactHash,
      refs: [...(check.refs || [])],
    });
  }

  return { results, skipped: skipped.map((c) => c.id) };
}

/**
 * The verdict: does this set of results satisfy the gate?
 *
 * A required check that failed or was blocked does not. An advisory check that failed does
 * not block the gate — that is what advisory means — but it is reported in the summary and
 * written into the record, because an advisory result nobody reads is the same as no check
 * at all.
 */
export function summariseChecks(results = [], { declared = 0, skipped = [] } = {}) {
  const byId = (status, severity) => results
    .filter((r) => r.status === status && (severity === undefined || r.severity === severity))
    .map((r) => r.id);

  const failed = byId('failed', 'required');
  const blocked = byId('blocked', 'required');
  const advisoryFailed = [...byId('failed', 'advisory'), ...byId('blocked', 'advisory')];
  const passed = byId('passed');

  const notes = [];
  if (results.length === 0) {
    notes.push(declared === 0
      ? 'the project declares no architecture checks, so nothing was verified'
      : `no check was applicable to the changed files (${skipped.length} declared check(s) skipped)`);
  }
  if (advisoryFailed.length > 0) {
    notes.push(`advisory check(s) did not pass and do not block: ${advisoryFailed.join(', ')}`);
  }
  if (blocked.length > 0) {
    notes.push(`required check(s) could not complete: ${blocked.join(', ')}`);
  }

  return {
    gatePassed: failed.length === 0 && blocked.length === 0,
    passed,
    failed,
    blocked,
    advisoryFailed,
    skipped,
    note: notes.join('; '),
  };
}

/** A one-line-per-check reading for a human, and for `describe*`-style refusals. */
export function describeCheckResults(results = [], summary = null) {
  const lines = results.map((r) => {
    const mark = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⚠️';
    const refs = r.refs?.length ? ` (${r.refs.join(', ')})` : '';
    return `  ${mark} ${r.id} [${r.severity}] ${r.status}${r.reason ? ` — ${r.reason}` : ''}${refs}`;
  });
  if (summary?.skipped?.length) lines.push(`  ⏭  skipped, not applicable: ${summary.skipped.join(', ')}`);
  return lines;
}
