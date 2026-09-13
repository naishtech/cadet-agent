import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  validateState, migrateStateV1toV2, migrateStateFile, evaluateTransition, applyTransition,
  createEvidence, computeInputTreeHash, evidenceFreshness, latestEvidenceForGate,
  resetGatesForNewWorkItem, workItemIdOf, requiredGates, StateError, GATES, PHASES, STATE_VERSION,
} from '../src/harness/state.mjs';
import { newId, hashCriteria, sha256, hashTree } from '../src/harness/util.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixtures = join(__dirname, 'fixtures', 'state');
const load = (name) => JSON.parse(readFileSync(join(fixtures, name), 'utf-8'));

function v2State(overrides = {}) {
  return {
    version: 2,
    stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    activeRunId: null,
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: { testsPassed: false },
    gateEvidence: [],
    lastTransition: null,
    spikes: {},
    changeHistory: [],
    ...overrides,
  };
}

function passingEvidence(gate, { workItemId = 'epic-1::story-1.md', treeHash = sha256('tree'), phase = 'implementation', status = 'passed', createdAt = new Date(), expiresAt = null } = {}) {
  return createEvidence({
    evidenceId: newId(),
    workItemId,
    phase,
    gate,
    status,
    command: 'npm test',
    result: 'ok',
    exitCode: 0,
    inputTreeHash: treeHash,
    criteriaHash: hashCriteria(['crit-1']),
    relevantFiles: ['src/a.mjs'],
    createdAt,
    expiresAt,
  });
}

