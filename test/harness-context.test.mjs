import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ContextManifest, buildBaseManifest, tier0References, ContextError, DEFAULT_MAX_EXPANSION_PER_STEP,
} from '../src/harness/context.mjs';
import {
  routeTask, detectCapabilities, RoutingError, toolCallSpan, TOOL_KINDS,
} from '../src/harness/routing.mjs';
import { defaultPolicy } from '../src/harness/policy.mjs';

const policy = defaultPolicy();

describe('context — manifest', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'cadet-ctx-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'src', 'b.mjs'), 'export const b = 2;\n');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('records tier, reason, authority, hash, and size for each item', () => {
    const m = new ContextManifest({ policy, rootDir: dir });
    const { item } = m.load({ reference: 'src/a.mjs', tier: 'tier1', reason: 'changed file', authority: 'repository' });
    assert.equal(item.tier, 'tier1');
    assert.equal(item.reason, 'changed file');
    assert.equal(item.authority, 'repository');
    assert.match(item.hash, /^[0-9a-f]{64}$/);
    assert.ok(item.bytes > 0);
    assert.ok(item.estimatedTokens > 0);
  });

  it('deduplicates identical content before budget accounting', () => {
    const m = new ContextManifest({ policy, rootDir: dir });
    const first = m.load({ reference: 'src/a.mjs', tier: 'tier1', reason: 'x' });
    const second = m.load({ reference: 'src/a.mjs', tier: 'tier1', reason: 'again' });
    assert.equal(first.counted, true);
    assert.equal(second.deduplicated, true);
    assert.equal(second.counted, false);
    assert.equal(m.deduplicated, 1);
    // Context budget counted once.
    const used = m.manifest().budget.counters.contextTokens;
    assert.equal(used, first.item.estimatedTokens);
  });

  it('requires a reason for deeper tiers', () => {
    const m = new ContextManifest({ policy, rootDir: dir });
    assert.throws(() => m.load({ reference: 'src/a.mjs', tier: 'tier2' }), ContextError);
    assert.throws(() => m.load({ reference: 'src/a.mjs', tier: 'tier3' }), ContextError);
    const r = m.load({ reference: 'src/a.mjs', tier: 'tier2', reason: 'owning abstraction' });
    assert.equal(r.item.tier, 'tier2');
  });

  it('rejects unknown tiers and escaping references', () => {
    const m = new ContextManifest({ policy, rootDir: dir });
    assert.throws(() => m.load({ reference: 'src/a.mjs', tier: 'tier9' }), ContextError);
    assert.throws(() => m.load({ reference: '../../etc/passwd', tier: 'tier1' }), ContextError);
  });

  it('bounds per-step expansion', () => {
    const m = new ContextManifest({ policy, rootDir: dir, maxExpansionPerStep: 2 });
    m.load({ reference: 'src/a.mjs', tier: 'tier1', reason: 'a' });
    m.load({ reference: 'src/b.mjs', tier: 'tier1', reason: 'b' });
    assert.throws(() => m.load({ reference: 'src/c.mjs', tier: 'tier1', reason: 'c' }), ContextError);
    assert.equal(m.denied.length, 1);
  });

  it('marks stale context when a file changes', () => {
    const m = new ContextManifest({ policy, rootDir: dir });
    m.load({ reference: 'src/a.mjs', tier: 'tier1', reason: 'x' });
    writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 999;\n');
    const { stale, anyStale } = m.refresh();
    assert.equal(anyStale, true);
    assert.equal(stale[0].reference, 'src/a.mjs');
    assert.equal(m.manifest().items[0].stale, true);
  });

  it('produces a report showing why each item was loaded', () => {
    const m = new ContextManifest({ policy, rootDir: dir });
    m.load({ reference: 'src/a.mjs', tier: 'tier1', reason: 'changed file', authority: 'repository' });
    const report = m.report();
    assert.equal(report.length, 1);
    assert.equal(report[0].reason, 'changed file');
  });

  it('seeds tier 0 and reports missing required files', () => {
    mkdirSync(join(dir, '.cadet', 'agent', 'core'), { recursive: true });
    writeFileSync(join(dir, '.cadet', 'agent', 'core', 'cadet-agent.md'), '# rules');
    const { manifest, missingTier0 } = buildBaseManifest({ targetDir: dir, policy });
    assert.deepEqual(missingTier0, []);
    assert.ok(manifest.items.some((i) => i.tier === 'tier0'));

    const emptyDir = mkdtempSync(join(tmpdir(), 'cadet-ctx-empty-'));
    try {
      const r = buildBaseManifest({ targetDir: emptyDir, policy });
      assert.ok(r.missingTier0.includes('.cadet/agent/core/cadet-agent.md'));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('exposes the default expansion limit', () => {
    assert.equal(DEFAULT_MAX_EXPANSION_PER_STEP, 12);
  });
});

describe('routing — decision tree', () => {
  it('routes verification to deterministic CLI', () => {
    const d = routeTask({ task: { kind: 'cli' } });
    assert.equal(d.tool, 'cli');
    assert.match(d.reason, /deterministic CLI/);
  });

  it('routes static context to read/search', () => {
    assert.equal(routeTask({ task: { kind: 'read' } }).tool, 'read');
    assert.equal(routeTask({ task: { kind: 'search' } }).tool, 'search');
  });

  it('routes live inspection to MCP when available', () => {
    const d = routeTask({ task: { kind: 'mcp' }, capabilities: { mcp: { available: true } } });
    assert.equal(d.tool, 'mcp');
  });

  it('falls back to CLI verification when MCP is unavailable and never claims live inspection', () => {
    const d = routeTask({ task: { kind: 'mcp', verification: true }, capabilities: { mcp: { available: false } } });
    assert.equal(d.tool, 'cli');
    assert.equal(d.fallbackApplied, true);
    assert.equal(d.liveInspectionPerformed, false);
  });

  it('falls back to static context when MCP is unavailable and no CLI fallback is requested', () => {
    const d = routeTask({ task: { kind: 'mcp' }, capabilities: { mcp: { available: false } } });
    assert.equal(d.tool, 'read');
    assert.equal(d.fallbackApplied, true);
  });

  it('blocks a live-editor mutation without user confirmation', () => {
    assert.throws(
      () => routeTask({ task: { kind: 'write', target: 'live-editor' }, capabilities: { mcp: { available: true } } }),
      (err) => err instanceof RoutingError && err.blocked === true && err.requiresConfirmation === true
    );
  });

  it('allows a confirmed live-editor mutation via MCP', () => {
    const d = routeTask({ task: { kind: 'write', target: 'live-editor', userConfirmed: true }, capabilities: { mcp: { available: true } } });
    assert.equal(d.tool, 'mcp');
    assert.equal(d.userConfirmed, true);
  });

  it('falls back to a manual request when a confirmed mutation has no MCP', () => {
    const d = routeTask({ task: { kind: 'write', target: 'live-editor', userConfirmed: true }, capabilities: { mcp: { available: false } } });
    assert.equal(d.tool, 'manual');
    assert.equal(d.fallbackApplied, true);
  });

  it('rejects unknown task kinds', () => {
    assert.throws(() => routeTask({ task: { kind: 'teleport' } }), RoutingError);
  });

  it('lists the supported tool kinds', () => {
    assert.deepEqual([...TOOL_KINDS], ['cli', 'read', 'search', 'mcp', 'write', 'manual']);
  });

  it('shapes a tool-call span without leaking secrets', () => {
    const span = toolCallSpan({
      tool: 'cli', args: { command: 'npm test' }, rationale: 'verification',
      startedAt: '2026-09-11T00:00:00.000Z', finishedAt: '2026-09-11T00:00:01.000Z',
      durationMs: 1000, resultClass: 'ok', outputBytes: 10,
    });
    assert.equal(span.kind, 'tool-call');
    assert.equal(span.tool, 'cli');
    assert.equal(span.reason, 'verification');
  });
});

describe('routing — capability detection', () => {
  it('reports CLI always available and never throws when tools are missing', () => {
    const caps = detectCapabilities({ targetDir: process.cwd(), runner: () => ({ status: 1, stdout: '' }) });
    assert.equal(caps.cli, true);
    assert.equal(caps.unityCli.available, false);
    assert.equal(caps.tokenTelemetry.source, 'estimate');
    assert.equal(caps.costTelemetry.available, false);
  });

  it('reports Unity CLI when the probe succeeds', () => {
    const runner = (cmd, args) => {
      if (cmd === 'where' || cmd === 'which') return { status: 0, stdout: '/usr/bin/unity\n' };
      return { status: 0, stdout: '1.0.0-beta.4\n' };
    };
    const caps = detectCapabilities({ targetDir: process.cwd(), runner });
    assert.equal(caps.unityCli.available, true);
    assert.equal(caps.unityCli.version, '1.0.0-beta.4');
  });
});
