/**
 * Phase 5 — human acceptance.
 *
 * The gate this file covers answers a question no test can: did a person accept the
 * delivered work. The tests are grouped by the three claims Phase 5 has to make:
 *
 *   1. Passing tests cannot satisfy human acceptance.
 *   2. The next-story transition stays unblocked.
 *   3. Epic closure fails without human acceptance or a valid exception.
 *
 * Every negative case asserts a NON-zero exit AND that the state file is
 * byte-identical, because a refusal that still wrote would be worse than none.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { randomUUID } from 'node:crypto';

import {
  HUMAN_ACCEPTANCE_GATE, HUMAN_ACCEPTANCE_TRANSITION_FROM, DEFAULT_HUMAN_ACCEPTANCE,
  MANUAL_ONLY_GATES, TRANSITIONS, PHASES, requiredGates, conditionalEdgeGates,
  gateBuilder, manualOnlyGateNames, validatePolicy, validateState, evaluateTransition,
  createEvidence, computeInputTreeHash,
} from '../src/harness/index.mjs';

const newId = () => randomUUID();

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = join(__dirname, '..', 'bin', 'cli.mjs');

function runCli(args) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf-8' });
  let json = null;
  for (const text of [r.stdout, r.stderr]) {
    if (!text) continue;
    const start = text.indexOf('{');
    if (start < 0) continue;
    try { json = JSON.parse(text.slice(start)); } catch { /* not this stream */ }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** A repository at `validation`, one story through validation, nothing else asked of it. */
function fixture({
  phase = HUMAN_ACCEPTANCE_TRANSITION_FROM,
  enabled = true,
  strict = false,
  gates = null,
  gateExceptions = [],
  stories = { 'story-1.md': 'validation-stage' },
  policyExtra = {},
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-accept-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  const policy = { humanAcceptance: { enabled }, ...policyExtra };
  if (strict) {
    policy.strictClosure = {
      enabled: true,
      manualConfirmation: { requireReason: true, requireExpiresAt: true, requireEnvironment: true, requireScope: true, maxValidityMs: 86400000 },
    };
  }
  writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, 'story-1.md'), 'Status: In Progress\n');
  // Everything the closure transition demands on its own, evidenced the way a real
  // repository does it — a gate that reads true with no record behind it counts as
  // missing, so a fixture that only set booleans would fail for the wrong reason.
  const mk = (gate) => createEvidence({
    evidenceId: newId(), workItemId: 'epic-1::story-1.md', phase, gate,
    status: 'passed', command: `fixture:${gate}`, result: 'fixture', exitCode: 0,
    inputTreeHash: computeInputTreeHash(dir, ['story-1.md']), relevantFiles: ['story-1.md'],
    createdAt: new Date(), freshnessPolicy: { scope: 'story' },
  });
  const base = {};
  const gateEvidence = [];
  // `requiredGates` takes the TARGET phase, so the closure's own gates come from
  // `requiredGates('closed')` — asking for 'validation' would return the gates that
  // carry INTO validation, which is a different transition's business.
  for (const g of new Set([...requiredGates('closed').gates, ...requiredGates('closed').revalidate])) {
    base[g] = true;
    gateEvidence.push(mk(g));
  }
  const state = {
    version: 4,
    stateVersion: 4,
    session: { currentPhase: phase, workflowPath: 'large', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: { 'epic-1': { status: 'in-progress', stories } },
    gates: { ...base, ...(gates || {}) },
    gateEvidence, gateExceptions, changeHistory: [],
  };
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));
  return { dir, state };
}

const withPolicy = (enabled) => ({ policy: { humanAcceptance: { enabled } } });

describe('human acceptance — the declaration', () => {
  it('is a human-owned gate with no automated path and no project override', () => {
    const b = gateBuilder(HUMAN_ACCEPTANCE_GATE);
    assert.ok(b, 'the gate must be in the registry (C3)');
    assert.equal(b.owner, 'human');
    assert.equal(b.automatedPath, null, 'no command answers whether a person accepted the work');
    assert.equal(b.projectCommand, false);
    assert.equal(b.manual, true);
    assert.ok(b.attests.length > 0);
  });

  it('is in the manual-only list, because manual confirmation is its only route', () => {
    assert.ok(MANUAL_ONLY_GATES.includes(HUMAN_ACCEPTANCE_GATE));
    assert.ok(manualOnlyGateNames().includes(HUMAN_ACCEPTANCE_GATE));
  });

  it('may never be forbidden by hand, because forbidding it would make it unsatisfiable', () => {
    assert.throws(
      () => validatePolicy({ strictClosure: { enabled: true, disallowManualFor: [HUMAN_ACCEPTANCE_GATE] } }),
      /unsatisfiable/,
    );
  });

  it('is not a static requirement of any transition (the placement is conditional)', () => {
    for (const [from, spec] of Object.entries(TRANSITIONS)) {
      assert.equal(spec.gates.includes(HUMAN_ACCEPTANCE_GATE), false,
        `TRANSITIONS.${from}.gates must not list the gate: it is added at evaluation time, so an in-flight repository is unaffected`);
    }
    assert.deepEqual(conditionalEdgeGates('validation', 'closed'), []);
  });

  it('is opt-in by default', () => {
    assert.equal(DEFAULT_HUMAN_ACCEPTANCE.enabled, false);
    assert.equal(validatePolicy({}).humanAcceptance.enabled, false);
  });

  it('rejects an unknown policy key instead of ignoring it', () => {
    assert.throws(() => validatePolicy({ humanAcceptance: { enable: true } }), /Unknown "humanAcceptance" key/);
  });
});

