/**
 * Contract v3 §5 — `cadet-agent harness confirm`.
 *
 * Written before the implementation (TDD red). The command is the first-class
 * path for manual evidence; these tests pin the behaviour that makes it safer
 * than hand-editing state.json, and — importantly — that it refuses to write
 * when strict-closure metadata is incomplete.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

/** A minimal project tree with state.json and an optional harness.json. */
function project({ harness = null, gates = {}, phase = 'implementation' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-confirm-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  writeFileSync(join(dir, 'src-a.txt'), 'contents\n', 'utf-8');
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 3,
    stateVersion: 3,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    activeRunId: null,
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates,
    gateEvidence: [],
    lastTransition: null,
    spikes: {},
    changeHistory: [],
  }, null, 2) + '\n', 'utf-8');
  if (harness) {
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(harness, null, 2) + '\n', 'utf-8');
  }
  return dir;
}

function runConfirm(dir, args) {
  const r = spawnSync(process.execPath, [CLI, 'harness', 'confirm', '--target', dir, '--format', 'json', ...args], {
    encoding: 'utf-8',
  });
  // On success the JSON payload goes to stdout; on refusal the CLI writes it to
  // stderr (the `fail()` convention shared with every other subcommand). Parse
  // both so a test can assert the error shape either way.
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* human output or empty */ }
  if (!json) {
    try { json = JSON.parse(r.stderr); } catch { /* human error output */ }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const FULL_META = [
  '--gate', 'compileCheckConfirmed',
  '--reason', 'Unity CLI unavailable in this environment; editor reports 0 errors',
  '--expires-at', new Date(Date.now() + 3600_000).toISOString(),
  '--environment', 'projectPath=E:/proj,editorVersion=6000.6.0f1',
  '--scope', 'Assets/Scripts/Game/SimulationHost.cs',
  '--files', 'src-a.txt',
];

describe('harness confirm — happy path', () => {
  it('records evidence, flips the gate, and writes both stores', () => {
    const dir = project();
    const { status, json } = runConfirm(dir, FULL_META);
    assert.equal(status, 0, `stderr: ${json ? JSON.stringify(json) : ''}`);
    assert.equal(json.ok, true);
    assert.ok(json.evidenceId, 'must return the new evidenceId');

    const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    assert.equal(state.gates.compileCheckConfirmed, true);
    const ev = state.gateEvidence.find((e) => e.evidenceId === json.evidenceId);
    assert.ok(ev, 'evidence must be in state.gateEvidence');
    assert.equal(ev.status, 'manual-confirmation');
    assert.match(ev.reason, /Unity CLI unavailable/);
    assert.deepEqual(ev.scope, ['Assets/Scripts/Game/SimulationHost.cs']);
    assert.equal(ev.environment.editorVersion, '6000.6.0f1');

    // The ledger entry must exist and reference the same evidence id.
    assert.ok(json.runId, 'must return a runId');
    const ledgerPath = join(dir, '.cadet', 'runs', `${json.runId}.json`);
    assert.ok(existsSync(ledgerPath), `ledger not written at ${ledgerPath}`);
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
    assert.ok(JSON.stringify(ledger).includes(json.evidenceId), 'ledger must reference the evidence');
  });

  it('supersedes prior passing evidence for the same gate rather than overwriting it', () => {
    const dir = project();
    const first = runConfirm(dir, FULL_META);
    assert.equal(first.status, 0);
    const second = runConfirm(dir, FULL_META);
    assert.equal(second.status, 0);

    const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    const prior = state.gateEvidence.find((e) => e.evidenceId === first.json.evidenceId);
    assert.equal(prior.status, 'superseded');
    assert.equal(prior.supersededBy, second.json.evidenceId);
    assert.equal(state.gateEvidence.length, 2, 'immutability: both records retained');
  });

  it('binds evidence to the files given by --files', () => {
    const dir = project();
    const { status, json } = runConfirm(dir, FULL_META);
    assert.equal(status, 0);
    const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    const ev = state.gateEvidence.find((e) => e.evidenceId === json.evidenceId);
    assert.equal(ev.relevantFiles[0], 'src-a.txt');
    assert.match(ev.inputTreeHash, /^[0-9a-f]{64}$/);
  });
});

describe('harness confirm — strict-closure refusals', () => {
  const strictHarness = { strictClosure: { enabled: true } };

  it('rejects a gate listed in disallowManualFor and points at automation', () => {
    const dir = project({ harness: strictHarness });
    const { status, json } = runConfirm(dir, [
      '--gate', 'testsPassed',
      '--reason', 'r', '--expires-at', new Date(Date.now() + 60_000).toISOString(),
      '--environment', 'tool=node', '--scope', 's', '--files', 'src-a.txt',
    ]);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error || '', /manual-confirmation is not permitted/);
  });

  it('rejects a manual confirmation with no --reason, naming the missing field', () => {
    const dir = project({ harness: strictHarness });
    const { status, json } = runConfirm(dir, [
      '--gate', 'compileCheckConfirmed',
      '--expires-at', new Date(Date.now() + 60_000).toISOString(),
      '--environment', 'tool=unity', '--scope', 's', '--files', 'src-a.txt',
    ]);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error || '', /reason/);
  });

  it('reports all missing metadata fields together', () => {
    const dir = project({ harness: strictHarness });
    const { status, json } = runConfirm(dir, ['--gate', 'compileCheckConfirmed', '--files', 'src-a.txt']);
    assert.equal(status, 1);
    const err = json.error || '';
    assert.ok(/reason/.test(err), err);
    assert.ok(/expires-at/.test(err), err);
    assert.ok(/environment/.test(err), err);
    assert.ok(/scope/.test(err), err);
  });

  it('rejects an expiry beyond maxValidityMs', () => {
    const dir = project({ harness: { strictClosure: { enabled: true, manualConfirmation: { maxValidityMs: 3600_000 } } } });
    const { status, json } = runConfirm(dir, [
      '--gate', 'compileCheckConfirmed',
      '--reason', 'r',
      '--expires-at', new Date(Date.now() + 10 * 86400_000).toISOString(),
      '--environment', 'tool=unity', '--scope', 's', '--files', 'src-a.txt',
    ]);
    assert.equal(status, 1);
    assert.match(json.error || '', /maxValidityMs|validity/);
  });

  it('does NOT write state or ledger when validation fails', () => {
    const dir = project({ harness: strictHarness });
    const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
    const { status } = runConfirm(dir, ['--gate', 'compileCheckConfirmed', '--files', 'src-a.txt']);
    assert.equal(status, 1);
    const after = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
    assert.equal(after, before, 'a refused confirm must not mutate state');
    const runsDir = join(dir, '.cadet', 'runs');
    assert.equal(existsSync(runsDir), false, 'a refused confirm must not write a ledger');
  });

  it('accepts the same metadata when strict closure is disabled', () => {
    const dir = project();
    const { status } = runConfirm(dir, [
      '--gate', 'compileCheckConfirmed',
      '--reason', 'r', '--expires-at', new Date(Date.now() + 60_000).toISOString(),
      '--environment', 'tool=unity', '--scope', 's', '--files', 'src-a.txt',
    ]);
    assert.equal(status, 0);
  });
});

