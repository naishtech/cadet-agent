import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateState, toStateV4, splitEvidence, buildEvidenceCoverage, appendEvidence, recordEvidence,
  migrateStateDocument, migrateStateFile, parseTargetVersion, applyTransition,
  resetGatesForNewWorkItem, workItemIdOf, sealWorkItem, isHistoryExternal, compactHistory,
  STATE_VERSION, GATES, HISTORY_ENTRIES_KEPT, StateError,
} from '../src/harness/state.mjs';
import { newId, sha256, hashCriteria } from '../src/harness/util.mjs';

const ACTIVE = 'epic-8-playable-skirmish::story-4-production-on-buildings.md';
const CLOSED = 'epic-8-playable-skirmish::story-3-order-dispatch.md';

function evidence(gate, { workItemId = ACTIVE, status = 'passed', createdAt = '2026-09-20T00:00:00.000Z', treeHash = sha256('tree'), partial = false } = {}) {
  return {
    evidenceId: newId(),
    workItemId,
    acceptanceCriterionId: null,
    phase: 'implementation',
    gate,
    status,
    command: 'npm test',
    result: 'exit 0',
    exitCode: 0,
    artifactPath: null,
    artifactHash: null,
    inputTreeHash: treeHash,
    criteriaHash: hashCriteria(['ac']),
    relevantFiles: ['src/a.mjs'],
    toolVersion: null,
    createdAt,
    expiresAt: null,
    freshnessPolicy: { scope: 'story' },
    supersededBy: null,
    source: 'automated',
    ...(partial ? { partial: true } : {}),
  };
}

