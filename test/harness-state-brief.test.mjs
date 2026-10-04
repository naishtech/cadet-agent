/**
 * The state brief — the tier-0 summary of `.cadet/state.json` (0.63.0).
 *
 * WHY THIS FILE EXISTS. The context plan named `.cadet/state.json` itself as an always-load
 * reference, and that document is not the current story: it is the current story's live evidence
 * plus one row per work item ever closed and one entry per change checkpoint ever recorded. In a
 * real consumer it reached 94,547 B — about 31,500 tokens — of which the current story was 31%,
 * and a host re-sent it on every turn.
 *
 * WHAT THE TESTS HOLD:
 *   1. the brief stays small as the document grows without bound (the whole point);
 *   2. it reads the gates with the same function a gate check uses, so it cannot disagree;
 *   3. it reports what compaction would archive, so the growth is visible instead of implied;
 *   4. `harness context plan` writes it and names it at tier 0 — with a hash, so a stale brief is
 *      detectable exactly like any other reference;
 *   5. `state brief` writes nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { buildStateBrief, renderStateBrief, GATES } from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf-8', windowsHide: true });
  let json = null;
  for (const text of [r.stdout, r.stderr]) {
    if (!text) continue;
    const start = text.indexOf('{');
    if (start < 0) continue;
    try { json = JSON.parse(text.slice(start)); } catch { /* the other stream */ }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** A document shaped like a real one after a long epic: the active story, plus archived history. */
function stateWithHistory({ records = 60, historyEntries = 80 } = {}) {
  return {
    version: 4,
    stateVersion: 4,
    session: {
      workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown', learnerTier: 'standard',
    },
    activeWorkItem: { epicId: 'epic-12', storyId: 'story-5b.md' },
    activeRunId: null,
    epics: {
      'epic-12': { status: 'in-progress', stories: { 'story-5a.md': 'done', 'story-5b.md': 'in-progress', 'story-5c.md': 'planned' } },
    },
    gates: { testsPassed: true, compileCheckConfirmed: true, codeReviewCompleted: false },
    gateEvidence: Array.from({ length: records }, (_, i) => ({
      evidenceId: `rec-${i}`,
      gate: i % 2 === 0 ? 'testsPassed' : 'compileCheckConfirmed',
      // The two newest records are the passes; every earlier one is history. That shape matters:
      // `state validate` reads the LATEST record for a gate, so a true gate whose newest record is
      // superseded is an invalid document. This fixture is a valid one.
      status: i >= records - 2 ? 'passed' : 'superseded',
      createdAt: `2026-10-0${(i % 9) + 1}T00:00:0${i % 10}.000Z`,
      workItem: 'epic-12::story-5b.md',
      // The bulk of a real record, and the reason the document grows.
      relevantFiles: Array.from({ length: 14 }, (_, f) => `Assets/Scripts/Some/Deeply/Nested/Path/File${f}.cs`),
      reason: 'x'.repeat(400),
    })),
    gateExceptions: [],
    changeHistory: Array.from({ length: historyEntries }, (_, i) => ({
      at: `2026-10-0${(i % 9) + 1}T00:00:00.000Z`, workItem: 'epic-12::story-5b.md', summary: `change ${i} ${'y'.repeat(120)}`,
    })),
    storyCompletions: Array.from({ length: 40 }, (_, i) => ({ storyId: `story-${i}.md`, completedAt: '2026-10-01T00:00:00.000Z' })),
    lastTransition: { from: 'context-resolution', to: 'implementation', at: '2026-10-04T02:15:59.830Z' },
  };
}

