import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';

// ── Import actual functions from install.mjs ────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { findManagedPathsInZip, deleteRemovedManagedPaths, extractZip } = await import(
  `file://${join(__dirname, '..', 'src', 'install.mjs')}`
);
const { runUpgrades } = await import(
  `file://${join(__dirname, '..', 'src', 'upgrades.mjs')}`
);

// ── Helper: build a minimal valid ZIP in memory ─────────────────────────────

const SIG_LFH = 0x04034b50;
const SIG_CD  = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function buildMinimalZip(files) {
  // files: [{ name: string, content: Buffer | string }]
  const parts = [];
  const cdEntries = [];
  let cdOffset = 0;

  for (const { name, content } of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const nameBuf = Buffer.from(name, 'utf-8');

    // Local file header
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(SIG_LFH, 0);          // signature
    lfh.writeUInt16LE(20, 4);                // version needed
    lfh.writeUInt16LE(0, 6);                 // flags
    lfh.writeUInt16LE(0, 8);                 // method (stored)
    lfh.writeUInt16LE(0, 10);                // mod time
    lfh.writeUInt16LE(0, 12);                // mod date
    lfh.writeUInt32LE(0, 14);                // crc32
    lfh.writeUInt32LE(data.length, 18);      // compressed size
    lfh.writeUInt32LE(data.length, 22);      // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);   // filename length
    lfh.writeUInt16LE(0, 28);                // extra field length
    nameBuf.copy(lfh, 30);

    const lfhOffset = cdOffset;
    parts.push(lfh, data);
    cdOffset += lfh.length + data.length;

    // Central directory entry
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(SIG_CD, 0);              // signature
    cd.writeUInt16LE(20, 4);                   // version made by
    cd.writeUInt16LE(20, 6);                   // version needed
    cd.writeUInt16LE(0, 8);                    // flags
    cd.writeUInt16LE(0, 10);                   // method (stored)
    cd.writeUInt16LE(0, 12);                   // mod time
    cd.writeUInt16LE(0, 14);                   // mod date
    cd.writeUInt32LE(0, 16);                   // crc32
    cd.writeUInt32LE(data.length, 20);         // compressed size
    cd.writeUInt32LE(data.length, 24);         // uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28);      // filename length
    cd.writeUInt16LE(0, 30);                   // extra field length
    cd.writeUInt16LE(0, 32);                   // comment length
    cd.writeUInt16LE(0, 34);                   // disk number start
    cd.writeUInt16LE(0, 36);                   // internal attrs
    cd.writeUInt32LE(0, 38);                   // external attrs
    cd.writeUInt32LE(lfhOffset, 42);           // local header offset
    nameBuf.copy(cd, 46);

    cdEntries.push(cd);
  }

  const cdStart = cdOffset;
  for (const cd of cdEntries) {
    parts.push(cd);
    cdOffset += cd.length;
  }
  const cdSize = cdOffset - cdStart;

  // EOCD
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);             // disk number
  eocd.writeUInt16LE(0, 6);             // cd disk
  eocd.writeUInt16LE(files.length, 8);  // cd entries on disk
  eocd.writeUInt16LE(files.length, 10); // cd entries total
  eocd.writeUInt32LE(cdSize, 12);       // cd size
  eocd.writeUInt32LE(cdStart, 16);      // cd offset
  eocd.writeUInt16LE(0, 20);            // comment length

  parts.push(eocd);
  return Buffer.concat(parts);
}

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
