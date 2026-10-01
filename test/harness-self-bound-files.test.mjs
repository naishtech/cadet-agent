/**
 * Contract C13 — a command may not bind its own outputs as the evidence it records.
 *
 * Written after the defect was reproduced in a consumer on 2026-10-01, and before the fix.
 * The defect: `--files` is hashed into the evidence record's `inputTreeHash`, and
 * `harness verify` / `harness confirm` then write `.cadet/state.json` and the run ledger.
 * A record that binds one of those is stale at the instant it is created — the write it
 * describes changes a file the hash covers — so `state transition --dry-run` refuses the
 * boundary with *"input tree hash changed since the evidence was recorded"*, for a record
 * the harness itself just wrote. On the consumer the gate had to be re-recorded twice.
 *
 * The tests are in two halves, and both are needed. The unit half pins the matcher against
 * every pattern shape the registry actually uses, GENERATED from the registry rather than
 * retyped, so a new command with a new shape is covered. The CLI half proves the refusal
 * happens before any handler runs, and that a legitimate `--files` is still accepted — a
 * refusal test with no positive control passes just as well when the command is broken for
 * every input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { COMMANDS, selfBoundFiles } from '../src/harness/commands.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

/** A minimal project tree: a state document, a source file, nothing else. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-self-bound-'));
  mkdirSync(join(dir, '.cadet', 'runs'), { recursive: true });
  writeFileSync(join(dir, 'src-a.txt'), 'contents\n', 'utf-8');
  writeFileSync(join(dir, 'story-1.md'), '# story\n', 'utf-8');
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 4,
    stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    epics: {},
    gates: {},
    gateEvidence: [],
    activeRunId: null,
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    lastTransition: null,
    spikes: {},
    changeHistory: [],
  }, null, 2) + '\n', 'utf-8');
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
}

describe('selfBoundFiles (the registry-driven matcher)', () => {
  it('refuses the state document for a command that writes it', () => {
    assert.deepEqual(selfBoundFiles('harness verify', ['.cadet/state.json']), ['.cadet/state.json']);
    assert.deepEqual(selfBoundFiles('harness confirm', ['.cadet/state.json']), ['.cadet/state.json']);
    assert.deepEqual(selfBoundFiles('harness verify-acs', ['.cadet/state.json']), ['.cadet/state.json']);
  });

  it('refuses the ledger, at any depth under the run directory', () => {
    assert.deepEqual(
      selfBoundFiles('harness verify', ['.cadet/runs/abc.json', '.cadet/runs/architecture/x.json']),
      ['.cadet/runs/abc.json', '.cadet/runs/architecture/x.json'],
    );
  });

  it('names only the offending entries when the list is mixed', () => {
    assert.deepEqual(
      selfBoundFiles('harness verify', ['src-a.txt', '.cadet/state.json', 'story-1.md']),
      ['.cadet/state.json'],
    );
  });

  it('normalises a backslash path and a leading ./ before matching', () => {
    const windowsSep = String.fromCharCode(92);
    const windows = `.${windowsSep}.cadet${windowsSep}state.json`;
    assert.deepEqual(selfBoundFiles('harness verify', [windows]), [windows]);
    assert.deepEqual(selfBoundFiles('harness verify', ['./.cadet/state.json']), ['./.cadet/state.json']);
  });

  it('refuses nothing for a read-only command, whose declaration is empty', () => {
    // The check is derived from the registry, not hardcoded: a command that declares no
    // writes cannot own a path, so the same input is accepted.
    assert.deepEqual(selfBoundFiles('harness report', ['.cadet/state.json']), []);
    assert.deepEqual(selfBoundFiles('harness changes', ['.cadet/runs/abc.json']), []);
  });

  it('bounds `*` to one directory segment and `**` across many', () => {
    // `*.coverage.json` is a root-level suffix wildcard, so a nested file of the same name
    // is NOT the command's output — a matcher that let `*` cross directories would refuse
    // a path the command never writes.
    assert.deepEqual(selfBoundFiles('harness verify-acs', ['x.coverage.json']), ['x.coverage.json']);
    assert.deepEqual(selfBoundFiles('harness verify-acs', ['nested/x.coverage.json']), []);
  });

  it('covers every pattern shape the registry actually declares', () => {
    // GENERATED from the table, so a new command with a new shape is covered the moment it
    // is registered rather than when someone remembers to add a case here.
    const offenders = [];
    for (const [key, entry] of Object.entries(COMMANDS)) {
      for (const pattern of entry.writes || []) {
        const sample = pattern.replace(/\*\*/g, 'a/b').replace(/\*/g, 'a');
        const matched = selfBoundFiles(key, [sample]);
        if (matched.length !== 1) offenders.push(`${key} :: ${pattern} -> ${sample}`);
      }
    }
    assert.deepEqual(offenders, [], 'a declared write pattern that never matches its own shape');
  });
});

describe('the refusal, at the CLI surface', () => {
  it('refuses `harness confirm --files .cadet/state.json` before any handler runs', () => {
    const dir = project();
    const res = run([
      'harness', 'confirm', '--gate', 'codeReviewCompleted',
      '--reason', 'x', '--scope', 'a', '--files', '.cadet/state.json', '--format', 'json',
    ], dir);

    assert.equal(res.status, 1);
    const payload = JSON.parse(res.stderr);
    assert.equal(payload.code, 'self-bound-files');
    assert.deepEqual(payload.files, ['.cadet/state.json']);
    assert.match(payload.error, /writes itself/);
  });

  it('refuses `harness verify --files` naming the run ledger', () => {
    const dir = project();
    const res = run([
      'harness', 'verify', '--gate', 'testsPassed',
      '--files', '.cadet/runs/abc.json', '--format', 'json',
    ], dir);

    assert.equal(res.status, 1);
    assert.equal(JSON.parse(res.stderr).code, 'self-bound-files');
  });

  it('refuses `harness verify-architecture --files .cadet/state.json` too', () => {
    // The third resolver of `--files`. It is covered because the check lives in the
    // dispatcher rather than in each handler.
    const dir = project();
    const res = run([
      'harness', 'verify-architecture', '--files', '.cadet/state.json', '--format', 'json',
    ], dir);

    assert.equal(res.status, 1);
    assert.equal(JSON.parse(res.stderr).code, 'self-bound-files');
  });

  it('accepts a legitimate list, and refuses for another reason or none at all', () => {
    // The positive control. Without it, a refusal that fired for EVERY input would pass
    // all three tests above. This asserts the absence of the refusal, not a passing gate:
    // the project declares no test command, so the command still fails — for a different
    // reason, which is the point.
    const dir = project();
    const res = run([
      'harness', 'verify', '--gate', 'testsPassed',
      '--files', 'src-a.txt,story-1.md', '--format', 'json',
    ], dir);

    const output = `${res.stdout}${res.stderr}`;
    assert.doesNotMatch(output, /writes itself/);
    assert.doesNotMatch(output, /self-bound-files/);
  });
});
