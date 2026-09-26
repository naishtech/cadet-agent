import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { PLANS_DEFAULT_DIR, reconcileArtifacts } from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

const PLANS = PLANS_DEFAULT_DIR;

/** Build a fixture tree from `{ 'relative/path': 'contents' }`. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-reconcile-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function storyMd({
  id = 'EPIC-1-STORY-1',
  status = 'Planned',
  parentEpic = '../epic.md',
  reachability = 'witnessed — the user opens the scene and sees the clock tick',
  designRefs = 'technical-design.md §Clock',
  omitStatus = false,
  omitReachability = false,
} = {}) {
  const head = [id];
  if (!omitStatus) head.push(`Parent Epic: ${parentEpic}`, `Status: ${status}`);
  head.push('Estimate: Small');
  // An ABSENT field and an empty one are different inputs: the templates require
  // the line, and the real repo simply has no line at all.
  if (!omitReachability) head.push(`Reachability: ${reachability}`);
  return `# Story: A story

${head.join('\n')}

## Acceptance Criteria
### AC-1: it works
- Given a, When b, Then c
- Declared tests: test_one

## Scope
- In: a
- Out: b

## Implementation Notes
- Design refs: ${designRefs}
- Test strategy: tdd

## Change History
| Date | Change | Reason |
|---|---|---|
| 2026-09-25 | Created | Initial |
`;
}

function epicMd({
  id = 'EPIC-1',
  status = 'In Progress',
  requirements = '../requirements.md',
  technicalDesign = '../technical-design.md',
  witness = 'Witnessed by story-1 — the user opens the scene.',
  stories = '- [ ] Story one — does a thing',
} = {}) {
  return `# Epic: The epic

${id}
Status: ${status}
Requirements: ${requirements}
Technical Design: ${technicalDesign}

## Summary
One paragraph.

## Stories
${stories}

## Witness checkpoint
${witness}

## Change History
| Date | Change | Reason |
|---|---|---|
| 2026-09-25 | Created | Initial |
`;
}

function stateDoc({ phase = 'validation', workflowPath = 'large', epics = {}, evidenceCoverage = {} } = {}) {
  return JSON.stringify({
    version: 4,
    stateVersion: 4,
    session: { workflowPath, currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: null,
    epics,
    gates: {},
    gateEvidence: [],
    evidenceCoverage,
  }, null, 2);
}

/** A chain in which nothing is wrong, as the baseline every negative case departs from. */
function healthy({ storyOverrides = {}, epicOverrides = {}, stateOverrides = {}, storyFile = 'story-1-a.md' } = {}) {
  return fixture({
    [`.cadet/state.json`]: stateDoc({
      epics: { 'epic-1-foo': { status: 'in-progress', stories: { [storyFile]: 'in-progress' } } },
      evidenceCoverage: {},
      ...stateOverrides,
    }),
    [`${PLANS}/requirements.md`]: '# Requirements\n\n### AC-01: the clock ticks\n',
    [`${PLANS}/technical-design.md`]: '# Technical Design\n\n## Design Summary\n- Overview: a clock\n',
    [`${PLANS}/project-plan.md`]: '# Project Plan\n\n## Plan Summary\n- Goal: ship\n',
    [`${PLANS}/epic-1-foo/epic.md`]: epicMd(epicOverrides),
    [`${PLANS}/epic-1-foo/${storyFile}`]: storyMd({ status: 'In Progress', ...storyOverrides }),
  });
}

/**
 * Reconcile a fixture, reading its state document the way the CLI does. Without
 * this the whole state half of the engine would go untested — every fixture would
 * silently reconcile against nothing.
 */
function run(targetDir, options = {}) {
  const statePath = join(targetDir, '.cadet', 'state.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf-8')) : null;
  return reconcileArtifacts(targetDir, { state, ...options });
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

function summary(dir, options = {}) {
  const result = run(dir, options);
  return { result, codes: codes(result) };
}

