import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  parseReachabilityDeclarationText, validateReachabilityDeclaration, collectWorkItems,
  findDeferralCycles, normalizeWorkItemRef,
} from '../src/harness/reachability.mjs';
import {
  defaultPolicy, validatePolicy, requiredGates, REACHABILITY_GATE, PolicyError,
  evaluateTransition, applyTransition, StateError,
  createEvidence, computeInputTreeHash, newId,
} from '../src/harness/index.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repoRoot, 'bin', 'cli.mjs');

// ── Declaration parsing ──────────────────────────────────────────────────────

describe('parseReachabilityDeclarationText', () => {
  it('reads a witnessed declaration', () => {
    const d = parseReachabilityDeclarationText('Status: Done\nReachability: witnessed — run the demo scene and watch the counter rise\n');
    assert.equal(d.declared, true);
    assert.equal(d.kind, 'witnessed');
    assert.match(d.witness, /counter rise/);
    assert.deepEqual(d.errors, []);
  });

  it('reads a deferral and its reason', () => {
    const d = parseReachabilityDeclarationText('Reachability: deferred to epic-9::story-4.md — the scene wiring lands there\n');
    assert.equal(d.kind, 'deferred');
    assert.equal(d.deferTo, 'epic-9::story-4.md');
    assert.match(d.reason, /scene wiring/);
  });

  it('reports a MISSING declaration as not-declared, not as a parse error', () => {
    // The two findings are different, and collapsing them would make a story
    // that simply forgot the line indistinguishable from one that wrote it
    // wrongly. The caller reports them apart.
    const d = parseReachabilityDeclarationText('Status: Done\n\n## Acceptance Criteria\n');
    assert.equal(d.declared, false);
    assert.equal(d.errors.length, 0);
  });

  it('rejects an empty declaration', () => {
    const d = parseReachabilityDeclarationText('Reachability:\n');
    assert.equal(d.declared, false);
    assert.equal(d.errors.length, 1);
  });

  it('rejects a deferral with no reason', () => {
    const d = parseReachabilityDeclarationText('Reachability: deferred to story-2.md\n');
    assert.match(d.errors.join(' '), /WHY/);
  });

  it('rejects an unrecognised form rather than ignoring it', () => {
    const d = parseReachabilityDeclarationText('Reachability: probably fine\n');
    assert.equal(d.declared, false);
    assert.match(d.errors.join(' '), /unrecognised/);
  });

  it('ignores a declaration quoted inside a fenced block', () => {
    const d = parseReachabilityDeclarationText([
      'An example:',
      '```',
      'Reachability: witnessed — quoted example',
      '```',
    ].join('\n'));
    assert.equal(d.declared, false, 'a quoted example must not be read as the story own declaration');
  });
});

// ── State-referenced validation ──────────────────────────────────────────────

const stateFixture = {
  epics: {
    'epic-1': {
      status: 'in-progress',
      stories: { 'story-1.md': 'in-progress', 'story-2.md': 'planned', 'story-9.md': 'done' },
    },
  },
  activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
  spikes: { 'M-flow-field': 'complete' },
};

describe('collectWorkItems', () => {
  it('indexes stories, epics and spikes, with status', () => {
    const { refs, status } = collectWorkItems(stateFixture);
    assert.ok(refs.has('epic-1'));
    assert.ok(refs.has('story-1.md'));
    assert.ok(refs.has('epic-1::story-1.md'));
    assert.ok(refs.has('m-flow-field'), 'a spike is a legitimate deferral target');
    assert.equal(status.get('epic-1::story-9.md'), 'done');
  });
});

