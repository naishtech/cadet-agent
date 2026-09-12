import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { writeRepoRoleMarker, readRepoRoleMarker } from '../src/install.mjs';
import { REPO_ROLES, REPO_ROLE_MARKER, detectRepoRole } from '../src/harness/repo-role.mjs';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'cadet-role-marker-'));
}

describe('install — repo-role marker', () => {
  it('writes consumer-project by default, creating .cadet/ if needed', () => {
    const dir = tmpDir();
    try {
      const path = writeRepoRoleMarker(dir);
      assert.equal(path, join(dir, REPO_ROLE_MARKER));
      assert.equal(readFileSync(path, 'utf-8').trim(), REPO_ROLES.CONSUMER);
      // And detection now honours it at high confidence.
      const info = detectRepoRole(dir);
      assert.equal(info.role, REPO_ROLES.CONSUMER);
      assert.equal(info.source, 'marker');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes framework-source when asked', () => {
    const dir = tmpDir();
    try {
      writeRepoRoleMarker(dir, REPO_ROLES.FRAMEWORK);
      assert.equal(readFileSync(join(dir, REPO_ROLE_MARKER), 'utf-8').trim(), REPO_ROLES.FRAMEWORK);
      assert.equal(detectRepoRole(dir).role, REPO_ROLES.FRAMEWORK);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an unknown role value', () => {
    const dir = tmpDir();
    try {
      assert.throws(() => writeRepoRoleMarker(dir, 'not-a-role'), /unknown repo role/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('readRepoRoleMarker returns null when absent and the value when present', () => {
    const dir = tmpDir();
    try {
      assert.equal(readRepoRoleMarker(dir), null);
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      writeFileSync(join(dir, REPO_ROLE_MARKER), 'consumer-project\n');
      assert.equal(readRepoRoleMarker(dir), REPO_ROLES.CONSUMER);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the marker file is never a managed path (sync must not delete or overwrite it)', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.cadet', 'agent', 'core', 'FrameworkManifest.json'), 'utf-8'));
    const managed = manifest.managedPaths.map((p) => p.replace(/\\/g, '/'));
    assert.equal(managed.includes(REPO_ROLE_MARKER), false);
    const preserved = (manifest.preservedPaths || []).map((p) => p.replace(/\\/g, '/'));
    assert.equal(preserved.includes(REPO_ROLE_MARKER), false);
  });
});

// ── Contract invariant C9 (docs/core/HarnessContract.md) ─────────────────────

describe('contract C9 — repository role', () => {
  it('is recorded verbatim in the frozen harness contract', () => {
    const contract = readFileSync(join(import.meta.dirname, '..', 'docs', 'core', 'HarnessContract.md'), 'utf-8');
    assert.ok(/^\|\s*C9\s*\|/m.test(contract), 'HarnessContract.md must define invariant C9');
    assert.ok(contract.includes(REPO_ROLE_MARKER), 'C9 must name .cadet/.repo-role');
  });

  it('detects framework-source from structure alone, with no marker present', () => {
    const dir = tmpDir();
    try {
      mkdirSync(join(dir, '.cadet', 'agent', 'core'), { recursive: true });
      writeFileSync(join(dir, '.cadet', 'agent', 'core', 'FrameworkManifest.json'), '{"frameworkVersion":"0.28.0"}');
      assert.equal(existsSync(join(dir, REPO_ROLE_MARKER)), false, 'precondition: no marker');
      assert.equal(detectRepoRole(dir).role, REPO_ROLES.FRAMEWORK);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the marker survives detection precedence over structural signals', () => {
    // A framework-shaped tree that a consumer has explicitly re-marked.
    const dir = tmpDir();
    try {
      mkdirSync(join(dir, '.cadet', 'agent', 'core'), { recursive: true });
      writeFileSync(join(dir, '.cadet', 'agent', 'core', 'FrameworkManifest.json'), '{"frameworkVersion":"0.28.0"}');
      writeRepoRoleMarker(dir, REPO_ROLES.CONSUMER);
      assert.equal(detectRepoRole(dir).role, REPO_ROLES.CONSUMER);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
