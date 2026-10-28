import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { writeInstallRecord, installRecordPath } from '../src/install.mjs';
import {
  uninstall, classifyRecord, generatedDirs, leftovers, PROTECTED_PREFIXES,
} from '../src/uninstall.mjs';

let work;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'cadet-uninstall-')); });
afterEach(() => { rmSync(work, { recursive: true, force: true }); });

const sha = (body) => createHash('sha256').update(body).digest('hex');

/** Write a file and return its record entry. */
function installed(rel, body = 'x') {
  const full = join(work, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return { path: rel, sha256: sha(body), component: 'core' };
}

function makeRecord(files, { components = ['core'], dirs = [] } = {}) {
  return {
    schemaVersion: 1,
    suiteVersion: '0.70.0',
    installedAt: '2026-10-28T00:00:00Z',
    components,
    engine: { primary: null, secondary: null },
    targets: {},
    dirs,
    files,
  };
}

// ── Classification ──────────────────────────────────────────────────────────

describe('classifyRecord', () => {
  it('removes a file whose hash still matches', () => {
    const entry = installed('.cadet/agent/core/cadet-agent.md', 'agent');
    const result = classifyRecord(makeRecord([entry]), { targetDir: work });
    assert.deepEqual(result.remove, ['.cadet/agent/core/cadet-agent.md']);
    assert.deepEqual(result.keepModified, []);
  });

  it('keeps a file the consumer edited', () => {
    const entry = installed('.claude/skills/cadet-agent/SKILL.md', 'mine');
    writeFileSync(join(work, '.claude/skills/cadet-agent/SKILL.md'), 'edited');
    const result = classifyRecord(makeRecord([entry]), { targetDir: work });
    assert.deepEqual(result.remove, []);
    assert.deepEqual(result.keepModified, ['.claude/skills/cadet-agent/SKILL.md']);
  });

  it('removes an edited file when forced', () => {
    const entry = installed('.claude/skills/cadet-agent/SKILL.md', 'mine');
    writeFileSync(join(work, '.claude/skills/cadet-agent/SKILL.md'), 'edited');
    const result = classifyRecord(makeRecord([entry]), { targetDir: work, force: true });
    assert.equal(result.remove.length, 1);
  });

  it('reports a file that is already gone', () => {
    const entry = { path: '.cadet/agent/core/gone.md', sha256: sha('x'), component: 'core' };
    const result = classifyRecord(makeRecord([entry]), { targetDir: work });
    assert.deepEqual(result.absent, ['.cadet/agent/core/gone.md']);
    assert.deepEqual(result.remove, []);
  });

  it('refuses a protected path even when the hash matches', () => {
    assert.ok(PROTECTED_PREFIXES.includes('.cadet/state.json'));
    const entry = installed('.cadet/state.json', '{"phase":"review"}');
    const result = classifyRecord(makeRecord([entry]), { targetDir: work });
    assert.deepEqual(result.remove, []);
    assert.deepEqual(result.keepProtected, ['.cadet/state.json']);
  });

  it('refuses a file inside a protected folder', () => {
    const entry = installed('.cadet/agent/policies/mine.md', 'policy');
    const result = classifyRecord(makeRecord([entry]), { targetDir: work });
    assert.deepEqual(result.keepProtected, ['.cadet/agent/policies/mine.md']);
  });

  it('removes the git hook, which the framework installed and sync refreshes', () => {
    const entry = installed('.githooks/pre-commit', '#!/bin/bash');
    const result = classifyRecord(makeRecord([entry]), { targetDir: work });
    assert.deepEqual(result.remove, ['.githooks/pre-commit']);
  });
});

describe('generated directories', () => {
  it('are only reported for the Unreal plugin', () => {
    mkdirSync(join(work, 'Plugins/CadetBuild/Binaries'), { recursive: true });
    assert.deepEqual(generatedDirs(makeRecord([], { components: ['core'] }), { targetDir: work }), []);
    assert.deepEqual(
      generatedDirs(makeRecord([], { components: ['engine.unreal.plugin'] }), { targetDir: work }),
      ['Plugins/CadetBuild/Binaries'],
    );
  });
});

// ── The command ─────────────────────────────────────────────────────────────

describe('uninstall', () => {
  it('says so and deletes nothing when there is no record', async () => {
    const a = installed('.cadet/agent/core/cadet-agent.md');
    const result = await uninstall(work, {});
    assert.equal(result.reason, 'no-record');
    assert.ok(existsSync(join(work, '.cadet/agent/core/cadet-agent.md')));
    assert.ok(a);
  });

  it('removes recorded files, keeps edited ones, and deletes the record last', async () => {
    const mine = installed('.cadet/agent/core/cadet-agent.md', 'agent');
    const edited = installed('.claude/skills/cadet-agent/SKILL.md', 'original');
    writeFileSync(join(work, '.claude/skills/cadet-agent/SKILL.md'), 'edited by me');
    writeInstallRecord(work, makeRecord([mine, edited], { dirs: ['.cadet/agent/core'] }));

    const result = await uninstall(work, {});
    assert.equal(result.removed, 1);
    assert.deepEqual(result.keptModified, ['.claude/skills/cadet-agent/SKILL.md']);
    assert.equal(existsSync(join(work, '.cadet/agent/core/cadet-agent.md')), false);
    assert.equal(existsSync(join(work, '.claude/skills/cadet-agent/SKILL.md')), true);
    assert.equal(existsSync(installRecordPath(work)), false);
  });

  it('is idempotent: a second run finds no record and exits clean', async () => {
    const entry = installed('.cadet/agent/core/cadet-agent.md');
    writeInstallRecord(work, makeRecord([entry]));
    await uninstall(work, {});
    const second = await uninstall(work, {});
    assert.equal(second.ok, true);
    assert.equal(second.reason, 'no-record');
  });

  it('deletes nothing on a dry run', async () => {
    const entry = installed('.cadet/agent/core/cadet-agent.md');
    writeInstallRecord(work, makeRecord([entry], { dirs: ['.cadet/agent/core'] }));
    const result = await uninstall(work, { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.removed, 1);
    assert.ok(existsSync(join(work, '.cadet/agent/core/cadet-agent.md')));
    assert.ok(existsSync(installRecordPath(work)));
  });

  it('keeps the user data that lives beside the framework', async () => {
    const entry = installed('.cadet/agent/core/cadet-agent.md');
    installed('.cadet/agent/policies/Mine.md', 'my rule');
    installed('.cadet/state.json', '{"currentPhase":"review"}');
    writeInstallRecord(work, makeRecord([entry], { dirs: ['.cadet/agent/core'] }));

    await uninstall(work, {});
    assert.equal(existsSync(join(work, '.cadet/agent/core/cadet-agent.md')), false);
    assert.ok(existsSync(join(work, '.cadet/agent/policies/Mine.md')));
    assert.ok(existsSync(join(work, '.cadet/state.json')));
    assert.ok(existsSync(join(work, '.cadet')));
  });

  it('removes an empty .cadet when the install was all there was', async () => {
    const entry = installed('.cadet/agent/core/cadet-agent.md');
    writeInstallRecord(work, makeRecord([entry], { dirs: ['.cadet/agent/core'] }));
    await uninstall(work, {});
    assert.equal(existsSync(join(work, '.cadet')), false);
  });

  it('reports downloaded tools it leaves alone', async () => {
    const entry = installed('Assets/Covyne/Cadet/CLI/dist.sh', '#!/bin/bash');
    mkdirSync(join(work, 'Assets/Covyne/Cadet/CLI'), { recursive: true });
    writeFileSync(join(work, 'Assets/Covyne/Cadet/CLI/cosmos-bash'), 'binary');
    writeInstallRecord(work, makeRecord([entry], { components: ['engine.unity.plugin', 'engine.unity.cli'] }));

    const result = await uninstall(work, {});
    assert.equal(existsSync(join(work, 'Assets/Covyne/Cadet/CLI/dist.sh')), false);
    assert.ok(existsSync(join(work, 'Assets/Covyne/Cadet/CLI/cosmos-bash')));
    assert.ok(result.leftovers.some((l) => l.path === 'Assets/Covyne/Cadet/CLI'));
  });
});
