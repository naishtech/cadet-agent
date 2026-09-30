/**
 * Gate builder registry (contract C14) — the evidence contract of every gate.
 *
 * What this file proves, and why each part is here:
 *
 *   1. The registry is coherent: one contract per gate, every gate covered, every
 *      coverage claim derived rather than restated.
 *   2. The bypass that motivated the registry is CLOSED at the CLI: an arbitrary
 *      exit-zero command cannot satisfy an agent-owned, human-owned, or
 *      specialized gate, and it cannot invent a gate name.
 *   3. The workflows that must keep working, keep working: a project command
 *      still fills the four slots whose evidence IS a project command.
 *   4. A record is bound to the gate's contract version, so a change to the
 *      builder's rules refuses the old records instead of silently re-reading
 *      them.
 *
 * Every negative case asserts on a NON-zero exit and on the state file being
 * byte-identical, because a refusal that still wrote would be worse than none.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  GATES, PHASES, requiredGates, conditionalEdgeGates, MANUAL_ONLY_GATES, gateBuilder, gateContractId,
  auditGateRegistry, describeGateRefusal, gatesAcceptingProjectCommand, manualOnlyGateNames,
  createEvidence, evidenceFreshness, evaluateTransition,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, { cwd = repoRoot } = {}) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-gates-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 2,
    stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: {},
    gateEvidence: [],
    changeHistory: [],
  }, null, 2));
  return dir;
}

function stateBytes(dir) {
  return readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
}

function jsonOf(res) {
  // `fail()` writes its JSON to stderr, the recorder to stdout: read both rather
  // than depending on which side the command answered from.
  for (const stream of [res.stdout, res.stderr]) {
    try {
      const value = JSON.parse(stream);
      if (value && typeof value === 'object') return value;
    } catch { /* try the next stream */ }
  }
  return null;
}

const ZERO_EXIT = 'node -e "process.exit(0)"';

describe('gate registry — the contract is declared once', () => {
  it('is coherent', () => {
    assert.deepEqual(auditGateRegistry(), []);
  });

  it('covers every gate and invents none', () => {
    const registered = GATES.filter((g) => gateBuilder(g));
    assert.deepEqual(registered, [...GATES]);
    for (const gate of GATES) assert.ok(gateBuilder(gate), `${gate} has no contract`);
  });

  it('gives no gate a contract that no transition can require', () => {
    // Derived from `requiredGates` rather than read off `TRANSITIONS`, because one
    // gate is appended at evaluation time instead of declared in the table: the
    // reachability gate joins `review -> validation` only when the repository has
    // opted in (C4). Asking every phase both ways covers the table and the append.
    const required = new Set();
    for (const phase of PHASES) {
      for (const optedIn of [false, true]) {
        const spec = requiredGates(phase, { reachability: optedIn, humanAcceptance: optedIn, architectureFitness: optedIn });
        if (!spec) continue;
        for (const gate of spec.gates) required.add(gate);
        for (const gate of spec.revalidate || []) required.add(gate);
      }
    }
    // The conditional one: a gate on an edge with no `TRANSITIONS` entry is still a
    // requirement, and the design-review gate lives exactly there.
    for (const gate of conditionalEdgeGates('architectureComplete', 'story-breakdown', { designReview: { enabled: true } })) {
      required.add(gate);
    }
    const orphans = GATES.filter((gate) => !required.has(gate));
    assert.deepEqual(orphans, [], `gates required by no transition: ${orphans.join(', ')}`);
  });

  it('derives the two gate groupings instead of restating them', () => {
    assert.deepEqual(gatesAcceptingProjectCommand(), [
      'testsPassed', 'storyTrackingUpdated', 'compileCheckConfirmed', 'unityAnalyzerClean',
    ]);
    // Gates with no automated builder: a reviewer's judgement, or a person's own
    // acceptance. Same route, different owner, and the derivation must not drop
    // either kind.
    assert.deepEqual(manualOnlyGateNames(), [
      'codeReviewCompleted', 'securityReviewPassed', 'designArtifactSyncConfirmed',
      'humanAcceptanceConfirmed',
    ]);
  });

  it('agrees with the policy list of gates that have no automated builder', () => {
    // `MANUAL_ONLY_GATES` decides which gates `disallowManualFor` refuses; the
    // registry decides each gate's owner. They describe one fact, so they must
    // name the same gates in the same order.
    assert.deepEqual([...MANUAL_ONLY_GATES], manualOnlyGateNames());
  });

  it('names the gate and the version in a contract id', () => {
    assert.equal(gateContractId('testsPassed'), 'testsPassed@1');
    assert.equal(gateContractId('notAGate'), null);
  });

  it('refuses in one sentence that names the path which does work', () => {
    assert.match(describeGateRefusal('codeReviewCompleted'), /agent-owned/);
    assert.match(describeGateRefusal('acceptanceCriteriaValidated'), /harness verify-acs --story <path>/);
    assert.match(describeGateRefusal('reachabilityAddressed'), /harness verify-reachability --story <path>/);
    assert.match(describeGateRefusal('designArtifactSyncConfirmed'), /harness reconcile/);
    assert.match(describeGateRefusal('totallyMadeUpGate'), /unknown gate/);
  });
});

