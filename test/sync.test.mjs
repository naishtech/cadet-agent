import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// ── Import actual functions from install.mjs ────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { findManagedPathsInZip, deleteRemovedManagedPaths } = await import(
  `file://${join(__dirname, '..', 'src', 'install.mjs')}`
);

// ── findManagedPathsInZip against real zip ──────────────────────────────────

describe('findManagedPathsInZip', () => {
  let zipBuf;

  before(() => {
    const zipPath = join(__dirname, '..', 'cadet-agent.zip');
    zipBuf = readFileSync(zipPath);
  });

  it('reads managedPaths from real cadet-agent.zip', () => {
    const paths = findManagedPathsInZip(zipBuf);
    assert.ok(Array.isArray(paths), 'should return an array');
    assert.ok(paths.length > 0, 'should have at least one managed path');
    // Core should always be there
    const normalized = paths.map(p => p.replace(/\\/g, '/'));
    assert.ok(normalized.some(p => p === '.cadet/agent/core' || p.startsWith('.cadet/agent/core/')));
    // IDE adapters
    assert.ok(normalized.some(p => p === '.github/agents/cadet.agent.md'));
  });

  it('returns empty array for non-zip buffer', () => {
    assert.deepEqual(findManagedPathsInZip(Buffer.from('not a zip')), []);
  });
});

// ── deleteRemovedManagedPaths with temp dir ─────────────────────────────────

describe('deleteRemovedManagedPaths', () => {
  let tmpDir;

  before(() => {
    tmpDir = join(tmpdir(), `cadet-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes directories that were removed from managedPaths', () => {
    // Create a fake old managed directory
    const orchestratorDir = join(tmpDir, '.cadet', 'orchestrator', 'lib');
    mkdirSync(orchestratorDir, { recursive: true });
    writeFileSync(join(orchestratorDir, 'state.sh'), 'echo old');
    writeFileSync(join(orchestratorDir, 'classify.sh'), 'echo old');

    // Create a directory that is still managed (should survive)
    const coreDir = join(tmpDir, '.cadet', 'agent', 'core');
    mkdirSync(coreDir, { recursive: true });
    writeFileSync(join(coreDir, 'cadet-agent.md'), '# rules');

    const oldManaged = ['.cadet/orchestrator', '.cadet/agent/core'];
    const newManaged = ['.cadet/agent/core'];

    const deleted = deleteRemovedManagedPaths(tmpDir, oldManaged, newManaged);

    assert.ok(deleted.length >= 2, 'should delete at least 2 files from orchestrator');
    // Orchestrator files should be gone
    assert.equal(existsSync(join(tmpDir, '.cadet', 'orchestrator', 'lib', 'state.sh')), false);
    // Core files should survive
    assert.equal(existsSync(join(tmpDir, '.cadet', 'agent', 'core', 'cadet-agent.md')), true);
  });

  it('deletes single-file managed paths that were removed', () => {
    const oldFile = join(tmpDir, '.github', 'agents');
    mkdirSync(oldFile, { recursive: true });
    writeFileSync(join(oldFile, 'old-agent.agent.md'), '# old agent');

    const coreFile = join(tmpDir, '.github', 'agents');
    writeFileSync(join(coreFile, 'cadet.agent.md'), '# cadet agent');

    // old-agent.agent.md was managed but is now removed; cadet.agent.md still managed
    const oldManaged = ['.github/agents/old-agent.agent.md', '.github/agents/cadet.agent.md'];
    const newManaged = ['.github/agents/cadet.agent.md'];

    const deleted = deleteRemovedManagedPaths(tmpDir, oldManaged, newManaged);

    assert.ok(deleted.length >= 1, 'should delete old-agent.agent.md');
    assert.equal(existsSync(join(tmpDir, '.github', 'agents', 'old-agent.agent.md')), false);
    assert.equal(existsSync(join(tmpDir, '.github', 'agents', 'cadet.agent.md')), true);
  });

  it('returns empty when nothing was removed', () => {
    const testDir = join(tmpDir, 'nothing-removed');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'keep.md'), '# keep');

    const deleted = deleteRemovedManagedPaths(
      tmpDir,
      ['nothing-removed'],
      ['nothing-removed']
    );
    assert.deepEqual(deleted, []);
  });
});