function rebuild(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function readStateFile(dir) {
  return JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
}

function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(`${relative(dir, full).replace(/\\/g, '/')}:${statSync(full).size}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

describe('reconcile: a healthy chain', () => {
  it('reports consistent with no findings', () => {
    const dir = healthy();
    try {
      const { result } = summary(dir);
      assert.equal(result.available, true);
      assert.equal(result.verdict, 'consistent');
      assert.deepEqual(codes(result), []);
      assert.equal(result.summary.total, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('treats an advisory info finding as consistent, not as an inconsistency', () => {
    // The project plan is checked but not required — no skill produces one — so
    // its absence must not stop a clean chain from being called clean.
    const dir = healthy();
    try {
      rmSync(join(dir, PLANS, 'project-plan.md'));
      const { result } = summary(dir);
      assert.deepEqual(codes(result), ['missing-artifact']);
      assert.equal(result.findings[0].severity, 'info');
      assert.equal(result.verdict, 'consistent');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('reconcile: missing artifacts', () => {
  it('flags a missing requirements.md once the workflow has passed the phase that produces it', () => {
    const dir = healthy();
    try {
      rmSync(join(dir, PLANS, 'requirements.md'));
      const { result } = summary(dir);
      assert.ok(codes(result).includes('missing-artifact'));
      const f = result.findings.find((x) => x.code === 'missing-artifact');
      assert.equal(f.severity, 'blocking');
      assert.equal(f.subject, 'requirements.md');
      assert.equal(result.verdict, 'findings');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not flag a document the workflow has not reached yet', () => {
    const dir = healthy({ stateOverrides: { phase: 'requirements' } });
    try {
      rmSync(join(dir, PLANS, 'requirements.md'));
      rmSync(join(dir, PLANS, 'technical-design.md'));
      const { result } = summary(dir);
      assert.equal(codes(result).includes('missing-artifact'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('reconcile: state vs disk', () => {
  it('flags an epic state tracks with no directory', () => {
    const dir = healthy({
      stateOverrides: {
        epics: {
          'epic-1-foo': { status: 'in-progress', stories: { 'story-1-a.md': 'in-progress' } },
          'epic-3-ghost': { status: 'planned', stories: {} },
        },
      },
    });
    try {
      const { result } = summary(dir);
      assert.ok(codes(result).includes('missing-epic-dir'));
      assert.equal(result.findings.find((f) => f.code === 'missing-epic-dir').subject, 'epic-3-ghost');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags an epic directory state does not track', () => {
    const dir = healthy();
    try {
      rebuild(dir, `${PLANS}/epic-2-orphan/epic.md`, epicMd({ id: 'EPIC-2' }));
      rebuild(dir, `${PLANS}/epic-2-orphan/story-1-x.md`, storyMd());
      const { result } = summary(dir);
      assert.ok(codes(result).includes('orphan-epic-dir'));
      assert.ok(codes(result).includes('orphan-story-file'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags a story state tracks with no file', () => {
    const dir = healthy({
      stateOverrides: {
        epics: { 'epic-1-foo': { status: 'in-progress', stories: { 'story-1-a.md': 'in-progress', 'story-9-gone.md': 'planned' } } },
      },
    });
    try {
      const { result } = summary(dir);
      assert.ok(codes(result).includes('missing-story-file'));
      const f = result.findings.find((x) => x.code === 'missing-story-file');
      assert.equal(f.severity, 'blocking');
      assert.equal(f.subject, 'epic-1-foo::story-9-gone.md');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags a story whose markdown status disagrees with state', () => {
    const dir = healthy({
      storyOverrides: { status: 'Done' },
      stateOverrides: {
        epics: { 'epic-1-foo': { status: 'in-progress', stories: { 'story-1-a.md': 'in-progress' } } },
      },
    });
    try {
      const { result } = summary(dir);
      assert.ok(codes(result).includes('status-mismatch'));
      const f = result.findings.find((x) => x.code === 'status-mismatch');
      assert.match(f.detail, /Done/);
      assert.match(f.detail, /in-progress/);
      assert.ok(f.evidence, 'a mismatch must cite the line it read');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts the two spellings of the same status', () => {
    const dir = healthy({
      storyOverrides: { status: 'In Progress' },
      stateOverrides: {
        epics: { 'epic-1-foo': { status: 'in-progress', stories: { 'story-1-a.md': 'in-progress' } } },
      },
    });
    try {
      assert.equal(codes(run(dir)).includes('status-mismatch'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags an epic with no stories', () => {
    const dir = healthy();
    try {
      rebuild(dir, `${PLANS}/epic-4-empty/epic.md`, epicMd({ id: 'EPIC-4', stories: '' }));
      const { result } = summary(dir);
      assert.ok(codes(result).includes('epic-without-stories'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('reconcile: links', () => {
  it('flags a story whose Parent Epic does not resolve', () => {
    const dir = healthy({ storyOverrides: { parentEpic: '../epic-missing.md' } });
    try {
      const { result } = summary(dir);
      assert.ok(codes(result).includes('dangling-parent-epic'));
      assert.equal(result.findings.find((f) => f.code === 'dangling-parent-epic').severity, 'blocking');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('resolves a link written as a markdown link', () => {
    const dir = healthy({ epicOverrides: { requirements: '[requirements](../requirements.md)' } });
    try {
      assert.equal(codes(run(dir)).includes('dangling-epic-link'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags an epic whose Requirements link does not resolve', () => {
    const dir = healthy({ epicOverrides: { requirements: '../requirements-gone.md' } });
    try {
      const { result } = summary(dir);
      const f = result.findings.find((x) => x.code === 'dangling-epic-link');
      assert.ok(f, 'expected a dangling link finding');
      assert.match(f.detail, /requirements-gone\.md/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags an epic with no witness checkpoint', () => {
    const dir = healthy({ epicOverrides: { witness: '' } });
    try {
      assert.ok(codes(run(dir)).includes('missing-witness-checkpoint'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('reconcile: reachability and evidence', () => {
  /** Two stories: one finished and evidenced, one that defers to it. */
  function deferredChain(reachability) {
    return fixture({
      '.cadet/state.json': stateDoc({
        epics: { 'epic-1-foo': { status: 'in-progress', stories: { 'story-1-a.md': 'done', 'story-2-b.md': 'in-progress' } } },
        evidenceCoverage: { 'epic-1-foo::story-1-a.md': { workItemId: 'epic-1-foo::story-1-a.md', recordCount: 4 } },
      }),
      [`${PLANS}/requirements.md`]: '# Requirements\n',
      [`${PLANS}/technical-design.md`]: '# Technical Design\n',
      [`${PLANS}/epic-1-foo/epic.md`]: epicMd(),
      [`${PLANS}/epic-1-foo/story-1-a.md`]: storyMd({ id: 'EPIC-1-STORY-1', status: 'Done' }),
      [`${PLANS}/epic-1-foo/story-2-b.md`]: storyMd({ id: 'EPIC-1-STORY-2', status: 'In Progress', reachability }),
    });
  }

  it('flags a deferral whose target already finished', () => {
    const dir = deferredChain('deferred to epic-1-foo::story-1-a.md — the wiring lands there');
    try {
      const { result } = summary(dir);
      const f = result.findings.find((x) => x.code === 'expired-deferral');
      assert.ok(f, `expected an expired deferral, got ${JSON.stringify(codes(result))}`);
      assert.equal(f.severity, 'blocking');
      assert.equal(f.subject, 'epic-1-foo::story-2-b.md');
      assert.match(f.detail, /story-1-a\.md/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags a deferral to something that is not a work item', () => {
    const dir = deferredChain('deferred to epic-9-nowhere::story-9.md — someone will wire it');
    try {
      assert.ok(codes(run(dir)).includes('unresolved-deferral'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags a story that defers to itself', () => {
    const dir = deferredChain('deferred to epic-1-foo::story-2-b.md — circular');
    try {
      assert.ok(codes(run(dir)).includes('unresolved-deferral'));
      assert.equal(codes(run(dir)).includes('expired-deferral'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('flags a story marked done with no evidence indexed against it', () => {
    const dir = healthy({
      stateOverrides: {
        epics: { 'epic-1-foo': { status: 'complete', stories: { 'story-1-a.md': 'done' } } },
      },
    });
    try {
      const { result } = summary(dir);
      assert.ok(codes(result).includes('done-without-evidence'));
      assert.equal(result.findings.find((f) => f.code === 'done-without-evidence').severity, 'blocking');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts a done story that owns evidence', () => {
    const dir = healthy({
      storyOverrides: { status: 'Done' },
      stateOverrides: {
        epics: { 'epic-1-foo': { status: 'complete', stories: { 'story-1-a.md': 'done' } } },
        evidenceCoverage: { 'epic-1-foo::story-1-a.md': { workItemId: 'epic-1-foo::story-1-a.md', recordCount: 12 } },
      },
    });
    try {
      assert.equal(codes(run(dir)).includes('done-without-evidence'), false);
      assert.equal(run(dir).verdict, 'consistent');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('reconcile: honesty about what it could not read', () => {
  it('never certifies a chain containing an unreadable artifact', () => {
    // A story with no Status field cannot be reconciled. The verdict must say so
    // rather than reporting the fields it could read as a clean result.
    const dir = healthy({ storyOverrides: { omitStatus: true } });
    try {
      const { result } = summary(dir);
      assert.ok(codes(result).includes('unparsable-artifact'));
      assert.equal(result.verdict, 'unknown');
      assert.notEqual(result.verdict, 'consistent');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports no artifacts rather than a clean chain when the plans directory is absent', () => {
    const dir = fixture({ '.cadet/state.json': stateDoc() });
    try {
      const result = run(dir);
      assert.equal(result.available, false);
      assert.equal(result.verdict, null);
      assert.match(result.reason, /no planning artifacts/);
      assert.deepEqual(result.findings, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('works with no state document at all', () => {
    const dir = fixture({
      [`${PLANS}/requirements.md`]: '# Requirements\n',
      [`${PLANS}/technical-design.md`]: '# Technical Design\n',
    });
    try {
      const result = run(dir);
      assert.equal(result.available, true);
      assert.equal(result.result, undefined);
      assert.ok(Array.isArray(result.findings));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('reconcile: output shape', () => {
  it('sorts findings by severity, then code, and numbers them stably', () => {
    const dir = healthy({ storyOverrides: { parentEpic: '../gone.md' } });
    try {
      rebuild(dir, `${PLANS}/epic-4-empty/epic.md`, epicMd({ id: 'EPIC-4', stories: '' }));
      const a = run(dir);
      const b = run(dir);
      assert.deepEqual(a.findings.map((f) => f.id), b.findings.map((f) => f.id));
      const ranks = a.findings.map((f) => ({ blocking: 0, warning: 1, info: 2 }[f.severity]));
      assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y), 'blocking findings must come first');
      assert.equal(a.findings[0].id, 'R-1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('scopes to one epic when a story path is given', () => {
    const dir = healthy();
    try {
      rebuild(dir, `${PLANS}/epic-2-other/epic.md`, epicMd({ id: 'EPIC-2', witness: '' }));
      const full = run(dir);
      assert.ok(codes(full).includes('missing-witness-checkpoint'));
      const scoped = run(dir, { story: `${PLANS}/epic-1-foo/story-1-a.md` });
      assert.equal(codes(scoped).includes('missing-witness-checkpoint'), false);
      assert.equal(scoped.scopedEpic, 'epic-1-foo');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── Layouts that a real project actually uses ───────────────────────────────
//
// Every case here comes from running the command against a real consumer repo
// (`dolven-tactics`), where the first version reported 15 blocking findings for
// epics that existed one level deeper, two for documents that existed under
// other names, and ~120 more for fields that simply predated the templates.
// A check that fires on a correct project is worse than no check.

describe('reconcile: real-world layouts', () => {
  /** A project folder, `epics/`, then `epic-N/` — all one level deeper than the template implies. */
  function nested() {
    return fixture({
      '.cadet/state.json': stateDoc({
        epics: { 'epic-1-nested': { status: 'in-progress', stories: { 'story-1-a.md': 'in-progress' } } },
      }),
      [`${PLANS}/my-game/mvp-requirements.md`]: '# Requirements\n\n### AC-01: it works\n',
      [`${PLANS}/my-game/technical-design.md`]: '# Technical Design\n',
      [`${PLANS}/my-game/epics/epic-1-nested/epic.md`]: epicMd({
        id: 'EPIC-1',
        requirements: '../../mvp-requirements.md',
        technicalDesign: '../../technical-design.md',
      }),
      [`${PLANS}/my-game/epics/epic-1-nested/story-1-a.md`]: storyMd({ status: 'In Progress', parentEpic: 'epic.md' }),
    });
  }

  it('finds epics nested under a project folder', () => {
    const dir = nested();
    try {
      const { result } = summary(dir);
      assert.equal(result.artifacts.epicCount, 1);
      assert.equal(result.artifacts.storyCount, 1);
      // The regression that prompted this test: state tracks the epic, and the
      // epic IS on disk — just deeper than a one-level scan looked.
      assert.equal(codes(result).includes('missing-epic-dir'), false);
      assert.equal(codes(result).includes('orphan-epic-dir'), false);
      assert.equal(result.verdict, 'consistent');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('finds a renamed document anywhere under the plans directory', () => {
    const dir = nested();
    try {
      const result = run(dir);
      const req = result.artifacts.docs.find((d) => d.name === 'requirements');
      assert.equal(req.present, true);
      assert.match(req.path, /my-game\/mvp-requirements\.md$/);
      // Only the advisory project-plan finding is left, if anything.
      assert.equal(result.findings.filter((f) => f.code === 'missing-artifact' && f.severity === 'blocking').length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts a legacy ../epic.md as well as the documented sibling', () => {
    // ~100 stories in the real repo carry the old form. Reporting them all would
    // be noise; reporting a genuinely wrong filename still matters.
    const dir = nested();
    try {
      rebuild(dir, `${PLANS}/my-game/epics/epic-1-nested/story-1-a.md`,
        storyMd({ status: 'In Progress', parentEpic: '../epic.md' }));
      assert.equal(codes(run(dir)).includes('dangling-parent-epic'), false);

      rebuild(dir, `${PLANS}/my-game/epics/epic-1-nested/story-1-a.md`,
        storyMd({ status: 'In Progress', parentEpic: '../epic-typo.md' }));
      assert.ok(codes(run(dir)).includes('dangling-parent-epic'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('resolves an epic link field that carries several links and notes', () => {
    const dir = nested();
    const epicPath = `${PLANS}/my-game/epics/epic-1-nested/epic.md`;
    try {
      rebuild(dir, epicPath, epicMd({
        requirements: '../../gone.md (GDD v2) · ../../mvp-requirements.md (delivered history)',
        technicalDesign: '../../technical-design.md (hub) · ../../gone-too.md (sub-document)',
      }));
      assert.equal(codes(run(dir)).includes('dangling-epic-link'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still flags an epic whose every link candidate is missing', () => {
    const dir = nested();
    try {
      rebuild(dir, `${PLANS}/my-game/epics/epic-1-nested/epic.md`, epicMd({
        requirements: '../../gone.md (one) · ../../also-gone.md (two)',
      }));
      assert.ok(codes(run(dir)).includes('dangling-epic-link'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('reconcile: gaps are reported for open work, not for history', () => {
  it('does not ask a story that has not started for a reachability declaration', () => {
    // The declaration is written DURING implementation, so a planned story has
    // nothing truthful to declare yet.
    const dir = healthy({
      storyOverrides: { status: 'Planned', omitReachability: true },
      stateOverrides: { epics: { 'epic-1-foo': { status: 'in-progress', stories: { 'story-1-a.md': 'planned' } } } },
    });
    try {
      assert.equal(codes(run(dir)).includes('missing-reachability'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not ask a closed story for a declaration it predates', () => {
    const dir = healthy({
      storyOverrides: { status: 'Done', omitReachability: true },
      stateOverrides: {
        epics: { 'epic-1-foo': { status: 'complete', stories: { 'story-1-a.md': 'done' } } },
        evidenceCoverage: { 'epic-1-foo::story-1-a.md': { workItemId: 'epic-1-foo::story-1-a.md', recordCount: 3 } },
      },
    });
    try {
      assert.equal(codes(run(dir)).includes('missing-reachability'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does ask a story in flight', () => {
    const dir = healthy({ storyOverrides: { status: 'In Progress', omitReachability: true } });
    try {
      assert.ok(codes(run(dir)).includes('missing-reachability'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not ask a closed epic for a witness checkpoint', () => {
    const dir = healthy({
      epicOverrides: { witness: '' },
      stateOverrides: { epics: { 'epic-1-foo': { status: 'complete', stories: { 'story-1-a.md': 'in-progress' } } } },
    });
    try {
      assert.equal(codes(run(dir)).includes('missing-witness-checkpoint'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does ask an epic still open', () => {
    const dir = healthy({ epicOverrides: { witness: '' } });
    try {
      assert.ok(codes(run(dir)).includes('missing-witness-checkpoint'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports a done story with no evidence even when its epic is closed', () => {
    // The opposite case, deliberately: a completion claim must be traceable
    // however old it is, and the framework's answer to an accepted historical
    // gap is a recorded gate-exception, not silence.
    const dir = healthy({
      storyOverrides: { status: 'Done' },
      stateOverrides: {
        epics: { 'epic-1-foo': { status: 'complete', stories: { 'story-1-a.md': 'done' } } },
        evidenceCoverage: {},
      },
    });
    try {
      assert.ok(codes(run(dir)).includes('done-without-evidence'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('harness reconcile CLI', () => {
  it('exits 0 on an inconsistent chain, because the verdict is the payload', () => {
    const dir = healthy({ storyOverrides: { parentEpic: '../gone.md' } });
    try {
      const res = spawnSync('node', [cli, 'harness', 'reconcile', '--target', dir, '--format', 'json'],
        { encoding: 'utf-8', cwd: dir, windowsHide: true });
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.verdict, 'findings');
      assert.ok(out.findings.length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('honours --plans-dir', () => {
    const dir = healthy();
    try {
      const res = spawnSync('node', [cli, 'harness', 'reconcile', '--plans-dir', 'docs/planning', '--target', dir, '--format', 'json'],
        { encoding: 'utf-8', cwd: dir, windowsHide: true });
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.available, false);
      assert.match(out.reason, /docs\/planning/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes nothing', () => {
    const dir = healthy({ storyOverrides: { parentEpic: '../gone.md' } });
    try {
      const before = snapshot(dir);
      const stateBefore = readStateFile(dir);
      spawnSync('node', [cli, 'harness', 'reconcile', '--target', dir], { encoding: 'utf-8', cwd: dir, windowsHide: true });
      spawnSync('node', [cli, 'harness', 'reconcile', '--target', dir, '--format', 'json'], { encoding: 'utf-8', cwd: dir, windowsHide: true });
      assert.deepEqual(snapshot(dir), before, 'harness reconcile must not write');
      assert.deepEqual(readStateFile(dir), stateBefore, 'state.json must be untouched');
      assert.equal(existsSync(join(dir, '.cadet', 'runs')), false, 'a read must not create a ledger');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
