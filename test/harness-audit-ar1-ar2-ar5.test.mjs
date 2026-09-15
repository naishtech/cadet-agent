// Tests for the Agent Reviewer audit findings AR-1 / AR-2 / AR-5
// (2026-09-15, dolven-tactics PR #51).
//
// AR-1 — a gate record MUST be able to cite the commit it attests. Before this
//        change no evidence field carried one and no CLI flag could supply one,
//        so every gate-related fix claim was structurally unverifiable: a claim
//        could name its work item and its files but never the revision.
// AR-2 — a story marked `done` with NO evidence record at all was reported as
//        valid. Eight such stories existed in a real project and `state validate`
//        said "valid, 0 errors, 0 warnings".
// AR-5 — a TDD-matrix row can name a test that was never written, and nothing
//        mechanical checks it until the validation gate, two stories later.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateState, createEvidence, computeInputTreeHash,
} from '../src/harness/state.mjs';
import { newId, hashCriteria, sha256 } from '../src/harness/util.mjs';
import { collectDeclaredTestNames, reconcileTestNames } from '../src/harness/matrix-check.mjs';

function v3State(overrides = {}) {
  return {
    version: 3,
    stateVersion: 3,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    activeRunId: null,
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: {},
    gateEvidence: [],
    lastTransition: null,
    changeHistory: [],
    ...overrides,
  };
}

describe('AR-1 — evidence can cite the commit it attests', () => {
  it('createEvidence carries a null commit by default (v2-shaped records unchanged)', () => {
    const ev = createEvidence({
      workItemId: 'epic-1::story-1.md',
      phase: 'implementation',
      gate: 'testsPassed',
      status: 'passed',
      inputTreeHash: sha256('tree'),
      relevantFiles: ['a.mjs'],
    });
    assert.ok('commit' in ev, 'the commit key must be present so consumers can rely on it');
    assert.equal(ev.commit, null);
  });

  it('createEvidence persists a supplied commit', () => {
    const ev = createEvidence({
      workItemId: 'epic-1::story-1.md',
      phase: 'implementation',
      gate: 'testsPassed',
      status: 'passed',
      inputTreeHash: sha256('tree'),
      relevantFiles: ['a.mjs'],
      commit: 'be4a674',
    });
    assert.equal(ev.commit, 'be4a674');
  });

  it('rejects a commit that is not a hex-ish revision identifier', () => {
    assert.throws(
      () => createEvidence({
        workItemId: 'epic-1::story-1.md',
        phase: 'implementation',
        gate: 'testsPassed',
        status: 'passed',
        inputTreeHash: sha256('tree'),
        relevantFiles: ['a.mjs'],
        commit: 'not a commit!',
      }),
      /commit/i,
    );
  });

  it('state validate accepts a record whose commit is present', () => {
    const ev = createEvidence({
      evidenceId: newId(),
      workItemId: 'epic-1::story-1.md',
      phase: 'implementation',
      gate: 'testsPassed',
      status: 'passed',
      command: 'npm test',
      result: 'ok',
      exitCode: 0,
      inputTreeHash: sha256('whatever'),
      criteriaHash: hashCriteria([]),
      relevantFiles: [],
      commit: 'abc1234',
    });
    const state = v3State({ gates: { testsPassed: true }, gateEvidence: [ev] });
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });
});

