import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  RunLedger, loadRun, listRuns, cleanupRuns, buildReport, formatReport, runsDir,
} from '../src/harness/ledger.mjs';
import { defaultPolicy, validatePolicy } from '../src/harness/policy.mjs';
import { REDACTED } from '../src/harness/redaction.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const policy = defaultPolicy();

describe('ledger — spans and redaction', () => {
  it('redacts secrets in tool arguments before persistence', () => {
    const l = new RunLedger({ targetDir: repoRoot, policy, workItemId: 'w', phase: 'implementation' });
    const span = l.addSpan({ kind: 'tool-call', tool: 'cli', args: { env: { API_KEY: 'abcdef123456' } } });
    assert.equal(span.args.env.API_KEY, REDACTED);
  });

  it('records a tool output with output bytes', () => {
    const l = new RunLedger({ targetDir: repoRoot, policy });
    const span = l.recordOutput({ name: 'npm-test', output: 'hello world', status: 'ok', tool: 'cli' });
    assert.equal(span.outputBytes, 11);
    assert.equal(span.preview, null); // under the inline limit => no artifact
  });

  it('stores oversized output as a bounded artifact with a preview', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-ledger-'));
    try {
      const small = validatePolicy({ output: { maxInlineBytes: 100, previewBytes: 20 } });
      const l = new RunLedger({ targetDir: dir, policy: small });
      const big = 'x'.repeat(500);
      const span = l.recordOutput({ name: 'big', output: big, status: 'ok' });
      assert.ok(span.artifactPath, 'oversized output must be artifact-stored');
      assert.match(span.artifactHash, /^[0-9a-f]{64}$/);
      assert.equal(span.preview.length, 20);
      assert.equal(existsSync(span.artifactPath), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ledger — accounting', () => {
  it('records exact provider usage and estimates cost when a rate card exists', () => {
    const p = validatePolicy({
      model: 'm1',
      estimation: { rateCards: { m1: { id: 'rc', inputRate: 0.000003, outputRate: 0.000015, effectiveDate: '2026-09-01' } } },
    });
    const l = new RunLedger({ targetDir: repoRoot, policy: p });
    const usage = l.recordUsage({ source: 'provider', inputTokens: 1000, outputTokens: 1000 });
    assert.equal(usage.source, 'provider');
    assert.equal(usage.usd, 0.018);
  });

  it('labels unknown usage as unknown and never presents it as zero cost', () => {
    const l = new RunLedger({ targetDir: repoRoot, policy });
    const usage = l.recordUsage(null);
    assert.equal(usage.source, 'unknown');
    assert.equal(usage.usd, null);
    assert.equal(usage.costUnknown, true);
  });

  it('estimates usage when no provider data is available', () => {
    const l = new RunLedger({ targetDir: repoRoot, policy });
    const usage = l.recordUsage({ bytes: 300 });
    assert.equal(usage.source, 'estimate');
    assert.equal(usage.inputTokens, 100);
  });
});

describe('ledger — persistence and retention', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'cadet-runs-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('persists and reloads a run record with a schema version', () => {
    const l = new RunLedger({ targetDir: dir, policy, workItemId: 'epic-1::story-1.md', phase: 'implementation' });
    l.addSpan({ kind: 'verification', name: 'tests', status: 'ok' });
    const rec = l.finalize();
    const path = l.persist();
    assert.equal(existsSync(path), true);
    const loaded = loadRun(dir, l.runId);
    assert.equal(loaded.runId, l.runId);
    assert.equal(loaded.schemaVersion, 2);
    assert.equal(loaded.workItemId, 'epic-1::story-1.md');
    assert.equal(loaded.spans.length, 1);
  });

  it('lists runs newest first', async () => {
    const d2 = mkdtempSync(join(tmpdir(), 'cadet-runs2-'));
    try {
      const a = new RunLedger({ targetDir: d2, policy });
      a.startedAt = '2026-09-11T00:00:00.000Z';
      a.persist();
      await new Promise((r) => setTimeout(r, 5));
      const b = new RunLedger({ targetDir: d2, policy });
      b.startedAt = '2026-09-11T01:00:00.000Z';
      b.persist();
      const runs = listRuns(d2);
      assert.equal(runs[0].runId, b.runId);
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  });

  it('deletes successful runs but keeps failed runs when keepOnFailure is set', () => {
    const d3 = mkdtempSync(join(tmpdir(), 'cadet-runs3-'));
    try {
      const ok = new RunLedger({ targetDir: d3, policy });
      ok.finalize({ status: 'ok' });
      ok.persist();
      const bad = new RunLedger({ targetDir: d3, policy });
      bad.finalize({ status: 'failed' });
      bad.persist();

      const { deleted, kept } = cleanupRuns(d3, policy);
      assert.ok(deleted.includes(ok.runId));
      assert.ok(kept.includes(bad.runId));
      assert.equal(existsSync(join(runsDir(d3), `${bad.runId}.json`)), true);
    } finally {
      rmSync(d3, { recursive: true, force: true });
    }
  });

  it('retains everything when retainRunRecords is set', () => {
    const d4 = mkdtempSync(join(tmpdir(), 'cadet-runs4-'));
    try {
      const p = validatePolicy({ retention: { retainRunRecords: true, keepOnFailure: true, retainRawPrompt: false } });
      const ok = new RunLedger({ targetDir: d4, policy: p });
      ok.finalize({ status: 'ok' });
      ok.persist();
      const { deleted, kept } = cleanupRuns(d4, p);
      assert.equal(deleted.length, 0);
      assert.ok(kept.includes(ok.runId));
    } finally {
      rmSync(d4, { recursive: true, force: true });
    }
  });
});

describe('ledger — report', () => {
  it('shows budget consumption and labels unknown telemetry', () => {
    const l = new RunLedger({ targetDir: repoRoot, policy, capabilities: { tokenTelemetry: { provider: false }, mcp: { available: false } } });
    l.tracker.add('toolCalls', 10);
    const rec = l.finalize();
    const report = buildReport(rec);
    assert.equal(report.toolCalls, 10);
    assert.equal(report.usage.costUnknown, true);
    assert.equal(report.telemetry.tokenTelemetry, 'unavailable-estimated-or-unknown');
    assert.equal(report.telemetry.mcp, 'unavailable');
    const text = formatReport(rec);
    assert.match(text, /Budgets:/);
  });

  it('reports overage status', () => {
    const l = new RunLedger({ targetDir: repoRoot, policy });
    l.tracker.add('toolCalls', 100); // over 80
    const rec = l.finalize();
    const report = buildReport(rec);
    const toolBudget = report.budgets.find((b) => b.budget === 'maxToolCalls');
    assert.equal(toolBudget.overage, true);
    assert.equal(toolBudget.status, 'exhausted');
  });

  it('never includes a secret in the report', () => {
    const l = new RunLedger({ targetDir: repoRoot, policy });
    l.recordOutput({ name: 'env', output: 'API_KEY=abcdef123456', status: 'failed' });
    l.finalize();
    const text = formatReport(l.toRecord());
    assert.equal(text.includes('abcdef123456'), false);
  });
});
