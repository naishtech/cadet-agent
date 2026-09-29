import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, { cwd = repoRoot } = {}) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A project directory that carries only what a test asks for. */
function makeProject({ state = null, plans = false, manifest = false, runs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-status-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  if (plans) mkdirSync(join(dir, '.cadet', 'agent', 'project-plans'), { recursive: true });
  if (manifest) {
    mkdirSync(join(dir, '.cadet', 'agent', 'core'), { recursive: true });
    writeFileSync(join(dir, '.cadet', 'agent', 'core', 'FrameworkManifest.json'), '{}\n');
  }
  if (state !== null) writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));
  if (runs.length > 0) {
    mkdirSync(join(dir, '.cadet', 'runs'), { recursive: true });
    for (const run of runs) {
      writeFileSync(join(dir, '.cadet', 'runs', `${run.runId}.json`), JSON.stringify(run, null, 2));
    }
  }
  return dir;
}

/** A v4 state document, all gates false. Healthy by construction. */
function v4State({ gates = {}, gateEvidence = [] } = {}) {
  return {
    version: 4,
    stateVersion: 4,
    session: {
      workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown', operatingMode: 'hybrid',
    },
    epics: {},
    gates: {
      codeReviewCompleted: false,
      testsPassed: false,
      storyTrackingUpdated: false,
      compileCheckConfirmed: false,
      unityAnalyzerClean: false,
      acceptanceCriteriaValidated: false,
      securityReviewPassed: false,
      designArtifactSyncConfirmed: false,
      reachabilityAddressed: false,
      ...gates,
    },
    gateEvidence,
    activeRunId: null,
    activeWorkItem: { epicId: 'epic-1', workItemId: null, storyId: 'story-1.md' },
    lastTransition: { from: 'context-resolution', to: 'implementation', at: '2026-09-29T00:00:00.000Z', evidenceIds: [] },
    spikes: {},
    changeHistory: [],
    evidenceCoverage: {},
    gateExceptions: [],
    storyCompletions: [],
  };
}

function withProject(options, fn) {
  const dir = makeProject(options);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('harness status — the health line', () => {
  it('prints exactly `cadet-agent: ok` for a record that validates', () => {
    withProject({ state: v4State({}) }, (dir) => {
      const res = runCli(['harness', 'status', '--target', dir]);
      assert.equal(res.status, 0);
      // The contract is one line. A second line would reintroduce the table this
      // command exists to remove.
      assert.equal(res.stdout.trim(), 'cadet-agent: ok');
      assert.ok(!res.stdout.trim().includes('\n'), 'the health line must be a single line');
    });
  });

  it('reports the role instead of a bare ok in a framework-source repository', () => {
    // No state file and no plans tree: the framework source repository, where a
    // missing record is expected rather than a silent pass.
    withProject({ manifest: true }, (dir) => {
      const res = runCli(['harness', 'status', '--target', dir]);
      assert.equal(res.status, 0);
      assert.match(res.stdout.trim(), /^cadet-agent: ok — framework-source repository, no workflow state$/);
    });
  });

  it('reports a missing record in a consumer repository', () => {
    withProject({ plans: true }, (dir) => {
      const res = runCli(['harness', 'status', '--target', dir]);
      assert.equal(res.status, 1, 'a missing record is a problem, and the exit code says so');
      assert.match(res.stdout.trim(), /no \.cadet\/state\.json/);
      assert.match(res.stdout.trim(), /cadet-agent init/);
    });
  });

  it('reports an unbacked gate rather than treating it as healthy', () => {
    // A hand-edited `true` gate with no evidence is the exact rejection
    // `state validate` exists for; the line must carry it, not swallow it.
    withProject({ state: v4State({ gates: { testsPassed: true } }) }, (dir) => {
      const res = runCli(['harness', 'status', '--target', dir]);
      assert.equal(res.status, 1);
      assert.match(res.stdout.trim(), /testsPassed/);
      assert.match(res.stdout.trim(), /state validate/);
    });
  });

  it('reports a run that stopped instead of reporting an outcome', () => {
    withProject({
      state: v4State({}),
      runs: [{ runId: 'aaaaaaaa-1111-4111-8111-111111111111', status: 'blocked', startedAt: '2026-09-29T01:00:00.000Z' }],
    }, (dir) => {
      const res = runCli(['harness', 'status', '--target', dir]);
      assert.equal(res.status, 1);
      assert.match(res.stdout.trim(), /could not run/);
      assert.match(res.stdout.trim(), /aaaaaaaa/);
    });
  });

  it('does NOT report a failed run, because a red is how TDD works', () => {
    // This negative case is the design: gate reds are normal, a stop is not.
    // Treating a red as a problem would print one on nearly every story turn.
    withProject({
      state: v4State({}),
      runs: [{ runId: 'bbbbbbbb-2222-4222-8222-222222222222', status: 'failed', startedAt: '2026-09-29T01:00:00.000Z' }],
    }, (dir) => {
      const res = runCli(['harness', 'status', '--target', dir]);
      assert.equal(res.status, 0);
      assert.equal(res.stdout.trim(), 'cadet-agent: ok');
    });
  });

  it('carries the same verdict in json, with the detail behind the line', () => {
    withProject({ state: v4State({}) }, (dir) => {
      const ok = JSON.parse(runCli(['harness', 'status', '--format', 'json', '--target', dir]).stdout);
      assert.equal(ok.ok, true);
      assert.equal(ok.status.line, 'cadet-agent: ok');
      assert.deepEqual(ok.status.problems, []);
      assert.equal(ok.status.role, 'consumer-project');
      assert.equal(ok.status.stateExists, true);
    });

    withProject({ state: v4State({ gates: { testsPassed: true } }) }, (dir) => {
      const bad = JSON.parse(runCli(['harness', 'status', '--format', 'json', '--target', dir]).stdout);
      assert.equal(bad.ok, false);
      assert.ok(bad.status.problems.length > 0, 'the problem must be machine-readable, not only prose');
      assert.equal(bad.status.problems[0].code, 'state-invalid');
      assert.ok(bad.status.problems[0].remedy, 'a problem without a remedy is half a message');
    });
  });

  it('is honoured as read-only at any depth, including --help', () => {
    const res = runCli(['harness', 'status', '--help']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /harness status/);
  });
});