describe('gate registry — the CLI cannot be talked into a claim', () => {
  for (const gate of ['codeReviewCompleted', 'securityReviewPassed', 'designArtifactSyncConfirmed',
    'acceptanceCriteriaValidated', 'reachabilityAddressed', 'designReviewCompleted']) {
    it(`refuses an arbitrary command for ${gate}`, () => {
      const dir = makeProject();
      try {
        const before = stateBytes(dir);
        const res = runCli(['harness', 'verify', '--gate', gate, '--command', ZERO_EXIT,
          '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
        assert.equal(res.status, 1, `expected a refusal, got exit ${res.status}: ${res.stdout}${res.stderr}`);
        assert.equal(jsonOf(res)?.code, 'gate-not-overridable');
        assert.equal(stateBytes(dir), before, 'a refused command must not touch state.json');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }

  it('refuses a gate name that does not exist', () => {
    const dir = makeProject();
    try {
      const before = stateBytes(dir);
      const res = runCli(['harness', 'verify', '--gate', 'totallyMadeUpGate', '--command', ZERO_EXIT,
        '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(jsonOf(res)?.code, 'unknown-gate');
      assert.equal(stateBytes(dir), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a missing gate name in the same shape', () => {
    const res = runCli(['harness', 'verify', '--files', 'src/a.mjs', '--format', 'json']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /requires --gate/);
  });

  it('still refuses, and says why, when no command is supplied at all', () => {
    const dir = makeProject();
    try {
      const res = runCli(['harness', 'verify', '--gate', 'codeReviewCompleted',
        '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.match(jsonOf(res)?.reason || '', /agent-owned/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('gate registry — the workflows that work keep working', () => {
  it('accepts a project command for testsPassed, red before green', () => {
    const dir = makeProject();
    try {
      const red = runCli(['harness', 'verify', '--gate', 'testsPassed',
        '--command', 'node -e "process.exit(3)"', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(red.status, 1);
      const green = runCli(['harness', 'verify', '--gate', 'testsPassed',
        '--command', ZERO_EXIT, '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(green.status, 0, green.stdout + green.stderr);
      assert.equal(jsonOf(green)?.status, 'passed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts a project command for the tracking gate, which has no default', () => {
    const dir = makeProject();
    try {
      const res = runCli(['harness', 'verify', '--gate', 'storyTrackingUpdated',
        '--command', ZERO_EXIT, '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stdout + res.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('explains the missing command for the tracking gate instead of calling it agent-owned', () => {
    const dir = makeProject();
    try {
      const res = runCli(['harness', 'verify', '--gate', 'storyTrackingUpdated',
        '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.match(jsonOf(res)?.reason || '', /has no default command/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('gate registry — a record is bound to its contract', () => {
  const workItemId = 'epic-1::story-1.md';

  function record(gate, { contract } = {}) {
    const base = createEvidence({
      evidenceId: randomUUID(),
      workItemId,
      phase: 'implementation',
      gate,
      status: 'passed',
      command: 'node -e "process.exit(0)"',
      result: 'exit 0',
      exitCode: 0,
      inputTreeHash: 'a'.repeat(64),
      relevantFiles: ['src/a.mjs'],
      createdAt: new Date('2026-09-30T00:00:00.000Z'),
    });
    return contract === undefined ? base : { ...base, gateContract: contract };
  }

  const implementationGates = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated'];

  function stateWith(records) {
    return {
      version: 4,
      stateVersion: 4,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
      gates: Object.fromEntries(implementationGates.map((g) => [g, true])),
      gateEvidence: records,
      changeHistory: [],
    };
  }

  it('stamps automated evidence with the current contract and manual records with none', () => {
    assert.equal(record('testsPassed').gateContract, 'testsPassed@1');
    const manual = createEvidence({
      evidenceId: randomUUID(), workItemId, phase: 'review', gate: 'securityReviewPassed',
      status: 'manual-confirmation', command: null, result: null, inputTreeHash: 'a'.repeat(64),
      relevantFiles: [], createdAt: new Date('2026-09-30T00:00:00.000Z'), source: 'manual-confirmation',
    });
    assert.equal(manual.gateContract, null);
  });

  it('treats a record written under an earlier contract as stale, and an undeclared contract as usable', () => {
    const current = 'testsPassed@1';
    const differing = evidenceFreshness({ ...record('testsPassed'), gateContract: 'testsPassed@0' }, { gateContract: current });
    assert.equal(differing.fresh, false);
    assert.match(differing.reasons.join(' '), /gate contract "testsPassed@0", not the current "testsPassed@1"/);

    const undeclared = evidenceFreshness({ ...record('testsPassed'), gateContract: null }, { gateContract: current });
    assert.equal(undeclared.fresh, true, 'evidence predating the field must not be retroactively invalidated');
  });

  it('blocks the transition when the gate contract moved under the evidence', () => {
    const dir = makeProject();
    try {
      const records = implementationGates.map((gate) => record(gate));
      const allowed = evaluateTransition(stateWith(records), 'review', { rootDir: dir, computeFreshness: false });
      assert.equal(allowed.allowed, true, JSON.stringify(allowed));

      const moved = records.map((r) => (r.gate === 'testsPassed' ? { ...r, gateContract: 'testsPassed@0' } : r));
      const refused = evaluateTransition(stateWith(moved), 'review', { rootDir: dir, computeFreshness: false });
      assert.equal(refused.allowed, false);
      assert.deepEqual(refused.missingGates, ['testsPassed']);
      assert.match(JSON.stringify(refused.staleEvidence), /testsPassed@0/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