/** A v2 document with history: evidence for a closed item plus the active one. */
function v2WithHistory(overrides = {}) {
  return {
    version: 2,
    stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-8-playable-skirmish', storyId: 'story-4-production-on-buildings.md' },
    activeRunId: null,
    epics: {
      'epic-8-playable-skirmish': {
        status: 'in-progress',
        stories: { 'story-3-order-dispatch.md': 'done', 'story-4-production-on-buildings.md': 'in-progress' },
      },
    },
    gates: { testsPassed: true },
    // The closed item's records are older, so the active item's record is the
    // latest for `testsPassed` — which is what `latestEvidenceForGate` reads, and
    // what makes this document valid before compaction (the premise of the safety
    // assertion below).
    gateEvidence: [
      evidence('testsPassed', { workItemId: CLOSED, createdAt: '2026-09-01T00:00:00.000Z' }),
      evidence('codeReviewCompleted', { workItemId: CLOSED, status: 'superseded', createdAt: '2026-09-02T00:00:00.000Z' }),
      evidence('testsPassed'),
    ],
    lastTransition: null,
    spikes: {},
    changeHistory: [
      { date: '2026-09-01T00:00:00.000Z', change: 'Phase transition implementation → review', phase: 'review' },
      {
        type: 'gate-exception',
        gate: 'codeReviewCompleted',
        category: 'documentation-only',
        scope: CLOSED,
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('state v4 — history moves out of the document', () => {
  it('keeps only the active work item inline and reports the rest for archiving', () => {
    const { live, archived, coverage } = splitEvidence(v2WithHistory());
    assert.equal(live.length, 1, 'only the active work item stays inline');
    assert.equal(archived.length, 2);
    // Coverage covers everything, including what leaves: the index is the memory.
    assert.equal(coverage[ACTIVE].recordCount, 1);
    assert.equal(coverage[CLOSED].recordCount, 2);
  });

  it('is provably safe for a valid document: every true gate is backed inline', () => {
    // The invariant that makes compaction safe by construction. `validateState`
    // rejects a true gate whose evidence belongs to another work item, so keeping
    // the active work item cannot orphan a gate that was already valid.
    const before = v2WithHistory();
    assert.equal(validateState(before, { structuralOnly: true }).valid, true);

    const { state: after, archived } = toStateV4(before);
    assert.equal(archived.length, 2);
    assert.equal(validateState(after, { structuralOnly: true }).valid, true,
      JSON.stringify(validateState(after, { structuralOnly: true }).errors));
  });

  it('promotes gate exceptions into their own field and bounds the change log', () => {
    const { state, archivedHistory } = toStateV4(v2WithHistory());
    assert.equal(state.version, STATE_VERSION);
    assert.equal(state.gateExceptions.length, 1);
    assert.equal(state.gateExceptions[0].gate, 'codeReviewCompleted');
    // `changeHistory` is bounded, not retired: eight skills record artifact paths
    // in it and Resume reads its tail, so removing the field would break them.
    // What was unbounded was the contents (pasted handoff summaries).
    assert.ok(Array.isArray(state.changeHistory));
    assert.deepEqual(archivedHistory, []);
    assert.ok(isHistoryExternal(state));
  });

  it('archives only the change-log overflow, keeping the recent tail inline', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      date: '2026-09-01T00:00:00.000Z',
      change: `note ${i}`,
      phase: 'implementation',
    }));
    const { state, archivedHistory } = toStateV4(v2WithHistory({ changeHistory: many }));
    assert.equal(state.changeHistory.length, HISTORY_ENTRIES_KEPT);
    assert.equal(archivedHistory.length, 60 - HISTORY_ENTRIES_KEPT);
    // The tail is what stays, because that is what Resume cross-checks.
    assert.equal(state.changeHistory.at(-1).change, 'note 59');
    assert.equal(archivedHistory[0].change, 'note 0');
  });

  it('never loses a gate exception to history compaction', () => {
    // The overflow path must not swallow live state. Exceptions are promoted
    // before the log is bounded, so an exception can sit at index 0 and still
    // survive a 60-entry trim.
    const many = Array.from({ length: 60 }, (_, i) => ({ date: '2026-09-01T00:00:00.000Z', change: `note ${i}` }));
    const before = v2WithHistory({
      changeHistory: [
        { type: 'gate-exception', gate: 'testsPassed', scope: ACTIVE, expiresAt: '2099-01-01T00:00:00.000Z' },
        ...many,
      ],
    });
    const { state, archivedHistory } = toStateV4(before);
    assert.equal(state.gateExceptions.length, 1);
    assert.equal(archivedHistory.some((e) => e.type === 'gate-exception'), false);
  });

  it('an exception still excuses its gate after promotion', () => {
    // The promotion is a move, not a rewrite: an exception that a gate depends on
    // must keep working, or compacting a repository would break its closure.
    // Scoped to the ACTIVE work item, because that is the only scope an exception
    // can excuse — one for another story must not leak into this one.
    const before = v2WithHistory({
      gates: { testsPassed: true, codeReviewCompleted: true },
      changeHistory: [
        {
          type: 'gate-exception',
          gate: 'codeReviewCompleted',
          category: 'documentation-only',
          scope: ACTIVE,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      ],
    });
    assert.equal(validateState(before, { structuralOnly: true }).valid, true,
      JSON.stringify(validateState(before, { structuralOnly: true }).errors));

    const { state } = toStateV4(before);
    assert.deepEqual(state.gateExceptions.map((e) => e.gate), ['codeReviewCompleted']);
    assert.equal(validateState(state, { structuralOnly: true }).valid, true,
      JSON.stringify(validateState(state, { structuralOnly: true }).errors));
  });

  it('an exception scoped to another story still does not excuse the active one', () => {
    // Control for the test above: the promotion must not widen an exception's scope.
    const before = v2WithHistory({ gates: { testsPassed: true, codeReviewCompleted: true } });
    const { state } = toStateV4(before);
    const result = validateState(state, { structuralOnly: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'gates.codeReviewCompleted'));
  });

  it('refuses a keep selector it does not understand rather than guessing', () => {
    assert.throws(() => splitEvidence(v2WithHistory(), { keep: 'everything' }), StateError);
  });

  it('--keep always keeps every record inline, which is the non-vacuity control', () => {
    const { live, archived } = splitEvidence(v2WithHistory(), { keep: 'always' });
    assert.equal(live.length, 3);
    assert.equal(archived.length, 0);
  });

  it('--keep can name the work items to retain', () => {
    const { live, archived } = splitEvidence(v2WithHistory(), { keep: [CLOSED] });
    assert.equal(live.length, 2);
    assert.equal(archived.length, 1);
    assert.ok(archived.every((r) => r.workItemId === ACTIVE));
  });
});

describe('state v4 — the coverage index keeps AR-2 answerable', () => {
  it('does not report a done story as unevidenced once its records are archived', () => {
    // The regression this whole design risks. Without the index, compaction looks
    // exactly like evidence loss, and the framework would accuse a correctly
    // compacted repository of having closed a story with no evidence.
    const { state } = toStateV4(v2WithHistory());
    const result = validateState(state, { structuralOnly: true });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.ok(!result.errors.some((e) => /story-3-order-dispatch/.test(e.path)));
  });

  it('still reports a done story that has neither records nor an index row', () => {
    // The control: the check must remain capable of failing, or the assertion
    // above proves nothing.
    const before = v2WithHistory({
      epics: {
        'epic-8-playable-skirmish': {
          status: 'in-progress',
          stories: { 'story-9-never-worked.md': 'done', 'story-4-production-on-buildings.md': 'in-progress' },
        },
      },
    });
    const result = validateState(before, { structuralOnly: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /story-9-never-worked/.test(e.path)));
  });

  it('merges rather than replaces the index when new evidence arrives', () => {
    const { state } = toStateV4(v2WithHistory());
    const next = appendEvidence(state, evidence('storyTrackingUpdated'));
    assert.equal(next.evidenceCoverage[CLOSED].recordCount, 2, 'archived coverage must survive');
    assert.equal(next.evidenceCoverage[ACTIVE].recordCount, 2);
    assert.deepEqual(next.evidenceCoverage[ACTIVE].gates, ['storyTrackingUpdated', 'testsPassed']);
  });

  it('rejects a malformed coverage index instead of reading it as empty', () => {
    const bad = { ...v2WithHistory(), version: STATE_VERSION, stateVersion: STATE_VERSION, evidenceCoverage: [] };
    const result = validateState(bad, { structuralOnly: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'evidenceCoverage'));

    const badRow = { ...v2WithHistory(), version: STATE_VERSION, stateVersion: STATE_VERSION, evidenceCoverage: { x: { recordCount: -1 } } };
    assert.ok(validateState(badRow, { structuralOnly: true }).errors.some((e) => /recordCount/.test(e.path)));
  });

  it('rejects a non-array gateExceptions field', () => {
    const bad = { ...v2WithHistory(), version: STATE_VERSION, stateVersion: STATE_VERSION, gateExceptions: 'nope' };
    assert.ok(validateState(bad, { structuralOnly: true }).errors.some((e) => e.path === 'gateExceptions'));
  });

  it('summarises a record set into rows keyed by work item', () => {
    const coverage = buildEvidenceCoverage([
      evidence('testsPassed', { createdAt: '2026-09-01T00:00:00.000Z' }),
      evidence('testsPassed', { createdAt: '2026-09-05T00:00:00.000Z' }),
    ]);
    assert.equal(coverage[ACTIVE].recordCount, 2);
    assert.equal(coverage[ACTIVE].firstAt, '2026-09-01T00:00:00.000Z');
    assert.equal(coverage[ACTIVE].lastAt, '2026-09-05T00:00:00.000Z');
  });
});

describe('state v4 — history stops growing', () => {
  it('does not append to changeHistory on a v4 document', () => {
    const treeHash = sha256('tree');
    const gates = Object.fromEntries(GATES.map((g) => [g, true]));
    const v4 = {
      version: STATE_VERSION,
      stateVersion: STATE_VERSION,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-8-playable-skirmish', storyId: 'story-4-production-on-buildings.md' },
      epics: {},
      gates,
      gateEvidence: ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
        .map((g) => evidence(g, { treeHash })),
      gateExceptions: [],
      evidenceCoverage: {},
    };
    const next = applyTransition(v4, 'review', { inputTreeHash: treeHash });
    assert.equal(next.session.currentPhase, 'review');
    assert.ok(!('changeHistory' in next), 'v4 must not accumulate transition prose');
    assert.equal(next.lastTransition.to, 'review');
  });

  it('keeps recording history for a v2 document, because that is how v2 was specified', () => {
    // Parity guard: the change must be scoped to v4, not applied retroactively.
    const treeHash = sha256('tree');
    const v2 = {
      version: 2,
      stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' },
      epics: {},
      gates: Object.fromEntries(GATES.map((g) => [g, true])),
      gateEvidence: ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
        .map((g) => evidence(g, { treeHash, workItemId: 'e::s' })),
      changeHistory: [],
    };
    const next = applyTransition(v2, 'review', { inputTreeHash: treeHash });
    assert.equal(next.changeHistory.length, 1);
  });

  it('keeps an existing bounded log untouched on a v4 transition', () => {
    // A transition must not silently discard the artifact registrations the skills
    // wrote; it simply stops adding machine-generated lines of its own.
    const treeHash = sha256('tree');
    const v4 = {
      version: STATE_VERSION,
      stateVersion: STATE_VERSION,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'e', storyId: 's' },
      epics: {},
      gates: Object.fromEntries(GATES.map((g) => [g, true])),
      gateEvidence: ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']
        .map((g) => evidence(g, { treeHash, workItemId: 'e::s' })),
      changeHistory: [{ date: '2026-09-01T00:00:00.000Z', change: 'Requirements at docs/req.md', phase: 'requirements' }],
    };
    const next = applyTransition(v4, 'review', { inputTreeHash: treeHash });
    assert.deepEqual(next.changeHistory, v4.changeHistory);
  });

  it('bounds a log on demand and preserves the dropped tail for archiving', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ date: '2026-09-01T00:00:00.000Z', change: `n${i}` }));
    const { kept, archived } = compactHistory(entries, { keepRecent: 3 });
    assert.deepEqual(kept.map((e) => e.change), ['n7', 'n8', 'n9']);
    assert.equal(archived.length, 7);
    assert.deepEqual(compactHistory(entries, { keepRecent: 50 }).kept, entries);
  });

  it('folds cleared evidence into the index when a work item is reset', () => {
    const { state } = toStateV4(v2WithHistory());
    const next = resetGatesForNewWorkItem(state, { epicId: 'epic-9', storyId: 'story-1.md' });
    assert.deepEqual(next.gateEvidence, []);
    for (const gate of GATES) assert.equal(next.gates[gate], false);
    // The records are gone but their existence is not: this is the difference
    // between "compacted" and "never verified".
    assert.equal(next.evidenceCoverage[ACTIVE].recordCount, 1);
    assert.equal(next.evidenceCoverage[CLOSED].recordCount, 2);
  });

  it('drops an expired exception on reset but keeps a live one', () => {
    const expired = {
      ...v2WithHistory().changeHistory[1],
      gate: 'securityReviewPassed',
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    const { state } = toStateV4(v2WithHistory({ changeHistory: [...v2WithHistory().changeHistory, expired] }));
    assert.equal(state.gateExceptions.length, 2);
    const next = resetGatesForNewWorkItem(state, { epicId: 'e', storyId: 's' });
    assert.deepEqual(next.gateExceptions.map((e) => e.gate), ['codeReviewCompleted']);
  });
});

