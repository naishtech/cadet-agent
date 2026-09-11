import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  validatePolicy, defaultPolicy, loadPolicy, budgetForScope,
  PolicyError, DEFAULT_BUDGETS, PHASES, GATES, TRANSITIONS,
} from '../src/harness/policy.mjs';
import {
  BudgetTracker, budgetExhaustedResult, estimateTokens, estimateCost, normalizeUsage,
} from '../src/harness/budget.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('policy — defaults', () => {
  it('exposes the frozen phase names', () => {
    assert.deepEqual([...PHASES], [
      'context-resolution', 'requirements', 'requirementsComplete', 'architecture',
      'architectureComplete', 'spikes', 'story-breakdown', 'implementation',
      'review', 'validation', 'closed',
    ]);
  });

  it('exposes the frozen gate names', () => {
    assert.deepEqual([...GATES], [
      'codeReviewCompleted', 'testsPassed', 'storyTrackingUpdated', 'compileCheckConfirmed',
      'unityAnalyzerClean', 'acceptanceCriteriaValidated', 'securityReviewPassed',
      'designArtifactSyncConfirmed',
    ]);
  });

  it('keeps the frozen transition table', () => {
    assert.equal(TRANSITIONS.implementation.to, 'review');
    assert.equal(TRANSITIONS.review.to, 'validation');
    assert.equal(TRANSITIONS.validation.to, 'closed');
  });

  it('applies contract default budgets', () => {
    const p = defaultPolicy();
    assert.equal(p.budgets.maxContextTokens.hard, 64000);
    assert.equal(p.budgets.maxOutputTokens.hard, 8000);
    assert.equal(p.budgets.maxToolCalls.hard, 80);
    assert.equal(p.budgets.maxRetriesPerStep.hard, 2);
    assert.equal(p.budgets.maxTotalRetries.hard, 8);
    assert.equal(p.budgets.maxWallClockMs.hard, 30 * 60 * 1000);
    assert.equal(p.budgets.maxEstimatedCostUsd.hard, 2.0);
    assert.equal(p.budgets.maxDownloadedBytes.hard, 25 * 1024 * 1024);
    assert.equal(p.budgets.maxDecompressedBytes.hard, 100 * 1024 * 1024);
    assert.equal(p.budgets.maxArchiveFiles.hard, 2000);
  });

  it('loads the repo .cadet/harness.json', () => {
    const repoRoot = join(__dirname, '..');
    const p = loadPolicy(repoRoot);
    assert.equal(p.sourcePath.endsWith('harness.json'), true);
    assert.equal(p.budgets.maxContextTokens.hard, 64000);
  });
});

