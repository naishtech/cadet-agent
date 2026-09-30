/**
 * The easy capture route: `harness acceptance-form` writes a form pre-filled from
 * state, and `harness confirm --artifact <form>` records the gate from it.
 *
 * The point of these tests is that the record costs the person one short answer per
 * blank field and no retyping: everything the framework already knows is already in the
 * file, and the command to record it is printed in the file too. The refusals matter
 * more than the happy path — a sentinel that reads as an answer would put the
 * framework's own placeholder text into the record as if a person had written it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  HUMAN_ACCEPTANCE_GATE, ACCEPTANCE_HUMAN_FIELDS, ACCEPTANCE_FORM_FILENAME,
  acceptanceFormPath, acceptanceCandidates, buildAcceptanceForm, parseAcceptanceForm,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');
const TEMPLATE = readFileSync(join(repoRoot, '.cadet/agent/core/templates/HumanAcceptanceTemplate.md'), 'utf-8');

function runCli(args, cwd = repoRoot) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  let json = null;
  for (const text of [r.stdout, r.stderr]) {
    if (!text) continue;
    const start = text.indexOf('{');
    if (start < 0) continue;
    try { json = JSON.parse(text.slice(start)); } catch { /* other stream */ }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** A repository at validation, one epic, two stories, with the template in place. */
function fixture({ policy = { humanAcceptance: { enabled: true } }, stories = { 'story-1.md': 'validation-stage', 'story-2.md': 'planned' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-form-'));
  mkdirSync(join(dir, '.cadet', 'agent', 'core', 'templates'), { recursive: true });
  mkdirSync(join(dir, '.cadet', 'agent', 'project-plans', 'epic-1'), { recursive: true });
  writeFileSync(join(dir, '.cadet', 'agent', 'core', 'templates', 'HumanAcceptanceTemplate.md'), TEMPLATE);
  writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', 'story-1.md'), '# story 1\n');
  writeFileSync(join(dir, 'story-1.md'), 'Status: In Progress\n');
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 4,
    stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: { 'epic-1': { status: 'in-progress', stories } },
    gates: {}, gateEvidence: [], gateExceptions: [], changeHistory: [],
  }, null, 2));
  return dir;
}

