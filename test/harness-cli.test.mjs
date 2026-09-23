import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
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

function makeProject(stateDoc) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-cli-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  if (stateDoc !== null) {
    writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(stateDoc, null, 2));
  }
  return dir;
}

function v1State() {
  return {
    version: 1,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: { testsPassed: false },
    spikes: {},
    changeHistory: [],
  };
}

/** Run a failing (red) verification so a subsequent green testsPassed is allowed. */
function runRedThenGreen(dir, gate, greenCommand) {
  runCli(['harness', 'verify', '--gate', gate, '--command', 'node -e "process.exit(3)"', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
  return runCli(['harness', 'verify', '--gate', gate, '--command', greenCommand, '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
}

describe('cli — state', () => {
  it('validates a valid v2 state', () => {
    const dir = makeProject({ version: 2, stateVersion: 2, session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' }, epics: {}, gates: {}, gateEvidence: [] });
    try {
      const res = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0);
      assert.equal(JSON.parse(res.stdout).valid, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects an invalid state with a nonzero exit', () => {
    const dir = makeProject({ version: 1, session: { workflowPath: 'huge', currentPhase: 'bogus', trackingMode: 'x' }, epics: 'no' });
    try {
      const res = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('migrates a v1 state and writes a backup', () => {
    const dir = makeProject(v1State());
    try {
      const res = runCli(['state', 'migrate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0);
      assert.equal(JSON.parse(res.stdout).migrated, true);
      const after = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      // v1 migrates to the current version (contract C6). Bumped to 4 by
      // contract v5; the migration also installs the coverage index.
      assert.equal(after.version, 4);
      assert.equal(existsSync(join(dir, '.cadet', 'state.json.v1.bak')), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects an illegal transition and lists missing gates', () => {
    const dir = makeProject({
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
      epics: {}, gates: { testsPassed: true }, gateEvidence: [], changeHistory: [],
    });
    try {
      const res = runCli(['state', 'transition', '--to', 'review', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      const out = JSON.parse(res.stdout);
      assert.equal(out.allowed, false);
      assert.ok(out.missingGates.length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects a hand-edited true gate without evidence', () => {
    const dir = makeProject({
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
      epics: {},
      gates: { testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true },
      gateEvidence: [], changeHistory: [],
    });
    try {
      const res = runCli(['state', 'transition', '--to', 'review', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      const out = JSON.parse(res.stdout);
      assert.ok(out.staleEvidence.some((s) => /no evidence/.test(s.reason)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('cli — harness', () => {
  it('reports capabilities without throwing', () => {
    const res = runCli(['harness', 'capabilities', '--format', 'json']);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.capabilities.cli, true);
  });

  it('rejects verify for a gate with no automated command', () => {
    const dir = makeProject(v1State());
    try {
      const res = runCli(['harness', 'verify', '--gate', 'unityAnalyzerClean', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).blocked, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('runs a bounded verification loop with an explicit command and persists a ledger', () => {
    const dir = makeProject(v1State());
    try {
      // Migrate to v2 so the ledger can read a work item.
      runCli(['state', 'migrate', '--target', dir]);
      const res = runRedThenGreen(dir, 'testsPassed', 'node -e "process.exit(0)"');
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, true);
      assert.equal(existsSync(join(dir, '.cadet', 'runs', `${out.runId}.json`)), true);

      const report = runCli(['harness', 'report', '--target', dir, '--format', 'json']);
      assert.equal(report.status, 0);
      assert.equal(JSON.parse(report.stdout).ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails a deterministic verification with a nonzero exit', () => {
    const dir = makeProject(v1State());
    try {
      const res = runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "throw new Error(\'AssertionError: nope\')"', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1);
      assert.equal(JSON.parse(res.stdout).ok, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('closes the loop: verify all gates then transition to review', () => {
    const dir = makeProject({
      version: 2, stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
      gates: {}, gateEvidence: [], changeHistory: [],
    });
    try {
      // testsPassed requires a red record first (red-before-green).
      const tests = runRedThenGreen(dir, 'testsPassed', 'node -e "process.exit(0)"');
      assert.equal(tests.status, 0, `testsPassed: ${tests.stderr}`);
      assert.equal(JSON.parse(tests.stdout).stateUpdated, true);
      for (const gate of ['compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated']) {
        const res = runCli(['harness', 'verify', '--gate', gate, '--command', 'node -e "process.exit(0)"', '--files', 'src/a.mjs', '--target', dir, '--format', 'json']);
        assert.equal(res.status, 0, `${gate}: ${res.stderr}`);
        assert.equal(JSON.parse(res.stdout).stateUpdated, true);
      }
      const transition = runCli(['state', 'transition', '--to', 'review', '--target', dir, '--format', 'json']);
      assert.equal(transition.status, 0, transition.stderr);
      const after = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.equal(after.session.currentPhase, 'review');
      assert.equal(after.gates.testsPassed, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never prints secrets in the report', () => {
    const dir = makeProject(v1State());
    try {
      runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "console.log(\'API_KEY=abcdef123456\')"', '--files', 'src/a.mjs', '--target', dir]);
      const report = runCli(['harness', 'report', '--target', dir]);
      assert.equal(report.stdout.includes('abcdef123456'), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('cleans up successful runs but keeps failed ones', () => {
    const dir = makeProject(v1State());
    try {
      runRedThenGreen(dir, 'testsPassed', 'node -e "process.exit(0)"');
      runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(2)"', '--files', 'src/a.mjs', '--target', dir]);
      // `cleanup` deletes run records irreversibly, so an unattended run must
      // state a bound on what it deletes. `--older-than-ms 0` keeps the original
      // intent (everything is old enough) while satisfying the guard.
      const res = runCli(['harness', 'cleanup', '--older-than-ms', '0', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.ok(out.deleted.length >= 1);
      assert.ok(out.kept.length >= 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to clean up unattended without an explicit bound', () => {
    // The guard that makes `cleanup` safe to hand to an agent that does not know
    // what it does: no bound means no deletion, regardless of what the agent
    // intends.
    const dir = makeProject(v1State());
    try {
      runRedThenGreen(dir, 'testsPassed', 'node -e "process.exit(0)"');
      const before = readdirSync(join(dir, '.cadet', 'runs')).length;
      const res = runCli(['harness', 'cleanup', '--target', dir, '--format', 'json']);
      assert.notEqual(res.status, 0);
      assert.equal(JSON.parse(res.stderr).code, 'unattended-requirement-missing');
      assert.equal(readdirSync(join(dir, '.cadet', 'runs')).length, before, 'nothing may be deleted without a bound');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('records an explicit harness event', () => {
    const dir = makeProject(v1State());
    try {
      const res = runCli(['harness', 'record', '--type', 'tool-call', '--reason', 'manual note', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.equal(existsSync(join(dir, '.cadet', 'runs', `${out.runId}.json`)), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