describe('state v4 — migration', () => {
  it('parses a --to value and rejects a nonsense one', () => {
    assert.equal(parseTargetVersion(null), null);
    assert.equal(parseTargetVersion('4'), 4);
    assert.equal(parseTargetVersion('v4'), 4);
    assert.ok(Number.isNaN(parseTargetVersion('banana')));
    assert.ok(Number.isNaN(parseTargetVersion('99')));
    assert.ok(Number.isNaN(parseTargetVersion('0')));
  });

  it('migrates v2 to v4 only when a target is asked for', () => {
    const doc = v2WithHistory();
    assert.equal(migrateStateDocument(doc).changed, false, 'a read must not silently bump the version');
    assert.equal(migrateStateDocument(doc).state.version, 2);

    const explicit = migrateStateDocument(doc, { to: 4 });
    assert.equal(explicit.changed, true);
    assert.equal(explicit.state.version, 4);
    assert.equal(explicit.archived.length, 2);
    assert.equal(explicit.promoted, 1);
  });

  it('is a no-op on a document that is already v4, so a retried migration is safe', () => {
    const { state } = toStateV4(v2WithHistory());
    const again = migrateStateDocument(state, { to: 4 });
    assert.equal(again.changed, false);
    assert.equal(again.state, state);
  });

  it('downgrading is refused', () => {
    const { state } = toStateV4(v2WithHistory());
    assert.equal(migrateStateDocument(state, { to: 2 }).changed, false);
  });

  it('fails a malformed --to loudly', () => {
    assert.throws(() => migrateStateDocument(v2WithHistory(), { to: 'nope' }), StateError);
  });

  it('writes the archive before the document that stops referencing it', () => {
    // The crash-safety ordering. If the process died between the two writes, the
    // safe state is "records in both places", so the archive must land first.
    const dir = mkdtempSync(join(tmpdir(), 'cadet-v4-order-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const statePath = join(dir, '.cadet', 'state.json');
      writeFileSync(statePath, JSON.stringify(v2WithHistory(), null, 2));

      const order = [];
      const result = migrateStateFile(statePath, {
        to: 4,
        beforeWrite: ({ archived }) => { order.push(`archive:${archived.length}`); },
      });
      order.push(`state:${JSON.parse(readFileSync(statePath, 'utf-8')).version}`);

      assert.equal(result.migrated, true);
      assert.deepEqual(order, ['archive:2', 'state:4']);
      assert.equal(existsSync(`${statePath}.v2.bak`), true, 'the backup names the version it came from');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the tree untouched when writing the archive fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-v4-atomic-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const statePath = join(dir, '.cadet', 'state.json');
      const original = JSON.stringify(v2WithHistory(), null, 2);
      writeFileSync(statePath, original);

      assert.throws(() => migrateStateFile(statePath, {
        to: 4,
        beforeWrite: () => { throw new Error('disk full'); },
      }), /disk full/);

      assert.equal(readFileSync(statePath, 'utf-8'), original, 'a failed archive must leave state.json alone');
      assert.equal(existsSync(`${statePath}.v2.bak`), false, 'and must not leave a backup behind');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stages its temp file beside the target, not in the OS temp directory', () => {
    // `renameSync` is atomic only within one filesystem. Staging in os.tmpdir()
    // passes on a single-drive machine and fails with EXDEV the moment the
    // project sits on a different volume than the temp dir — the common Windows
    // layout of temp on C: and the project on D: or E:. Asserting the temp file
    // is a sibling of state.json is what keeps that failure unreachable, and it
    // cannot be asserted from the OS temp dir because libuv caches tmpdir.
    const dir = mkdtempSync(join(tmpdir(), 'cadet-v4-sibling-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const statePath = join(dir, '.cadet', 'state.json');
      writeFileSync(statePath, JSON.stringify(v2WithHistory(), null, 2));

      let sawSiblingTemp = false;
      migrateStateFile(statePath, {
        to: 4,
        beforeWrite: () => {
          sawSiblingTemp = readdirSync(join(dir, '.cadet')).some((name) => name.startsWith('state.json.tmp-'));
        },
      });

      assert.equal(sawSiblingTemp, true, 'the temp file must be a sibling of the target so the rename stays on one volume');
      assert.equal(JSON.parse(readFileSync(statePath, 'utf-8')).version, 4);
      assert.equal(
        readdirSync(join(dir, '.cadet')).some((name) => name.includes('.tmp-')),
        false,
        'the temp file must not be left behind',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a v1 document all the way to v4', () => {
    const v1 = {
      version: 1,
      session: { workflowPath: 'small', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
      gates: { testsPassed: false },
      spikes: {},
      changeHistory: [],
    };
    const { state, changed } = migrateStateDocument(v1);
    assert.equal(changed, true);
    assert.equal(state.version, STATE_VERSION);
    assert.equal(validateState(state, { structuralOnly: true }).valid, true);
    assert.deepEqual(state.evidenceCoverage, {});
    assert.deepEqual(state.gateExceptions, []);
  });
});

describe('state v4 — sealing', () => {
  it('encodes the active work item into trailer lines', () => {
    const { state } = toStateV4(v2WithHistory());
    const { workItemId, records, lines, partial } = sealWorkItem(state);
    assert.equal(workItemId, ACTIVE);
    assert.equal(records.length, 1);
    assert.deepEqual(partial, []);
    assert.ok(lines.join('\n').includes('Cadet-Gate: testsPassed'));
  });

  it('seals exactly what compaction kept inline', () => {
    // These two must agree, or the commit and the archive would describe
    // different sets of records for the same work item.
    const { state, archived } = toStateV4(v2WithHistory());
    const { records } = sealWorkItem(state);
    const inlineIds = state.gateEvidence.map((r) => r.evidenceId).sort();
    assert.deepEqual(records.map((r) => r.evidenceId).sort(), inlineIds);
    assert.equal(archived.some((r) => inlineIds.includes(r.evidenceId)), false);
  });

  it('reports nothing to seal when there is no inline evidence', () => {
    const { state } = toStateV4(v2WithHistory(), { keep: [] });
    assert.equal(sealWorkItem(state).records.length, 0);
  });

  it('marks records that exceed the trailer bound as partial', () => {
    const huge = evidence('testsPassed', {});
    huge.relevantFiles = Array.from({ length: 400 }, (_, i) => `Assets/Very/Long/Segment/File${i}.cs`);
    const state = { ...v2WithHistory(), gateEvidence: [huge] };
    const { partial } = sealWorkItem(state, { maxBytes: 4096 });
    assert.deepEqual(partial, [huge.evidenceId]);
  });
});

describe('state v4 — evidence writers keep the index in step', () => {
  it('recordEvidence supersedes prior passing evidence and flips the gate', () => {
    const { state } = toStateV4(v2WithHistory({ gates: { testsPassed: false } }));
    const fresh = evidence('testsPassed');
    const next = recordEvidence(state, fresh);
    assert.equal(next.gates.testsPassed, true);
    const priorInline = next.gateEvidence.find((e) => e.status === 'superseded');
    assert.ok(priorInline, 'the previous passing record is superseded, never deleted');
    assert.equal(priorInline.supersededBy, fresh.evidenceId);
    assert.equal(next.evidenceCoverage[ACTIVE].recordCount, 2);
  });

  it('does not invent an index for a v2 document', () => {
    // A v2 document has no index field, and adding one would be a silent shape
    // change on a version that did not ask for it.
    const v2 = v2WithHistory();
    const next = appendEvidence(v2, evidence('testsPassed'));
    assert.equal('evidenceCoverage' in next, false);
  });

  it('derives a work item id for the active item', () => {
    assert.equal(workItemIdOf(v2WithHistory()), ACTIVE);
  });
});