/** Replace the three sentinels with real answers, the way a person would. */
function fillIn(text, { acceptor = 'the owner', witness = 'launched the level, the tower fired, the wave advanced', limitations = 'no audio pass yet' } = {}) {
  return text
    .replace(/Accepted by:.*$/m, `Accepted by: ${acceptor}`, 1)
    .replace(/^## Witness\s*\n+.*$/m, `## Witness\n\n${witness}`, 1)
    .replace(/^## Accepted limitations\s*\n+.*$/m, `## Accepted limitations\n\n${limitations}`, 1);
}

describe('acceptance form — generation', () => {
  it('writes a form that is complete except the fields only a person can answer', () => {
    const dir = fixture();
    try {
      const r = runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const text = readFileSync(join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME), 'utf-8');

      // Everything the framework knows is already written down.
      assert.match(text, /^# Human Acceptance: epic-1$/m);
      assert.match(text, /^Files: .+story-1\.md/m, 'the form names the epic\'s files');
      assert.match(text, /^Environment: revision=/m);
      assert.match(text, /^- story-1\.md — validation-stage$/m, 'scope is pre-filled from state');
      assert.match(text, /- story-2\.md is "planned", not done/, 'candidates come from state');

      // And the three blanks are exactly the three a person answers.
      const parsed = parseAcceptanceForm(text);
      assert.deepEqual(parsed.incomplete, ['acceptor', 'witness', 'limitations']);
      assert.deepEqual([...ACCEPTANCE_HUMAN_FIELDS], ['acceptor', 'witness', 'limitations']);

      // The command to record it is in the file, with the real path.
      assert.match(text, /harness confirm --gate humanAcceptanceConfirmed --artifact \.cadet\/agent\/project-plans\/epic-1\/HumanAcceptance\.md/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never overwrites a form a person has already touched', () => {
    const dir = fixture();
    try {
      assert.equal(runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]).status, 0);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));
      const before = readFileSync(path);
      const second = runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir, '--format', 'json']);
      assert.equal(second.status, 1);
      assert.equal(second.json?.code, 'form-exists');
      assert.deepEqual(readFileSync(path), before, 'a half-filled form must survive a second run');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an epic that does not exist rather than inventing one', () => {
    const dir = fixture();
    try {
      const r = runCli(['harness', 'acceptance-form', '--epic', 'epic-9', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'epic-unknown');
      assert.match(r.json?.error, /epic-1/, 'the refusal must say what does exist');
      assert.equal(existsSync(acceptanceFormPath(dir, 'epic-9')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('says so when the template is missing instead of writing a different shape', () => {
    const dir = fixture();
    try {
      rmSync(join(dir, '.cadet', 'agent', 'core', 'templates', 'HumanAcceptanceTemplate.md'));
      const r = runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'template-missing');
      assert.match(r.json?.error, /sync/, 'the remedy is named');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes nothing to state, so generating a form is never a gate change', () => {
    const dir = fixture();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports no candidates when state holds nothing outstanding', () => {
    assert.deepEqual(acceptanceCandidates({ epics: {}, gateEvidence: [], gateExceptions: [] }), []);
    const candidates = acceptanceCandidates({
      epics: { 'epic-1': { stories: { 'story-1.md': 'done' } } },
      gateEvidence: [],
      gateExceptions: [{ gate: 'compileCheckConfirmed', category: 'manual-compile', expiresAt: '2026-12-01T00:00:00.000Z' }],
    });
    assert.equal(candidates.length, 1);
    assert.match(candidates[0], /compileCheckConfirmed.*manual-compile.*2026-12-01/);
  });

  it('works in a repository with no git, and says the revision is unknown', () => {
    const { text } = buildAcceptanceForm({
      template: TEMPLATE, state: { epics: { 'epic-1': { stories: {} } } }, epicId: 'epic-1',
      targetDir: join(tmpdir(), 'definitely-not-a-repository-xyz'),
    });
    assert.match(text, /^Environment: revision=unknown/m);
  });
});

describe('acceptance form — recording from the form', () => {
  it('records the gate from a filled form, with no flags retyped', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));

      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);

      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.gates[HUMAN_ACCEPTANCE_GATE], true);
      const record = state.gateEvidence.find((e) => e.gate === HUMAN_ACCEPTANCE_GATE);
      assert.equal(record.witness, 'launched the level, the tower fired, the wave advanced');
      assert.equal(record.limitations, 'no audio pass yet');
      assert.deepEqual(record.relevantFiles, ['.cadet/agent/project-plans/epic-1/story-1.md'], 'the form bound its own files');
      assert.equal(record.source, 'manual-confirmation');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an untouched form and names every blank', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      const before = readFileSync(join(dir, '.cadet', 'state.json'));

      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'acceptance-form-incomplete');
      assert.deepEqual(r.json?.missing, ['acceptor', 'witness', 'limitations']);
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before, 'a refusal must not write');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a partially filled form, so half an acceptance is not a record', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      // The witness answered, the limitations left blank.
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8'), { limitations: '<slot id="limitations" note="x"/>' }));
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.deepEqual(r.json?.missing, ['limitations']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a form that accepts an epic the repository does not have', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')).replace('# Human Acceptance: epic-1', '# Human Acceptance: epic-404'));
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'acceptance-form-epic-unknown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a missing form, and an artifact offered to a different gate', () => {
    const dir = fixture();
    try {
      const missing = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', join(dir, 'nope.md'), '--target', dir, '--format', 'json']);
      assert.equal(missing.status, 1);
      assert.equal(missing.json?.code, 'artifact-unreadable');

      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));
      const wrongGate = runCli(['harness', 'confirm', '--gate', 'testsPassed', '--artifact', path, '--target', dir, '--format', 'json']);
      assert.equal(wrongGate.status, 1);
      assert.equal(wrongGate.json?.code, 'artifact-not-applicable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses the artifact together with the flags it would compete with', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path,
        '--scope', 'a-different-scope', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'artifact-conflicts-with-flags');
      assert.deepEqual(r.json?.conflicting, ['scope']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to record without a form, and points at the command that writes one', () => {
    // There is no flag route: a scripting caller writes the form too, which costs one
    // extra command and leaves the acceptance somewhere a person can read it.
    const dir = fixture();
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--scope', 'epic-1',
        '--files', 'story-1.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'acceptance-form-required');
      assert.match(r.json?.error, /harness acceptance-form --epic/);
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('records a scripted acceptance from a form written by hand, so nothing is API-only', () => {
    const dir = fixture();
    try {
      const form = join(dir, 'HandWritten.md');
      writeFileSync(form, '# Human Acceptance: epic-1\n\nAccepted by: the owner\nDate: 2026-09-30\nFiles: story-1.md\nEnvironment: revision=abc\n\n## Witness\n\nran the exported build\n\n## Accepted limitations\n\nnone\n');
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', form, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('opens closure with nothing else retyped, end to end', () => {
    const dir = fixture();
    try {
      // Give the epic everything closure wants except the acceptance, so the only
      // thing the form can be doing is supplying that.
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      state.gates = { designArtifactSyncConfirmed: true };
      state.gateEvidence = [{
        evidenceId: '11111111-1111-4111-8111-111111111111', gate: 'designArtifactSyncConfirmed',
        phase: 'validation', status: 'manual-confirmation', source: 'manual-confirmation',
        reason: 'fixture', createdAt: new Date().toISOString(), relevantFiles: ['story-1.md'],
        workItemId: 'epic-1::story-1.md',
      }];
      writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));

      const blocked = runCli(['state', 'transition', '--to', 'closed', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(blocked.json?.allowed, false);
      assert.ok(blocked.json.missingGates.includes(HUMAN_ACCEPTANCE_GATE));

      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));
      assert.equal(runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path, '--target', dir]).status, 0);

      // The full closure path is covered by harness-human-acceptance.test.mjs; here the
      // claim is narrower and is the one this file is about — the form supplied the
      // gate, so closure no longer names it.
      const after = runCli(['state', 'transition', '--to', 'closed', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal((after.json?.missingGates || []).includes(HUMAN_ACCEPTANCE_GATE), false,
        `the acceptance must come from the form: ${after.stdout}${after.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the acceptance route under the SHIPPED policy', () => {
  // The defect this pins: the generated route was unsatisfiable whenever strict closure was on,
  // which is how every new consumer starts. `harness confirm` demanded `--scope` and
  // `--environment` (strictClosure.manualConfirmation) and then refused them beside `--artifact`
  // as "a second, competing source" — so the command failed whichever way it was called, and the
  // gate could not be satisfied at all. Every other test in this file used a policy without
  // strict closure, which is exactly why the suite did not notice.
  const SEED = JSON.parse(readFileSync(join(repoRoot, '.cadet', 'harness.json'), 'utf-8'));

  function strictFixture() {
    const dir = fixture({ policy: { ...SEED, humanAcceptance: { enabled: true } } });
    return dir;
  }

  it('records the acceptance from the form with the two fields strict closure needs', () => {
    const dir = strictFixture();
    try {
      const form = runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      assert.equal(form.status, 0, form.stdout + form.stderr);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));

      const expires = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path,
        '--reason', 'accepted in the acceptance-route test', '--expires-at', expires,
        '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, `the artifact route must be satisfiable under the shipped policy: ${r.stdout}${r.stderr}`);
      assert.equal(r.json?.ok, true);

      // The scope came from the form, not from a flag: the exemption must not have dropped it.
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const record = (state.gateEvidence || []).find((e) => e.gate === HUMAN_ACCEPTANCE_GATE);
      assert.ok(record, 'the acceptance was recorded');
      assert.ok(Array.isArray(record.relevantFiles) && record.relevantFiles.length > 0,
        'the record binds the files the form named, so the exemption did not drop the scope');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still refuses --scope beside the artifact, which is why the exemption exists', () => {
    const dir = strictFixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));
      const expires = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path,
        '--reason', 'x', '--expires-at', expires, '--scope', 'epic-1', '--target', dir, '--format', 'json']);
      assert.notEqual(r.status, 0);
      assert.equal(r.json?.code, 'artifact-conflicts-with-flags');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still refuses a confirmation with no validity window', () => {
    const dir = strictFixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));
      const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path,
        '--reason', 'x', '--target', dir, '--format', 'json']);
      assert.notEqual(r.status, 0);
      assert.equal(r.json?.code, 'strict-metadata-missing');
      assert.ok(r.json.missing.includes('--expires-at'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the flags the form replaced are refused by name', () => {
  // C16 claims "a caller passing `--witness` or `--limitations` is refused by name". It was not:
  // neither flag had a parseArgs case, so both fell through into `opts.rest` and the command exited
  // 0, recording the form's values and discarding what the caller typed. A discarded field that
  // looked accepted is the failure this framework exists to prevent.
  it('refuses --witness and --limitations with the form named instead', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'acceptance-form', '--epic', 'epic-1', '--target', dir]);
      const path = join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', ACCEPTANCE_FORM_FILENAME);
      writeFileSync(path, fillIn(readFileSync(path, 'utf-8')));
      const before = readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8');

      for (const flag of ['--witness', '--limitations']) {
        const r = runCli(['harness', 'confirm', '--gate', HUMAN_ACCEPTANCE_GATE, '--artifact', path,
          flag, 'a value nobody should lose', '--target', dir, '--format', 'json']);
        assert.notEqual(r.status, 0, `${flag} must be refused`);
        assert.equal(r.json?.code, 'flag-removed', `${flag} must be refused by name`);
        assert.match(r.stdout + r.stderr, /harness acceptance-form/);
        assert.equal(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'), before,
          'a refused confirmation writes nothing');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
