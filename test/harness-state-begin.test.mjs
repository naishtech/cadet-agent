/**
 * `cadet-agent state begin` — the story boundary, as a command.
 *
 * The boundary used to be a sentence in `Resume` ("set `activeWorkItem`, reset
 * gates") that an agent carried out by editing state.json by hand. The sentence
 * never mentioned evidence, and `resetGatesForNewWorkItem` — which clears it
 * correctly — had no caller, so a previous story's records stayed inline for ever
 * where no gate could read them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { COMMANDS, describeCommand } from '../src/harness/commands.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

function evidenceRecord(workItemId) {
  return {
    evidenceId: '11111111-1111-4111-8111-111111111111',
    workItemId,
    acceptanceCriterionId: null,
    phase: 'validation',
    gate: 'testsPassed',
    status: 'passed',
    command: 'npm test',
    result: 'exit 0',
    exitCode: 0,
    artifactPath: null,
    artifactHash: null,
    inputTreeHash: 'a'.repeat(64),
    criteriaHash: 'b'.repeat(64),
    relevantFiles: ['src/a.mjs'],
    toolVersion: null,
    commit: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    expiresAt: null,
    freshnessPolicy: { scope: 'story' },
    supersededBy: null,
    source: 'automated',
  };
}

/** A v4 project mid-story, with one record for the work item just finished. */
function project({ phase = 'validation', active = { epicId: 'epic-1', storyId: 'story-1.md' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-state-begin-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  const workItemId = `${active.epicId}::${active.storyId}`;
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 4,
    stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: active,
    activeRunId: null,
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'done', 'story-2.md': 'planned' } } },
    gates: { testsPassed: true },
    gateEvidence: [evidenceRecord(workItemId)],
    evidenceCoverage: {},
    gateExceptions: [],
    lastTransition: { from: 'review', to: 'validation', at: '2026-09-20T00:00:00.000Z', evidenceIds: [] },
    spikes: {},
    changeHistory: [],
  }, null, 2) + '\n', 'utf-8');
  return dir;
}

function run(dir, args) {
  const r = spawnSync(process.execPath, [CLI, 'state', 'begin', '--target', dir, '--format', 'json', ...args], { encoding: 'utf-8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { try { json = JSON.parse(r.stderr); } catch { /* text */ } }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

const readState = (dir) => JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
const archiveDir = (dir) => join(dir, '.cadet', 'archive', 'evidence');

describe('state begin — the story boundary', () => {
  it('resets gates, archives the outgoing evidence, and folds it into the coverage index', () => {
    const dir = project();
    try {
      const res = run(dir, ['--epic', 'epic-1', '--story', 'story-2.md']);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.from, 'epic-1::story-1.md');
      assert.equal(res.json.to, 'epic-1::story-2.md');
      assert.equal(res.json.archived, 1);

      const state = readState(dir);
      assert.deepEqual(state.activeWorkItem, { epicId: 'epic-1', storyId: 'story-2.md' });
      assert.ok(Object.keys(state.gates).length > 0, 'gates are reset to false, not removed');
      assert.equal(Object.values(state.gates).every((v) => v === false), true, 'every gate is reset');
      assert.deepEqual(state.gateEvidence, [], 'the previous work item holds nothing inline');
      assert.equal(state.evidenceCoverage['epic-1::story-1.md'].recordCount, 1, 'the outgoing records are indexed, not lost');
      assert.match(
        (state.changeHistory || []).map((e) => e.change).join('\n'),
        /Gates reset for new work item epic-1::story-2\.md/,
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('archives the outgoing records, so the boundary is never indistinguishable from evidence loss', () => {
    const dir = project();
    try {
      const res = run(dir, ['--epic', 'epic-1', '--story', 'story-2.md']);
      assert.equal(res.status, 0, res.stderr);

      assert.ok(existsSync(archiveDir(dir)), 'the archive directory must exist');
      const files = readdirSync(archiveDir(dir));
      assert.equal(files.length, 1, `expected one archive file, got ${files.join(', ')}`);
      const lines = readFileSync(join(archiveDir(dir), files[0]), 'utf-8').trim().split('\n');
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).evidenceId, '11111111-1111-4111-8111-111111111111');
      assert.ok(res.json.archivePaths.length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves a document the tool itself still accepts', () => {
    const dir = project();
    try {
      assert.equal(run(dir, ['--epic', 'epic-1', '--story', 'story-2.md']).status, 0);
      const validate = spawnSync(process.execPath, [CLI, 'state', 'validate', '--target', dir, '--format', 'json'], { encoding: 'utf-8' });
      assert.equal(validate.status, 0, validate.stdout + validate.stderr);
      assert.equal(JSON.parse(validate.stdout).valid, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a target that is already the active work item, and writes nothing', () => {
    const dir = project();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = run(dir, ['--epic', 'epic-1', '--story', 'story-1.md']);
      assert.equal(res.status, 1);
      assert.equal(res.json.code, 'already-active');
      assert.equal(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'), before);
      assert.equal(existsSync(archiveDir(dir)), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses when the session is closed', () => {
    // `closed` is terminal: Resume says new work starts from a fresh session
    // (context-resolution), not by beginning a work item inside a finished plan.
    const dir = project({ phase: 'closed' });
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = run(dir, ['--epic', 'epic-1', '--story', 'story-2.md']);
      assert.equal(res.status, 1);
      assert.equal(res.json.code, 'session-closed');
      assert.equal(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('requires both --epic and --story', () => {
    const dir = project();
    try {
      assert.equal(run(dir, ['--story', 'story-2.md']).status, 1);
      assert.equal(run(dir, ['--epic', 'epic-1']).status, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('honours --dry-run and writes nothing', () => {
    // The global dry-run interception covers every registered mutating command,
    // so this is really a check that `state begin` is registered correctly.
    const dir = project();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = run(dir, ['--epic', 'epic-1', '--story', 'story-2.md', '--dry-run']);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'), before);
      assert.equal(existsSync(archiveDir(dir)), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('state begin — command registry (C13)', () => {
  it('declares that it writes, and which paths', () => {
    const described = describeCommand('state begin');
    assert.ok(described, 'state begin must be registered');
    assert.equal(described.mutates, true);
    assert.ok(described.writes.includes('.cadet/state.json'));
    assert.ok(described.writes.some((p) => p.startsWith('.cadet/archive')));
  });

  it('needs no confirmation flag: its bound is the work item it names', () => {
    assert.equal(COMMANDS['state begin'].unattended, true);
    assert.deepEqual(COMMANDS['state begin'].requiresForUnattended || [], []);
  });
});
