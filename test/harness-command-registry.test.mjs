import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { COMMANDS, readOnlyCommands, mutatingCommands, resolveCommand, describeAllCommands, checkUnattendedRequirements } from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, { cwd = repoRoot } = {}) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Every file under `dir`, relative + size, so a rewrite is distinguishable. */
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

function v2State(phase = 'implementation', gates = {}) {
  return {
    version: 2, stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: {}, gates, gateEvidence: [], changeHistory: [],
  };
}

function makeProject(stateDoc) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-reg-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  if (stateDoc !== null) writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(stateDoc, null, 2));
  return dir;
}

/**
 * A representative invocation for each read-only command, with a project that
 * gives it every chance to write. If a command cannot be invoked meaningfully
 * here it must still be listed — the guard is "declared read-only" ⊆ "writes
 * nothing", and an untestable entry would be a hole in the assertion.
 */
const READ_ONLY_INVOCATIONS = {
  'state validate': ['state', 'validate'],
  'harness report': ['harness', 'report'],
  'harness capabilities': ['harness', 'capabilities'],
  'harness matrix-check': ['harness', 'matrix-check'],
};

describe('command registry', () => {
  it('classifies every command as either mutating or read-only', () => {
    for (const [key, c] of Object.entries(COMMANDS)) {
      assert.equal(typeof c.mutates, 'boolean', `${key} must declare mutates`);
      assert.ok(c.summary, `${key} must carry a summary for the agent-facing surface`);
    }
  });

  it('gives every mutating command a non-empty writes list', () => {
    // A mutating command with no declared writes cannot be audited, and hides
    // what the guard is protecting.
    for (const key of mutatingCommands()) {
      assert.ok(Array.isArray(COMMANDS[key].writes) && COMMANDS[key].writes.length > 0, `${key} must declare what it writes`);
    }
  });

  it('resolves nested invocations to their registry entry', () => {
    assert.equal(resolveCommand(['node', 'cli', 'harness', 'record']), 'harness record');
    assert.equal(resolveCommand(['node', 'cli', 'state', 'transition']), 'state transition');
    assert.equal(resolveCommand(['node', 'cli', 'init']), 'init');
    // A bare group or an unknown subcommand resolves to nothing, so the caller
    // reports a usage error rather than guessing a safety posture.
    assert.equal(resolveCommand(['node', 'cli', 'harness']), null);
    assert.equal(resolveCommand(['node', 'cli', 'harness', 'bogus']), null);
    assert.equal(resolveCommand(['node', 'cli', '--help']), null);
  });

  it('requires a content-bearing bound for unattended destructive commands', () => {
    const noBound = checkUnattendedRequirements('harness cleanup', {});
    assert.equal(noBound.ok, false);
    assert.deepEqual(noBound.missing, ['--older-than-ms']);

    const withBound = checkUnattendedRequirements('harness cleanup', { olderThanMs: 1000 });
    assert.equal(withBound.ok, true);

    // Append-only evidence logging must stay frictionless: requiring a flag to
    // record evidence would push agents to skip logging entirely.
    assert.equal(checkUnattendedRequirements('harness record', {}).ok, true);
  });

  it('does not let --dry-run satisfy an unattended requirement', () => {
    // A dry run does not perform the action, so it can never substitute for the
    // bound the real action requires.
    assert.equal(checkUnattendedRequirements('harness cleanup', { dryRun: true }).ok, false);
  });
});

