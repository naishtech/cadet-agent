import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';

// ── Import actual functions from install.mjs ────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { findManagedPathsInZip, deleteRemovedManagedPaths, extractZip, extractZipWithManifest } = await import(
  `file://${join(__dirname, '..', 'src', 'install.mjs')}`
);
const { runUpgrades } = await import(
  `file://${join(__dirname, '..', 'src', 'upgrades.mjs')}`
);
import { buildMinimalZip } from './helpers/zip.mjs';

// ── Helper: build a minimal valid ZIP in memory (shared, test/helpers/zip.mjs) ──

// ── findManagedPathsInZip tests ─────────────────────────────────────────────

describe('findManagedPathsInZip', () => {

  it('reads managedPaths from synthetic zip with manifest', () => {
    const manifest = JSON.stringify({
      frameworkName: 'Test',
      frameworkVersion: '1.0.0',
      managedPaths: ['.cadet/agent/core', '.github/agents/cadet.agent.md'],
    });
    const zip = buildMinimalZip([
      { name: '.cadet/agent/core/FrameworkManifest.json', content: manifest },
      { name: '.cadet/agent/core/cadet-agent.md', content: '# test' },
    ]);
    const paths = findManagedPathsInZip(zip);
    assert.deepEqual(paths, ['.cadet/agent/core', '.github/agents/cadet.agent.md']);
  });

  it('returns empty array when manifest not in zip', () => {
    const zip = buildMinimalZip([
      { name: 'readme.txt', content: 'hello' },
    ]);
    assert.deepEqual(findManagedPathsInZip(zip), []);
  });

  it('returns empty array for non-zip buffer', () => {
    assert.deepEqual(findManagedPathsInZip(Buffer.from('not a zip')), []);
  });

  // Only runs locally where cadet-agent.zip exists (gitignored, not in CI)
  const zipPath = join(__dirname, '..', 'cadet-agent.zip');
  if (existsSync(zipPath)) {
    it('reads managedPaths from real cadet-agent.zip', () => {
      const zipBuf = readFileSync(zipPath);
      const paths = findManagedPathsInZip(zipBuf);
      assert.ok(paths.length > 0, 'should have at least one managed path');
      const normalized = paths.map(p => p.replace(/\\/g, '/'));
      assert.ok(normalized.some(p => p === '.cadet/agent/core' || p.startsWith('.cadet/agent/core/')));
    });
  }
});

// ── Windows-style zip extraction (backslash separators) ────────────────────

