import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, { cwd = repoRoot } = {}) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Recursively list every file under `dir`, relative and sorted, with sizes. */
function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(`${relative(dir, full).replace(/\\/g, '/')}:${statSync(full).size}`);
    }
  };
  walk(dir);
  return out.sort();
}

function v2State(phase = 'implementation', gates = {}) {
  return {
    version: 2,
    stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: {},
    gates,
    gateEvidence: [],
    changeHistory: [],
  };
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

function makeProject(stateDoc) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-help-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  if (stateDoc !== null) writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(stateDoc, null, 2));
  return dir;
}

/**
 * Every mutating surface in the CLI, paired with the state it needs to actually
 * perform a write. Without the state fixture these commands fail fast for
 * unrelated reasons and the test would pass vacuously — the point is to give
 * each one everything it needs to mutate, then assert it does not.
 */
const CASES = [
  { name: 'harness record', args: ['harness', 'record'], state: () => v2State() },
  { name: 'harness cleanup', args: ['harness', 'cleanup'], state: () => v2State() },
  { name: 'harness confirm', args: ['harness', 'confirm', '--gate', 'testsPassed'], state: () => v2State() },
  { name: 'harness verify', args: ['harness', 'verify', '--gate', 'testsPassed'], state: () => v2State() },
  { name: 'harness verify-acs', args: ['harness', 'verify-acs'], state: () => v2State() },
  { name: 'harness report', args: ['harness', 'report'], state: () => v2State() },
  { name: 'harness matrix-check', args: ['harness', 'matrix-check'], state: () => v2State() },
  { name: 'harness capabilities', args: ['harness', 'capabilities'], state: () => v2State() },
  // Gates satisfied, so the ONLY thing standing between this and a real phase
  // change is `--help` being honoured.
  {
    name: 'state transition',
    args: ['state', 'transition', '--to', 'review'],
    state: () => v2State('implementation', {
      testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true,
    }),
  },
  { name: 'state migrate', args: ['state', 'migrate'], state: v1State },
  { name: 'state validate', args: ['state', 'validate'], state: () => v2State() },
];

describe('nested --help is read-only', () => {
  for (const c of CASES) {
    it(`${c.name} --help writes nothing and exits 0`, () => {
      const dir = makeProject(c.state());
      try {
        const before = snapshot(dir);
        const res = runCli([...c.args, '--help', '--target', dir], { cwd: dir });
        const after = snapshot(dir);
        assert.equal(res.status, 0, `${c.name} --help exited ${res.status}; stderr: ${res.stderr}`);
        assert.deepEqual(after, before, `${c.name} --help mutated the filesystem: ${after.filter((f) => !before.includes(f)).join(', ')}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it(`${c.name} -h writes nothing and exits 0`, () => {
      const dir = makeProject(c.state());
      try {
        const before = snapshot(dir);
        const res = runCli([...c.args, '-h', '--target', dir], { cwd: dir });
        const after = snapshot(dir);
        assert.equal(res.status, 0, `${c.name} -h exited ${res.status}; stderr: ${res.stderr}`);
        assert.deepEqual(after, before, `${c.name} -h mutated the filesystem`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe('nested --help prints usage', () => {
  it('prints help to stdout for a nested invocation', () => {
    const res = runCli(['harness', 'record', '--help']);
    assert.equal(res.status, 0);
    assert.ok(/usage/i.test(res.stdout), 'expected usage text on stdout');
    assert.match(res.stdout, /--help/);
  });

  it('prints help for a subcommand that would otherwise error', () => {
    const res = runCli(['harness', 'verify', '--help']);
    assert.equal(res.status, 0);
    assert.ok(/usage/i.test(res.stdout));
  });

  it('leaves the top-level help unchanged', () => {
    const res = runCli(['--help']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Usage:/);
  });
});

describe('--help is never consumed as another flag value', () => {
  // `--target --help` used to set targetDir to a directory literally named
  // "--help"; the help flag must win before any value is bound.
  it('does not treat --help as the target path', () => {
    const res = runCli(['harness', 'record', '--target', '--help']);
    assert.equal(res.status, 0);
    assert.ok(/usage/i.test(res.stdout), 'expected usage text, not a record run');
  });

  it('does not write to a directory named --help', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-help-dash-'));
    try {
      const res = runCli(['harness', 'record', '--target', '--help'], { cwd: dir });
      assert.equal(res.status, 0);
      assert.deepEqual(readdirSync(dir), [], 'created files in cwd while handling --help');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('a flag never silently consumes the next flag as its value', () => {
  // `--target --format` used to bind the literal string "--format" as the target
  // directory and then write a ledger into a directory named `--format/` — a
  // stray write in an arbitrary place, reported as success. A missing option
  // value must be a loud usage error.
  const FLAGS = ['--target', '--format', '--gate', '--to', '--reason', '--type', '--run', '--phase', '--expect-phase'];

  for (const flag of FLAGS) {
    it(`${flag} with no value is rejected`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'cadet-swallow-'));
      try {
        const res = runCli(['harness', 'record', flag, '--target', dir], { cwd: dir });
        assert.notEqual(res.status, 0, `${flag} with no value must fail`);
        assert.deepEqual(readdirSync(dir), [], `${flag} wrote into the cwd`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }

  it('rejects a flag whose value is another flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-swallow2-'));
    try {
      const res = runCli(['harness', 'record', '--target', '--format', 'json'], { cwd: dir });
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /requires a value/i);
      assert.deepEqual(readdirSync(dir), []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still accepts a genuine value that starts with a dash-digit', () => {
    // `--older-than-ms -1` is a plausible value and must not be mistaken for a flag.
    const dir = makeProject(v2State());
    try {
      const res = runCli(['harness', 'cleanup', '--older-than-ms', '-1', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still reports the specific empty-files error for an empty value', () => {
    // The generic guard must not mask the deliberate empty-`--files` rejection.
    const dir = makeProject(v2State());
    try {
      const res = runCli(['harness', 'verify', '--gate', 'testsPassed', '--files', '', '--target', dir, '--format', 'json']);
      assert.equal(JSON.parse(res.stderr).code, 'empty-files');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('normal invocations still mutate', () => {
  // Guards against "fixing" the help bug by disabling the commands themselves.
  it('harness record without --help still records', () => {
    const dir = makeProject(v2State());
    try {
      const res = runCli(['harness', 'record', '--target', dir, '--format', 'json'], { cwd: dir });
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.ok(readFileSync(join(dir, '.cadet', 'runs', `${out.runId}.json`), 'utf-8'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('state migrate without --help still migrates', () => {
    const dir = makeProject(v1State());
    try {
      const res = runCli(['state', 'migrate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0);
      assert.equal(JSON.parse(res.stdout).migrated, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