describe('state — validation', () => {
  it('accepts a v2 minimal state', () => {
    const r = validateState(load('v2-minimal-valid.json'));
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('accepts the v1 minimal fixture as valid input', () => {
    const r = validateState(load('v1-minimal-valid.json'));
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('rejects malformed JSON shape', () => {
    const r = validateState('not an object');
    assert.equal(r.valid, false);
  });

  it('rejects invalid enums', () => {
    const r = validateState(load('invalid-enums.json'));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.path === 'session.currentPhase'));
    assert.ok(r.errors.some((e) => e.path === 'session.workflowPath'));
    assert.ok(r.errors.some((e) => e.path === 'session.trackingMode'));
    assert.ok(r.errors.some((e) => e.path === 'epics'));
  });

  it('warns on unknown gates but rejects non-boolean gates', () => {
    const warn = validateState(v2State({ gates: { unknownGate: true } }));
    assert.ok(warn.warnings.some((w) => w.path.startsWith('gates.')));
    const bad = validateState(v2State({ gates: { testsPassed: 'yes' } }));
    assert.equal(bad.valid, false);
  });

  it('rejects an evidence record missing required fields', () => {
    const r = validateState(v2State({ gateEvidence: [{ gate: 'testsPassed' }] }));
    assert.equal(r.valid, false);
  });

  it('rejects a non-UUID activeRunId', () => {
    const r = validateState(v2State({ activeRunId: 'not-a-uuid' }));
    assert.equal(r.valid, false);
  });

  // ------------------------------------------------------------------
  // Gate exceptions vs validation (defect A2).
  //
  // A stale gate may be covered by a scoped, unexpired gate-exception. The
  // transition path honours that; validation used to ignore it, so the two
  // official commands disagreed about the SAME state document - `state transition`
  // reported staleEvidence: [] while `state validate` reported those gates as
  // errors. A consumer could not tell "correctly excepted" from "evidence broken".
  // ------------------------------------------------------------------

  it('honors a scoped, unexpired gate exception when validating', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-exc-'));
    try {
      const rel = 'relevant.txt';
      writeFileSync(join(dir, rel), 'original');
      const treeHash = computeInputTreeHash(dir, [rel]);

      const ev = { ...passingEvidence('testsPassed', { treeHash }), relevantFiles: [rel] };
      const state = v2State({
        gates: { testsPassed: true },
        gateEvidence: [ev],
        changeHistory: [{
          type: 'gate-exception',
          gate: 'testsPassed',
          scope: 'epic-1::story-1.md',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          rationale: 'follow-up chore touched a file this evidence was bound to',
        }],
      });

      // Make the evidence stale: the file changed after the record was written.
      writeFileSync(join(dir, rel), 'changed');

      // Sanity: without the exception this state IS invalid, which is what makes
      // the assertion below meaningful rather than vacuous.
      const withoutException = { ...state, changeHistory: [] };
      assert.equal(validateState(withoutException, { rootDir: dir }).valid, false);

      const r = validateState(state, { rootDir: dir });
      assert.equal(r.valid, true, `expected valid, got errors: ${JSON.stringify(r.errors)}`);
      assert.deepEqual(r.errors, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still rejects a stale gate when the exception is out of scope', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-exc-'));
    try {
      const rel = 'relevant.txt';
      writeFileSync(join(dir, rel), 'original');
      const treeHash = computeInputTreeHash(dir, [rel]);
      const ev = { ...passingEvidence('testsPassed', { treeHash }), relevantFiles: [rel] };

      const state = v2State({
        gates: { testsPassed: true },
        gateEvidence: [ev],
        changeHistory: [{
          type: 'gate-exception',
          gate: 'testsPassed',
          scope: 'epic-9::story-9.md',   // different work item
          rationale: 'unrelated',
        }],
      });
      writeFileSync(join(dir, rel), 'changed');

      const r = validateState(state, { rootDir: dir });
      assert.equal(r.valid, false,
        'an exception scoped to another work item must not excuse this one');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still rejects a stale gate when the exception has expired', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-exc-'));
    try {
      const rel = 'relevant.txt';
      writeFileSync(join(dir, rel), 'original');
      const treeHash = computeInputTreeHash(dir, [rel]);
      const ev = { ...passingEvidence('testsPassed', { treeHash }), relevantFiles: [rel] };

      const state = v2State({
        gates: { testsPassed: true },
        gateEvidence: [ev],
        changeHistory: [{
          type: 'gate-exception',
          gate: 'testsPassed',
          scope: 'epic-1::story-1.md',
          expiresAt: new Date(Date.now() - 60000).toISOString(),   // already expired
          rationale: 'expired',
        }],
      });
      writeFileSync(join(dir, rel), 'changed');

      const r = validateState(state, { rootDir: dir });
      assert.equal(r.valid, false, 'an expired exception must not excuse a stale gate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('state — migration', () => {
  it('migrates v1 to the current version and fills every gate', () => {
    const v1 = load('v1-minimal-valid.json');
    const { state, changed } = migrateStateV1toV2(v1);
    assert.equal(changed, true);
    // v1 migrates straight to the current version. Contract v3 §1 C6 keeps v2
    // readable but does not leave a migrated document at v2.
    assert.equal(state.version, STATE_VERSION);
    assert.equal(state.stateVersion, STATE_VERSION);
    for (const gate of GATES) assert.equal(typeof state.gates[gate], 'boolean');
    assert.deepEqual(state.gateEvidence, []);
    assert.equal(state.session.currentPhase, 'implementation');
  });

  it('infers the active work item from in-progress stories', () => {
    const { state } = migrateStateV1toV2(load('v1-minimal-valid.json'));
    assert.deepEqual(state.activeWorkItem, { epicId: 'epic-1-player-movement', storyId: 'story-1-walk.md' });
  });

  it('preserves unknown legacy top-level fields', () => {
    const { state } = migrateStateV1toV2(load('v1-gates-true-no-evidence.json'));
    assert.deepEqual(state.unexpectedLegacyField, { keep: 'me' });
    assert.equal(state.spikes['spike-1'], 'complete');
  });

  it('is idempotent on an already-v2 document', () => {
    const { changed, state } = migrateStateV1toV2(load('v2-minimal-valid.json'));
    assert.equal(changed, false);
    // A v2 document is NOT silently rewritten to v3 by a read: the version bump
    // must not invalidate existing evidence, so an explicit migration is needed.
    assert.equal(state.version, 2);
  });

  it('is idempotent on an already-v3 document', () => {
    const { changed, state } = migrateStateV1toV2({ version: STATE_VERSION, session: {}, gates: {} });
    assert.equal(changed, false);
    assert.equal(state.version, STATE_VERSION);
  });

  it('does not retroactively invalidate legacy manual evidence when read as v3', () => {
    // The opt-in guarantee at migration level: v2 evidence keeps its shape.
    const v2 = load('v2-minimal-valid.json');
    const r = validateState({ ...v2, version: 3, stateVersion: 3 }, { structuralOnly: true });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('migrates atomically on disk and leaves a backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-migrate-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const statePath = join(dir, '.cadet', 'state.json');
      writeFileSync(statePath, JSON.stringify(load('v1-minimal-valid.json'), null, 2));
      const result = migrateStateFile(statePath);
      assert.equal(result.migrated, true);
      const after = JSON.parse(readFileSync(statePath, 'utf-8'));
      assert.equal(after.version, STATE_VERSION);
      assert.equal(existsSync(`${statePath}.v1.bak`), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the original untouched when migration fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-migrate-bad-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const statePath = join(dir, '.cadet', 'state.json');
      writeFileSync(statePath, '{ this is not json');
      assert.throws(() => migrateStateFile(statePath), StateError);
      assert.equal(readFileSync(statePath, 'utf-8'), '{ this is not json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('state — transitions', () => {
  it('exposes the frozen transition requirements', () => {
    // C4: the `gates` list per transition is unchanged by contract v3.
    assert.deepEqual(requiredGates('review').gates, ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']);
    assert.deepEqual(requiredGates('validation').gates, ['codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated']);
    assert.deepEqual(requiredGates('closed').gates, ['designArtifactSyncConfirmed']);
  });

  it('exposes the v3 revalidation sets (C4 revised)', () => {
    // C4 revised: `revalidate` is new in v3 and is applied only under
    // strictClosure. Pinned here so the rule cannot drift from the contract doc.
    assert.deepEqual(requiredGates('review').revalidate, []);
    assert.deepEqual(requiredGates('validation').revalidate, ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']);
    assert.deepEqual(requiredGates('closed').revalidate, [
      'codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated',
      'testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated',
    ]);
  });

  it('does not apply revalidation when strictClosure is absent', () => {
    // The opt-in guarantee: a stale implementation gate must NOT block closure
    // when the flag is off, or v2 repositories would break on upgrade.
    const state = v2State({
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      gates: { designArtifactSyncConfirmed: true },
      gateEvidence: [passingEvidence('designArtifactSyncConfirmed', { phase: 'validation' })],
    });
    const r = evaluateTransition(state, 'closed', { inputTreeHash: sha256('tree') });
    assert.equal(r.allowed, true, JSON.stringify(r));
    assert.deepEqual(r.revalidated, []);
  });

  it('rejects an illegal transition and lists the missing gates', () => {
    const state = v2State(); // implementation
    const r = evaluateTransition(state, 'validation');
    assert.equal(r.allowed, false);
    assert.ok(r.errors.some((e) => /illegal transition/.test(e)));
  });

  it('rejects a claimed-true gate with no evidence', () => {
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
    });
    const r = evaluateTransition(state, 'review');
    assert.equal(r.allowed, false);
    assert.ok(r.missingGates.includes('testsPassed'));
    assert.ok(r.staleEvidence.some((s) => s.gate === 'testsPassed' && /no evidence/.test(s.reason)));
  });

  it('accepts a transition with fresh evidence for every gate', () => {
    const treeHash = sha256('tree');
    const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
      .map((g) => passingEvidence(g, { treeHash }));
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: evidence,
    });
    const r = evaluateTransition(state, 'review', { inputTreeHash: treeHash });
    assert.equal(r.allowed, true, JSON.stringify(r));
  });

  it('rejects evidence with a stale input tree hash', () => {
    const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
      .map((g) => passingEvidence(g, { treeHash: sha256('old-tree') }));
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: evidence,
    });
    const r = evaluateTransition(state, 'review', { inputTreeHash: sha256('new-tree') });
    assert.equal(r.allowed, false);
    assert.ok(r.staleEvidence.some((s) => s.reasons.some((reason) => /tree hash/.test(reason))));
  });

  it('rejects evidence from a different work item', () => {
    const treeHash = sha256('tree');
    const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
      .map((g) => passingEvidence(g, { treeHash, workItemId: 'epic-9::story-9.md' }));
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: evidence,
    });
    const r = evaluateTransition(state, 'review', { inputTreeHash: treeHash });
    assert.equal(r.allowed, false);
    assert.ok(r.staleEvidence.some((s) => s.reasons.some((reason) => /work item/.test(reason))));
  });

  it('rejects expired evidence', () => {
    const treeHash = sha256('tree');
    const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
      .map((g) => passingEvidence(g, { treeHash, expiresAt: new Date(Date.now() - 1000) }));
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: evidence,
    });
    const r = evaluateTransition(state, 'review', { inputTreeHash: treeHash });
    assert.equal(r.allowed, false);
    assert.ok(r.staleEvidence.some((s) => s.reasons.some((reason) => /expired/.test(reason))));
  });

  it('rejects superseded evidence', () => {
    const treeHash = sha256('tree');
    const ev = passingEvidence('testsPassed', { treeHash });
    ev.status = 'superseded';
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: [ev],
    });
    const r = evaluateTransition(state, 'review', { inputTreeHash: treeHash });
    assert.equal(r.allowed, false);
  });

  it('allows an ungated transition (context-resolution → requirements)', () => {
    const state = v2State({ session: { workflowPath: 'large', currentPhase: 'context-resolution', trackingMode: 'markdown' } });
    assert.equal(evaluateTransition(state, 'requirements').allowed, true);
  });

  it('honors a scoped, unexpired gate exception', () => {
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      changeHistory: [{
        type: 'gate-exception',
        gate: 'testsPassed',
        scope: 'epic-1::story-1.md',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        rationale: 'manually verified',
      }],
    });
    // No evidence at all, but three gates still need evidence — only testsPassed excepted.
    const r = evaluateTransition(state, 'review');
    assert.equal(r.missingGates.includes('testsPassed'), false);
    assert.ok(r.exceptions.includes('testsPassed'));
  });

  it('applies a legal transition and records lastTransition', () => {
    const treeHash = sha256('tree');
    const evidence = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
      .map((g) => passingEvidence(g, { treeHash }));
    const state = v2State({
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: evidence,
    });
    const next = applyTransition(state, 'review', { inputTreeHash: treeHash, evidenceIds: evidence.map((e) => e.evidenceId) });
    assert.equal(next.session.currentPhase, 'review');
    assert.equal(next.lastTransition.from, 'implementation');
    assert.equal(next.lastTransition.to, 'review');
    assert.equal(next.lastTransition.evidenceIds.length, 4);
  });

  it('throws StateError applying an illegal transition', () => {
    assert.throws(() => applyTransition(v2State(), 'validation'), StateError);
  });

  it('resets gates atomically for a new work item', () => {
    const state = v2State({
      gates: { testsPassed: true, codeReviewCompleted: true },
      gateEvidence: [passingEvidence('testsPassed')],
    });
    const next = resetGatesForNewWorkItem(state, { epicId: 'epic-2', storyId: 'story-2.md' });
    for (const gate of GATES) assert.equal(next.gates[gate], false);
    assert.deepEqual(next.gateEvidence, []);
    assert.deepEqual(next.activeWorkItem, { epicId: 'epic-2', storyId: 'story-2.md' });
  });
});

