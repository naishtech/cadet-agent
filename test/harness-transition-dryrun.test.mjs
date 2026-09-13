import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { evaluateTransition, applyTransition, StateError } from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A v2 state in the given phase, with optional gate evidence. */
function stateIn(phase, extra = {}) {
  return {
    version: 2, stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
    ...extra,
  };
}

function makeProject(stateDoc) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-dryrun-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(stateDoc, null, 2));
  return dir;
}

// ── `state transition --dry-run` must not write ──────────────────────────────

describe('state transition --dry-run', () => {
  it('leaves state.json byte-identical', () => {
    const dir = makeProject(stateIn('implementation'));
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = runCli(['state', 'transition', '--to', 'review', '--dry-run', '--target', dir, '--format', 'json']);
      const after = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      assert.equal(after, before, 'a documented dry check must not modify state.json');
      assert.equal(res.status, 1, 'missing gates must still be reported as a rejection');
      const out = JSON.parse(res.stdout);
      assert.equal(out.allowed, false);
      assert.ok(out.missingGates.length > 0);
      assert.equal(out.dryRun, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports a satisfiable transition as allowed without applying it', () => {
    const dir = makeProject(stateIn('context-resolution'));
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = runCli(['state', 'transition', '--to', 'requirements', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.allowed, true);
      assert.equal(out.applied, false);
      const after = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      assert.equal(after, before, 'dry-run must not apply an allowed transition either');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not append a changeHistory entry', () => {
    const dir = makeProject(stateIn('context-resolution'));
    try {
      runCli(['state', 'transition', '--to', 'requirements', '--dry-run', '--target', dir, '--format', 'json']);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.changeHistory.length, 0);
      assert.equal(state.session.currentPhase, 'context-resolution');
      assert.equal(state.lastTransition, undefined);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still applies for real when --dry-run is absent', () => {
    const dir = makeProject(stateIn('context-resolution'));
    try {
      const res = runCli(['state', 'transition', '--to', 'requirements', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.session.currentPhase, 'requirements');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── Legal-transition guard ────────────────────────────────────────────────────

describe('transition guard — illegal backward transitions', () => {
  it('rejects closed → implementation', () => {
    const r = evaluateTransition(stateIn('closed'), 'implementation');
    assert.equal(r.allowed, false, 'closed is terminal; leaving it requires an explicit new work item');
    assert.ok(r.errors.length > 0);
  });

  it('rejects closed → requirements', () => {
    const r = evaluateTransition(stateIn('closed'), 'requirements');
    assert.equal(r.allowed, false);
  });

  it('rejects implementation → requirements (backward)', () => {
    const r = evaluateTransition(stateIn('implementation'), 'requirements');
    assert.equal(r.allowed, false);
    assert.ok(r.errors.some((e) => /illegal transition/i.test(e)));
  });

  it('rejects review → implementation (backward)', () => {
    const r = evaluateTransition(stateIn('review'), 'implementation');
    assert.equal(r.allowed, false);
  });

  it('applyTransition throws rather than writing a rejected transition', () => {
    assert.throws(() => applyTransition(stateIn('closed'), 'implementation'), StateError);
  });

  it('still allows the bootstrap edge context-resolution → requirements', () => {
    assert.equal(evaluateTransition(stateIn('context-resolution'), 'requirements').allowed, true);
  });

  it('still allows context-resolution → implementation (small change)', () => {
    assert.equal(evaluateTransition(stateIn('context-resolution'), 'implementation').allowed, true);
  });

  it('still allows the documented forward planning edges', () => {
    // Per the workflow, story-breakdown follows architectureComplete, not architecture.
    assert.equal(evaluateTransition(stateIn('requirements'), 'architecture').allowed, true);
    assert.equal(evaluateTransition(stateIn('architecture'), 'architectureComplete').allowed, true);
    assert.equal(evaluateTransition(stateIn('architectureComplete'), 'story-breakdown').allowed, true);
    assert.equal(evaluateTransition(stateIn('story-breakdown'), 'implementation').allowed, true);
  });
});
