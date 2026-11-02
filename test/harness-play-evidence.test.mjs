/**
 * A deferred `Play:` record validates.
 *
 * The framework writes a `userPlaythroughConfirmed` record for a story whose `Play:` line says the
 * work cannot be played yet. That record has no person to quote, and it used to be refused by
 * `state validate` — so the framework rejected evidence it had just written, and the only ways out
 * were to delete the record or to hand-write a reason the validator exists to stop.
 *
 * Two claims are pinned here:
 *   1. the validator accepts an AUTOMATED deferral record with no reason, and still refuses a record
 *      that claims a playthrough without one;
 *   2. `harness verify-play` writes the deferral into `reason`, so the record explains itself.
 *
 * The second is a CLI test because the field is written by the handler, not by a pure function.
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateState } from '../src/harness/state.mjs';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.mjs');

const STORY_REL = '.cadet/agent/project-plans/plan/epics/epic-1/story-1.md';

const STORY = [
  '# Story: A library nothing reaches yet',
  'Status: Planned',
  'Reachability: deferred to epic-1::story-2.md — nothing wires it in yet',
  'Play: deferred to epic-1::story-2.md — it has no runtime surface until that story wires it',
  '',
].join('\n');

/** A state document whose only interesting part is one evidence record. */
function stateWith(record) {
  return {
    version: 4,
    stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: 'review', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    activeRunId: null,
    gates: {},
    gateEvidence: [{
      evidenceId: '11111111-1111-4111-8111-111111111111',
      workItemId: 'epic-1::story-1.md',
      acceptanceCriterionId: null,
      phase: 'review',
      gate: 'userPlaythroughConfirmed',
      status: 'passed',
      command: 'harness verify-play --story ' + STORY_REL,
      result: 'play deferred (deferred)',
      exitCode: 0,
      commit: null,
      inputTreeHash: 'a'.repeat(64),
      criteriaHash: 'b'.repeat(64),
      relevantFiles: [STORY_REL],
      createdAt: '2026-10-31T06:00:00.000Z',
      expiresAt: null,
      freshnessPolicy: { scope: 'story' },
      source: 'automated',
      ...record,
    }],
    epics: { 'epic-1': { stories: { 'story-1.md': 'in-progress', 'story-2.md': 'planned' } } },
    changes: [],
    changeHistory: [],
    lastTransition: null,
  };
}

function reasonErrors(record) {
  return validateState(stateWith(record)).errors.filter((e) => String(e.path).endsWith('reason'));
}

describe('a deferred play record — the validator asks the invariant, not the field', () => {
  it('accepts an automated deferral with no reason', () => {
    assert.deepEqual(reasonErrors({}), [], 'the framework must accept the record it wrote itself');
  });

  it('still refuses a record that claims a playthrough with no reason', () => {
    const errors = reasonErrors({ result: 'played', source: 'manual-confirmation', status: 'manual-confirmation' });
    assert.equal(errors.length, 1, 'a person\'s answer is still required for a claim of a playthrough');
  });

  it('accepts an automated deferral that carries its reason', () => {
    assert.deepEqual(reasonErrors({ reason: 'play deferred to epic-1::story-2.md: not built yet' }), []);
  });
});

describe('harness verify-play — the deferral record explains itself', () => {
  it('writes the deferral target into the record, and the result validates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-play-'));
    mkdirSync(join(dir, '.cadet', 'agent', 'project-plans', 'plan', 'epics', 'epic-1'), { recursive: true });
    writeFileSync(join(dir, STORY_REL), STORY, 'utf-8');
    writeFileSync(join(dir, '.cadet', 'harness.json'),
      JSON.stringify({ userPlay: { enabled: true } }, null, 2) + '\n', 'utf-8');

    const init = spawnSync(process.execPath, [
      CLI, 'state', 'init', '--target', dir,
      '--workflow-path', 'large', '--tracking-mode', 'markdown', '--phase', 'review',
    ], { encoding: 'utf-8' });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const begin = spawnSync(process.execPath, [
      CLI, 'state', 'begin', '--target', dir, '--epic', 'epic-1', '--story', 'story-1.md',
    ], { encoding: 'utf-8' });
    assert.equal(begin.status, 0, begin.stderr || begin.stdout);

    // The deferral target must be a known work item. `state begin` records one item at a time, so the
    // fixture names the target the way a consumer with a full epic record would. (A deferral that
    // resolves against the plans tree is a separate fix and is not what this test is about.)
    const statePath = join(dir, '.cadet', 'state.json');
    const begun = JSON.parse(readFileSync(statePath, 'utf-8'));
    begun.epics = begun.epics || {};
    begun.epics['epic-1'] = begun.epics['epic-1'] || { stories: {} };
    begun.epics['epic-1'].stories = begun.epics['epic-1'].stories || {};
    begun.epics['epic-1'].stories['story-1.md'] = 'in-progress';
    begun.epics['epic-1'].stories['story-2.md'] = 'planned';
    writeFileSync(statePath, JSON.stringify(begun, null, 2) + '\n', 'utf-8');


    const played = spawnSync(process.execPath, [
      CLI, 'harness', 'verify-play', '--target', dir, '--story', STORY_REL,
    ], { encoding: 'utf-8' });
    assert.equal(played.status, 0, played.stderr || played.stdout);

    const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    const record = (state.gateEvidence || []).find((e) => e.gate === 'userPlaythroughConfirmed');
    assert.ok(record, 'the gate record was written');
    assert.equal(record.source, 'automated');
    assert.match(record.result, /^play deferred/);
    assert.match(record.reason, /epic-1::story-2\.md/, 'the record names where the play is deferred to');

    const validate = spawnSync(process.execPath, [CLI, 'state', 'validate', '--target', dir], { encoding: 'utf-8' });
    assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  });
});
