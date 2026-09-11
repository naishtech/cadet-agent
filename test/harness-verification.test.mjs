import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyResult, classifyRepair, runVerificationLoop, commandForGate, analyzerClean,
  manualConfirmation, isBudgetExhaustion, TRANSIENT_BACKOFF_MS, DEFAULT_FLAKY_SIGNATURES,
} from '../src/harness/verification.mjs';
import { defaultPolicy, validatePolicy } from '../src/harness/policy.mjs';
import { BudgetTracker } from '../src/harness/budget.mjs';

const policy = defaultPolicy();

function fakeResult(over = {}) {
  return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', durationMs: 5, outputBytes: 5, artifactPath: null, artifactHash: null, preview: '', errorMessage: '', ...over };
}

function loopDeps(results) {
  let i = 0;
  const commands = [];
  const sleeps = [];
  return {
    runCommandImpl: async (command) => {
      commands.push(command);
      const r = results[Math.min(i, results.length - 1)];
      i++;
      return r;
    },
    sleepImpl: async (ms) => { sleeps.push(ms); },
    commands,
    sleeps,
  };
}

describe('verification — classifier', () => {
  it('classifies a passing result as deterministic/success', () => {
    const c = classifyResult({ exitCode: 0 });
    assert.equal(c.retryClass, 'deterministic');
    assert.equal(c.retryable, false);
  });

  it('classifies assertion failures as deterministic (no retry)', () => {
    const c = classifyResult({ exitCode: 1, stderr: 'AssertionError: expected 1 to equal 2' });
    assert.equal(c.retryClass, 'deterministic');
    assert.equal(c.retryable, false);
  });

  it('classifies compile errors as deterministic', () => {
    const c = classifyResult({ exitCode: 1, stdout: 'error CS0103: name not found' });
    assert.equal(c.retryClass, 'deterministic');
  });

  it('classifies analyzer findings as deterministic', () => {
    const c = classifyResult({ exitCode: 1, stdout: 'UNT0008 null propagation' });
    assert.equal(c.retryClass, 'deterministic');
  });

  it('classifies network resets as transient (retryable)', () => {
    const c = classifyResult({ exitCode: 1, stderr: 'Error: read ECONNRESET' });
    assert.equal(c.retryClass, 'transient');
    assert.equal(c.retryable, true);
  });

  it('classifies a plain nonzero exit with no signature as unknown (no retry)', () => {
    const c = classifyResult({ exitCode: 7, stderr: 'weird thing happened' });
    assert.equal(c.retryClass, 'unknown');
    assert.equal(c.retryable, false);
  });

  it('treats a reproducible timeout as deterministic', () => {
    const c = classifyResult({ exitCode: null, timedOut: true });
    assert.equal(c.retryClass, 'deterministic');
    assert.equal(c.retryable, false);
  });

  it('honors a configured flaky signature for a timeout', () => {
    const c = classifyResult({ exitCode: null, timedOut: true, stderr: 'socket hang up' });
    assert.equal(c.retryClass, 'transient');
  });

  it('accepts only a well-formed repair retry', () => {
    assert.equal(classifyRepair({}).retryable, false);
    assert.equal(classifyRepair({ failedEvidenceId: 'x', changedFiles: [] }).retryable, false);
    const ok = classifyRepair({ failedEvidenceId: 'ev-1', changedFiles: ['src/a.mjs'] });
    assert.equal(ok.retryClass, 'repair');
    assert.equal(ok.retryable, true);
  });
});