describe('validateReachabilityDeclaration', () => {
  const workItems = collectWorkItems(stateFixture);

  it('fails a missing declaration', () => {
    const v = validateReachabilityDeclaration(parseReachabilityDeclarationText('Status: Done'), { workItems });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'not-declared');
  });

  it('accepts a witnessed declaration', () => {
    const v = validateReachabilityDeclaration(parseReachabilityDeclarationText('Reachability: witnessed — open the page'), { workItems });
    assert.equal(v.ok, true);
  });

  it('accepts a deferral to a real, unfinished work item', () => {
    const v = validateReachabilityDeclaration(parseReachabilityDeclarationText('Reachability: deferred to story-2.md — wiring lands there'), { workItems });
    assert.equal(v.ok, true);
    assert.equal(v.code, 'deferred');
  });

  it('FAILS a deferral to a work item that does not exist', () => {
    // A deferral to something that does not exist never expires and never lands.
    const v = validateReachabilityDeclaration(parseReachabilityDeclarationText('Reachability: deferred to story-404.md — someday'), { workItems });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'unknown-target');
  });

  it('FAILS a deferral whose target is already done — the falsifiability tooth', () => {
    // The owner landed, so the promise has been overtaken: either this item is
    // reachable now or the wiring was missed when the owner closed.
    const v = validateReachabilityDeclaration(parseReachabilityDeclarationText('Reachability: deferred to story-9.md — the owner will wire it'), { workItems });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'deferral-target-done');
  });

  it('does not claim a verdict when there is no state to check against', () => {
    const v = validateReachabilityDeclaration(parseReachabilityDeclarationText('Reachability: deferred to story-2.md — later'), { workItems: null });
    assert.equal(v.ok, true);
    assert.equal(v.code, 'deferred-unchecked');
  });
});

describe('findDeferralCycles', () => {
  const decl = (text) => parseReachabilityDeclarationText(text);

  it('finds no cycle in a chain that terminates', () => {
    const cycles = findDeferralCycles([
      { id: 'story-1.md', declaration: decl('Reachability: deferred to story-2.md — later') },
      { id: 'story-2.md', declaration: decl('Reachability: witnessed — a scene') },
    ]);
    assert.deepEqual(cycles, []);
  });

  it('reports a two-item loop as ONE finding', () => {
    const cycles = findDeferralCycles([
      { id: 'story-1.md', declaration: decl('Reachability: deferred to story-2.md — later') },
      { id: 'story-2.md', declaration: decl('Reachability: deferred to story-1.md — earlier') },
    ]);
    assert.equal(cycles.length, 1);
  });

  it('connects the long form to the bare file name through aliases', () => {
    // Without alias resolution these are two disconnected nodes and a real cycle
    // would go unreported — a check that cannot see the edge it exists to find.
    const cycles = findDeferralCycles([
      { id: 'story-1.md', aliases: ['epic-1::story-1.md'], declaration: decl('Reachability: deferred to epic-1::story-2.md — later') },
      { id: 'story-2.md', aliases: ['epic-1::story-2.md'], declaration: decl('Reachability: deferred to story-1.md — earlier') },
    ]);
    assert.equal(cycles.length, 1);
  });
});

// ── Policy: opt-in, and off by default ───────────────────────────────────────

describe('reachability policy', () => {
  it('is disabled by default, so adopting the framework version changes nothing', () => {
    assert.equal(defaultPolicy().reachability.enabled, false);
    assert.equal(defaultPolicy().reachability.command, null);
  });

  it('requires the gate only when the repository opts in, and only entering validation', () => {
    // `requiredGates(target)` answers for the phase being ENTERED, so the
    // reachability gate belongs to entering `validation` — the same point as the
    // review gates, not implementation, where the wiring may legitimately not
    // exist yet.
    assert.equal(requiredGates('validation').gates.includes(REACHABILITY_GATE), false,
      'default OFF must not add a requirement');
    assert.equal(requiredGates('review').gates.includes(REACHABILITY_GATE), false,
      'entering review must never carry it, or every in-flight story would block on a framework update');

    const on = requiredGates('validation', { reachability: true }).gates;
    assert.equal(on.includes(REACHABILITY_GATE), true, 'opt-in must add the requirement');
    // The pre-existing gates are untouched either way.
    for (const gate of ['codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated']) {
      assert.ok(on.includes(gate), `${gate} must still be required`);
    }
  });

  it('rejects an inert probe: a command with the policy disabled', () => {
    assert.throws(() => validatePolicy({ reachability: { enabled: false, command: 'node --version' } }), PolicyError);
  });

  it('rejects an empty command and an unknown key', () => {
    assert.throws(() => validatePolicy({ reachability: { enabled: true, command: '   ' } }), PolicyError);
    assert.throws(() => validatePolicy({ reachability: { enabled: true, nope: 1 } }), PolicyError);
  });

  it('accepts an enabled policy with a probe', () => {
    const p = validatePolicy({ reachability: { enabled: true, command: 'node --version' } });
    assert.equal(p.reachability.enabled, true);
    assert.equal(p.reachability.command, 'node --version');
  });
});

