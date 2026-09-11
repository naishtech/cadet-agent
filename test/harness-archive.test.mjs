import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import {
  extractArchive, readEntries, readArchiveEntry, assertContained, crc32,
  ArchiveError, DEFAULT_ARCHIVE_LIMITS, findEocd,
} from '../src/harness/archive.mjs';
import { extractZip, extractZipWithManifest, findManagedPathsInZip } from '../src/install.mjs';

const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Build a ZIP with optional per-entry overrides for adversarial testing. */
function buildZip(files, { crcOverride = null } = {}) {
  const parts = [];
  const cdEntries = [];
  let cdOffset = 0;

  for (const file of files) {
    const name = file.name;
    const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content ?? '', 'utf-8');
    const method = file.method ?? 0;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf-8');
    const compressedSize = file.compressedSize ?? data.length;
    const uncompressedSize = file.uncompressedSize ?? raw.length;
    const crc = crcOverride !== null ? crcOverride : crc32(raw);

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(SIG_LFH, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressedSize, 18);
    lfh.writeUInt32LE(uncompressedSize, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    const lfhOffset = cdOffset;
    parts.push(lfh, data);
    cdOffset += lfh.length + data.length;

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(SIG_CD, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressedSize, 20);
    cd.writeUInt32LE(uncompressedSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(lfhOffset, 42);
    nameBuf.copy(cd, 46);
    cdEntries.push(cd);
  }

  const cdStart = cdOffset;
  for (const cd of cdEntries) { parts.push(cd); cdOffset += cd.length; }
  const cdSize = cdOffset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  parts.push(eocd);
  return Buffer.concat(parts);
}

describe('archive — containment', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'cadet-arc-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts a normal nested path', () => {
    const out = assertContained(dir, '.cadet/agent/core/file.md');
    assert.ok(out.startsWith(resolve(dir)));
  });

  it('rejects absolute paths', () => {
    assert.throws(() => assertContained(dir, '/etc/passwd'), /absolute path/);
    assert.throws(() => assertContained(dir, 'C:/Windows/system32'), /absolute path/);
  });

  it('rejects traversal that escapes the target', () => {
    assert.throws(() => assertContained(dir, '../../evil.sh'), /escapes the target/);
    assert.throws(() => assertContained(dir, 'a/../../evil.sh'), /escapes the target/);
  });

  it('rejects traversal after normalization even when it starts inside', () => {
    assert.throws(() => assertContained(dir, 'a/b/../../../evil.sh'), /escapes the target/);
  });

  it('does not write any file outside the target directory', () => {
    const outside = join(dir, '..', 'cadet-escape-probe.txt');
    const zip = buildZip([{ name: '../../cadet-escape-probe.txt', content: 'pwned' }]);
    assert.throws(() => extractArchive(zip, join(dir, 'sub'), { limits: DEFAULT_ARCHIVE_LIMITS }), ArchiveError);
    assert.equal(existsSync(outside), false);
  });

  it('rejects an absolute-path entry without writing it', () => {
    const zip = buildZip([{ name: '/tmp/cadet-abs-probe.txt', content: 'pwned' }]);
    assert.throws(() => extractArchive(zip, dir, { limits: DEFAULT_ARCHIVE_LIMITS }), /absolute path/);
  });
});

describe('archive — resource limits', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'cadet-arc-lim-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('rejects too many files', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, content: 'x' }));
    const zip = buildZip(files);
    assert.throws(
      () => extractArchive(zip, dir, { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxFiles: 3 } }),
      /over the limit of 3|more than 3 files/
    );
  });

  it('rejects an oversized filename', () => {
    const zip = buildZip([{ name: `${'a'.repeat(300)}.txt`, content: 'x' }]);
    assert.throws(() => extractArchive(zip, dir, { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxFilenameBytes: 240 } }), /filename exceeds/);
  });

  it('rejects a decompressed total over the limit', () => {
    const zip = buildZip([{ name: 'big.txt', content: 'x'.repeat(2048) }]);
    assert.throws(
      () => extractArchive(zip, dir, { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxDecompressedBytes: 1024 } }),
      /decompressed size exceeds/
    );
  });

  it('rejects excessive compression ratio', () => {
    const zip = buildZip([{ name: 'bomb.txt', method: 8, content: 'a'.repeat(50000) }]);
    assert.throws(
      () => extractArchive(zip, dir, { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxCompressionRatio: 2 } }),
      /compression ratio/
    );
  });

  it('rejects an archive larger than the compressed limit', () => {
    const zip = buildZip([{ name: 'x.txt', content: 'hello' }]);
    assert.throws(
      () => extractArchive(zip, dir, { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxCompressedBytes: 10 } }),
      /over the compressed limit/
    );
  });
});

