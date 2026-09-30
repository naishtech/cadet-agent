/**
 * `state init` — the first state document, as a command.
 *
 * The defect this file closes: `cadet-agent init` installs the framework, and then EVERY entry
 * point refused with "Initialise state before ...", while nothing could initialise it. The only
 * documented route was a hand-written document (`skills/Resume.md`), and that document was
 * `version: 1` with `session.workflowPath: null` — which `state validate` rejects, because
 * `workflowPath` is required and `null` is not one of its values. So a new consumer's FIRST
 * document was unaudited, and following the instruction literally produced an invalid one. Every
 * gate reads that document, which makes it the last place to leave unenforced.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATES, PHASES } from '../src/harness/index.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');
const scratch = process.env.TMPDIR || process.env.BH_AGENT_WORKSPACE || undefined;

const run = (args, cwd = repoRoot) => {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  let json = null;
  for (const text of [r.stdout, r.stderr]) {
    if (!text) continue;
    const start = text.indexOf('{');
    if (start < 0) continue;
    try { json = JSON.parse(text.slice(start)); } catch { /* the other stream */ }
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
};

/** A clean consumer repository: the framework installed, and no state document yet. */
function freshRepo() {
  const dir = mkdtempSync(join(scratch ? `${scratch}/` : '', 'cadet-state-init-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  return dir;
}

const statePath = (dir) => join(dir, '.cadet', 'state.json');
const readStateFile = (dir) => JSON.parse(readFileSync(statePath(dir), 'utf-8'));

describe('state init — the first document', () => {
  let dir;
  beforeEach(() => { dir = freshRepo(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates a document the validator accepts, with every gate declared false', () => {
    const init = run(['state', 'init', '--target', dir]);
    assert.equal(init.status, 0, init.stdout + init.stderr);
    assert.equal(existsSync(statePath(dir)), true);
    const doc = readStateFile(dir);
    assert.equal(doc.version, 4);
    assert.equal(doc.stateVersion, 4);
    assert.deepEqual(Object.keys(doc.gates).sort(), [...GATES].sort(), 'every gate is declared, so no gate reads as unknown');
    assert.deepEqual(Object.values(doc.gates), GATES.map(() => false));
    assert.deepEqual(doc.gateEvidence, []);
    assert.equal(existsSync(join(dir, '.cadet', 'archive')), false, 'nothing is archived: there is nothing to archive');

    const validate = run(['state', 'validate', '--target', dir]);
    assert.equal(validate.status, 0, validate.stdout + validate.stderr);
    assert.match(validate.stdout, /valid/);
  });

  it('declares the values it was given, and the defaults when it was given none', () => {
    run(['state', 'init', '--workflow-path', 'small', '--tracking-mode', 'github', '--learner-tier', 'beginner', '--operating-mode', 'hybrid', '--target', dir]);
    const explicit = readStateFile(dir);
    assert.equal(explicit.session.workflowPath, 'small');
    assert.equal(explicit.session.trackingMode, 'github');
    assert.equal(explicit.session.learnerTier, 'beginner');
    assert.equal(explicit.session.operatingMode, 'hybrid');
    assert.equal(explicit.session.currentPhase, 'context-resolution');

    const second = freshRepo();
    try {
      run(['state', 'init', '--target', second]);
      const defaults = readStateFile(second);
      assert.equal(defaults.session.workflowPath, 'large', 'the full gated workflow is the safe default');
      assert.equal(defaults.session.trackingMode, 'markdown');
      assert.equal(defaults.session.currentPhase, PHASES[0]);
      assert.equal(Object.hasOwn(defaults.session, 'learnerTier'), false, 'an unresolved value is absent, not invented');
    } finally { rmSync(second, { recursive: true, force: true }); }
  });

  it('refuses to overwrite a document that exists, and writes nothing', () => {
    run(['state', 'init', '--target', dir]);
    const before = readFileSync(statePath(dir), 'utf-8');
    const again = run(['state', 'init', '--workflow-path', 'small', '--format', 'json', '--target', dir]);
    assert.notEqual(again.status, 0);
    assert.equal(again.json?.code, 'state-exists');
    assert.match(again.stdout + again.stderr, /never overwrites/);
    assert.equal(readFileSync(statePath(dir), 'utf-8'), before, 'the refusal must leave the document byte-identical');
  });

  it('refuses an unknown value before writing anything', () => {
    const cases = [
      ['--workflow-path', 'huge'],
      ['--tracking-mode', 'xml'],
      ['--phase', 'nonsense'],
      ['--learner-tier', 'expert'],
      ['--operating-mode', 'chaos'],
    ];
    for (const [flag, value] of cases) {
      const d = freshRepo();
      try {
        const r = run(['state', 'init', flag, value, '--format', 'json', '--target', d]);
        assert.notEqual(r.status, 0, `${flag} ${value} must be refused`);
        assert.equal(r.json?.code, 'unknown-value', `${flag} ${value} must name the refusal`);
        assert.equal(existsSync(statePath(d)), false, `${flag} ${value} must not leave a document behind`);
      } finally { rmSync(d, { recursive: true, force: true }); }
    }
  });

  it('is the missing first step: every entry point refuses before it, and works after it', () => {
    // The defect, as a test. Each of these said "Initialise state" and none of them could.
    const before = [
      ['state', 'begin', '--epic', 'DEMO-1', '--story', 's.md'],
      ['state', 'transition', '--to', 'requirements', '--dry-run'],
      ['state', 'seal'],
      ['state', 'compact', '--keep', 'active'],
      ['harness', 'confirm', '--gate', 'testsPassed', '--reason', 'r', '--expires-at', '2030-01-01T00:00:00Z', '--environment', 'a=b', '--scope', 's'],
    ];
    for (const args of before) {
      const r = run([...args, '--target', dir]);
      assert.notEqual(r.status, 0, `${args.join(' ')} must refuse with no state document`);
      assert.match(r.stdout + r.stderr, /(Initialise state|No \.cadet\/state\.json)/, `${args.join(' ')} must name the missing document`);
    }
    assert.equal(existsSync(statePath(dir)), false, 'a refusal must not create the document');

    assert.equal(run(['state', 'init', '--target', dir]).status, 0);
    const begin = run(['state', 'begin', '--epic', 'DEMO-1', '--story', 's.md', '--target', dir]);
    assert.equal(begin.status, 0, begin.stdout + begin.stderr);
    assert.equal(readStateFile(dir).activeWorkItem.epicId, 'DEMO-1');
  });

  it('pins the instruction it replaced: the hand-written document was invalid', () => {
    // The exact document `skills/Resume.md` used to describe. It must stay refused, or the
    // regression can come back through the documentation.
    const doc = {
      version: 1,
      session: { currentPhase: 'context-resolution', trackingMode: 'markdown', workflowPath: null },
      gates: {}, epics: {}, spikes: {}, changeHistory: [],
    };
    writeFileSync(statePath(dir), JSON.stringify(doc, null, 2));
    const validate = run(['state', 'validate', '--target', dir]);
    assert.notEqual(validate.status, 0);
    assert.match(validate.stdout + validate.stderr, /workflowPath/);

    const skill = readFileSync(join(repoRoot, '.cadet/agent/core/skills/Resume.md'), 'utf-8');
    assert.equal(skill.includes('workflowPath: null'), false, 'the skill must not describe the invalid document');
    assert.equal(/version: 1\b/.test(skill), false, 'the skill must not write a v1 document');
    assert.match(skill, /state init/, 'the skill must name the command');
  });

  it('is documented where the agent will look for it', () => {
    const harness = readFileSync(join(repoRoot, '.cadet/agent/core/Harness.md'), 'utf-8');
    assert.match(harness, /cadet-agent state init/);
    const bootstrap = readFileSync(join(repoRoot, '.cadet/agent/core/cadet-agent.md'), 'utf-8');
    assert.match(bootstrap, /state init/);
    assert.equal(bootstrap.includes('Write `state.json`.'), false, 'the hand-write instruction is gone');
  });
});