describe('extractZip handles Windows-style paths', () => {
  let tmpDir;

  before(() => {
    tmpDir = join(tmpdir(), `cadet-extract-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips backslash directory entries and extracts nested files', async () => {
    const zip = buildMinimalZip([
      { name: '.cadet\\agent\\', content: Buffer.alloc(0) },
      { name: '.claude\\skills\\', content: Buffer.alloc(0) },
      { name: '.cadet\\agent\\core\\skills\\Requirements.md', content: '# req' },
      { name: '.cadet\\agent\\core\\templates\\StoryTemplate.md', content: '# story' },
      { name: '.github\\prompts\\cadet-requirements.prompt.md', content: '---' },
    ]);

    const extracted = await extractZip(zip, tmpDir);

    assert.equal(extracted.length, 3, 'directory entries must be skipped');

    const skills = join(tmpDir, '.cadet', 'agent', 'core', 'skills', 'Requirements.md');
    const templates = join(tmpDir, '.cadet', 'agent', 'core', 'templates', 'StoryTemplate.md');
    const prompt = join(tmpDir, '.github', 'prompts', 'cadet-requirements.prompt.md');

    assert.equal(readFileSync(skills, 'utf-8'), '# req');
    assert.equal(readFileSync(templates, 'utf-8'), '# story');
    assert.equal(readFileSync(prompt, 'utf-8'), '---');

    // .cadet/agent must be a directory, not a file
    assert.equal(statSync(join(tmpDir, '.cadet', 'agent')).isDirectory(), true);
  });
});

// ── Sync extraction preserves nested managed files ──────────────────────────

describe('extractZipWithManifest preserves nested managed files', () => {
  let tmpDir;

  before(() => {
    tmpDir = join(tmpdir(), `cadet-sync-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps nested files under a managed directory and removes stale files', async () => {
    const manifest = JSON.stringify({
      frameworkVersion: '0.20.0',
      managedPaths: ['.cadet/agent/core'],
      preservedPaths: [],
    });
    const zip = buildMinimalZip([
      { name: '.cadet/agent/core/FrameworkManifest.json', content: manifest },
      { name: '.cadet/agent/core/skills/Architecture.md', content: '# arch' },
      { name: '.cadet/agent/core/templates/StoryTemplate.md', content: '# story' },
    ]);

    // Pre-existing install with a stale file that should be removed
    mkdirSync(join(tmpDir, '.cadet', 'agent', 'core'), { recursive: true });
    writeFileSync(join(tmpDir, '.cadet', 'agent', 'core', 'stale.md'), 'stale');

    await extractZipWithManifest(zip, tmpDir, {
      preserved: [],
      managed: ['.cadet/agent/core'],
    });

    assert.equal(existsSync(join(tmpDir, '.cadet', 'agent', 'core', 'skills', 'Architecture.md')), true);
    assert.equal(existsSync(join(tmpDir, '.cadet', 'agent', 'core', 'templates', 'StoryTemplate.md')), true);
    assert.equal(existsSync(join(tmpDir, '.cadet', 'agent', 'core', 'stale.md')), false, 'stale file must be removed');
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

// ── runUpgrades: version comparison logic ──────────────────────────────────

// semverGt is internal; test the runner mechanics indirectly
describe('runUpgrades', () => {
  it('returns empty when registry is empty', () => {
    // No upgrades registered currently — should return empty
    const deleted = runUpgrades('/tmp', '0.13.0', '0.15.4');
    assert.deepEqual(deleted, []);
  });

  it('handles invalid version strings gracefully', () => {
    const deleted = runUpgrades('/tmp', 'unknown', '0.15.4');
    assert.deepEqual(deleted, []);
  });

  it('handles same from/to version', () => {
    const deleted = runUpgrades('/tmp', '0.15.0', '0.15.0');
    assert.deepEqual(deleted, []);
  });
});

// ── Harness preservation across sync (contract invariant C8) ────────────────

/** A package whose installable policy content is the REAL seed the repo ships. */
function seedZip() {
  const manifest = JSON.stringify({
    frameworkVersion: '0.56.0',
    managedPaths: ['.cadet/agent/core', '.cadet/harness.json'],
    preservedPaths: ['.cadet/state.json'],
    createOnlyPaths: ['.cadet/harness.json'],
  });
  return buildMinimalZip([
    { name: '.cadet/agent/core/FrameworkManifest.json', content: manifest },
    { name: '.cadet/harness.json', content: readFileSync(join(__dirname, '..', '.cadet', 'harness.json')) },
  ]);
}


describe('sync preserves harness policy and run ledgers', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), `cadet-sync-harness-${Date.now()}`));
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps .cadet/harness.json and .cadet/runs untouched', async () => {
    // Local harness policy and a run ledger the user owns.
    mkdirSync(join(tmpDir, '.cadet', 'runs'), { recursive: true });
    writeFileSync(join(tmpDir, '.cadet', 'harness.json'), '{"budgets":{"maxToolCalls":42}}');
    writeFileSync(join(tmpDir, '.cadet', 'runs', 'run-1.json'), '{"runId":"run-1"}');

    // A managed core update plus a stray file that should be replaced.
    const manifest = JSON.stringify({
      frameworkVersion: '0.23.0',
      managedPaths: ['.cadet/agent/core'],
      preservedPaths: ['.cadet/agent/policies', '.cadet/agent/project-plans', '.cadet/state.json', '.cadet/harness.json', '.cadet/runs'],
    });
    const zip = buildMinimalZip([
      { name: '.cadet/agent/core/FrameworkManifest.json', content: manifest },
      { name: '.cadet/agent/core/Harness.md', content: '# harness v2' },
    ]);

    await extractZipWithManifest(zip, tmpDir, {
      preserved: ['.cadet/agent/policies', '.cadet/agent/project-plans', '.cadet/state.json', '.cadet/harness.json', '.cadet/runs'],
      managed: ['.cadet/agent/core'],
    });

    // The managed file is updated...
    assert.equal(existsSync(join(tmpDir, '.cadet', 'agent', 'core', 'Harness.md')), true);
    // ...and local policy/ledgers survive unchanged.
    assert.equal(readFileSync(join(tmpDir, '.cadet', 'harness.json'), 'utf-8'), '{"budgets":{"maxToolCalls":42}}');
    assert.equal(readFileSync(join(tmpDir, '.cadet', 'runs', 'run-1.json'), 'utf-8'), '{"runId":"run-1"}');
  });

  it('creates the seeded policy file for a consumer that has none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-seed-absent-'));
    try {
      const zip = seedZip();
      const result = await extractZipWithManifest(zip, dir, {
        preserved: ['.cadet/state.json'],
        managed: ['.cadet/agent/core', '.cadet/harness.json'],
        createOnly: ['.cadet/harness.json'],
      });
      assert.equal(existsSync(join(dir, '.cadet', 'harness.json')), true,
        'a fresh consumer must receive the declared starting policy');
      assert.equal(result.kept.includes('.cadet/harness.json'), false);
      // The file that lands is the seed the repo ships, byte-for-byte, and it is a
      // policy that turns strict closure on — the property the seed exists for.
      assert.equal(
        readFileSync(join(dir, '.cadet', 'harness.json'), 'utf-8'),
        readFileSync(join(__dirname, '..', '.cadet', 'harness.json'), 'utf-8'),
      );
      assert.equal(JSON.parse(readFileSync(join(dir, '.cadet', 'harness.json'), 'utf-8')).strictClosure.enabled, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never overwrites a policy file the consumer already owns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-seed-present-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      // No trailing newline, and a CRLF inside: a rewrite that normalised the file
      // would still "look right" while changing the consumer's bytes.
      const own = '{\r\n  "strictClosure": { "enabled": true, "manualConfirmation": { "requireExpiresAt": false, "maxValidityMs": 604800000 } }\r\n}';
      writeFileSync(join(dir, '.cadet', 'harness.json'), own);
      const result = await extractZipWithManifest(seedZip(), dir, {
        preserved: ['.cadet/state.json'],
        managed: ['.cadet/agent/core', '.cadet/harness.json'],
        createOnly: ['.cadet/harness.json'],
      });
      assert.equal(readFileSync(join(dir, '.cadet', 'harness.json'), 'utf-8'), own);
      assert.ok(result.kept.includes('.cadet/harness.json'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the real manifest ships the seed and keeps every consumer path intact', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', '.cadet', 'agent', 'core', 'FrameworkManifest.json'), 'utf-8'));
    const norm = (list) => (list || []).map((p) => p.replace(/\\/g, '/'));
    const preserved = norm(manifest.preservedPaths);
    const managed = norm(manifest.managedPaths);
    const createOnly = norm(manifest.createOnlyPaths);

    // The policy file is a create-only SEED, not a preserved path: preserved
    // paths are skipped at extraction, so a preserved policy file would never be
    // created for a new consumer. Create-only is what makes "a new consumer
    // starts from a declared policy" and "an existing policy is never
    // overwritten" the same mechanism.
    assert.ok(createOnly.includes('.cadet/harness.json'));
    assert.ok(managed.includes('.cadet/harness.json'), 'a create-only path must also be managed, or the package lacks it');
    assert.equal(preserved.includes('.cadet/harness.json'), false);

    for (const p of ['.cadet/agent/policies', '.cadet/agent/project-plans', '.cadet/state.json', '.cadet/runs']) {
      assert.ok(preserved.includes(p), `${p} must be preserved`);
    }
  });
});
