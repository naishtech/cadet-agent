/**
 * `--expect-phase` — refuse to record gate evidence into a phase the caller did
 * not intend.
 *
 * `state transition` already signals a rejection with `allowed: false` and exit 1.
 * The failure this guard closes is a caller that does not read that signal: it
 * chains commands with `;` and filters the output, reads the next command's
 * success as the transition's, and records the following gates into the phase it
 * never left. The guard is opt-in, so a caller that omits it is unaffected.
 *
 * The guard covers every command that writes gate evidence: `harness verify`,
 * `harness confirm`, `harness verify-acs`, and `harness verify-reachability`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

/** A minimal project tree whose state.json sits in `phase`. */
function project({ phase = 'implementation' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-expect-phase-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  writeFileSync(join(dir, 'src-a.txt'), 'contents\n', 'utf-8');
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 3,
    stateVersion: 3,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    activeRunId: null,
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: {},
    gateEvidence: [],
    lastTransition: null,
    spikes: {},
    changeHistory: [],
  }, null, 2) + '\n', 'utf-8');
  writeFileSync(join(dir, 'story.md'), [
    '## Acceptance Criteria',
    '### AC-1: grid',
    '- Given a map, When loaded, Then rectangular',
    '- Declared tests: Grid_Foo',
    '',
  ].join('\n'), 'utf-8');
  writeFileSync(join(dir, 'report.txt'), ['TAP version 13', 'ok 1 - Grid_Foo', '1..1'].join('\n'), 'utf-8');
  return dir;
}

function run(dir, args) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--target', dir, '--format', 'json'], { encoding: 'utf-8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* human output */ }
  if (!json) {
    try { json = JSON.parse(r.stderr); } catch { /* human error output */ }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const dirOf = (dir) => ({
  state: readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'),
  runsExists: existsSync(join(dir, '.cadet', 'runs')),
});

describe('--expect-phase refuses a mismatch before any write', () => {
  // One entry per gate-recording command. Each is invoked with a phase that does
  // not match the state, so the guard must fire before the command does any of
  // its own work (running a test, parsing a story, probing reachability).
  const cases = [
    {
      name: 'harness verify',
      args: (dir) => ['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(0)"', '--expect-phase', 'review'],
    },
    {
      name: 'harness confirm',
      args: () => ['harness', 'confirm', '--gate', 'compileCheckConfirmed', '--expect-phase', 'review'],
    },
    {
      name: 'harness verify-acs',
      args: (dir) => ['harness', 'verify-acs', '--story', join(dir, 'story.md'), '--report', join(dir, 'report.txt'), '--expect-phase', 'review'],
    },
    {
      name: 'harness verify-reachability',
      args: (dir) => ['harness', 'verify-reachability', '--story', join(dir, 'story.md'), '--expect-phase', 'review'],
    },
  ];

  for (const c of cases) {
    it(`${c.name} refuses when the current phase is not the expected one`, () => {
      const dir = project({ phase: 'implementation' });
      try {
        const before = dirOf(dir);
        const res = run(dir, c.args(dir));
        assert.equal(res.status, 1, `${c.name} should have refused; stderr: ${res.stderr}`);
        assert.equal(res.json?.code, 'phase-mismatch', `${c.name}: ${JSON.stringify(res.json)}`);
        assert.equal(res.json.expectedPhase, 'review');
        assert.equal(res.json.actualPhase, 'implementation');
        // A refusal that still wrote would be worse than no guard: the point is
        // that no gate is recorded into the unintended phase.
        const after = dirOf(dir);
        assert.equal(after.state, before.state, `${c.name} mutated state.json while refusing`);
        assert.equal(after.runsExists, before.runsExists, `${c.name} wrote a run ledger while refusing`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }

  it('rejects a phase name that is not a known phase', () => {
    const dir = project({ phase: 'implementation' });
    try {
      const res = run(dir, ['harness', 'confirm', '--gate', 'compileCheckConfirmed', '--expect-phase', 'wibble']);
      assert.equal(res.status, 1);
      assert.equal(res.json?.code, 'unknown-phase');
      assert.match(res.json.error, /Valid phases:/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('names the expected and actual phase in the message', () => {
    const dir = project({ phase: 'implementation' });
    try {
      const res = run(dir, ['harness', 'confirm', '--gate', 'compileCheckConfirmed', '--expect-phase', 'closed']);
      assert.match(res.json.error, /closed/);
      assert.match(res.json.error, /implementation/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('--expect-phase allows the command through when the phase matches', () => {
  it('records the confirmation', () => {
    const dir = project({ phase: 'implementation' });
    try {
      const res = run(dir, ['harness', 'confirm', '--gate', 'compileCheckConfirmed', '--files', 'src-a.txt', '--expect-phase', 'implementation']);
      assert.equal(res.status, 0, `stderr: ${JSON.stringify(res.json)}`);
      assert.equal(res.json.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('is inert when omitted: the same command still records', () => {
    const dir = project({ phase: 'implementation' });
    try {
      const res = run(dir, ['harness', 'confirm', '--gate', 'compileCheckConfirmed', '--files', 'src-a.txt']);
      assert.equal(res.status, 0, `stderr: ${JSON.stringify(res.json)}`);
      assert.equal(res.json.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