describe('archive — malformed input', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'cadet-arc-bad-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('rejects a non-zip buffer', () => {
    assert.throws(() => extractArchive(Buffer.from('not a zip'), dir), /not a valid ZIP|too short/i);
  });

  it('rejects a truncated archive', () => {
    const zip = buildZip([{ name: 'a.txt', content: 'hello' }]);
    assert.throws(() => extractArchive(zip.subarray(0, 20), dir), ArchiveError);
  });

  it('detects a CRC mismatch', () => {
    const zip = buildZip([{ name: 'a.txt', content: 'hello' }], { crcOverride: 0xDEADBEEF });
    assert.throws(() => extractArchive(zip, dir), /CRC mismatch/);
  });

  it('rejects an unsupported compression method', () => {
    const zip = buildZip([{ name: 'a.txt', method: 99, content: 'hello' }]);
    assert.throws(() => extractArchive(zip, dir), /unsupported compression method/);
  });

  it('rejects malformed central-directory bounds', () => {
    const zip = buildZip([{ name: 'a.txt', content: 'hello' }]);
    const eocd = findEocd(zip);
    const broken = Buffer.from(zip);
    broken.writeUInt32LE(0xFFFFFFF0, eocd + 12); // cdSize far past EOF
    assert.throws(() => [...readEntries(broken)], ArchiveError);
  });
});

describe('archive — valid extraction round-trip', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'cadet-arc-ok-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('extracts stored and deflated files with correct content', () => {
    const zip = buildZip([
      { name: 'stored.txt', content: 'stored-content' },
      { name: 'deflated.txt', method: 8, content: 'deflated-content-'.repeat(20) },
    ]);
    const { extracted } = extractArchive(zip, dir, { limits: DEFAULT_ARCHIVE_LIMITS });
    assert.equal(extracted.length, 2);
    assert.equal(readFileSync(join(dir, 'stored.txt'), 'utf-8'), 'stored-content');
    assert.equal(readFileSync(join(dir, 'deflated.txt'), 'utf-8'), 'deflated-content-'.repeat(20));
  });

  it('reads a single entry by name without extracting', () => {
    const zip = buildZip([{ name: 'manifest.json', content: '{"a":1}' }]);
    const data = readArchiveEntry(zip, 'manifest.json');
    assert.equal(data.toString('utf-8'), '{"a":1}');
    assert.equal(readArchiveEntry(zip, 'missing.json'), null);
  });

  it('compute crc32 matches a known vector', () => {
    // CRC-32 of "The quick brown fox jumps over the lazy dog" is 0x414FA339.
    assert.equal(crc32(Buffer.from('The quick brown fox jumps over the lazy dog')), 0x414FA339);
  });
});

describe('archive — install.mjs hardening integration', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'cadet-inst-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('extractZip refuses traversal entries', async () => {
    const zip = buildZip([{ name: '../escape.txt', content: 'x' }]);
    await assert.rejects(() => extractZip(zip, join(dir, 'target')), ArchiveError);
  });

  it('extractZipWithManifest refuses traversal entries', async () => {
    const zip = buildZip([{ name: '../../escape.txt', content: 'x' }]);
    await assert.rejects(
      () => extractZipWithManifest(zip, dir, { preserved: [], managed: [] }),
      ArchiveError
    );
  });

  it('findManagedPathsInZip still reads managedPaths', () => {
    const manifest = JSON.stringify({ managedPaths: ['.cadet/agent/core'] });
    const zip = buildZip([{ name: '.cadet/agent/core/FrameworkManifest.json', content: manifest }]);
    assert.deepEqual(findManagedPathsInZip(zip), ['.cadet/agent/core']);
  });

  it('findManagedPathsInZip returns empty for a traversal-only archive', () => {
    const zip = buildZip([{ name: '../evil.json', content: '{}' }]);
    assert.deepEqual(findManagedPathsInZip(zip), []);
  });
});
