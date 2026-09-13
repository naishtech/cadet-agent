/**
 * Contract v3 — strict closure, manual-confirmation quality, exception taxonomy.
 *
 * These tests are written BEFORE the implementation (TDD red). They encode
 * docs/core/HarnessContract-v3.md §1–§4 and §6.
 *
 * Design constraint under test: with `strictClosure` absent or disabled the
 * harness must behave byte-identically to v2. That is the property that makes
 * the change opt-in, so it gets its own regression guard rather than being
 * assumed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  validateState, evaluateTransition, createEvidence, requiredGates,
  activeExceptions, StateError, GATES, STATE_VERSION,
} from '../src/harness/state.mjs';
import { validatePolicy, PolicyError, EXCEPTION_CATEGORIES, EXCEPTION_EXPIRY_DAYS, DEFAULT_STRICT_CLOSURE } from '../src/harness/policy.mjs';
import { newId, hashCriteria, sha256 } from '../src/harness/util.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixtures = join(__dirname, 'fixtures', 'state');

function baseState(overrides = {}) {
  return {
    version: STATE_VERSION,
    stateVersion: STATE_VERSION,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    activeRunId: null,
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: {},
    gateEvidence: [],
    lastTransition: null,
    spikes: {},
    changeHistory: [],
    ...overrides,
  };
}

/** A full-quality manual-confirmation record as v3 requires it. */
function strictManual(gate, {
  workItemId = 'epic-1::story-1.md',
  treeHash = sha256('tree'),
  phase = 'implementation',
  createdAt = new Date(),
  expiresAt = new Date(Date.now() + 60_000),
  reason = 'Unity CLI unavailable; editor reports 0 errors',
  environment = { projectPath: 'E:/proj', editorVersion: '6000.6.0f1' },
  scope = ['Assets/Scripts/Game/SimulationHost.cs'],
  relevantFiles = ['src/a.mjs'],
} = {}) {
  return {
    ...createEvidence({
      evidenceId: newId(),
      workItemId,
      phase,
      gate,
      status: 'manual-confirmation',
      command: null,
      result: 'manual confirmation recorded',
      inputTreeHash: treeHash,
      criteriaHash: hashCriteria(['crit-1']),
      relevantFiles,
      createdAt,
      expiresAt,
      source: 'manual-confirmation',
    }),
    reason,
    environment,
    scope,
  };
}

function automated(gate, { workItemId = 'epic-1::story-1.md', treeHash = sha256('tree'), phase = 'implementation', createdAt = new Date() } = {}) {
  return createEvidence({
    evidenceId: newId(),
    workItemId,
    phase,
    gate,
    status: 'passed',
    command: 'npm test',
    result: 'exit 0',
    exitCode: 0,
    inputTreeHash: treeHash,
    criteriaHash: hashCriteria(['crit-1']),
    relevantFiles: ['src/a.mjs'],
    createdAt,
  });
}

const strictPolicy = (over = {}) => validatePolicy({ strictClosure: { enabled: true, ...over } });

// ── §7 step 1: the off state must be byte-identical to v2 ────────────────────