describe('verification — command contracts', () => {
  it('uses npm test as the default test command', () => {
    const c = commandForGate('testsPassed', { policy });
    assert.equal(c.command, 'npm test');
    assert.equal(c.automated, true);
  });

  it('prefers a configured test command', () => {
    const p = validatePolicy({ testCommand: 'node --test custom/*.test.mjs' });
    assert.equal(commandForGate('testsPassed', { policy: p }).command, 'node --test custom/*.test.mjs');
  });

  it('requires the analyzer command to be declared before automation', () => {
    const c = commandForGate('unityAnalyzerClean', { policy });
    assert.equal(c.automated, false);
    assert.match(c.reason, /analyzer command/);
  });

  it('builds the analyzer command when declared', () => {
    const p = validatePolicy({ analyzerCommand: 'analyze' });
    const c = commandForGate('unityAnalyzerClean', { policy: p, projectPath: 'MyProj' });
    assert.equal(c.command, 'unity run MyProj --command analyze --format json');
    assert.equal(c.automated, true);
  });

  it('falls back to manual confirmation for compile when Unity CLI is unavailable', () => {
    const c = commandForGate('compileCheckConfirmed', { policy, unityAvailable: false });
    assert.equal(c.automated, false);
    assert.equal(c.tool, 'manual-confirmation');
  });

  it('uses the standard Unity build command for compile when Unity CLI is available', () => {
    const c = commandForGate('compileCheckConfirmed', { policy, unityAvailable: true, projectPath: '.' });
    assert.match(c.command, /^unity build \. --target StandaloneWindows64/);
    assert.match(c.command, /--format json$/);
  });

  it('detects UNT diagnostics in an analyzer envelope', () => {
    assert.equal(analyzerClean(JSON.stringify({ success: true, data: [] })), true);
    assert.equal(analyzerClean(JSON.stringify({ data: ['UNT0008'] })), false);
    assert.equal(analyzerClean('plain text with UNT0008'), false);
  });

  it('records manual confirmation as a user-owned evidence record', () => {
    const m = manualConfirmation({
      gate: 'compileCheckConfirmed', workItemId: 'epic-1::story-1.md', phase: 'implementation',
      projectPath: '/proj', editorVersion: '6000.0.47f1', scope: 'changed files',
    });
    assert.equal(m.evidence.status, 'manual-confirmation');
    assert.equal(m.evidence.source, 'manual-confirmation');
    assert.match(m.evidence.result, /editor=6000\.0\.47f1/);
  });
});