describe('AR-2 — a done story with no evidence is not silently valid', () => {
  it('flags a story marked done that has zero evidence records', () => {
    const state = v3State({
      epics: { 'epic-1': { status: 'done', stories: { 'story-1.md': 'done' } } },
    });
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, false, 'a done story with no evidence must not validate clean');
    assert.ok(
      r.errors.some((e) => /no evidence/i.test(e.message) && /story-1/.test(e.message)),
      `expected a no-evidence error naming the story, got ${JSON.stringify(r.errors)}`,
    );
  });

  it('does not flag a planned story with no evidence', () => {
    const state = v3State({
      epics: { 'epic-1': { status: 'planned', stories: { 'story-1.md': 'planned' } } },
    });
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('does not flag a done story that has evidence', () => {
    const ev = createEvidence({
      evidenceId: newId(),
      workItemId: 'epic-1::story-1.md',
      phase: 'implementation',
      gate: 'testsPassed',
      status: 'passed',
      command: 'npm test',
      result: 'ok',
      exitCode: 0,
      inputTreeHash: sha256('x'),
      criteriaHash: hashCriteria([]),
      relevantFiles: [],
    });
    const state = v3State({
      epics: { 'epic-1': { status: 'done', stories: { 'story-1.md': 'done' } } },
      gateEvidence: [ev],
    });
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('honours a pre-harness-story exception, so the documented escape actually works', () => {
    // Before this, the check had no exception path at all: the comment said a
    // project "can resolve it with a scoped gate exception", but the code only
    // consulted gateEvidence, so the escape it promised did not exist.
    const state = v3State({
      epics: { 'epic-1': { status: 'done', stories: { 'story-1.md': 'done' } } },
      changeHistory: [{
        type: 'gate-exception',
        gate: 'storyCoverage',
        category: 'pre-harness-story',
        scope: ['epic-1::story-1.md'],
        rationale: 'Story closed before the harness existed; gates recorded in narrative only.',
      }],
    });
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('an exception for one story does not excuse a different story', () => {
    const state = v3State({
      epics: { 'epic-1': { status: 'done', stories: { 'story-1.md': 'done', 'story-2.md': 'done' } } },
      changeHistory: [{
        type: 'gate-exception',
        gate: 'storyCoverage',
        category: 'pre-harness-story',
        scope: ['epic-1::story-1.md'],
        rationale: 'Story 1 only.',
      }],
    });
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, false, 'the unexcepted story must still be reported');
    assert.ok(r.errors.some((e) => /story-2/.test(e.message)), JSON.stringify(r.errors));
    assert.ok(!r.errors.some((e) => /story-1\.md/.test(e.message)), 'story 1 is excepted');
  });

  it('an unknown exception category is rejected rather than silently honoured', () => {
    const state = v3State({
      epics: { 'epic-1': { status: 'done', stories: { 'story-1.md': 'done' } } },
      changeHistory: [{
        type: 'gate-exception',
        gate: 'storyCoverage',
        category: 'because-i-said-so',
        scope: ['epic-1::story-1.md'],
        rationale: 'not a real category',
      }],
    });
    const r = validateState(state, { structuralOnly: true });
    assert.equal(r.valid, false, 'an unclassifiable exception must not work');
  });
});

describe('AR-5 — matrix test-name reconciliation is mechanical', () => {
  const matrixDoc = [
    '| AC | Declared tests | Notes |',
    '| --- | --- | --- |',
    '| AC-1 | `Real_TestOne`; `Real_TestTwo` — **DELIVERED 2026-09-15** | done |',
    '| AC-2 | `Phantom_NotWritten` — **DELIVERED 2026-09-15** | broken |',
    '| AC-3 | `Planned_ForLater` | not delivered yet, an intention not a claim |',
  ].join('\n');

  it('extracts test names only from DELIVERED rows', () => {
    const { claims, intents } = collectDeclaredTestNames(matrixDoc);
    assert.deepEqual(claims.sort(), ['Phantom_NotWritten', 'Real_TestOne', 'Real_TestTwo'].sort());
    assert.deepEqual(intents.sort(), ['Planned_ForLater']);
  });

  it('reports a delivered name that was never written', () => {
    const inventory = new Set(['Real_TestOne', 'Real_TestTwo']);
    const { claims } = collectDeclaredTestNames(matrixDoc);
    const result = reconcileTestNames({ claims, intents: [] }, inventory);
    assert.deepEqual(result.missingFromInventory, ['Phantom_NotWritten']);
  });

  it('does not report an undelivered intention as missing (no false failures)', () => {
    const inventory = new Set(['Real_TestOne', 'Real_TestTwo']);
    const { intents } = collectDeclaredTestNames(matrixDoc);
    const result = reconcileTestNames({ claims: [], intents }, inventory);
    assert.deepEqual(result.missingFromInventory, []);
  });

  it('reconciles a clean document with no findings', () => {
    const inventory = new Set(['Real_TestOne', 'Real_TestTwo']);
    const { claims } = collectDeclaredTestNames(matrixDoc);
    const clean = claims.filter((c) => c !== 'Phantom_NotWritten');
    const result = reconcileTestNames({ claims: clean, intents: [] }, inventory);
    assert.deepEqual(result.missingFromInventory, []);
  });
});