describe('state — evidence helpers', () => {
  it('computes a stable tree hash independent of pair order', () => {
    const a = [hashFileLike('a.mjs', 'aaa'), hashFileLike('b.mjs', 'bbb')];
    const b = [hashFileLike('b.mjs', 'bbb'), hashFileLike('a.mjs', 'aaa')];
    assert.equal(hashTree(a), hashTree(b));
  });

  it('returns the latest evidence for a gate', () => {
    const older = passingEvidence('testsPassed', { createdAt: new Date(Date.now() - 10000) });
    const newer = passingEvidence('testsPassed', { createdAt: new Date() });
    const state = v2State({ gateEvidence: [older, newer] });
    assert.equal(latestEvidenceForGate(state, 'testsPassed').evidenceId, newer.evidenceId);
  });

  it('reports freshness reasons for failed evidence', () => {
    const ev = passingEvidence('testsPassed', { status: 'failed' });
    const { fresh, reasons } = evidenceFreshness(ev, {});
    assert.equal(fresh, false);
    assert.ok(reasons.some((r) => /not passing/.test(r)));
  });

  it('derives a work item id', () => {
    assert.equal(workItemIdOf(v2State()), 'epic-1::story-1.md');
    assert.equal(workItemIdOf({}), 'unscoped');
  });
});

// small helper local to the test
function hashFileLike(path, content) {
  return { path, hash: sha256(content) };
}