describe('verification — loop contract', () => {
  it('stops immediately on a passing first attempt', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 0 })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.ok, true);
    assert.equal(result.attempts.length, 1);
    assert.equal(deps.sleeps.length, 0);
  });

  it('does not retry a deterministic failure', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 1, stderr: 'AssertionError: expected 1 to equal 2' })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'deterministic');
    assert.equal(result.attempts.length, 1);
    assert.equal(deps.commands.length, 1);
  });

  it('retries a transient failure within the limit and records every attempt', async () => {
    const deps = loopDeps([
      fakeResult({ exitCode: 1, stderr: 'ECONNRESET' }),
      fakeResult({ exitCode: 1, stderr: 'ECONNRESET' }),
      fakeResult({ exitCode: 0 }),
    ]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.attempts.length, 3);
    assert.deepEqual(deps.sleeps, [250, 1000]);
    // Every attempt has a distinct evidence record.
    const ids = new Set(result.attempts.map((a) => a.evidence.evidenceId));
    assert.equal(ids.size, 3);
  });

  it('exhausts retries when a transient failure persists', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 1, stderr: 'ECONNRESET' })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'retry-exhausted');
    assert.equal(result.attempts.length, 3); // initial + 2 retries (maxRetriesPerStep = 2)
    assert.equal(isBudgetExhaustion(result), false);
  });

  it('never lets a retry overwrite a failed attempt record', async () => {
    const deps = loopDeps([
      fakeResult({ exitCode: 1, stderr: 'ECONNRESET' }),
      fakeResult({ exitCode: 0 }),
    ]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    assert.equal(result.attempts[0].status, 'failed');
    assert.equal(result.attempts[0].evidence.status, 'failed');
    assert.equal(result.attempts[1].evidence.status, 'passed');
    assert.notEqual(result.attempts[0].evidence.evidenceId, result.attempts[1].evidence.evidenceId);
  });

  it('fails on timeout without retry when not flaky', async () => {
    const deps = loopDeps([fakeResult({ exitCode: null, timedOut: true })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    assert.equal(result.status, 'timed-out');
    assert.equal(result.attempts.length, 1);
  });

  it('requires zero UNT diagnostics for the analyzer gate', async () => {
    const dirty = loopDeps([fakeResult({ exitCode: 0, stdout: JSON.stringify({ data: ['UNT0008'] }) })]);
    const r1 = await runVerificationLoop({
      gate: 'unityAnalyzerClean', command: 'unity run . --command analyze --format json',
      workItemId: 'w', phase: 'implementation', policy,
      runCommandImpl: dirty.runCommandImpl, sleepImpl: dirty.sleepImpl,
    });
    assert.equal(r1.status, 'failed');

    const clean = loopDeps([fakeResult({ exitCode: 0, stdout: JSON.stringify({ data: [] }) })]);
    const r2 = await runVerificationLoop({
      gate: 'unityAnalyzerClean', command: 'unity run . --command analyze --format json',
      workItemId: 'w', phase: 'implementation', policy,
      runCommandImpl: clean.runCommandImpl, sleepImpl: clean.sleepImpl,
    });
    assert.equal(r2.status, 'passed');
  });

  it('produces evidence linking the gate, command, and work item', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 0 })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'epic-1::story-1.md',
      phase: 'implementation', acceptanceCriterionId: 'ac-1', relevantFiles: ['src/a.mjs'],
      criteria: ['given x when y then z'], rootDir: process.cwd(), policy,
      requireRedFirst: false,
      runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    const ev = result.finalEvidence;
    assert.equal(ev.gate, 'testsPassed');
    assert.equal(ev.command, 'npm test');
    assert.equal(ev.workItemId, 'epic-1::story-1.md');
    assert.equal(ev.acceptanceCriterionId, 'ac-1');
    assert.equal(ev.status, 'passed');
    assert.match(ev.inputTreeHash, /^[0-9a-f]{64}$/);
  });

  it('stops when the wall-clock budget is exhausted', async () => {
    const budgets = new BudgetTracker(policy);
    const deps = loopDeps([fakeResult({ exitCode: 1, stderr: 'ECONNRESET', durationMs: 20 * 60 * 1000 })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, budgets, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'budget-exhausted');
    assert.equal(isBudgetExhaustion(result), true);
  });

  it('exposes the transient backoff schedule', () => {
    assert.deepEqual([...TRANSIENT_BACKOFF_MS], [250, 1000, 4000]);
    assert.ok(DEFAULT_FLAKY_SIGNATURES.includes('econnreset'));
  });

  it('runs a real command through runCommand and captures exit code', async () => {
    const { runCommand } = await import('../src/harness/verification.mjs');
    const ok = await runCommand('node -e "process.exit(0)"', { cwd: process.cwd(), timeoutMs: 10000 });
    assert.equal(ok.exitCode, 0);
    const bad = await runCommand('node -e "process.exit(3)"', { cwd: process.cwd(), timeoutMs: 10000 });
    assert.equal(bad.exitCode, 3);
  });

  it('bounds large output to an artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-verify-'));
    try {
      const { runCommand } = await import('../src/harness/verification.mjs');
      const r = await runCommand('node -e "process.stdout.write(\'x\'.repeat(200000))"', {
        cwd: process.cwd(), timeoutMs: 10000, maxInlineBytes: 1024, previewBytes: 256, artifactDir: dir,
      });
      assert.equal(r.exitCode, 0);
      assert.ok(r.artifactPath, 'large output must be artifact-stored');
      assert.match(r.artifactHash, /^[0-9a-f]{64}$/);
      assert.ok(r.preview.length <= 256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