// ── CLI ──────────────────────────────────────────────────────────────────────

function runCli(args, cwd = repoRoot) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function makeProject({ enabled = false, command = null, storyBody = null, epics = null, phase = 'implementation' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-reach-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 2, stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: epics || { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: {}, gateEvidence: [], changeHistory: [],
  }, null, 2));

  if (enabled) {
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify({
      reachability: { enabled: true, ...(command ? { command } : {}) },
    }, null, 2));
  }

  const story = join(dir, 'story-1.md');
  writeFileSync(story, storyBody ?? [
    'Status: In Progress',
    'Reachability: witnessed — run the demo and watch the counter',
    '',
    '## Acceptance Criteria',
    '### AC-1: something',
    '- Given a world, When stepped, Then it advances',
    '- Declared tests: Some_Test',
    '',
  ].join('\n'));
  return { dir, story };
}

describe('cli — harness verify-reachability', () => {
  it('rejects a missing --story', () => {
    const res = runCli(['harness', 'verify-reachability', '--format', 'json']);
    assert.equal(res.status, 1);
  });

  it('reports and writes nothing when the policy is off', () => {
    const { dir, story } = makeProject();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.gateSet, false);
      assert.equal(out.enabled, false);
      assert.equal(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'), before,
        'state.json must be byte-identical when the policy is off');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails a story that declares nothing, even with the policy off', () => {
    // A caller who ran the command explicitly asked the question.
    const { dir, story } = makeProject({ storyBody: 'Status: In Progress\n\n## Acceptance Criteria\n### AC-1: x\n- Given a, When b, Then c\n- Declared tests: T\n' });
    try {
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).reachability.code, 'not-declared');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('sets the gate when enabled and the declaration holds', () => {
    const { dir, story } = makeProject({ enabled: true });
    try {
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.gateSet, true);
      assert.equal(out.probe, null, 'no probe configured means the wiring was not proven, and the output says so');

      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.gates[REACHABILITY_GATE], true);

      // The recorded evidence must satisfy the state validator, not merely exist.
      const validate = runCli(['state', 'validate', '--target', dir]);
      assert.equal(validate.status, 0, `state validate rejected the record: ${validate.stdout}${validate.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails a deferral whose target is already done', () => {
    const { dir, story } = makeProject({
      enabled: true,
      storyBody: 'Status: In Progress\nReachability: deferred to story-9.md — the owner will wire it\n\n## Acceptance Criteria\n### AC-1: x\n- Given a, When b, Then c\n- Declared tests: T\n',
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress', 'story-9.md': 'done' } } },
    });
    writeSiblingStory(dir, 'story-9.md');
    try {
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).reachability.code, 'deferral-target-done');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails a deferral cycle between two stories', () => {
    const { dir, story } = makeProject({
      enabled: true,
      storyBody: 'Status: In Progress\nReachability: deferred to story-2.md — the other one\n\n## Acceptance Criteria\n### AC-1: x\n- Given a, When b, Then c\n- Declared tests: T\n',
      // Both stories must be REAL work items: a cycle between two unknown ids
      // would be reported as an unknown target, which is a different finding.
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress', 'story-2.md': 'planned' } } },
    });
    writeFileSync(join(dir, 'story-2.md'), 'Status: Planned\nReachability: deferred to story-1.md — this one\n');
    try {
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      const out = JSON.parse(res.stdout);
      assert.equal(out.code, 'deferral-cycle');
      assert.equal(out.cycles.length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails when the project probe fails, and passes when it succeeds', () => {
    const failing = makeProject({ enabled: true, command: 'node --this-flag-does-not-exist' });
    const passing = makeProject({ enabled: true, command: 'node --version' });
    try {
      const bad = runCli(['harness', 'verify-reachability', '--story', failing.story, '--target', failing.dir, '--format', 'json']);
      assert.equal(bad.status, 1);
      assert.equal(JSON.parse(bad.stdout).code, 'probe-failed');

      const good = runCli(['harness', 'verify-reachability', '--story', passing.story, '--target', passing.dir, '--format', 'json']);
      assert.equal(good.status, 0, good.stderr);
      assert.equal(JSON.parse(good.stdout).probe.ok, true);
    } finally {
      rmSync(failing.dir, { recursive: true, force: true });
      rmSync(passing.dir, { recursive: true, force: true });
    }
  });

  it('makes the gate a real requirement of review -> validation when enabled', () => {
    const { dir } = makeProject({ enabled: true, phase: 'review' });
    try {
      const res = runCli(['state', 'transition', '--to', 'validation', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1, 'the transition must be refused');
      const out = JSON.parse(res.stdout);
      assert.equal(out.allowed, false);
      assert.ok(out.missingGates.includes(REACHABILITY_GATE),
        `the missing-gate list must name ${REACHABILITY_GATE}: ${JSON.stringify(out.missingGates)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/** Write a sibling story file so the deferral graph sees the target as a node. */
function writeSiblingStory(dir, name) {
  writeFileSync(join(dir, name), 'Status: Done\nReachability: witnessed — wired\n');
}

// ── Audit fixes: transitions and hard gates ─────────────────────────────────

describe('validateReachabilityDeclaration — parser errors refuse even when typed (F1)', () => {
  const workItems = collectWorkItems(stateFixture);

  it('refuses a reasonless deferral whose target EXISTS (was silently accepted)', () => {
    // The parser flags the missing reason; the validator used to consult those
    // errors only for an untyped declaration, so a deferral whose target happened
    // to exist sailed through — the exact case contract v6 §1 refuses.
    const v = validateReachabilityDeclaration(
      parseReachabilityDeclarationText('Reachability: deferred to story-2.md\n'),
      { workItems },
    );
    assert.equal(v.ok, false);
    assert.equal(v.code, 'malformed');
    assert.match(v.message, /WHY/);
  });

  it('refuses a content-free witnessed declaration', () => {
    const v = validateReachabilityDeclaration(
      parseReachabilityDeclarationText('Reachability: witnessed\n'),
      { workItems },
    );
    assert.equal(v.ok, false);
    assert.equal(v.code, 'malformed');
  });

  it('refuses a deferral that names the story itself (F11, deferral-self)', () => {
    const v = validateReachabilityDeclaration(
      parseReachabilityDeclarationText('Reachability: deferred to story-1.md — myself\n'),
      { workItems, self: 'story-1.md' },
    );
    assert.equal(v.ok, false);
    assert.equal(v.code, 'deferral-self');
  });
});

describe('cli — long-form deferral graph (F2)', () => {
  it('reports a long-form cycle even when stories sit outside an epic-named directory', () => {
    // The graph used to derive its epic-key alias from the parent directory name;
    // for stories at the project root (dirname `.`) the long form connected to no
    // node and a real cycle passed green.
    const { dir, story } = makeProject({
      enabled: true,
      storyBody: 'Status: In Progress\nReachability: deferred to epic-1::story-2.md — the other one\n',
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress', 'story-2.md': 'planned' } } },
    });
    writeFileSync(join(dir, 'story-2.md'), 'Status: Planned\nReachability: deferred to story-1.md — this one\n');
    try {
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1, res.stdout + res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.code, 'deferral-cycle');
      assert.equal(out.cycles.length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a self-deferral written in the long form', () => {
    const { dir, story } = makeProject({
      enabled: true,
      storyBody: 'Status: In Progress\nReachability: deferred to epic-1::story-1.md — myself\n',
    });
    try {
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1, res.stdout + res.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('cli — freshness binding is repo-relative (F5)', () => {
  it('catches a story rewritten after recording, even when --story was absolute', () => {
    const { dir, story } = makeProject({ enabled: true, phase: 'review' });
    try {
      const res = runCli(['harness', 'verify-reachability', '--story', story, '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const rec = state.gateEvidence.find((e) => e.gate === REACHABILITY_GATE);
      assert.match(rec.relevantFiles[0], /^story-1\.md$/, 'evidence must bind the repo-relative path, not the absolute one');
      writeFileSync(story, 'Status: In Progress\nReachability: witnessed — rewritten after recording\n');
      const t = runCli(['state', 'transition', '--to', 'validation', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(t.status, 1);
      const out = JSON.parse(t.stdout);
      assert.ok(out.staleEvidence.some((s) => s.gate === REACHABILITY_GATE),
        `the rewritten story must stale the record: ${JSON.stringify(out.staleEvidence)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('closure re-examination (F3) and applyTransition policy (F4)', () => {
  /** A validation-stage repo: every gate evidenced in `validation`, deferral to a planned story. */
  function makeValidationStage({ story2Status = 'planned' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-reach-close-'));
    mkdirSync(join(dir, '.cadet'), { recursive: true });
    writeFileSync(join(dir, 'story-1.md'), 'Status: In Progress\nReachability: deferred to story-2.md — the wiring lands there\n');
    const mk = (gate) => createEvidence({
      evidenceId: newId(), workItemId: 'epic-1::story-1.md', phase: 'validation', gate,
      status: 'passed', command: `fixture:${gate}`, result: 'fixture', exitCode: 0,
      inputTreeHash: computeInputTreeHash(dir, ['story-1.md']), relevantFiles: ['story-1.md'],
      createdAt: new Date(), freshnessPolicy: { scope: 'story' },
    });
    const gates = {};
    const gateEvidence = [];
    for (const g of ['codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated',
      'testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated',
      'designArtifactSyncConfirmed', REACHABILITY_GATE]) {
      gates[g] = true;
      gateEvidence.push(mk(g));
    }
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify({
      reachability: { enabled: true }, strictClosure: { enabled: true },
    }, null, 2));
    const state = {
      version: 4, stateVersion: 4,
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'validation-stage', 'story-2.md': story2Status } } },
      gates, gateEvidence, gateExceptions: [], changeHistory: [],
    };
    return { dir, state };
  }

  it('closes cleanly while the deferral target is still unfinished', () => {
    const { dir, state } = makeValidationStage();
    try {
      const r = evaluateTransition(state, 'closed', {
        rootDir: dir, strictClosure: { enabled: true }, policy: { reachability: { enabled: true } },
      });
      assert.equal(r.allowed, true, JSON.stringify(r));
      assert.ok(r.revalidated.includes(REACHABILITY_GATE), 'the opted-in gate must be part of closure revalidation');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses closure once the deferral target is done', () => {
    const { dir, state } = makeValidationStage({ story2Status: 'done' });
    try {
      const r = evaluateTransition(state, 'closed', {
        rootDir: dir, strictClosure: { enabled: true }, policy: { reachability: { enabled: true } },
      });
      assert.equal(r.allowed, false, JSON.stringify(r));
      assert.ok(r.missingGates.includes(REACHABILITY_GATE));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves closure untouched when the repository has not opted in (OFF inert)', () => {
    const { dir, state } = makeValidationStage({ story2Status: 'done' });
    try {
      const r = evaluateTransition(state, 'closed', { rootDir: dir, strictClosure: { enabled: true } });
      assert.equal(r.allowed, true, JSON.stringify(r));
      assert.equal(r.revalidated.includes(REACHABILITY_GATE), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('CLI closure applies strict closure and the reachability re-examination (F7 + F3)', () => {
    const { dir, state } = makeValidationStage({ story2Status: 'done' });
    try {
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));
      const res = runCli(['state', 'transition', '--to', 'closed', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1, res.stdout + res.stderr);
      const out = JSON.parse(res.stdout);
      assert.ok(out.missingGates.includes(REACHABILITY_GATE),
        `closure must name the expired deferral: ${JSON.stringify(out)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('applyTransition enforces the gate when the caller passes the policy (F4)', () => {
    const { dir } = makeProject({ enabled: true, phase: 'review' });
    try {
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const policy = { reachability: { enabled: true } };
      assert.throws(() => applyTransition(state, 'validation', { rootDir: dir, policy }), (err) =>
        err instanceof StateError && /reachabilityAddressed/.test(err.message));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('cli — manual confirmation refused for the gate under strictClosure (F6/F9)', () => {
  it('rejects a manual confirmation by default and points at verify-reachability', () => {
    const { dir } = makeProject({ enabled: true });
    try {
      writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify({
        reachability: { enabled: true },
        strictClosure: { enabled: true },
      }, null, 2));
      const res = runCli(['harness', 'confirm', '--gate', REACHABILITY_GATE,
        '--reason', 'manual assertion', '--expires-at', new Date(Date.now() + 3600e3).toISOString(),
        '--environment', 'editor:test', '--scope', 'epic-1::story-1.md',
        '--files', 'story-1.md', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1, res.stdout + res.stderr);
      assert.match(res.stdout + res.stderr, /manual-disallowed/);
      assert.match(res.stdout + res.stderr, /verify-reachability/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
