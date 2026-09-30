/**
 * Phase 6 — architecture fitness.
 *
 * What this gate is for: a project declares executable constraints (dependency direction,
 * forbidden references) as registered checks, and a violation blocks review. What it is NOT:
 * a design review. A command can prove `using UnityEngine` is absent from a core assembly; it
 * cannot prove the assembly was a good idea. The tests keep that line: the samples prove
 * executable facts, and the gate's evidence records which check proved what.
 *
 * Every negative case asserts a NON-zero exit AND that the state file is byte-identical.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  ARCHITECTURE_GATE, ARCHITECTURE_TRANSITION_FROM, ARCHITECTURE_TRANSITION_TO,
  DEFAULT_ARCHITECTURE_FITNESS, architectureFitnessActive, validatePolicy, PolicyError,
  requiredGates, TRANSITIONS, GATES, gateBuilder, gatesAcceptingProjectCommand,
  computeInputTreeHash, evaluateTransition, DEFAULT_STRICT_CLOSURE,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

/** Commands the tests declare as checks. Kept here so the JSON-quoting is written once. */
const checks = {
  writeReportCommand: 'node -e "require(\'fs\').mkdirSync(\'.cadet/architecture\',{recursive:true});require(\'fs\').writeFileSync(\'.cadet/architecture/report.json\',JSON.stringify({edges:0}))"',
  flipCommand: 'node -e "const f=require(\'fs\');process.exit(f.readFileSync(\'flip.txt\',\'utf-8\').trim()===\'ok\'?0:7)"',
};
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

/** A repository at implementation with one story in flight, and a policy that declares checks. */
function fixture({ checks = [], enabled = true, extraPolicy = {}, strict = false, files = ['src/Core/EnemyGrid.cs'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-arch-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src', 'Core'), { recursive: true });
  mkdirSync(join(dir, 'src', 'Runtime'), { recursive: true });
  writeFileSync(join(dir, 'src', 'Core', 'EnemyGrid.cs'), 'namespace Core { class EnemyGrid {} }\n');
  writeFileSync(join(dir, 'src', 'Runtime', 'Spawner.cs'), 'using UnityEngine;\nnamespace Runtime { class Spawner {} }\n');
  const policy = { architectureFitness: { enabled, checks }, ...extraPolicy };
  if (strict) policy.strictClosure = { enabled: true, disallowManualFor: [...DEFAULT_STRICT_CLOSURE.disallowManualFor] };
  writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(policy, null, 2));
  // Every gate the transition needs on its own, evidenced, so the only thing a test is
  // looking at is the architecture gate.
  const needed = [...requiredGates(ARCHITECTURE_TRANSITION_TO).gates, ...requiredGates(ARCHITECTURE_TRANSITION_TO).revalidate];
  const gates = {};
  const gateEvidence = [];
  needed.forEach((gate, i) => {
    gates[gate] = true;
    gateEvidence.push({
      evidenceId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      workItemId: 'epic-1::story-1.md', acceptanceCriterionId: null, phase: 'implementation',
      gate, status: 'passed', command: `fixture:${gate}`, result: 'exit 0', exitCode: 0,
      inputTreeHash: computeInputTreeHash(dir, files), criteriaHash: 'b'.repeat(64),
      relevantFiles: files, createdAt: new Date().toISOString(), expiresAt: null,
      freshnessPolicy: { scope: 'story' }, supersededBy: null, source: 'automated',
    });
  });
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 4, stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: ARCHITECTURE_TRANSITION_FROM, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates, gateEvidence, gateExceptions: [], changeHistory: [],
  }, null, 2));
  return dir;
}

const record = (dir) => {
  const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
  return state.gateEvidence.find((e) => e.gate === ARCHITECTURE_GATE) || null;
};