describe('strict closure — disabled by default', () => {
  it('defaults the policy block to disabled', () => {
    assert.equal(validatePolicy({}).strictClosure.enabled, false);
    assert.equal(DEFAULT_STRICT_CLOSURE.enabled, false);
  });

  it('does not revalidate gates at closure when disabled', () => {
    // A v2-shaped state: designArtifactSyncConfirmed fresh, everything else stale
    // or absent. v2 allows this transition; strict mode must not change it.
    const state = baseState({
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      gates: { designArtifactSyncConfirmed: true },
      gateEvidence: [automated('designArtifactSyncConfirmed', { phase: 'validation' })],
    });
    const r = evaluateTransition(state, 'closed', {
      inputTreeHash: sha256('tree'),
      strictClosure: { enabled: false },
    });
    assert.equal(r.allowed, true, JSON.stringify(r));
  });

  it('keeps the v2 transition gate lists unchanged', () => {
    // C4 target/gate lists are frozen; only `revalidate` is new.
    assert.deepEqual(requiredGates('review').gates, ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']);
    assert.deepEqual(requiredGates('validation').gates, ['codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated']);
    assert.deepEqual(requiredGates('closed').gates, ['designArtifactSyncConfirmed']);
  });
});

// ── §1 C4 revised: closure revalidation ─────────────────────────────────────

describe('strict closure — closure revalidation', () => {
  it('exposes the revalidation sets per transition', () => {
    assert.deepEqual(requiredGates('validation').revalidate, ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']);
    assert.deepEqual(requiredGates('closed').revalidate, [
      'codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated',
      'testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated',
    ]);
    assert.deepEqual(requiredGates('review').revalidate, []);
  });

  it('rejects closure when a revalidated gate has gone stale', () => {
    // The defect this closes: designArtifactSyncConfirmed is fine, but the
    // implementation gates were satisfied against a tree that has since changed.
    const stale = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated'];
    const reviewGates = ['codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated'];
    const state = baseState({
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      gates: { designArtifactSyncConfirmed: true, ...Object.fromEntries([...stale, ...reviewGates].map((g) => [g, true])) },
      gateEvidence: [
        automated('designArtifactSyncConfirmed', { phase: 'validation' }),
        ...stale.map((g) => automated(g, { treeHash: sha256('OLD-tree') })),
        ...reviewGates.map((g) => automated(g, { phase: 'review' })),
      ],
    });
    const r = evaluateTransition(state, 'closed', {
      inputTreeHash: sha256('tree'),
      strictClosure: { enabled: true },
    });
    assert.equal(r.allowed, false);
    assert.ok(r.missingGates.includes('testsPassed'), `expected testsPassed in ${JSON.stringify(r.missingGates)}`);
  });

  it('accepts closure when every revalidated gate is fresh', () => {
    const all = [
      'designArtifactSyncConfirmed',
      'codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated',
      'testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated',
    ];
    const treeHash = sha256('tree');
    const state = baseState({
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      gates: Object.fromEntries(all.map((g) => [g, true])),
      // All records are recorded in the phase being closed (`validation`):
      // freshness is scoped to the current phase, so evidence stamped `review`
      // would be rejected for the phase reason rather than the recency reason
      // this test is about.
      gateEvidence: all.map((g) => automated(g, { treeHash, phase: 'validation' })),
    });
    const r = evaluateTransition(state, 'closed', {
      inputTreeHash: treeHash,
      strictClosure: { enabled: true },
      now: new Date(Date.now() + 1000),
    });
    assert.equal(r.allowed, true, JSON.stringify(r));
  });

  it('rejects an unexpired but pre-transition record when requireFreshRevalidation', () => {
    // "Fresh" must mean "produced after the last transition", not merely
    // "not yet expired" — otherwise a long review phase can carry evidence
    // that predates the very work it is supposed to attest.
    const all = [
      'designArtifactSyncConfirmed',
      'codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated',
      'testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated',
    ];
    const treeHash = sha256('tree');
    const now = new Date();
    const state = baseState({
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      gates: Object.fromEntries(all.map((g) => [g, true])),
      // Everything recorded well before the transition into validation, but in
      // the current phase so the phase-scope check does not fire first — this
      // test isolates the recency rule.
      gateEvidence: all.map((g) => automated(g, {
        treeHash,
        createdAt: new Date(now.getTime() - 3600_000),
        phase: 'validation',
      })),
      lastTransition: { from: 'review', to: 'validation', at: now.toISOString(), evidenceIds: [] },
    });
    const r = evaluateTransition(state, 'closed', {
      inputTreeHash: treeHash,
      strictClosure: { enabled: true, requireFreshRevalidation: true },
      now,
    });
    assert.equal(r.allowed, false);
    assert.ok(r.staleEvidence.some((s) => /predate|before the last transition|not fresh/.test(JSON.stringify(s))),
      JSON.stringify(r.staleEvidence));
  });
});

// ── §3: manual-confirmation quality constraints ─────────────────────────────

describe('strict closure — manual-confirmation quality', () => {
  const gates = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated'];

  it('accepts a fully specified manual-confirmation under strict closure', () => {
    const treeHash = sha256('tree');
    const state = baseState({
      gates: Object.fromEntries(gates.map((g) => [g, true])),
      gateEvidence: gates.map((g) => (g === 'testsPassed' ? automated(g, { treeHash }) : strictManual(g, { treeHash }))),
    });
    const r = validateState(state, { rootDir: null, strictClosure: strictPolicy() });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('rejects a manual-confirmation with no reason, and names the field', () => {
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [strictManual('compileCheckConfirmed', { reason: '' })],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /reason/.test(e.message)), JSON.stringify(r.errors));
  });

  it('rejects a manual-confirmation whose expiresAt is null', () => {
    // The null-freshness-bound defect: declaring the key is not declaring a bound.
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [strictManual('compileCheckConfirmed', { expiresAt: null })],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /expiresAt|freshness/.test(e.message)), JSON.stringify(r.errors));
  });

  it('rejects a manual-confirmation with no environment detail', () => {
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [strictManual('compileCheckConfirmed', { environment: null })],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /environment/.test(e.message)), JSON.stringify(r.errors));
  });

  it('rejects a manual-confirmation with an empty scope', () => {
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [strictManual('compileCheckConfirmed', { scope: [] })],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /scope/.test(e.message)), JSON.stringify(r.errors));
  });

  it('reports every missing manual field at once, not just the first', () => {
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [strictManual('compileCheckConfirmed', { reason: '', environment: null, scope: [] })],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, false);
    const joined = r.errors.map((e) => e.message).join(' | ');
    assert.ok(/reason/.test(joined) && /environment/.test(joined) && /scope/.test(joined), joined);
  });

  it('rejects a validity window longer than maxValidityMs', () => {
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [strictManual('compileCheckConfirmed', {
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 86400_000),
      })],
    }), { strictClosure: strictPolicy({ manualConfirmation: { maxValidityMs: 86400_000 } }) });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /maxValidityMs|validity/.test(e.message)), JSON.stringify(r.errors));
  });

  it('leaves a v2-shaped manual record valid when strict closure is off', () => {
    // The opt-in guarantee, stated as a test: no retroactive invalidation.
    const legacy = { ...createEvidence({
      evidenceId: newId(), workItemId: 'epic-1::story-1.md', phase: 'implementation',
      gate: 'compileCheckConfirmed', status: 'manual-confirmation', command: null,
      result: 'manual confirmation: project=... editor=... scope=...', inputTreeHash: sha256('tree'),
      criteriaHash: hashCriteria([]), relevantFiles: ['src/a.mjs'], createdAt: new Date(),
      expiresAt: null, freshnessPolicy: { scope: 'manual' }, source: 'manual-confirmation',
    }) };
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [legacy],
    }), { strictClosure: validatePolicy({}) });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });
});