describe('harness confirm — review fixes', () => {
  // These four tests were added after a review found the defects they cover.
  // Each one failed before its fix (red) and pins the corrected behaviour.

  it('F4: state validate enforces strictClosure from .cadet/harness.json', () => {
    // Before the fix, cmdState called validateState without loading the policy,
    // so strictClosure was silently ignored and a violating state reported
    // valid:true. The feature "installed cleanly and then did nothing".
    const dir = project({ harness: { strictClosure: { enabled: true } } });
    // A manual-confirmation record missing reason/expiresAt/environment/scope.
    const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    state.gates = { compileCheckConfirmed: true };
    state.gateEvidence = [{
      evidenceId: '11111111-1111-4111-8111-111111111111',
      workItemId: 'epic-1::story-1.md',
      acceptanceCriterionId: null,
      phase: 'implementation',
      gate: 'compileCheckConfirmed',
      status: 'manual-confirmation',
      command: null,
      result: 'legacy record',
      exitCode: null,
      artifactPath: null,
      artifactHash: null,
      inputTreeHash: 'a'.repeat(64),
      criteriaHash: null,
      relevantFiles: [],
      toolVersion: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      freshnessPolicy: null,
      supersededBy: null,
      source: 'manual-confirmation',
    }];
    writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));

    const r = spawnSync(process.execPath, [CLI, 'state', 'validate', '--target', dir, '--format', 'json'], { encoding: 'utf-8' });
    const out = JSON.parse(r.stdout);
    assert.equal(out.valid, false, 'strict closure must be enforced by state validate');
    assert.ok(out.errors.some((e) => /reason|expiresAt|environment|scope/.test(e.message)),
      `expected a strict-closure error, got ${JSON.stringify(out.errors)}`);
  });

  it('F1: does not write secrets from --reason into state.json', () => {
    const dir = project();
    const secret = 'ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII';
    const { status } = runConfirm(dir, [
      '--gate', 'compileCheckConfirmed',
      '--reason', `cannot automate because token=${secret}`,
      '--expires-at', new Date(Date.now() + 60_000).toISOString(),
      '--environment', 'tool=unity', '--scope', 's', '--files', 'src-a.txt',
    ]);
    assert.equal(status, 0);
    const raw = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
    assert.equal(raw.includes(secret), false, 'state.json must not contain the raw secret');
    assert.ok(/token=\[REDACTED\]|REDACTED/.test(raw), 'the value should be redacted, not dropped');
  });

  it('F2: rejects an expiry that exceeds maxValidityMs even with process latency', () => {
    // The bound must be measured against a single instant, not a live clock.
    // Before the fix the CLI read Date.now() at check time, so a few ms of
    // startup latency absorbed a small overage and the same command could pass or
    // fail run to run. Now the reference instant is captured at command start, so
    // this asserts an unambiguous overage that no amount of latency can hide.
    const dir = project({ harness: { strictClosure: { enabled: true, manualConfirmation: { maxValidityMs: 3_600_000 } } } });
    const { status, json } = runConfirm(dir, [
      '--gate', 'compileCheckConfirmed',
      '--reason', 'r',
      '--expires-at', new Date(Date.now() + 3_600_000 + 60_000).toISOString(),
      '--environment', 'tool=unity', '--scope', 's', '--files', 'src-a.txt',
    ]);
    assert.equal(status, 1, 'a 1ms overage must be rejected deterministically');
    assert.match(json.error || '', /maxValidityMs|validity/);
  });

  it('F2: rejects a manual-confirmation whose createdAt is in the future', () => {
    // Post-dating both timestamps defeated the window: a record could be shifted
    // 30 days forward and stay "valid", which is the unbounded-assertion hole
    // the feature exists to close.
    const dir = project({ harness: { strictClosure: { enabled: true } } });
    const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    const future = new Date(Date.now() + 30 * 86400_000);
    state.gates = { compileCheckConfirmed: true };
    state.gateEvidence = [{
      evidenceId: '22222222-2222-4222-8222-222222222222',
      workItemId: 'epic-1::story-1.md', acceptanceCriterionId: null, phase: 'implementation',
      gate: 'compileCheckConfirmed', status: 'manual-confirmation', command: null,
      result: 'post-dated', exitCode: null, artifactPath: null, artifactHash: null,
      inputTreeHash: 'a'.repeat(64), criteriaHash: null, relevantFiles: [], toolVersion: null,
      createdAt: future.toISOString(),
      expiresAt: new Date(future.getTime() + 3600_000).toISOString(),
      freshnessPolicy: null, supersededBy: null, source: 'manual-confirmation',
      reason: 'ok', environment: { tool: 'unity' }, scope: ['a'],
    }];
    writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));
    const r = spawnSync(process.execPath, [CLI, 'state', 'validate', '--target', dir, '--format', 'json'], { encoding: 'utf-8' });
    const out = JSON.parse(r.stdout);
    assert.equal(out.valid, false, 'a future-dated createdAt must be rejected');
    assert.ok(out.errors.some((e) => /future|createdAt/i.test(e.message)), JSON.stringify(out.errors));
  });

  it('F3: rejects a scope whose items are not strings', () => {
    const dir = project({ harness: { strictClosure: { enabled: true } } });
    const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    state.gates = { compileCheckConfirmed: true };
    state.gateEvidence = [{
      evidenceId: '33333333-3333-4333-8333-333333333333',
      workItemId: 'epic-1::story-1.md', acceptanceCriterionId: null, phase: 'implementation',
      gate: 'compileCheckConfirmed', status: 'manual-confirmation', command: null,
      result: 'x', exitCode: null, artifactPath: null, artifactHash: null,
      inputTreeHash: 'a'.repeat(64), criteriaHash: null, relevantFiles: [], toolVersion: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      freshnessPolicy: null, supersededBy: null, source: 'manual-confirmation',
      reason: 'ok', environment: { tool: 'unity' }, scope: [123],
    }];
    writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));
    const r = spawnSync(process.execPath, [CLI, 'state', 'validate', '--target', dir, '--format', 'json'], { encoding: 'utf-8' });
    const out = JSON.parse(r.stdout);
    assert.equal(out.valid, false, 'scope items must be strings, matching the schema');
  });
});

describe('harness confirm — freshness', () => {
  it('blocks when freshness cannot be established and no --files are given', () => {
    // Matches `harness verify`: never record a passing gate against an
    // unknown input tree. Git may or may not resolve inside a temp dir, so
    // this asserts the fail-safe direction, not a specific git outcome.
    const dir = project({ harness: { allowEmptyFreshness: false } });
    const { status, json } = runConfirm(dir, [
      '--gate', 'compileCheckConfirmed',
      '--reason', 'r', '--expires-at', new Date(Date.now() + 60_000).toISOString(),
      '--environment', 'tool=unity', '--scope', 's',
    ]);
    if (status !== 0) {
      assert.equal(json.code, 'freshness-unavailable', JSON.stringify(json));
    } else {
      // Git resolved and produced a file list; evidence must then be bound.
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const ev = state.gateEvidence[0];
      assert.match(ev.inputTreeHash, /^[0-9a-f]{64}$/);
    }
  });
});