describe('declared read-only commands write nothing', () => {
  for (const key of Object.keys(COMMANDS).filter((k) => !COMMANDS[k].mutates)) {
    it(`${key} performs no filesystem writes`, () => {
      const args = READ_ONLY_INVOCATIONS[key];
      assert.ok(args, `${key} is declared read-only but has no invocation under test — add one`);
      const dir = makeProject(v2State());
      try {
        const before = snapshot(dir);
        runCli([...args, '--target', dir], { cwd: dir });
        // Every documented read-only path, including the ones that error.
        runCli([...args, '--target', dir, '--format', 'json'], { cwd: dir });
        const after = snapshot(dir);
        assert.deepEqual(after, before, `${key} wrote: ${after.filter((f) => !before.includes(f)).join(', ')}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe('global --dry-run', () => {
  const MUTATING_INVOCATIONS = {
    'harness record': ['harness', 'record'],
    'harness cleanup': ['harness', 'cleanup', '--older-than-ms', '0'],
    'state migrate': ['state', 'migrate'],
    'harness confirm': ['harness', 'confirm', '--gate', 'testsPassed'],
    'harness verify': ['harness', 'verify', '--gate', 'testsPassed'],
    'harness verify-acs': ['harness', 'verify-acs'],
  };

  for (const [key, args] of Object.entries(MUTATING_INVOCATIONS)) {
    it(`${key} --dry-run writes nothing and exits 0`, () => {
      const dir = makeProject(v2State('implementation', {
        testsPassed: true, compileCheckConfirmed: true, unityAnalyzerClean: true, storyTrackingUpdated: true,
      }));
      try {
        const before = snapshot(dir);
        const res = runCli([...args, '--dry-run', '--target', dir], { cwd: dir });
        const after = snapshot(dir);
        assert.equal(res.status, 0, `${key} --dry-run exited ${res.status}: ${res.stderr}`);
        assert.deepEqual(after, before, `${key} --dry-run wrote: ${after.filter((f) => !before.includes(f)).join(', ')}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }

  it('reports the dry run in machine-readable form', () => {
    const dir = makeProject(v2State());
    try {
      const res = runCli(['harness', 'record', '--dry-run', '--target', dir, '--format', 'json']);
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, true);
      assert.equal(out.dryRun, true);
      assert.equal(out.applied, false);
      assert.equal(out.command, 'harness record');
      assert.ok(out.writes.length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still applies a mutating command when --dry-run is absent', () => {
    // The guard against "fixing" dry-run by disabling the command.
    const dir = makeProject(v2State());
    try {
      const res = runCli(['harness', 'record', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.ok(existsSync(join(dir, '.cadet', 'runs', `${out.runId}.json`)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves transition --dry-run reporting a real verdict', () => {
    // transition's dry-run is an evaluation, not a no-op: it must still answer
    // whether the transition would be allowed.
    const dir = makeProject(v2State('implementation'));
    try {
      const res = runCli(['state', 'transition', '--to', 'review', '--dry-run', '--target', dir, '--format', 'json']);
      const out = JSON.parse(res.stdout);
      assert.equal(out.dryRun, true);
      assert.equal(out.allowed, false, 'gates are unsatisfied, so the verdict must be false');
      assert.ok(out.missingGates.length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('capabilities exposes the registry', () => {
  it('reports every command with its safety posture', () => {
    const all = describeAllCommands();
    assert.equal(all.length, Object.keys(COMMANDS).length);
    for (const entry of all) {
      assert.equal(typeof entry.mutates, 'boolean');
      assert.ok(Array.isArray(entry.writes));
      if (entry.mutates) assert.ok(entry.writes.length > 0);
      else assert.deepEqual(entry.writes, [], 'a read-only command must not claim writes');
    }
  });
});

describe('a failed migrate leaves the tree exactly as it found it', () => {
  // `state migrate` declares `atomicFailure` in the registry. That declaration
  // is only meaningful if something asserts it: the backup used to be copied
  // BEFORE the migrated document was validated, so a rejected migration still
  // wrote a `.v1.bak` the caller never got — and would have overwritten a
  // previous good backup on a retry.
  const v1NoWorkflowPath = {
    version: 1,
    session: { currentPhase: 'implementation', trackingMode: 'markdown' },
    gates: {},
    changeHistory: [],
  };

  it('writes nothing when the migrated state fails validation', () => {
    const dir = makeProject(v1NoWorkflowPath);
    try {
      const before = snapshot(dir);
      const res = runCli(['state', 'migrate', '--target', dir, '--format', 'json']);
      assert.notEqual(res.status, 0, 'a state that cannot migrate must fail');
      const after = snapshot(dir);
      assert.deepEqual(after, before, `failed migrate wrote: ${after.filter((f) => !before.includes(f)).join(', ')}`);
      assert.ok(!existsSync(join(dir, '.cadet', 'state.json.v1.bak')), 'no backup may survive a failed migration');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not clobber an existing good backup on a failed retry', () => {
    // A pre-existing backup from a real successful migration must be preserved
    // when a later attempt fails — the failure path writes nothing at all.
    const dir = makeProject(v1NoWorkflowPath);
    try {
      const bak = join(dir, '.cadet', 'state.json.v1.bak');
      writeFileSync(bak, 'PRECIOUS PRIOR BACKUP\n');
      const res = runCli(['state', 'migrate', '--target', dir, '--format', 'json']);
      assert.notEqual(res.status, 0);
      assert.equal(readFileSync(bak, 'utf-8'), 'PRECIOUS PRIOR BACKUP\n', 'a failed migrate must not touch an existing backup');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('still writes the backup on a successful migration', () => {
    // Guards against "fixing" the ordering by never writing the backup.
    const dir = makeProject({
      version: 1,
      session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
      epics: {},
      gates: {},
      changeHistory: [],
    });
    try {
      const res = runCli(['state', 'migrate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(JSON.parse(res.stdout).migrated, true);
      assert.ok(existsSync(join(dir, '.cadet', 'state.json.v1.bak')), 'a successful migration must write its backup');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
