import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHook } from '../src/harness/hook.mjs';
import { assertContained, ArchiveError } from '../src/harness/archive.mjs';
import { evaluateTransition } from '../src/harness/state.mjs';
import { redactString } from '../src/harness/redaction.mjs';
import { validatePolicy, PolicyError } from '../src/harness/policy.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const coreDir = join(repoRoot, '.cadet', 'agent', 'core');
const skillsDir = join(coreDir, 'skills');

/**
 * Adversarial suite: prove the new guards FAIL when expected. A guard that only
 * ever returns "clean" launders the absence of verification into a green test.
 */

describe('adversarial — gate bypass attempts are rejected', () => {
  it('rejects an old gate-only state that claims true with no evidence', () => {
    const legacy = {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' },
      epics: {},
      // The v1 shape: gates true, no evidence.
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: [], changeHistory: [],
    };
    const r = evaluateTransition(legacy, 'review');
    assert.equal(r.allowed, false);
    assert.equal(r.missingGates.length, 4);
  });

  it('rejects a forged evidence record with the wrong work item', () => {
    const state = {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'real', storyId: 'real-story' },
      epics: {},
      gates: { testsPassed: true },
      gateEvidence: [{
        evidenceId: '11111111-1111-4111-8111-111111111111',
        workItemId: 'other::other-story',
        phase: 'implementation',
        gate: 'testsPassed',
        status: 'passed',
        inputTreeHash: 'a'.repeat(64),
        criteriaHash: 'b'.repeat(64),
        relevantFiles: [],
        createdAt: new Date().toISOString(),
      }],
      changeHistory: [],
    };
    const r = evaluateTransition(state, 'review');
    assert.ok(r.staleEvidence.some((s) => s.reasons.some((reason) => /work item/.test(reason))));
  });
});

describe('adversarial — archive containment cannot be bypassed', () => {
  const dir = repoRoot;
  const attacks = [
    '../escape',
    '..\\..\\escape',
    'a/../../escape',
    '/etc/passwd',
    'C:/Windows/system32',
    '\\\\server\\share\\file',
  ];
  for (const attack of attacks) {
    it(`rejects entry "${attack}"`, () => {
      assert.throws(() => assertContained(dir, attack), ArchiveError);
    });
  }
});

describe('adversarial — hook bypass attempts', () => {
  it('blocks malformed JSON instead of failing open', () => {
    const r = evaluateHook('{"toolName": "bash", "toolInput": ');
    assert.equal(r.decision, 'deny');
    assert.equal(r.code, 'hook-error');
  });

  it('blocks an obfuscated git write', () => {
    for (const cmd of ['g\\it commit -m x', '"git" commit -m x', 'git -c a=b commit -m x', 'git --no-pager push']) {
      assert.equal(evaluateHook(JSON.stringify({ toolName: 'bash', toolInput: cmd })).decision, 'ask', `should ask: ${cmd}`);
    }
  });

  it('does not treat a read-only command as a write', () => {
    for (const cmd of ['git status', 'git log', 'git diff HEAD', 'gh pr view 1']) {
      assert.equal(evaluateHook(JSON.stringify({ toolName: 'bash', toolInput: cmd })).decision, 'pass', `should pass: ${cmd}`);
    }
  });
});

describe('adversarial — redaction cannot be trivially defeated', () => {
  it('redacts secrets nested inside arrays and objects', () => {
    const payload = { headers: ['Authorization: Bearer abcdefghijklmnop'], nested: { deep: { password: 'hunter2' } } };
    const out = redactString(JSON.stringify(payload));
    assert.equal(out.includes('abcdefghijklmnop'), false);
  });

  it('does not redact ordinary prose', () => {
    assert.equal(redactString('the password field must be validated'), 'the password field must be validated');
  });
});

describe('adversarial — policy cannot silently weaken safety', () => {
  it('rejects an unknown policy key', () => {
    assert.throws(() => validatePolicy({ disableBudgets: true }), PolicyError);
  });

  it('rejects exceeding a hard safety ceiling without the explicit flag', () => {
    assert.throws(() => validatePolicy({ budgets: { maxArchiveFiles: 100000 } }), /hard safety ceiling/);
  });
});

describe('adversarial — no skill restates the harness contract', () => {
  it('every skill points at Harness.md instead of duplicating its budget table', () => {
    for (const file of readdirSync(skillsDir)) {
      if (!file.endsWith('.md')) continue;
      const content = readFileSync(join(skillsDir, file), 'utf-8');
      // No skill should carry the canonical budget table.
      assert.equal(
        content.includes('| Context tokens | 64,000'),
        false,
        `${file} duplicates the Harness.md budget table`
      );
    }
  });

  it('Harness.md is the single source of the budget table', () => {
    const harness = readFileSync(join(coreDir, 'Harness.md'), 'utf-8');
    assert.ok(harness.includes('| Context tokens | 64,000'), 'Harness.md must own the budget table');
  });
});

describe('adversarial — CLI guard rails', () => {
  const cli = join(repoRoot, 'bin', 'cli.mjs');

  it('state transition exits nonzero for an illegal transition', () => {
    const res = spawnSync('node', [cli, 'state', 'transition', '--to', 'closed', '--format', 'json'], {
      encoding: 'utf-8', cwd: repoRoot, windowsHide: true,
    });
    // No state.json in the repo root => cannot transition (exit 2), or rejected (exit 1).
    assert.notEqual(res.status, 0);
  });

  it('harness verify exits nonzero when a gate cannot be automated', () => {
    const res = spawnSync('node', [cli, 'harness', 'verify', '--gate', 'unityAnalyzerClean', '--format', 'json'], {
      encoding: 'utf-8', cwd: repoRoot, windowsHide: true,
    });
    assert.notEqual(res.status, 0);
  });
});