describe('architecture fitness — the declaration', () => {
  it('is an appended gate with a dedicated verifier and no project-command route', () => {
    assert.ok(GATES.includes(ARCHITECTURE_GATE), 'the gate must be appended to GATES (C3)');
    const b = gateBuilder(ARCHITECTURE_GATE);
    assert.equal(b.owner, 'automated');
    assert.equal(b.projectCommand, false, 'the command comes from the declared check, never from --command');
    assert.equal(b.manual, false, 'a declared check can always prove it, so a hand record would substitute for something available');
    assert.match(b.automatedPath, /verify-architecture/);
    assert.equal(gatesAcceptingProjectCommand().includes(ARCHITECTURE_GATE), false);
    assert.deepEqual(Object.keys(DEFAULT_ARCHITECTURE_FITNESS), ['enabled', 'checks']);
    assert.equal(DEFAULT_ARCHITECTURE_FITNESS.enabled, false, 'opt-in, like every other switch');
    assert.deepEqual(DEFAULT_ARCHITECTURE_FITNESS.checks, []);
  });

  it('is not in the frozen transition lists, because it is placed conditionally', () => {
    for (const [from, spec] of Object.entries(TRANSITIONS)) {
      assert.equal(spec.gates.includes(ARCHITECTURE_GATE), false,
        `TRANSITIONS.${from}.gates must not list the gate: a project with no checks must be unaffected`);
      assert.equal((spec.revalidate || []).includes(ARCHITECTURE_GATE), false);
    }
  });

  it('joins implementation -> review only when checks are declared, and closure revalidation too', () => {
    const bare = requiredGates(ARCHITECTURE_TRANSITION_TO);
    assert.equal(bare.gates.includes(ARCHITECTURE_GATE), false, 'off by default: the declared list is unchanged');

    const on = requiredGates(ARCHITECTURE_TRANSITION_TO, { architectureFitness: true });
    assert.deepEqual(on.gates.slice(-1), [ARCHITECTURE_GATE]);
    assert.deepEqual(on.gates.slice(0, -1), bare.gates, 'and it is appended, not substituted');

    const closure = requiredGates('closed', { architectureFitness: true });
    assert.ok(closure.revalidate.includes(ARCHITECTURE_GATE),
      'a dependency can be broken by a later story, so a strict closure re-examines it');
    assert.equal(requiredGates('closed').revalidate.includes(ARCHITECTURE_GATE), false);
    assert.equal(ARCHITECTURE_TRANSITION_TO, TRANSITIONS[ARCHITECTURE_TRANSITION_FROM].to);
  });

  it('is active only when it is both enabled and given something to check', () => {
    assert.equal(architectureFitnessActive({}), false);
    assert.equal(architectureFitnessActive({ architectureFitness: { enabled: true, checks: [] } }), false,
      'enabled with no checks is inert: the gate must not enter the list for a project that declares nothing');
    assert.equal(architectureFitnessActive({ architectureFitness: { enabled: false, checks: [{ id: 'a', command: 'x' }] } }), false);
    assert.equal(architectureFitnessActive({ architectureFitness: { enabled: true, checks: [{ id: 'a', command: 'x' }] } }), true);
  });

  it('refuses a policy defect instead of running half a check set', () => {
    const bad = (block, pattern) => assert.throws(() => validatePolicy({ architectureFitness: block }), pattern);
    bad({ nope: true }, /Unknown/);
    bad({ enabled: true, checks: {}, }, /array/);
    bad({ enabled: 'yes', checks: [] }, /boolean/);
    bad({ enabled: true, checks: [{ command: 'x' }] }, /id/);
    bad({ enabled: true, checks: [{ id: 'Bad Id', command: 'x' }] }, /id/);
    bad({ enabled: true, checks: [{ id: 'a-b', command: '' }] }, /command/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x' }, { id: 'a', command: 'y' }] }, /duplicate/i);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', cwd: '/etc' }] }, /relative/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', cwd: '../outside' }] }, /relative/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', files: ['../outside'] }] }, /relative/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', severity: 'critical' }] }, /severity/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', timeoutMs: 0 }] }, /timeoutMs/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', artifactFormat: 'json' }] }, /artifactFormat/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', artifact: '../out.json', artifactFormat: 'json' }] }, /relative/);
    bad({ enabled: true, checks: [{ id: 'a', command: 'x', nonsense: 1 }] }, /nonsense/);
  });

  it('fills the documented defaults, so a check may be one line', () => {
    const p = validatePolicy({ architectureFitness: { enabled: true, checks: [{ id: 'no-unity-in-core', command: 'true' }] } });
    assert.deepEqual(p.architectureFitness.checks[0], {
      id: 'no-unity-in-core', command: 'true', cwd: '.', files: [], timeoutMs: null,
      severity: 'required', refs: [], artifact: null, artifactFormat: 'text',
    });
  });

  it('may not be satisfied by hand under strict closure', () => {
    assert.ok(DEFAULT_STRICT_CLOSURE.disallowManualFor.includes(ARCHITECTURE_GATE),
      'a declared check is always available, so a manual record would substitute for it');
    // Unlike a gate with no automated builder, listing this one is legal: a consumer may
    // forbid the hand route for a gate it could prove by machine, which is the whole point.
    const p = validatePolicy({ strictClosure: { enabled: true, disallowManualFor: [ARCHITECTURE_GATE] } });
    assert.deepEqual(p.strictClosure.disallowManualFor, [ARCHITECTURE_GATE]);
  });
});

