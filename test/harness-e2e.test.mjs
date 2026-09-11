import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  loadPolicy, validateState, migrateStateV1toV2, createEvidence, computeInputTreeHash,
  evaluateTransition, applyTransition, resetGatesForNewWorkItem, hashCriteria, newId,
  runVerificationLoop, RunLedger, buildReport, cleanupRuns, ContextManifest,
  ContextError, routeTask, REDACTED, GATES,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-e2e-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  return dir;
}

function workItemEvidence(gate, { treeHash, workItemId = 'epic-1::story-1.md', phase = 'implementation', status = 'passed', criteria = ['ac'] }) {
  return createEvidence({
    evidenceId: newId(), workItemId, phase, gate, status,
    command: 'npm test', result: 'exit 0', exitCode: 0,
    inputTreeHash: treeHash, criteriaHash: hashCriteria(criteria),
    relevantFiles: ['src/a.mjs'],
  });
}

describe('e2e — valid state transition with fresh evidence', () => {
  it('accepts the transition when every gate has fresh evidence', () => {
    const dir = project();
    try {
      const treeHash = computeInputTreeHash(dir, ['src/a.mjs']);
      const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
        .map((g) => workItemEvidence(g, { treeHash }));
      const state = {
        version: 2, stateVersion: 2,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
        epics: {}, gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
        gateEvidence: evidence, changeHistory: [],
      };
      const r = evaluateTransition(state, 'review', { inputTreeHash: treeHash });
      assert.equal(r.allowed, true, JSON.stringify(r));
      const next = applyTransition(state, 'review', { inputTreeHash: treeHash });
      assert.equal(next.session.currentPhase, 'review');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — illegal transition with missing gate', () => {
  it('reports the exact missing gates', () => {
    const state = {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
      gates: { testsPassed: true }, gateEvidence: [], changeHistory: [],
    };
    const r = evaluateTransition(state, 'review');
    assert.equal(r.allowed, false);
    for (const gate of ['compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']) {
      assert.ok(r.missingGates.includes(gate));
    }
  });
});

describe('e2e — stale evidence rejection', () => {
  it('rejects evidence from a changed input tree', () => {
    const dir = project();
    try {
      const oldHash = computeInputTreeHash(dir, ['src/a.mjs']);
      const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
        .map((g) => workItemEvidence(g, { treeHash: oldHash }));
      const state = {
        version: 2, stateVersion: 2,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' }, epics: {},
        gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
        gateEvidence: evidence, changeHistory: [],
      };
      // Change a relevant file, then request the transition.
      writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 2;\n');
      const newHash = computeInputTreeHash(dir, ['src/a.mjs']);
      const r = evaluateTransition(state, 'review', { inputTreeHash: newHash });
      assert.equal(r.allowed, false);
      assert.ok(r.staleEvidence.some((s) => s.reasons.some((reason) => /tree hash/.test(reason))));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — red-to-green verification loop', () => {
  it('records red then green and produces fresh evidence each time', async () => {
    const policy = loadPolicy(repoRoot);
    const dir = project();
    try {
      let call = 0;
      const runner = async () => {
        call++;
        return call === 1
          ? { exitCode: 1, stdout: '', stderr: 'AssertionError: expected 1 to equal 2', timedOut: false, durationMs: 5, outputBytes: 5 }
          : { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, durationMs: 5, outputBytes: 2 };
      };
      const first = await runVerificationLoop({ gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation', policy, rootDir: dir, runCommandImpl: runner, sleepImpl: async () => {} });
      assert.equal(first.status, 'failed'); // deterministic -> no retry
      const red = first.finalEvidence;
      assert.equal(red.status, 'failed');

      // Red-before-green: a green result with no prior red record is rejected.
      const premature = await runVerificationLoop({ gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation', policy, rootDir: dir, runCommandImpl: runner, sleepImpl: async () => {} });
      assert.equal(premature.status, 'failed');
      assert.equal(premature.stopReason, 'red-required');

      // With the red record supplied, green is accepted.
      const second = await runVerificationLoop({ gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation', policy, rootDir: dir, runCommandImpl: runner, sleepImpl: async () => {}, priorEvidence: [red] });
      assert.equal(second.status, 'passed');
      const green = second.finalEvidence;
      assert.equal(green.status, 'passed');
      assert.notEqual(red.evidenceId, green.evidenceId);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — retry exhaustion', () => {
  it('stops after the configured retries and records every attempt', async () => {
    const policy = loadPolicy(repoRoot);
    const dir = project();
    try {
      const runner = async () => ({ exitCode: 1, stdout: '', stderr: 'ECONNRESET', timedOut: false, durationMs: 5, outputBytes: 5 });
      const result = await runVerificationLoop({ gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation', policy, rootDir: dir, runCommandImpl: runner, sleepImpl: async () => {} });
      assert.equal(result.status, 'failed');
      assert.equal(result.stopReason, 'retry-exhausted');
      assert.equal(result.attempts.length, policy.budgets.maxRetriesPerStep.hard + 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — context budget exhaustion', () => {
  it('stops expansion when the per-step limit is reached', () => {
    const dir = project();
    try {
      const policy = loadPolicy(repoRoot);
      const m = new ContextManifest({ policy, rootDir: dir, maxExpansionPerStep: 1 });
      writeFileSync(join(dir, 'src', 'b.mjs'), 'export const b = 2;\n');
      m.load({ reference: 'src/a.mjs', tier: 'tier1', reason: 'a' });
      assert.throws(() => m.load({ reference: 'src/b.mjs', tier: 'tier1', reason: 'b' }), ContextError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — tool output truncation and artifact storage', () => {
  it('stores oversized output as an artifact with a preview', () => {
    const dir = project();
    try {
      const policy = loadPolicy(repoRoot);
      const ledger = new RunLedger({ targetDir: dir, policy });
      const span = ledger.recordOutput({ name: 'big', output: 'x'.repeat(200000), status: 'ok' });
      assert.ok(span.artifactPath, 'oversized output must be artifact-stored');
      assert.match(span.artifactHash, /^[0-9a-f]{64}$/);
      assert.ok(span.preview.length <= policy.output.previewBytes);
      assert.equal(existsSync(span.artifactPath), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — cost report generation', () => {
  it('generates a secret-free report with budget consumption', () => {
    const dir = project();
    try {
      const policy = loadPolicy(repoRoot);
      const ledger = new RunLedger({ targetDir: dir, policy, capabilities: { tokenTelemetry: { provider: false }, mcp: { available: false } } });
      ledger.recordUsage({ source: 'provider', inputTokens: 1000, outputTokens: 500 });
      ledger.tracker.add('toolCalls', 5);
      ledger.finalize({ status: 'ok' });
      ledger.persist();
      const report = buildReport(ledger.toRecord());
      assert.equal(report.toolCalls, 5);
      assert.equal(report.usage.source, 'provider');
      assert.equal(report.usage.costUnknown, true); // no rate card
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — gate reset on new work item', () => {
  it('resets every gate and clears evidence atomically', () => {
    const state = {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e1', storyId: 's1' }, epics: {},
      gates: Object.fromEntries(GATES.map((g) => [g, true])),
      gateEvidence: [createEvidence({ evidenceId: newId(), workItemId: 'e1::s1', phase: 'implementation', gate: 'testsPassed', status: 'passed', inputTreeHash: 'a'.repeat(64), relevantFiles: [] })],
      changeHistory: [],
    };
    const next = resetGatesForNewWorkItem(state, { epicId: 'e2', storyId: 's2' });
    for (const g of GATES) assert.equal(next.gates[g], false);
    assert.deepEqual(next.gateEvidence, []);
    assert.deepEqual(next.activeWorkItem, { epicId: 'e2', storyId: 's2' });
  });
});

describe('e2e — routing fallback never claims live inspection', () => {
  it('falls back to CLI verification when MCP is unavailable', () => {
    const d = routeTask({ task: { kind: 'mcp', verification: true }, capabilities: { mcp: { available: false } } });
    assert.equal(d.tool, 'cli');
    assert.equal(d.fallbackApplied, true);
    assert.equal(d.liveInspectionPerformed, false);
  });
});

describe('e2e — synthetic secure-change run', () => {
  it('persists a sanitized ledger and cleans up successful runs', () => {
    const dir = project();
    try {
      const policy = loadPolicy(repoRoot);
      const ledger = new RunLedger({ targetDir: dir, policy, workItemId: 'epic-1::story-1.md', phase: 'implementation' });
      ledger.addSpan({ kind: 'tool-call', tool: 'cli', args: { command: 'npm test', env: { GITHUB_TOKEN: ['ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('') } }, status: 'ok' });
      ledger.finalize({ status: 'ok' });
      ledger.persist();

      const persisted = readFileSync(join(dir, '.cadet', 'runs', `${ledger.runId}.json`), 'utf-8');
      assert.equal(persisted.includes(['ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('')), false, 'ledger leaked a token');
      assert.ok(persisted.includes(REDACTED));

      const { deleted } = cleanupRuns(dir, policy);
      assert.ok(deleted.includes(ledger.runId));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('e2e — migration compatibility', () => {
  it('migrates a v1 state with all gates false and validates cleanly', () => {
    const v1 = {
      version: 1,
      session: { workflowPath: 'small', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
      gates: { testsPassed: false },
      spikes: {}, changeHistory: [],
    };
    const { state, changed } = migrateStateV1toV2(v1);
    assert.equal(changed, true);
    assert.equal(validateState(state).valid, true);
    assert.equal(state.gates.testsPassed, false);
    assert.deepEqual(state.activeWorkItem, { epicId: 'epic-1', storyId: 'story-1.md' });
  });

  it('a migrated true gate without evidence is rejected by validation', () => {
    const v1 = {
      version: 1,
      session: { workflowPath: 'small', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: {},
      gates: { testsPassed: true },
      spikes: {}, changeHistory: [],
    };
    const { state } = migrateStateV1toV2(v1);
    const result = validateState(state);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'gates.testsPassed'));
  });
});