// ── §2.1: disallowManualFor ─────────────────────────────────────────────────

describe('strict closure — disallowManualFor', () => {
  it('rejects manual evidence for a gate that must be automated', () => {
    const r = validateState(baseState({
      gates: { testsPassed: true },
      gateEvidence: [strictManual('testsPassed')],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /manual-confirmation is not permitted/.test(e.message)), JSON.stringify(r.errors));
  });

  it('still accepts automated evidence for that same gate', () => {
    const r = validateState(baseState({
      gates: { testsPassed: true },
      gateEvidence: [automated('testsPassed')],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('permits a manual-confirmation for compileCheckConfirmed by default', () => {
    // Documented v2 fallback: Unity CLI absent. Must not be broken by default.
    const r = validateState(baseState({
      gates: { compileCheckConfirmed: true },
      gateEvidence: [strictManual('compileCheckConfirmed')],
    }), { strictClosure: strictPolicy() });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });
});

// ── §4: exception taxonomy ──────────────────────────────────────────────────

describe('strict closure — exception taxonomy', () => {
  // The gate is claimed `false`: these tests isolate exception-taxonomy
  // validation, and a claimed-true gate with no evidence would trip the
  // separate gate-claim check first and mask the taxonomy result.
  const withException = (entry, gates = { testsPassed: false }) => baseState({
    gates,
    changeHistory: [{ type: 'gate-exception', scope: 'epic-1::story-1.md', ...entry }],
  });

  it('defines the category set and per-category expiries', () => {
    assert.deepEqual([...EXCEPTION_CATEGORIES].sort(), [
      'analyzer-fallback', 'budget-override', 'documentation-only',
      'manual-compile', 'tooling-gap', 'unscoped-freshness',
    ]);
    assert.equal(EXCEPTION_EXPIRY_DAYS['manual-compile'], 7);
    assert.equal(EXCEPTION_EXPIRY_DAYS['unscoped-freshness'], 1);
  });

  it('accepts a categorised exception with a closure review note', () => {
    const r = validateState(
      withException({
        gate: 'compileCheckConfirmed',
        category: 'manual-compile',
        reason: 'Unity CLI unavailable',
        closureReviewNote: 'Accepted because no CI runner has an editor; revisit when CI gains one.',
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      }),
      { strictClosure: strictPolicy() },
    );
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('rejects an unknown category and lists the valid set', () => {
    const r = validateState(
      withException({ gate: 'testsPassed', category: 'made-up', reason: 'x', closureReviewNote: 'y' }),
      { strictClosure: strictPolicy() },
    );
    assert.equal(r.valid, false);
    const msg = r.errors.map((e) => e.message).join(' | ');
    assert.ok(/unknown exception category/.test(msg), msg);
    assert.ok(/manual-compile/.test(msg), 'the error must list valid categories');
  });

  it('rejects a category that requires a closure review note when the note is missing', () => {
    const r = validateState(
      withException({ gate: 'testsPassed', category: 'tooling-gap', reason: 'no runner', expiresAt: new Date(Date.now() + 1000).toISOString() }),
      { strictClosure: strictPolicy() },
    );
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /closureReviewNote/.test(e.message)), JSON.stringify(r.errors));
  });

  it('accepts documentation-only without a closure review note', () => {
    const r = validateState(
      withException({ gate: 'testsPassed', category: 'documentation-only', reason: 'docs only', expiresAt: new Date(Date.now() + 1000).toISOString() }),
      { strictClosure: strictPolicy() },
    );
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('rejects an exception that extends beyond its category expiry without a reason', () => {
    const r = validateState(
      withException({
        gate: 'testsPassed',
        category: 'manual-compile', // 7-day default
        reason: 'x',
        closureReviewNote: 'y',
        expiresAt: new Date(Date.now() + 60 * 86400_000).toISOString(),
      }),
      { strictClosure: strictPolicy() },
    );
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /expiryExtendedReason/.test(e.message)), JSON.stringify(r.errors));
  });

  it('allows an extension that states a reason', () => {
    const r = validateState(
      withException({
        gate: 'testsPassed',
        category: 'manual-compile',
        reason: 'x',
        closureReviewNote: 'y',
        expiresAt: new Date(Date.now() + 60 * 86400_000).toISOString(),
        expiryExtendedReason: 'Editor rollout is scheduled and still pending after the default window.',
      }),
      { strictClosure: strictPolicy() },
    );
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('does not apply taxonomy rules when strict closure is disabled', () => {
    // Legacy exception shape (no category) must keep working — it is what
    // Dolven's own changeHistory contains today.
    const r = validateState(
      withException({ gate: 'codeReviewCompleted', reason: 'merged already', rationale: 'already verified', expiresAt: null }),
      { strictClosure: validatePolicy({}) },
    );
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });
});

// ── §2: policy loading ──────────────────────────────────────────────────────

describe('strict closure — policy validation', () => {
  it('rejects an unknown strictClosure key', () => {
    assert.throws(() => validatePolicy({ strictClosure: { enabled: true, nope: 1 } }), PolicyError);
  });

  it('rejects revalidateOnClosure with enabled=false as contradictory', () => {
    // Guards the `budgets.default` failure mode: a knob that is silently inert.
    assert.throws(() => validatePolicy({ strictClosure: { enabled: false, revalidateOnClosure: true } }), PolicyError);
  });

  it('rejects a disallowManualFor entry that is not a known gate', () => {
    assert.throws(() => validatePolicy({ strictClosure: { enabled: true, disallowManualFor: ['notAGate'] } }), PolicyError);
  });

  it('rejects a disallowManualFor entry that cannot ever be manual anyway', () => {
    // codeReviewCompleted is agent-owned; listing it is meaningless and hides intent.
    assert.throws(() => validatePolicy({ strictClosure: { enabled: true, disallowManualFor: ['codeReviewCompleted'] } }), PolicyError);
  });

  it('resolves a valid block with defaults filled in', () => {
    const p = validatePolicy({ strictClosure: { enabled: true } });
    assert.equal(p.strictClosure.revalidateOnClosure, true);
    assert.equal(p.strictClosure.requireFreshRevalidation, true);
    assert.deepEqual(p.strictClosure.disallowManualFor, ['testsPassed']);
    assert.equal(p.strictClosure.manualConfirmation.requireReason, true);
  });
});

// ── §1 C6 revised: v2 → v3 migration ────────────────────────────────────────

describe('strict closure — v3 state version', () => {
  it('reports v3 as the current state version', () => {
    assert.equal(STATE_VERSION, 3);
  });

  it('still accepts a v2 document', () => {
    const r = validateState(loadV2Fixture(), { structuralOnly: true });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('does not retroactively invalidate legacy manual evidence on version bump alone', () => {
    const state = loadV2Fixture();
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });
});

function loadV2Fixture() {
  return JSON.parse(readFileSync(join(fixtures, 'v2-minimal-valid.json'), 'utf-8'));
}
