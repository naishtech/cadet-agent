import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  loadPolicy, createEvidence, computeInputTreeHash, evaluateTransition, hashCriteria, newId,
  runVerificationLoop, RunLedger, BudgetTracker, evaluateHardStop, writeJsonAtomic,
  changedFiles, gitChangedFiles, validateState,
} from '../src/harness/index.mjs';
import { ContextManifest, ContextError } from '../src/harness/context.mjs';
import { validatePolicy, GATES } from '../src/harness/policy.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');
const policy = loadPolicy(repoRoot);

function runCli(args) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-fix-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  return dir;
}

// ── H1: CLI transition freshness ────────────────────────────────────────────

describe('H1 — state transition enforces file freshness', () => {
  it('rejects a transition after a relevant file changed (no explicit hashes)', () => {
    const dir = project();
    try {
      const treeHash = computeInputTreeHash(dir, ['src/a.mjs']);
      const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
        .map((gate) => createEvidence({
          evidenceId: newId(), workItemId: 'epic-1::story-1.md', phase: 'implementation', gate,
          status: 'passed', inputTreeHash: treeHash, criteriaHash: hashCriteria(['ac']), relevantFiles: ['src/a.mjs'],
        }));
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' }, epics: {},
        gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
        gateEvidence: evidence, changeHistory: [],
      }));

      // Transition succeeds while files are unchanged.
      assert.equal(runCli(['state', 'transition', '--to', 'review', '--target', dir, '--format', 'json']).status, 0);

      // Reset back and mutate a relevant file: transition must now be rejected.
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      state.session.currentPhase = 'implementation';
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state));
      writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 999;\n');

      const res = runCli(['state', 'transition', '--to', 'review', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      const out = JSON.parse(res.stdout);
      assert.equal(out.allowed, false);
      assert.ok(out.staleEvidence.some((s) => s.reasons.some((r) => /tree hash/.test(r))));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('evaluateTransition auto-computes the tree hash when not supplied', () => {
    const dir = project();
    try {
      const evidence = createEvidence({
        evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
        status: 'passed', inputTreeHash: computeInputTreeHash(dir, ['src/a.mjs']),
        criteriaHash: hashCriteria(['ac']), relevantFiles: ['src/a.mjs'],
      });
      const state = {
        version: 2, stateVersion: 2,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
        gates: { testsPassed: true }, gateEvidence: [evidence], changeHistory: [],
      };
      writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 2;\n');
      const r = evaluateTransition(state, 'review', { rootDir: dir });
      assert.ok(r.staleEvidence.some((s) => s.gate === 'testsPassed'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── H2: verification binds to relevant files ────────────────────────────────

describe('H2 — harness verify hashes relevant files', () => {
  it('records a non-empty input tree hash from --files', () => {
    const dir = project();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'no_test_required', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
      }));
      runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(0)"', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const ev = state.gateEvidence.find((e) => e.gate === 'testsPassed');
      assert.deepEqual(ev.relevantFiles, ['src/a.mjs']);
      assert.equal(ev.inputTreeHash, computeInputTreeHash(dir, ['src/a.mjs']));
      assert.notEqual(ev.inputTreeHash, computeInputTreeHash(dir, []));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('changedFiles returns forward-slash relative paths for a git repo', () => {
    const files = changedFiles(repoRoot);
    assert.ok(Array.isArray(files));
    for (const f of files) assert.equal(f.includes('\\'), false);
  });

  it('changedFiles returns an empty array outside a git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-nogit-'));
    try {
      assert.deepEqual(changedFiles(dir), []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── H3: artifacts are redacted before persistence ───────────────────────────

describe('H3 — oversized artifacts never contain secrets', () => {
  it('redacts the ledger artifact and hashes the persisted bytes', () => {
    const dir = project();
    try {
      const small = validatePolicy({ output: { maxInlineBytes: 100, previewBytes: 20 } });
      const ledger = new RunLedger({ targetDir: dir, policy: small });
      const secret = ['ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
      const span = ledger.recordOutput({ name: 'big', output: `${'x'.repeat(500)}\nTOKEN=${secret}`, status: 'ok' });
      assert.ok(span.artifactPath);
      const artifactText = readFileSync(span.artifactPath, 'utf-8');
      assert.equal(artifactText.includes(secret), false, 'artifact leaked a secret');
      assert.ok(artifactText.includes('[REDACTED]'));
      // The preview is redacted too.
      assert.equal((span.preview || '').includes(secret), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('redacts verification command artifacts', async () => {
    const dir = project();
    try {
      const artifactDir = join(dir, '.cadet', 'runs', 'artifacts');
      const result = await runVerificationLoop({
        gate: 'compileCheckConfirmed',
        command: 'node -e "process.stdout.write(\'x\'.repeat(500) + String.fromCharCode(10) + \'API_KEY=abcdef123456\')"',
        workItemId: 'e::s', phase: 'implementation', policy, rootDir: dir,
        maxInlineBytes: 100, previewBytes: 20, artifactDir,
        requireRedFirst: false,
      });
      const artifact = result.attempts[0].artifactPath;
      assert.ok(artifact, 'expected an artifact');
      const text = readFileSync(artifact, 'utf-8');
      assert.equal(text.includes('abcdef123456'), false, 'artifact leaked a secret');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── M1: hard budgets block ──────────────────────────────────────────────────

describe('M1 — hard budgets block execution', () => {
  it('a passing command cannot satisfy a gate after the tool-call budget is exhausted', async () => {
    const budgets = new BudgetTracker(policy);
    budgets.set('toolCalls', policy.budgets.maxToolCalls.hard);
    const result = await runVerificationLoop({
      gate: 'compileCheckConfirmed', command: 'noop', workItemId: 'e::s', phase: 'implementation',
      policy, budgets, requireRedFirst: false,
      runCommandImpl: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1, outputBytes: 1 }),
      sleepImpl: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.stopReason, 'budget-exhausted');
  });

  it('context loading throws when the token budget would be exceeded', () => {
    const dir = project();
    try {
      const tiny = validatePolicy({ budgets: { maxContextTokens: { hard: 5, warn: 0.8 } } });
      const m = new ContextManifest({ policy: tiny, rootDir: dir });
      writeFileSync(join(dir, 'src', 'big.mjs'), 'x'.repeat(1000));
      assert.throws(() => m.load({ reference: 'src/big.mjs', tier: 'tier1', reason: 'big' }), ContextError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('evaluateHardStop reports exhaustion', () => {
    const t = new BudgetTracker(policy);
    t.set('wallClockMs', policy.budgets.maxWallClockMs.hard);
    const stop = evaluateHardStop(t);
    assert.equal(stop.exhausted, true);
    assert.equal(stop.blocked, true);
  });
});

// ── M2: red-before-green ────────────────────────────────────────────────────

describe('M2 — red-before-green is enforced', () => {
  const green = async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, durationMs: 1, outputBytes: 2 });

  it('rejects a first-attempt green testsPassed with no prior red', async () => {
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'e::s', phase: 'implementation',
      policy, runCommandImpl: green, sleepImpl: async () => {},
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'red-required');
  });

  it('accepts green when a prior red record exists for the same work item', async () => {
    const red = createEvidence({
      evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
      status: 'failed', inputTreeHash: 'a'.repeat(64), criteriaHash: hashCriteria([]), relevantFiles: [],
    });
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'e::s', phase: 'implementation',
      policy, runCommandImpl: green, sleepImpl: async () => {}, priorEvidence: [red],
    });
    assert.equal(result.status, 'passed');
  });

  it('does not require red for a non-testsPassed gate', async () => {
    const result = await runVerificationLoop({
      gate: 'compileCheckConfirmed', command: 'noop', workItemId: 'e::s', phase: 'implementation',
      policy, runCommandImpl: green, sleepImpl: async () => {},
    });
    assert.equal(result.status, 'passed');
  });

  it('does not require red when explicitly disabled (no_test_required)', async () => {
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'e::s', phase: 'implementation',
      policy, runCommandImpl: green, sleepImpl: async () => {}, requireRedFirst: false,
    });
    assert.equal(result.status, 'passed');
  });

  it('the CLI exempts a no_test_required work item', () => {
    const dir = project();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'no_test_required', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
      }));
      const res = runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(0)"', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── M3: unknown cost cannot satisfy the envelope ────────────────────────────

describe('M3 — unmeasurable cost blocks a configured cost budget', () => {
  it('marks cost unknown and blocks the hard stop check', () => {
    const ledger = new RunLedger({ targetDir: repoRoot, policy });
    ledger.recordUsage({ source: 'provider', inputTokens: 1000, outputTokens: 1000 });
    assert.equal(ledger.usage.costUnknown, true);
    const stop = evaluateHardStop(ledger.tracker);
    assert.equal(stop.blocked, true);
    assert.match(stop.reason, /cost is unmeasurable/);
    assert.equal(ledger.tracker.result().ok, false);
  });

  it('does not block when a rate card resolves the cost', () => {
    const p = validatePolicy({
      model: 'm1',
      estimation: { rateCards: { m1: { id: 'rc', inputRate: 0.000003, outputRate: 0.000015, effectiveDate: '2026-09-01' } } },
    });
    const ledger = new RunLedger({ targetDir: repoRoot, policy: p });
    ledger.recordUsage({ source: 'provider', inputTokens: 1000, outputTokens: 1000 });
    assert.equal(ledger.usage.costUnknown, undefined);
    assert.equal(evaluateHardStop(ledger.tracker).blocked, false);
  });
});

// ── L1: atomic state writes ─────────────────────────────────────────────────

describe('L1 — state writes are atomic', () => {
  it('writeJsonAtomic leaves no temp file behind and writes valid JSON', () => {
    const dir = project();
    try {
      const target = join(dir, '.cadet', 'state.json');
      writeJsonAtomic(target, { version: 2, hello: 'world' });
      assert.equal(existsSync(target), true);
      assert.deepEqual(JSON.parse(readFileSync(target, 'utf-8')), { version: 2, hello: 'world' });
      const leftovers = readdirSync(join(dir, '.cadet')).filter((f) => f.includes('.tmp-'));
      assert.deepEqual(leftovers, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('an interrupted write cannot truncate the existing target', () => {
    const dir = project();
    try {
      const target = join(dir, '.cadet', 'state.json');
      writeFileSync(target, JSON.stringify({ version: 2, keep: true }));
      // JSON.stringify of a BigInt throws; the original must survive.
      assert.throws(() => writeJsonAtomic(target, { bad: 1n }));
      assert.deepEqual(JSON.parse(readFileSync(target, 'utf-8')), { version: 2, keep: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('CLI transition writes valid state', () => {
    const dir = project();
    try {
      const gates = Object.fromEntries(GATES.map((g) => [g, false]));
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'large', currentPhase: 'requirementsComplete', trackingMode: 'markdown' },
        epics: {}, gates, gateEvidence: [], changeHistory: [],
      }));
      const res = runCli(['state', 'transition', '--to', 'architecture', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const after = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(after.session.currentPhase, 'architecture');
      assert.equal(validateState(after).valid, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── F1: verification output tokens are counted ──────────────────────────────

describe('F1 — verification output bytes count against the output budget', () => {
  it('stops when the output-token budget is exceeded', async () => {
    const tiny = validatePolicy({ budgets: { maxOutputTokens: { hard: 100, warn: 0.8 } } });
    const result = await runVerificationLoop({
      gate: 'compileCheckConfirmed', command: 'noop', workItemId: 'e::s', phase: 'implementation',
      policy: tiny, requireRedFirst: false,
      // 3000 bytes / 3 bytes-per-token = 1000 tokens > 100 hard limit.
      runCommandImpl: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1, outputBytes: 3000 }),
      sleepImpl: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.stopReason, 'budget-exhausted');
    assert.ok(result.budget.counters.outputTokens >= 1000);
  });

  it('records the estimate from command output bytes', async () => {
    const result = await runVerificationLoop({
      gate: 'compileCheckConfirmed', command: 'noop', workItemId: 'e::s', phase: 'implementation',
      policy, requireRedFirst: false,
      runCommandImpl: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, durationMs: 1, outputBytes: 300 }),
      sleepImpl: async () => {},
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.budget.counters.outputTokens, 100); // 300 / 3
  });
});

// ── F2: non-git verification fails safe ─────────────────────────────────────

describe('F2 — verification without git cannot silently drop freshness', () => {
  it('blocks when git is unavailable and no --files are given', () => {
    const dir = project(); // temp dir, not a git repo
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'no_test_required', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
      }));
      const res = runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(0)"', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      const out = JSON.parse(res.stdout);
      assert.equal(out.blocked, true);
      assert.equal(out.code, 'freshness-unavailable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('proceeds with explicit --files even without git', () => {
    const dir = project();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'no_test_required', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
      }));
      const res = runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(0)"', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('proceeds without git only when allowEmptyFreshness is explicitly enabled', () => {
    const dir = project();
    try {
      writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify({ allowEmptyFreshness: true }));
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'no_test_required', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
      }));
      const res = runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(0)"', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('gitChangedFiles reports availability explicitly', () => {
    assert.equal(gitChangedFiles(repoRoot).available, true);
    const dir = mkdtempSync(join(tmpdir(), 'cadet-nogit2-'));
    try {
      const r = gitChangedFiles(dir);
      assert.equal(r.available, false);
      assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── F3: validate rejects unsupported true gates ─────────────────────────────

describe('F3 — state validate rejects unbacked true gates', () => {
  it('rejects a v2 state with testsPassed true and no evidence', () => {
    const result = validateState({
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: {}, gates: { testsPassed: true }, gateEvidence: [], changeHistory: [],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'gates.testsPassed'));
  });

  it('accepts a v2 state with testsPassed true and passing evidence', () => {
    const ev = createEvidence({
      evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
      status: 'passed', inputTreeHash: 'a'.repeat(64), criteriaHash: hashCriteria([]), relevantFiles: [],
    });
    const result = validateState({
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: {}, gates: { testsPassed: true }, gateEvidence: [ev], changeHistory: [],
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('accepts manual-confirmation as backing evidence', () => {
    const ev = createEvidence({
      evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'compileCheckConfirmed',
      status: 'manual-confirmation', inputTreeHash: 'a'.repeat(64), criteriaHash: hashCriteria([]), relevantFiles: [],
      source: 'manual-confirmation',
    });
    const result = validateState({
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: {}, gates: { compileCheckConfirmed: true }, gateEvidence: [ev], changeHistory: [],
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('does not flag v1 documents (gates are pre-evidence)', () => {
    const result = validateState({
      version: 1,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: {}, gates: { testsPassed: true }, changeHistory: [],
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('the CLI validate command exits nonzero for an unbacked true gate', () => {
    const dir = project();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        epics: {}, gates: { testsPassed: true }, gateEvidence: [], changeHistory: [],
      }));
      const res = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).valid, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── F4: finalize cannot override an unsafe budget result ────────────────────

describe('F4 — finalize cannot label an unsafe run as success', () => {
  it('forces exhausted runs to stay exhausted', () => {
    const ledger = new RunLedger({ targetDir: repoRoot, policy });
    ledger.tracker.set('toolCalls', policy.budgets.maxToolCalls.hard);
    const rec = ledger.finalize({ status: 'ok' });
    assert.equal(rec.status, 'exhausted');
    assert.notEqual(rec.status, 'ok');
  });

  it('forces unmeasurable-cost runs to blocked, not ok', () => {
    const ledger = new RunLedger({ targetDir: repoRoot, policy });
    ledger.recordUsage({ source: 'provider', inputTokens: 1000, outputTokens: 1000 }); // no rate card
    const rec = ledger.finalize({ status: 'ok' });
    assert.equal(rec.status, 'blocked');
  });

  it('still honors a caller-supplied failure status', () => {
    const ledger = new RunLedger({ targetDir: repoRoot, policy });
    const rec = ledger.finalize({ status: 'failed' });
    assert.equal(rec.status, 'failed');
  });

  it('a healthy run may be finalized ok', () => {
    const ledger = new RunLedger({ targetDir: repoRoot, policy });
    ledger.tracker.add('toolCalls', 1);
    const rec = ledger.finalize({ status: 'ok' });
    assert.equal(rec.status, 'ok');
  });
});

// ── F5: artifact redaction is mandatory ─────────────────────────────────────

describe('F5 — artifact redaction cannot be bypassed', () => {
  it('recordOutput ignores any legacy redactOutput option', () => {
    const dir = project();
    try {
      const small = validatePolicy({ output: { maxInlineBytes: 10, previewBytes: 100 } });
      const ledger = new RunLedger({ targetDir: dir, policy: small });
      const secret = ['ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
      // A caller attempting to bypass redaction must be ignored.
      const span = ledger.recordOutput({ name: 'bypass', output: `TOKEN=${secret}${'x'.repeat(500)}`, redactOutput: false });
      assert.ok(span.artifactPath);
      const text = readFileSync(span.artifactPath, 'utf-8');
      assert.equal(text.includes(secret), false, 'redaction bypass succeeded');
      assert.equal((span.preview || '').includes(secret), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── G1: ledger persistence is atomic ────────────────────────────────────────

describe('G1 — ledger persistence is atomic', () => {
  it('persist() leaves no temp file behind and writes valid JSON', () => {
    const dir = project();
    try {
      const ledger = new RunLedger({ targetDir: dir, policy, workItemId: 'e::s', phase: 'implementation' });
      ledger.addSpan({ kind: 'tool-call', status: 'ok' });
      const path = ledger.persist();
      assert.equal(existsSync(path), true);
      assert.equal(JSON.parse(readFileSync(path, 'utf-8')).runId, ledger.runId);
      const leftovers = readdirSync(join(dir, '.cadet', 'runs')).filter((f) => f.includes('.tmp-'));
      assert.deepEqual(leftovers, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('an interrupted persist cannot truncate an existing run record', () => {
    const dir = project();
    try {
      const ledger = new RunLedger({ targetDir: dir, policy });
      const path = ledger.persist();
      const original = readFileSync(path, 'utf-8');
      // A cyclic record cannot be serialized; the original must survive.
      const cyclic = {};
      cyclic.self = cyclic;
      ledger.spans.push(cyclic);
      assert.throws(() => ledger.persist());
      assert.equal(readFileSync(path, 'utf-8'), original);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── G2: evidence schema validation is complete ──────────────────────────────

describe('G2 — evidence schema validation requires the full contract', () => {
  function baseEvidence() {
    return {
      evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
      status: 'passed', command: 'npm test', result: 'exit 0', inputTreeHash: 'a'.repeat(64),
      criteriaHash: hashCriteria(['ac']), relevantFiles: ['src/a.mjs'], createdAt: new Date().toISOString(),
      expiresAt: null, freshnessPolicy: null,
    };
  }
  function stateWith(ev) {
    return {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
      gates: { testsPassed: true }, gateEvidence: [ev], changeHistory: [],
    };
  }

  it('accepts a complete evidence record', () => {
    const r = validateState(stateWith(baseEvidence()));
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  for (const field of ['command', 'result', 'criteriaHash']) {
    it(`rejects evidence missing ${field}`, () => {
      const ev = baseEvidence();
      delete ev[field];
      const r = validateState(stateWith(ev));
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => e.path.endsWith(`.${field}`)), `expected an error for ${field}`);
    });
  }

  it('rejects evidence with neither expiresAt nor freshnessPolicy', () => {
    const ev = baseEvidence();
    delete ev.expiresAt;
    delete ev.freshnessPolicy;
    const r = validateState(stateWith(ev));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /expiresAt or freshnessPolicy/.test(e.message)));
  });

  it('rejects a malformed criteriaHash', () => {
    const ev = baseEvidence();
    ev.criteriaHash = 'not-a-hash';
    const r = validateState(stateWith(ev));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.path.endsWith('.criteriaHash')));
  });

  it('rejects a non-string command', () => {
    const ev = baseEvidence();
    ev.command = { shell: 'npm test' };
    const r = validateState(stateWith(ev));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.path.endsWith('.command')));
  });

  it('rejects a bad freshnessPolicy scope', () => {
    const ev = baseEvidence();
    ev.freshnessPolicy = { scope: 'forever' };
    const r = validateState(stateWith(ev));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /freshnessPolicy.scope/.test(e.path)));
  });

  it('allows null command/result for a manual confirmation', () => {
    const ev = createEvidence({
      evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'compileCheckConfirmed',
      status: 'manual-confirmation', inputTreeHash: 'a'.repeat(64), criteriaHash: hashCriteria([]),
      relevantFiles: [], source: 'manual-confirmation',
    });
    const r = validateState({
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
      gates: { compileCheckConfirmed: true }, gateEvidence: [ev], changeHistory: [],
    });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });
});

// ── G3: state validate checks evidence binding and freshness ────────────────

describe('G3 — state validate checks work-item binding and freshness', () => {
  function stateWithEvidence(ev) {
    return {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
      gates: { testsPassed: true }, gateEvidence: [ev], changeHistory: [],
    };
  }

  it('rejects evidence bound to a different work item', () => {
    const ev = createEvidence({
      evidenceId: newId(), workItemId: 'other::story', phase: 'implementation', gate: 'testsPassed',
      status: 'passed', inputTreeHash: 'a'.repeat(64), criteriaHash: hashCriteria([]), relevantFiles: [],
    });
    const r = validateState(stateWithEvidence(ev));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /not the active work item/.test(e.message)));
  });

  it('rejects stale evidence when rootDir is provided', () => {
    const dir = project();
    try {
      const staleHash = computeInputTreeHash(dir, ['src/a.mjs']);
      const ev = createEvidence({
        evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
        status: 'passed', inputTreeHash: staleHash, criteriaHash: hashCriteria([]), relevantFiles: ['src/a.mjs'],
      });
      writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 999;\n');
      const r = validateState(stateWithEvidence(ev), { rootDir: dir });
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => /stale evidence/.test(e.message)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts fresh evidence bound to the active work item', () => {
    const dir = project();
    try {
      const ev = createEvidence({
        evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
        status: 'passed', inputTreeHash: computeInputTreeHash(dir, ['src/a.mjs']),
        criteriaHash: hashCriteria([]), relevantFiles: ['src/a.mjs'],
      });
      const r = validateState(stateWithEvidence(ev), { rootDir: dir });
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects expired evidence', () => {
    const ev = createEvidence({
      evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
      status: 'passed', inputTreeHash: 'a'.repeat(64), criteriaHash: hashCriteria([]),
      relevantFiles: [], expiresAt: new Date(Date.now() - 1000),
    });
    const r = validateState(stateWithEvidence(ev));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /expired evidence/.test(e.message)));
  });

  it('the CLI validate command catches a stale-evidence state', () => {
    const dir = project();
    try {
      const staleHash = computeInputTreeHash(dir, ['src/a.mjs']);
      const ev = createEvidence({
        evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
        status: 'passed', inputTreeHash: staleHash, criteriaHash: hashCriteria([]), relevantFiles: ['src/a.mjs'],
      });
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
        version: 2, stateVersion: 2,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
        gates: { testsPassed: true }, gateEvidence: [ev], changeHistory: [],
      }));
      writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 2;\n');
      const res = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).valid, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── G4: validateState freshness wiring is explicit, not silent ──────────────

describe('G4 — validateState freshness is wired, not silently skipped', () => {
  function staleState(dir) {
    const staleHash = computeInputTreeHash(dir, ['src/a.mjs']);
    const ev = createEvidence({
      evidenceId: newId(), workItemId: 'e::s', phase: 'implementation', gate: 'testsPassed',
      status: 'passed', inputTreeHash: staleHash, criteriaHash: hashCriteria([]), relevantFiles: ['src/a.mjs'],
    });
    writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 42;\n');
    return {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
      gates: { testsPassed: true }, gateEvidence: [ev], changeHistory: [],
    };
  }

  it('validateState(state, { rootDir }) flags stale file evidence', () => {
    const dir = project();
    try {
      const r = validateState(staleState(dir), { rootDir: dir });
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => /stale evidence/.test(e.message)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('without rootDir, it passes but warns that freshness was not verified', () => {
    const dir = project();
    try {
      const r = validateState(staleState(dir));
      assert.equal(r.valid, true); // structural-only
      assert.ok(r.warnings.some((w) => /freshness was not verified/.test(w.message)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('structuralOnly suppresses the freshness warning (migration path)', () => {
    const dir = project();
    try {
      const r = validateState(staleState(dir), { structuralOnly: true });
      assert.equal(r.valid, true);
      assert.equal(r.warnings.some((w) => /freshness was not verified/.test(w.message)), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a false-gate state produces no freshness warning', () => {
    const state = {
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
      gates: { testsPassed: false }, gateEvidence: [], changeHistory: [],
    };
    const r = validateState(state);
    assert.equal(r.valid, true);
    assert.equal(r.warnings.some((w) => /freshness was not verified/.test(w.message)), false);
  });
});

// ── F7: freshness must not bind to Cadet's own machinery ────────────────────
//
// `.cadet/state.json` is rewritten every time a gate is recorded, and
// `.cadet/runs/*.json` gains a new ledger on every harness command. When the
// working-tree scan picks them up, the recorded evidence hashes a file that the
// recording itself mutates — so the gate is stale the instant it is written.
// This is unwinnable by retrying and certifies no story code. These tests pin
// the exclusion so the trap cannot return.

function gitProject() {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-selfref-'));
  mkdirSync(join(dir, '.cadet', 'runs'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8', windowsHide: true });
  g(['init', '-q', '.']);
  g(['config', 'user.email', 't@t.t']);
  g(['config', 'user.name', 't']);
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return { dir, g };
}

function v2State(extra = {}) {
  return JSON.stringify({
    version: 2, stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'e', storyId: 's' }, epics: {},
    gates: {
      testsPassed: false, compileCheckConfirmed: false, unityAnalyzerClean: false,
      storyTrackingUpdated: false, codeReviewCompleted: false, securityReviewPassed: false,
      acceptanceCriteriaValidated: false, designArtifactSyncConfirmed: false,
    },
    gateEvidence: [], changeHistory: [], lastTransition: null, activeRunId: null,
    ...extra,
  });
}

describe('F7 — freshness bindings exclude Cadet machinery', () => {
  it('gitChangedFiles omits .cadet/state.json and .cadet/runs/** from the changed set', () => {
    const { dir, g } = gitProject();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State());
      g(['add', '-A']); g(['commit', '-qm', 'state']);
      // Now make Cadet's own files dirty, exactly as a live session does.
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State({ changeHistory: [{ note: 'wip' }] }));
      writeFileSync(join(dir, '.cadet', 'runs', 'abc.json'), '{"run":true}');
      // ...and a real story file alongside them.
      writeFileSync(join(dir, 'src', 'b.mjs'), 'export const b = 2;\n');

      const res = gitChangedFiles(dir);
      assert.equal(res.available, true, res.reason);
      assert.deepEqual(res.files, ['src/b.mjs']);
      assert.equal(res.files.some((f) => f.startsWith('.cadet/')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('recording a gate against a dirty state.json yields fresh, self-consistent evidence', () => {
    const { dir, g } = gitProject();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State());
      g(['add', '-A']); g(['commit', '-qm', 'state']);
      // state.json dirty with no other changes: the minimised self-reference case.
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State({ changeHistory: [{ note: 'wip' }] }));

      const res = runCli(['harness', 'confirm', '--gate', 'compileCheckConfirmed',
        '--type', 'manual-confirmation', '--reason', 'unity compiles clean', '--files', 'src/a.mjs',
        '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);

      // The evidence must not name state.json, and validate must not go stale.
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf8'));
      const ev = state.gateEvidence.at(-1);
      assert.equal(ev.relevantFiles.includes('.cadet/state.json'), false);
      const r = validateState(state, { rootDir: dir });
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('auto-detected evidence does not self-invalidate when only Cadet files are dirty', () => {
    const { dir, g } = gitProject();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State());
      g(['add', '-A']); g(['commit', '-qm', 'state']);
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State({ changeHistory: [{ note: 'wip' }] }));
      writeFileSync(join(dir, '.cadet', 'runs', 'ledger.json'), '{"run":true}');

      // No --files: this is the path that used to bind to Cadet's own files.
      const res = runCli(['harness', 'confirm', '--gate', 'compileCheckConfirmed',
        '--type', 'manual-confirmation', '--reason', 'unity compiles clean',
        '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);

      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf8'));
      const ev = state.gateEvidence.at(-1);
      assert.equal(ev.relevantFiles.some((f) => f.startsWith('.cadet/')), false,
        `evidence bound to Cadet machinery: ${JSON.stringify(ev.relevantFiles)}`);
      const r = validateState(state, { rootDir: dir });
      assert.equal(r.valid, true, JSON.stringify(r.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a non-empty --files list is still honoured verbatim', () => {
    const { dir, g } = gitProject();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State());
      g(['add', '-A']); g(['commit', '-qm', 'state']);
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State({ changeHistory: [{ note: 'wip' }] }));

      const res = runCli(['harness', 'confirm', '--gate', 'securityReviewPassed',
        '--type', 'manual-confirmation', '--reason', 'no secrets', '--files', 'src/a.mjs',
        '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf8'));
      assert.deepEqual(state.gateEvidence.at(-1).relevantFiles, ['src/a.mjs']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('an explicitly empty --files value fails loudly instead of silently auto-binding', () => {
    const { dir, g } = gitProject();
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State());
      g(['add', '-A']); g(['commit', '-qm', 'state']);
      writeFileSync(join(dir, '.cadet', 'state.json'), v2State({ changeHistory: [{ note: 'wip' }] }));

      const res = runCli(['harness', 'confirm', '--gate', 'compileCheckConfirmed',
        '--type', 'manual-confirmation', '--reason', 'x', '--files', '',
        '--target', dir, '--format', 'json']);
      assert.notEqual(res.status, 0, 'empty --files must not silently fall back to the working tree');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