describe('state brief — the tier-0 summary', () => {
  it('stays small while the document grows without bound', () => {
    const small = renderStateBrief(buildStateBrief(stateWithHistory({ records: 5, historyEntries: 5 })));
    const huge = renderStateBrief(buildStateBrief(stateWithHistory({ records: 400, historyEntries: 900 })));

    // The document itself would be ~40x the brief at this size; the brief barely moves, because it
    // reports counts and the newest record per gate instead of carrying the records.
    assert.ok(huge.length < 2000, `the brief must stay a summary: ${huge.length} characters`);
    assert.ok(huge.length - small.length < 300, 'the brief grows with the number of gates, not with the history');
  });

  it('reads the gates with the same function a gate check uses', () => {
    const state = stateWithHistory({ records: 6, historyEntries: 2 });
    const brief = buildStateBrief(state);

    assert.equal(brief.gates.length, GATES.length, 'one row per gate');

    const testsPassed = brief.gates.find((g) => g.gate === 'testsPassed');
    assert.equal(testsPassed.claimed, true, 'the document claims it');
    assert.ok(testsPassed.evidenceId, 'and the newest record is named');
    assert.ok(testsPassed.at);

    const codeReview = brief.gates.find((g) => g.gate === 'codeReviewCompleted');
    assert.equal(codeReview.claimed, false);
    assert.equal(codeReview.status, null, 'an unmet gate with no evidence says so');

    // The newest record for a gate is the one a check would read: the latest by createdAt, which in
    // this fixture is the single `passed` record — the superseded ones are history, not evidence.
    assert.equal(testsPassed.status, 'passed');
  });

  it('reports what compaction would archive, so the growth is visible', () => {
    const brief = buildStateBrief(stateWithHistory({ records: 60, historyEntries: 80 }));

    assert.ok(brief.evidence.inline >= 60);
    assert.ok(brief.evidence.archivable > 0, 'superseded records are archivable');
    assert.ok(brief.history.archivable > 0, 'history beyond the retained window is archivable');
    assert.equal(brief.history.entryLimit > 0, true);

    // Names the reader's own context: the work item, its story and its epic.
    assert.equal(brief.workItemId, 'epic-12::story-5b.md');
    assert.equal(brief.story.status, 'in-progress');
    assert.deepEqual([brief.epic.storiesDone, brief.epic.storiesTotal], [1, 3]);
  });

  it('writes nothing, and names the document it summarises', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-brief-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const statePath = join(dir, '.cadet/state.json');
      writeFileSync(statePath, JSON.stringify(stateWithHistory({ records: 8, historyEntries: 4 }), null, 2));
      const before = statSync(statePath);

      const r = runCli(['state', 'brief', '--target', dir]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /state brief — epic-12::story-5b\.md/);
      assert.match(r.stdout, /gates \(the newest evidence record for each\)/);
      assert.match(r.stdout, /UNMET/, 'an unmet gate is visible at a glance');
      assert.match(r.stdout, /state compact --keep active/, 'the reader is told how to archive');

      const after = statSync(statePath);
      assert.equal(after.size, before.size, 'the brief does not touch the document');
      assert.equal(after.mtimeMs, before.mtimeMs, 'and does not rewrite it');

      const json = runCli(['state', 'brief', '--target', dir, '--format', 'json']);
      assert.equal(json.status, 0, json.stdout + json.stderr);
      assert.equal(json.json.ok, true);
      assert.equal(json.json.brief.workItemId, 'epic-12::story-5b.md');
      assert.equal(json.json.brief.gates.length, GATES.length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('is written by the context plan, and named at tier 0 with a hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-brief-plan-'));
    try {
      mkdirSync(join(dir, '.cadet/agent/core/skills'), { recursive: true });
      mkdirSync(join(dir, '.cadet/agent/project-plans/epic-12'), { recursive: true });
      writeFileSync(join(dir, '.cadet/agent/core/cadet-agent.md'), '# the directive\n');
      writeFileSync(join(dir, '.cadet/agent/core/HarnessRuntime.md'), '# the runtime contract\n');
      writeFileSync(join(dir, '.cadet/agent/core/skills/TDD.md'), '# TDD\n');
      writeFileSync(join(dir, '.cadet/harness.json'), JSON.stringify({}, null, 2));
      writeFileSync(join(dir, '.cadet/agent/project-plans/epic-12/story-5b.md'), 'Status: In Progress\n## AC-1\nGiven a\nWhen b\nThen c\n');
      writeFileSync(join(dir, '.cadet/state.json'), JSON.stringify({
        ...stateWithHistory({ records: 6, historyEntries: 3 }),
        activeWorkItem: { epicId: 'epic-12', storyId: 'story-5b.md' },
      }, null, 2));

      const r = runCli(['harness', 'context', 'plan', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);

      const item = r.json.required.find((i) => i.reference === '.cadet/context/state-brief.md');
      assert.ok(item, 'tier 0 names the brief');
      assert.equal(item.tier, 'tier0');
      assert.equal(item.required, true);
      assert.equal(item.present, true, 'the plan wrote it before naming it');
      assert.match(item.hash, /^[0-9a-f]{64}$/, 'and hashes it, so a stale brief is detectable');

      const written = readFileSync(join(dir, '.cadet/context/state-brief.md'), 'utf-8');
      assert.match(written, /^state brief — epic-12::story-5b\.md/);
      assert.match(written, /Open that document for evidence records/, 'the brief says what it omits');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