describe('architecture fitness — running the checks', () => {
  const pass = { id: 'core-has-no-unity', command: 'node -e "process.exit(0)"', files: ['src/Core/'] };
  const fail = { id: 'core-direction', command: 'node -e "process.exit(3)"', files: ['src/Core/'] };

  it('records the gate when the required checks pass, and review opens', () => {
    const dir = fixture({ checks: [pass] });
    try {
      const before = runCli(['state', 'transition', '--to', 'review', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(before.json?.missingGates.includes(ARCHITECTURE_GATE), true, 'the gate is required before anything runs');

      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(run.json?.checks?.length, 1);
      assert.equal(run.json.checks[0].status, 'passed');

      const after = runCli(['state', 'transition', '--to', 'review', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(after.json?.allowed, true, after.stdout + after.stderr);

      const ev = record(dir);
      assert.equal(ev.status, 'passed');
      assert.equal(ev.gateContract, `${ARCHITECTURE_GATE}@1`);
      assert.deepEqual(ev.checks.map((c) => [c.id, c.status]), [['core-has-no-unity', 'passed']]);
      assert.deepEqual(ev.relevantFiles, ['src/Core/EnemyGrid.cs']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('blocks review when a required check fails, and records the red', () => {
    const dir = fixture({ checks: [pass, fail] });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      assert.equal(run.json?.failed?.includes('core-direction'), true);

      const ev = record(dir);
      assert.equal(ev.status, 'failed');
      assert.deepEqual(ev.checks.map((c) => [c.id, c.status]), [['core-has-no-unity', 'passed'], ['core-direction', 'failed']]);

      const after = runCli(['state', 'transition', '--to', 'review', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(after.json?.allowed, false);
      assert.ok(after.json.missingGates.includes(ARCHITECTURE_GATE));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lets an advisory failure through, and says so rather than hiding it', () => {
    const dir = fixture({ checks: [{ ...fail, severity: 'advisory' }] });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.deepEqual(run.json?.advisoryFailed, ['core-direction']);
      assert.match(run.json?.note, /advisory/i);
      const ev = record(dir);
      assert.equal(ev.status, 'passed', 'the gate is about required constraints');
      assert.match(ev.result, /advisory/i, 'the record must carry the advisory failure, not swallow it');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('treats a check that never completed as blocked, not as a red', () => {
    const dir = fixture({ checks: [{ id: 'slow', command: 'node -e "setTimeout(() => {}, 5000)"', timeoutMs: 400 }] });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 1);
      assert.equal(run.json?.blocked?.includes('slow'), true);
      assert.deepEqual(run.json?.failed || [], [], 'a command that never finished is not a failed constraint');
      assert.equal(record(dir).status, 'blocked');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not pass a check that declared an artifact and wrote none', () => {
    const dir = fixture({ checks: [{ id: 'writes-nothing', command: 'node -e "process.exit(0)"', artifact: '.cadet/architecture/missing.json', artifactFormat: 'json' }] });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 1);
      assert.match(JSON.stringify(run.json), /artifact/i);
      assert.notEqual(record(dir).status, 'passed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('records the artifact it bound, so the proof travels with the claim', () => {
    const dir = fixture({
      checks: [{
        id: 'dependency-report', command: 'node -e "require(\'fs\').mkdirSync(\'.cadet/architecture\',{recursive:true});require(\'fs\').writeFileSync(\'.cadet/architecture/report.json\',JSON.stringify({edges:0}))"',
        artifact: '.cadet/architecture/report.json', artifactFormat: 'json',
      }],
    });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const check = record(dir).checks[0];
      assert.equal(check.artifactPath, '.cadet/architecture/report.json');
      assert.match(check.artifactHash, /^[0-9a-f]{64}$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves a record that is fresh, when a check declared an artifact', () => {
    // The defect this pins: the record's `inputTreeHash` was computed over the judged files while
    // the stored `relevantFiles` was the union of those files AND the artifact paths. Freshness
    // re-derives the hash from the record's own `relevantFiles`, so every such record read as
    // "input tree hash changed since the evidence was recorded" the moment it was written, and the
    // gate could never be used again — `implementation -> review` was unreachable for any project
    // whose checks write a report. The artifact stays bound, in `checks[]`.
    const dir = fixture({
      checks: [{
        id: 'dependency-report', command: checks.writeReportCommand,
        artifact: '.cadet/architecture/report.json', artifactFormat: 'json',
      }],
    });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const evidence = record(dir);
      assert.equal(computeInputTreeHash(dir, evidence.relevantFiles), evidence.inputTreeHash,
        'the record must hash exactly the files it stores');
      assert.equal(evidence.relevantFiles.includes('.cadet/architecture/report.json'), false,
        'the artifact is bound per check, not folded into the judged files');
      assert.equal(evidence.checks[0].artifactPath, '.cadet/architecture/report.json');

      const dry = runCli(['state', 'transition', '--to', 'review', '--dry-run', '--target', dir, '--format', 'json']);
      const stale = (dry.json?.staleEvidence || []).filter((s) => s.gate === 'architectureFitnessPassed');
      assert.deepEqual(stale, [], `the gate must not read as stale: ${JSON.stringify(dry.json?.staleEvidence)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('clears the gate when a check fails, leaving a document the validator accepts', () => {
    // The defect this pins: `recordEvidence` was called unconditionally, so a failed run wrote
    // `gates.architectureFitnessPassed = true` beside a `failed` record. `state validate` rejects
    // that ("gate is true but has no supporting evidence record"), and the shipped pre-commit hook
    // refuses to commit such a document — a refusal the framework caused, in the consumer's file.
    const dir = fixture({ checks: [{ id: 'boom', severity: 'required', command: 'node -e "process.exit(7)"' }] });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 1);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.gates.architectureFitnessPassed, false, 'a failed run must not leave the gate true');
      const validate = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(validate.json?.valid, true, JSON.stringify(validate.json?.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('clears an earlier pass when a later run fails', () => {
    const dir = fixture({ checks: [{ id: 'flip', severity: 'required', command: checks.flipCommand }] });
    try {
      // Pass first, then fail, without touching the judged files.
      writeFileSync(join(dir, 'flip.txt'), 'ok');
      assert.equal(runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir]).status, 0);
      let state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.gates.architectureFitnessPassed, true);
      writeFileSync(join(dir, 'flip.txt'), 'fail');
      assert.notEqual(runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir]).status, 0);
      state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(state.gates.architectureFitnessPassed, false, 'the failing run invalidates the earlier pass');
      const validate = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(validate.json?.valid, true, JSON.stringify(validate.json?.errors));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses --command, like the sibling commands whose evidence comes from elsewhere', () => {
    const dir = fixture({ checks: [{ id: 'noop', severity: 'required', command: 'node -e "process.exit(0)"' }] });
    try {
      const r = runCli(['harness', 'verify-architecture', '--command', 'node -e "process.exit(0)"', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.notEqual(r.status, 0);
      assert.equal(r.json?.code, 'command-not-accepted');
      assert.match(r.stdout + r.stderr, /takes no --command/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an unparseable artifact when the check declares json', () => {
    const dir = fixture({
      checks: [{
        id: 'bad-json', command: 'node -e "require(\'fs\').writeFileSync(\'.cadet/architecture/bad.json\',\'not json\')"',
        artifact: '.cadet/architecture/bad.json', artifactFormat: 'json',
      }],
    });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 1);
      assert.match(JSON.stringify(run.json), /json/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('architecture fitness — selection by file scope', () => {
  it('runs a scoped check only when a relevant file is under its scope', () => {
    const dir = fixture({ checks: [{ id: 'core-only', command: 'node -e "process.exit(0)"', files: ['src/Core/'] }] });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Runtime/Spawner.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.deepEqual(run.json?.skipped, ['core-only']);
      assert.deepEqual(run.json?.checks, []);
      assert.match(run.json?.note, /no check/i, 'nothing applicable must be stated, not implied');
      assert.equal(record(dir).status, 'passed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('matches a directory scope at a boundary, not by prefix accident', () => {
    const dir = fixture({ checks: [{ id: 'core-only', command: 'node -e "process.exit(0)"', files: ['src/Core'] }] });
    try {
      mkdirSync(join(dir, 'src', 'CoreX'), { recursive: true });
      writeFileSync(join(dir, 'src', 'CoreX', 'Other.cs'), '// not core\n');
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/CoreX/Other.cs', '--target', dir, '--format', 'json']);
      assert.deepEqual(run.json?.skipped, ['core-only'], 'src/Core must not govern src/CoreX');
      const hit = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.deepEqual(hit.json?.skipped, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to guess the file set when a project scopes its checks', () => {
    const dir = fixture({ checks: [{ id: 'core-only', command: 'node -e "process.exit(0)"', files: ['src/Core/'] }] });
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      const run = runCli(['harness', 'verify-architecture', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      assert.equal(run.json?.code, 'freshness-unavailable');
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('architecture fitness — the boundaries', () => {
  it('reports and writes nothing when the project declares no checks', () => {
    const dir = fixture({ checks: [] });
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(run.json?.checks?.length, 0);
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before, 'nothing declared, nothing recorded');
      const after = runCli(['state', 'transition', '--to', 'review', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal((after.json?.missingGates || []).includes(ARCHITECTURE_GATE), false, 'behaves exactly as before');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses --command and the plain verify route for the gate', () => {
    const dir = fixture({ checks: [{ id: 'core', command: 'node -e "process.exit(0)"' }] });
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      const withCommand = runCli(['harness', 'verify', '--gate', ARCHITECTURE_GATE, '--command', 'node -e "process.exit(0)"', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(withCommand.status, 1);
      assert.equal(withCommand.json?.code, 'gate-not-overridable');

      const plain = runCli(['harness', 'verify', '--gate', ARCHITECTURE_GATE, '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(plain.status, 1);
      assert.equal(plain.json?.blocked, true);
      assert.match(plain.json?.reason, /verify-architecture/, 'the refusal names the route that works');
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a hand record under strict closure, because a check can always prove it', () => {
    const dir = fixture({ checks: [{ id: 'core', command: 'node -e "process.exit(0)"' }], strict: true });
    try {
      const before = readFileSync(join(dir, '.cadet', 'state.json'));
      // Full strict metadata, so the refusal that fires is the one under test: the metadata
      // check runs first, and a test that omitted the metadata would pass for that reason.
      const r = runCli(['harness', 'confirm', '--gate', ARCHITECTURE_GATE, '--scope', 'epic-1', '--reason', 'looks fine',
        '--files', 'src/Core/EnemyGrid.cs', '--environment', 'editor=6000.0.23f1',
        '--expires-at', new Date(Date.now() + 3600_000).toISOString(),
        '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'manual-disallowed');
      assert.deepEqual(readFileSync(join(dir, '.cadet', 'state.json')), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('stales the record when a governed file changes, and carries it when nothing did', () => {
    const dir = fixture({ checks: [{ id: 'core', command: 'node -e "process.exit(0)"', files: ['src/Core/'] }] });
    try {
      const run = runCli(['harness', 'verify-architecture', '--files', 'src/Core/EnemyGrid.cs', '--target', dir, '--format', 'json']);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));

      const carried = evaluateTransition(state, ARCHITECTURE_TRANSITION_TO, { rootDir: dir, policy: { architectureFitness: { enabled: true, checks: [{ id: 'core', command: 'x' }] } } });
      assert.equal(carried.missingGates.includes(ARCHITECTURE_GATE), false, JSON.stringify(carried));

      writeFileSync(join(dir, 'src', 'Core', 'EnemyGrid.cs'), 'namespace Core { class EnemyGrid { int x; } }\n');
      const stale = evaluateTransition(state, ARCHITECTURE_TRANSITION_TO, { rootDir: dir, policy: { architectureFitness: { enabled: true, checks: [{ id: 'core', command: 'x' }] } } });
      assert.ok(stale.missingGates.includes(ARCHITECTURE_GATE), `a changed governed file must stale the proof: ${JSON.stringify(stale)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('is not required at closure unless a project opted in', () => {
    const dir = fixture({ checks: [] });
    try {
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const off = evaluateTransition(state, 'closed', { rootDir: dir, policy: {} });
      assert.equal(off.missingGates.includes(ARCHITECTURE_GATE), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
