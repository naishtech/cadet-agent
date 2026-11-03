import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { installDrift } from '../src/harness/install-drift.mjs';
import { computeStatus } from '../src/harness/status.mjs';

let work;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'cadet-drift-')); });
afterEach(() => { rmSync(work, { recursive: true, force: true }); });

const sha = (body) => createHash('sha256').update(body).digest('hex');

function file(rel, body) {
  const full = join(work, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  return { path: rel, sha256: sha(body), component: 'core' };
}

function writeRecord(files, components = ['core']) {
  const path = join(work, '.cadet', 'agent', 'install.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    suiteVersion: '0.63.1',
    installedAt: '2026-10-28T00:00:00Z',
    components,
    engine: { primary: null, secondary: null },
    targets: {},
    dirs: [],
    files,
  }, null, 2));
}

describe('installDrift', () => {
  it('reports no install when there is no record', () => {
    const drift = installDrift(work);
    assert.equal(drift.installed, false);
    assert.deepEqual(drift.cli, { recorded: false, total: 0, modified: 0, missing: 0 });
  });

  it('counts a recorded file that is gone', () => {
    const present = file('.cadet/agent/core/cadet-agent.md', 'x');
    writeRecord([present, { path: '.cadet/agent/core/gone.md', sha256: sha('y'), component: 'core' }]);
    const drift = installDrift(work);
    assert.equal(drift.installed, true);
    assert.equal(drift.files.total, 2);
    assert.equal(drift.files.missing, 1);
  });

  it('separates a modified CLI file from a missing one', () => {
    const clean = file('Assets/Covyne/Cadet/CLI/dist.sh', '#!/bin/bash');
    const edited = file('Assets/Covyne/Cadet/CLI/build.sh', 'original');
    writeFileSync(join(work, 'Assets/Covyne/Cadet/CLI/build.sh'), 'patched');
    const missing = { path: 'Assets/Covyne/Cadet/CLI/Util/logging.sh', sha256: sha('z'), component: 'engine.unity.cli' };

    writeRecord([
      { ...clean, component: 'engine.unity.cli' },
      { ...edited, component: 'engine.unity.cli' },
      missing,
    ], ['core', 'engine.unity.cli']);

    const drift = installDrift(work);
    assert.equal(drift.cli.recorded, true);
    assert.equal(drift.cli.total, 3);
    assert.equal(drift.cli.modified, 1);
    assert.equal(drift.cli.missing, 1);
  });
});

describe('status and the CLI', () => {
  it('says the CLI is missing, because every build needs those scripts', () => {
    const present = file('Assets/Covyne/Cadet/CLI/dist.sh', '#!/bin/bash');
    writeRecord([
      { ...present, component: 'engine.unity.cli' },
      { path: 'Assets/Covyne/Cadet/CLI/build.sh', sha256: sha('gone'), component: 'engine.unity.cli' },
    ], ['core', 'engine.unity.cli']);

    const status = computeStatus(work);
    const cli = status.problems.find((p) => p.code === 'cli-missing');
    assert.ok(cli, `expected cli-missing in ${status.problems.map((p) => p.code).join(', ')}`);
    // The line reports the first problem; in this fixture that is the missing
    // workflow state, so the CLI message is asserted where it lives.
    assert.match(cli.message, /missing 1 of 2 files/);
    assert.equal(cli.remedy, 'npx cadet-agent@latest sync');
    assert.equal(status.ok, false);
  });

  it('does not complain about a CLI file the user patched', () => {
    const present = file('Assets/Covyne/Cadet/CLI/dist.sh', '#!/bin/bash');
    writeFileSync(join(work, 'Assets/Covyne/Cadet/CLI/dist.sh'), '#!/bin/bash # patched');
    writeRecord([{ ...present, component: 'engine.unity.cli' }], ['core', 'engine.unity.cli']);

    const status = computeStatus(work);
    assert.equal(status.problems.some((p) => p.code === 'cli-missing'), false);
    assert.equal(status.install.cli.modified, 1);
  });
});