describe('policy — validation', () => {
  it('rejects unknown top-level keys', () => {
    assert.throws(() => validatePolicy({ nonsense: 1 }), PolicyError);
  });

  it('rejects unknown budget keys', () => {
    assert.throws(() => validatePolicy({ budgets: { maxNonsense: 1 } }), PolicyError);
  });

  it('rejects negative limits', () => {
    assert.throws(() => validatePolicy({ budgets: { maxToolCalls: -1 } }), PolicyError);
    assert.throws(() => validatePolicy({ budgets: { maxToolCalls: { hard: -5 } } }), PolicyError);
  });

  it('rejects non-numeric limits', () => {
    assert.throws(() => validatePolicy({ budgets: { maxToolCalls: 'lots' } }), PolicyError);
  });

  it('rejects out-of-range warning thresholds', () => {
    assert.throws(() => validatePolicy({ budgets: { maxToolCalls: { hard: 10, warn: 2 } } }), PolicyError);
  });

  it('rejects unknown archive/output/retention keys', () => {
    assert.throws(() => validatePolicy({ archive: { maxWhatever: 1 } }), PolicyError);
    assert.throws(() => validatePolicy({ output: { maxNonsense: 1 } }), PolicyError);
    assert.throws(() => validatePolicy({ retention: { keepForever: true } }), PolicyError);
  });

  it('rejects a hook mode that is not recognized', () => {
    assert.throws(() => validatePolicy({ hook: { mode: 'yolo' } }), PolicyError);
  });

  it('refuses to exceed a hard safety ceiling without an explicit flag', () => {
    assert.throws(
      () => validatePolicy({ budgets: { maxDownloadedBytes: 200 * 1024 * 1024 } }),
      /hard safety ceiling/
    );
  });

  it('allows exceeding a ceiling only with the explicit opt-in flag', () => {
    const p = validatePolicy({
      allowBudgetCeilingOverride: true,
      budgets: { maxDownloadedBytes: 200 * 1024 * 1024 },
    });
    assert.equal(p.budgets.maxDownloadedBytes.hard, 200 * 1024 * 1024);
  });

  it('validates per-scope overrides', () => {
    const p = validatePolicy({ scopes: { perStory: { maxToolCalls: 40 } } });
    assert.equal(p.scopes.perStory.maxToolCalls, 40);
    const scoped = budgetForScope(p, 'perStory');
    assert.equal(scoped.maxToolCalls.hard, 40);
    // perRun unaffected
    assert.equal(budgetForScope(p, 'perRun').maxToolCalls.hard, 80);
  });

  it('throws PolicyError on malformed policy JSON in the repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-policy-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      writeFileSync(join(dir, '.cadet', 'harness.json'), '{ not json');
      assert.throws(() => loadPolicy(dir), PolicyError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('budget — deterministic counters', () => {
  it('tracks counters and evaluates warnings', () => {
    const t = new BudgetTracker(defaultPolicy());
    const r1 = t.add('toolCalls', 60); // 75% of 80 -> warning threshold exactly
    assert.equal(r1.status, 'warning');
    assert.equal(r1.ok, false);
  });

  it('reports ok below the warning threshold', () => {
    const t = new BudgetTracker(defaultPolicy());
    const r = t.add('toolCalls', 10);
    assert.equal(r.status, 'ok');
    assert.equal(r.ok, true);
  });

  it('hard-stops at the limit', () => {
    const t = new BudgetTracker(defaultPolicy());
    t.add('toolCalls', 80);
    const r = t.evaluate('toolCalls');
    assert.equal(r.exhausted, true);
    assert.equal(r.ok, false);
  });

  it('rejects unknown counters and negative amounts', () => {
    const t = new BudgetTracker(defaultPolicy());
    assert.throws(() => t.add('nonsense', 1), PolicyError);
    assert.throws(() => t.add('toolCalls', -1), PolicyError);
  });

  it('checks per-step retry limits separately from totals', () => {
    const t = new BudgetTracker(defaultPolicy());
    assert.equal(t.checkStepRetries(0).status, 'ok');       // 2 remaining
    assert.equal(t.checkStepRetries(1).status, 'warning');  // 1 remaining
    assert.equal(t.checkStepRetries(2).status, 'exhausted'); // 0 remaining
  });

  it('produces a machine-readable result that cannot be confused with success', () => {
    const t = new BudgetTracker(defaultPolicy());
    t.add('retries', 8);
    const result = t.result();
    assert.equal(result.ok, false);
    assert.equal(result.exhausted, true);
    assert.equal(result.status, 'exhausted');
  });

  it('emits a hard-stop result with a nonzero exit code', () => {
    const r = budgetExhaustedResult('tool call budget exhausted');
    assert.equal(r.code, 'budget-exhausted');
    assert.equal(r.ok, false);
    assert.notEqual(r.exitCode, 0);
  });

  it('counts exact values without drift', () => {
    const t = new BudgetTracker(defaultPolicy());
    for (let i = 0; i < 7; i++) t.add('retries', 1);
    assert.equal(t.snapshot().counters.retries, 7);
  });
});

describe('budget — estimation', () => {
  it('estimates tokens as ceil(bytes/3) and marks the source', () => {
    const e = estimateTokens('abcdef', defaultPolicy());
    assert.equal(e.tokens, 2);
    assert.equal(e.source, 'estimate');
    assert.equal(e.confidence, 'low');
  });

  it('never invents USD without a configured rate card', () => {
    const c = estimateCost(1000, 500, defaultPolicy());
    assert.equal(c.known, false);
    assert.equal(c.usd, null);
  });

  it('computes USD from a rate card when configured, rounded to 4dp', () => {
    const p = validatePolicy({
      model: 'test-model',
      estimation: { rateCards: { 'test-model': { id: 'rc-1', inputRate: 0.000003, outputRate: 0.000015, effectiveDate: '2026-09-01' } } },
    });
    const c = estimateCost(1000, 1000, p);
    assert.equal(c.known, true);
    assert.equal(c.usd, Math.round((1000 * 0.000003 + 1000 * 0.000015) * 10000) / 10000);
    assert.equal(c.rateCardId, 'rc-1');
  });

  it('reports unknown usage as unknown, never zero', () => {
    const u = normalizeUsage(null, defaultPolicy());
    assert.equal(u.source, 'unknown');
    assert.equal(u.inputTokens, null);
  });

  it('passes provider usage through and marks it', () => {
    const u = normalizeUsage({ source: 'provider', inputTokens: 100, outputTokens: 50 }, defaultPolicy());
    assert.equal(u.source, 'provider');
    assert.equal(u.confidence, 'high');
  });
});