describe('human acceptance — 1. passing tests cannot satisfy it', () => {
  it('refuses an exit-zero command for the gate', () => {
    const { dir } = fixture();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      const r = runCli(['harness', 'verify', '--gate', HUMAN_ACCEPTANCE_GATE,
        '--command', 'node -e "process.exit(0)"', '--files', 'a.mjs',
        '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'gate-not-overridable');
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before, 'a refusal must not write');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses the plain verify route too, and names the remedy', () => {
    const { dir } = fixture();
    try {
      const r = runCli(['harness', 'verify', '--gate', HUMAN_ACCEPTANCE_GATE, '--files', 'a.mjs',
        '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      // The same shape `codeReviewCompleted` has always used for "there is no command
      // for this gate": blocked, with a reason that names who can satisfy it.
      assert.equal(r.json?.blocked, true);
      assert.match(r.json?.reason, /human-owned/);
      assert.match(r.json?.reason, /person accepts/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('cannot be satisfied by a green testsPassed record', () => {
    const { dir, state } = fixture();
    try {
      const r = evaluateTransition(state, 'closed', { rootDir: dir, ...withPolicy(true) });
      assert.equal(r.allowed, false);
      assert.ok(r.missingGates.includes(HUMAN_ACCEPTANCE_GATE),
        `a passing suite must not stand in for acceptance: ${JSON.stringify(r)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('human acceptance — 2. the next-story loop stays unblocked', () => {
  it('is not required for validation -> implementation', () => {
    const { dir, state } = fixture();
    try {
      const r = evaluateTransition(state, 'implementation', { rootDir: dir, ...withPolicy(true) });
      assert.equal(r.allowed, true, JSON.stringify(r));
      assert.equal(r.missingGates.includes(HUMAN_ACCEPTANCE_GATE), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('is not required at any other transition either', () => {
    const { dir } = fixture({ phase: 'review' });
    try {
      for (const phase of PHASES) {
        if (phase === 'closed') continue;
        const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
        state.session.currentPhase = 'review';
        const r = evaluateTransition(state, phase, { rootDir: dir, ...withPolicy(true) });
        assert.equal(r.missingGates.includes(HUMAN_ACCEPTANCE_GATE), false,
          `the gate must not block review -> ${phase}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('human acceptance — 3. closure requires acceptance or a valid exception', () => {
  it('closes when a person has accepted the work, recorded from a form', () => {
    const { dir, state } = fixture();
    try {
      const r = evaluateTransition(state, 'closed', { rootDir: dir, ...withPolicy(true) });
      assert.equal(r.allowed, false, 'sanity: the gate is doing something');
      const ok = fixture();
      try {
        // The recorder's job, without the generator: a form is a file with three
        // answers in it, and this is one. The generator is covered in
        // harness-acceptance-form.test.mjs.
        const form = join(ok.dir, 'HumanAcceptance.md');
        writeFileSync(form, [
          '# Human Acceptance: epic-1',
          '',
          'Accepted by: the owner',
          'Date: 2026-09-30',
          'Files: story-1.md',
          'Environment: revision=abc1234, editor=6000.0.23f1',
          '',
          '## Witness',
          '',
          'played the tutorial level, the tower fired and the wave advanced',
          '',
          '## Scope reviewed',
          '',
          'the tutorial level only',
          '',
          '## Accepted limitations',
          '',
          'none',
          '',
          '---',
          '',
          '## Recording',
          '',
          'instructions, not part of the record',
          '',
        ].join('\n'));

        const res = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE,
          '--artifact', form, '--target', ok.dir, '--format', 'json']);
        assert.equal(res.status, 0, res.stdout + res.stderr);
        const after = JSON.parse(readFileSync(join(ok.dir, '.cadet', 'state.json'), 'utf-8'));
        assert.equal(after.gates[HUMAN_ACCEPTANCE_GATE], true);
        const record = after.gateEvidence.find((e) => e.gate === HUMAN_ACCEPTANCE_GATE);
        assert.ok(record, 'the acceptance must leave a record');
        assert.match(record.witness, /tutorial level/);
        assert.equal(record.limitations, 'none');
        assert.equal(record.source, 'manual-confirmation');
        assert.deepEqual(record.relevantFiles, ['story-1.md'], 'the form binds the files it names');
        const closure = evaluateTransition(after, 'closed', { rootDir: ok.dir, ...withPolicy(true) });
        assert.equal(closure.allowed, true, JSON.stringify(closure));
      } finally { rmSync(ok.dir, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses the flag route outright, because one gate has one way in', () => {
    // The two flags that used to carry the acceptance are gone. A caller still passing them must be
    // refused, not silently recorded without them — a silent no-op here would put an acceptance in
    // the record that nobody wrote.
    //
    // The refusal is by NAME (code `flag-removed`), which is what C16 claims and what the flags did
    // not do: they had no parseArgs case at all, so they fell through into `opts.rest`, the command
    // exited 0, and the values were discarded while the form's own values were recorded.
    const { dir } = fixture();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE,
        '--scope', 'epic-1', '--witness', 'played it', '--limitations', 'none',
        '--files', 'story-1.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'flag-removed');
      assert.deepEqual(r.json?.flags, ['--witness', '--limitations'], 'both flags are named');
      assert.match(r.json?.error, /acceptance-form/, 'the refusal must name the command that works');
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before, 'a refusal must not write');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a confirmation with no form, naming the command that writes one', () => {
    const { dir } = fixture();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE,
        '--scope', 'epic-1', '--files', 'story-1.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'acceptance-form-required');
      assert.match(r.json?.error, /acceptance-form/);
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to accept a record whose limitations were blanked, whatever wrote it', () => {
    // The witness twin of this test sits below. Together they say the gate cannot be
    // satisfied without both answers, no matter which route produced the record: the
    // blanking is caught at validation, not only at capture.
    const { dir, state } = fixture();
    try {
      state.gates[HUMAN_ACCEPTANCE_GATE] = true;
      state.gateEvidence = [{
        evidenceId: 'ev-2', gate: HUMAN_ACCEPTANCE_GATE, phase: HUMAN_ACCEPTANCE_TRANSITION_FROM,
        status: 'manual-confirmation', source: 'manual-confirmation', createdAt: new Date().toISOString(),
        witness: 'played the tutorial level',
        limitations: '   ',
      }];
      const r = validateState(state, {});
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => /limitations/.test(e.message)), JSON.stringify(r.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to accept a record whose witness was removed by hand', () => {
    const { dir, state } = fixture();
    try {
      state.gates[HUMAN_ACCEPTANCE_GATE] = true;
      state.gateEvidence = [{
        evidenceId: 'ev-1', gate: HUMAN_ACCEPTANCE_GATE, phase: HUMAN_ACCEPTANCE_TRANSITION_FROM,
        status: 'manual-confirmation', source: 'manual-confirmation', createdAt: new Date().toISOString(),
        limitations: 'none',
      }];
      const r = validateState(state, {});
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => /witness/.test(e.message)), JSON.stringify(r.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts a non-user-facing exception that names who judged it', () => {
    // Framework internals: work a user cannot reach or observe. The exception states
    // that, and the closure review note says who decided it and what would change it.
    const { dir, state } = fixture({
      gateExceptions: [{
        gate: HUMAN_ACCEPTANCE_GATE,
        category: 'non-user-facing',
        reason: 'this epic changes the packaging scripts; no runtime surface',
        closureReviewNote: 'Accepted by the owner on 2026-09-30; revisit if the change ever reaches a shipped build script.',
      }],
    });
    try {
      const validity = validateState(state, { strictClosure: { enabled: true } });
      assert.equal(validity.valid, true, JSON.stringify(validity.errors));
      const r = evaluateTransition(state, 'closed', { rootDir: dir, ...withPolicy(true) });
      assert.equal(r.allowed, true, JSON.stringify(r));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an unknown category and names the new one as valid', () => {
    const { dir, state } = fixture({
      gateExceptions: [{ gate: HUMAN_ACCEPTANCE_GATE, category: 'not-user-facing', reason: 'x', closureReviewNote: 'y' }],
    });
    try {
      const r = validateState(state, { strictClosure: { enabled: true } });
      assert.equal(r.valid, false);
      const msg = r.errors.map((e) => e.message).join(' | ');
      assert.ok(/unknown exception category/.test(msg), msg);
      assert.ok(/non-user-facing/.test(msg), 'the error must list the new category as valid');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a non-user-facing exception with no review note', () => {
    const { dir, state } = fixture({
      gateExceptions: [{ gate: HUMAN_ACCEPTANCE_GATE, category: 'non-user-facing', reason: 'internals' }],
    });
    try {
      const r = validateState(state, { strictClosure: { enabled: true } });
      assert.equal(r.valid, false);
      assert.ok(r.errors.some((e) => /closureReviewNote/.test(e.message)), JSON.stringify(r.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves closure exactly as it was when the repository has not opted in', () => {
    const { dir, state } = fixture({ enabled: false });
    try {
      const r = evaluateTransition(state, 'closed', { rootDir: dir, ...withPolicy(false) });
      assert.equal(r.allowed, true, JSON.stringify(r));
      assert.equal(r.missingGates.includes(HUMAN_ACCEPTANCE_GATE), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('is inert over the CLI when the repository has not opted in', () => {
    const { dir } = fixture({ enabled: false });
    try {
      const r = runCli(['state', 'transition', '--to', 'closed', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.json?.missingGates?.includes(HUMAN_ACCEPTANCE_GATE) ?? false, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
