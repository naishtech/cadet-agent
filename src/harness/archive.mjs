/**
 * Cadet-Agent archive safety.
 *
 * A hardened, zero-dependency ZIP reader/extractor with explicit containment and
 * resource limits. Rejects absolute paths, traversal after canonicalization,
 * paths outside the target directory, oversized filenames, too many files,
 * oversized compressed/uncompressed totals, and excessive compression ratios.
 * Validates central-directory and local-header bounds before allocating, and
 * verifies CRC-32 when present.
 *
 * Contract: docs/core/HarnessContract.md §9 (archive safety).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const SIG_EOCD = 0x06054b50;
export const SIG_CD = 0x02014b50;
export const SIG_LFH = 0x04034b50;

const MIB = 1024 * 1024;

/** Default archive limits (mirrors policy DEFAULT_ARCHIVE_LIMITS). */
export const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxCompressedBytes: 25 * MIB,
  maxDecompressedBytes: 100 * MIB,
  maxFiles: 2000,
  maxFilenameBytes: 240,
  maxCompressionRatio: 100,
});

export class ArchiveError extends Error {
  constructor(message, code = 'archive-error') {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
  }
}

function read32(buf, off) { return buf.readUInt32LE(off); }
function read16(buf, off) { return buf.readUInt16LE(off); }

/** CRC-32 (IEEE) table, computed once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function findEocd(buf) {
  if (buf.length < 22) throw new ArchiveError('Not a valid ZIP file: too short', 'not-a-zip');
  const maxStart = Math.max(0, buf.length - 65535 - 22);
  for (let i = buf.length - 22; i >= maxStart; i--) {
    if (read32(buf, i) === SIG_EOCD) return i;
  }
  throw new ArchiveError('Not a valid ZIP file: EOCD signature not found', 'not-a-zip');
}

/**
 * Validate that a resolved output path stays inside the target directory.
 * Rejects absolute paths and any traversal that escapes after canonicalization.
 */
export function assertContained(targetDir, entryName) {
  const raw = entryName.replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    throw new ArchiveError(`archive entry uses an absolute path: ${entryName}`, 'absolute-path');
  }
  const resolvedRoot = resolve(targetDir);
  const resolved = resolve(join(targetDir, raw));
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new ArchiveError(`archive entry escapes the target directory: ${entryName}`, 'traversal');
  }
  return resolved;
}

function validateEntry(entry, limits, running) {
  const nameBytes = Buffer.byteLength(entry.filename, 'utf-8');
  if (nameBytes > limits.maxFilenameBytes) {
    throw new ArchiveError(`archive entry filename exceeds ${limits.maxFilenameBytes} bytes: ${entry.filename.slice(0, 60)}`, 'filename-too-long');
  }
  if (entry.uncompressedSize > limits.maxDecompressedBytes || running.uncompressed + entry.uncompressedSize > limits.maxDecompressedBytes) {
    throw new ArchiveError(`decompressed size exceeds ${limits.maxDecompressedBytes} bytes`, 'decompressed-too-large');
  }
  if (entry.compressedSize > limits.maxCompressedBytes || running.compressed + entry.compressedSize > limits.maxCompressedBytes) {
    throw new ArchiveError(`compressed size exceeds ${limits.maxCompressedBytes} bytes`, 'compressed-too-large');
  }
  if (entry.uncompressedSize > 0 && entry.compressedSize > 0) {
    const ratio = entry.uncompressedSize / entry.compressedSize;
    if (ratio > limits.maxCompressionRatio) {
      throw new ArchiveError(`compression ratio ${ratio.toFixed(1)}:1 exceeds ${limits.maxCompressionRatio}:1 for ${entry.filename}`, 'compression-ratio');
    }
  }
}

/**
 * Iterate central-directory entries with bounds checking. Directory entries are
 * yielded too (`isDirectory: true`) so callers can decide what to do, but the
 * default extractor skips them.
 */
export function* readEntries(buf, limits = DEFAULT_ARCHIVE_LIMITS) {
  const eocdOff = findEocd(buf);
  const cdSize = read32(buf, eocdOff + 12);
  const cdOff = read32(buf, eocdOff + 16);
  const totalEntries = read16(buf, eocdOff + 10);

  if (cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    throw new ArchiveError('ZIP64 format is not supported', 'zip64');
  }
  if (cdOff + cdSize > buf.length) {
    throw new ArchiveError('central directory extends past the end of the archive', 'malformed');
  }
  if (totalEntries > limits.maxFiles) {
    throw new ArchiveError(`archive declares ${totalEntries} files, over the limit of ${limits.maxFiles}`, 'too-many-files');
  }

  const running = { compressed: 0, uncompressed: 0, files: 0 };
  let off = cdOff;
  const end = cdOff + cdSize;
  while (off + 46 <= end) {
    if (read32(buf, off) !== SIG_CD) {
      throw new ArchiveError('malformed central directory entry', 'malformed');
    }
    const method = read16(buf, off + 10);
    const crc = read32(buf, off + 16);
    const compressedSize = read32(buf, off + 20);
    const uncompressedSize = read32(buf, off + 24);
    const filenameLen = read16(buf, off + 28);
    const extraLen = read16(buf, off + 30);
    const commentLen = read16(buf, off + 32);
    const localHeaderOff = read32(buf, off + 42);
    if (off + 46 + filenameLen + extraLen + commentLen > end) {
      throw new ArchiveError('central directory entry extends past the directory', 'malformed');
    }
    const filename = buf.toString('utf-8', off + 46, off + 46 + filenameLen).replace(/\\/g, '/');
    if (localHeaderOff + 30 > buf.length) {
      throw new ArchiveError(`local header offset out of bounds for ${filename}`, 'malformed');
    }

    const isDirectory = filename.endsWith('/');
    const entry = { filename, method, compressedSize, uncompressedSize, localHeaderOff, crc, isDirectory };
    if (!isDirectory) {
      running.files++;
      if (running.files > limits.maxFiles) {
        throw new ArchiveError(`archive contains more than ${limits.maxFiles} files`, 'too-many-files');
      }
      validateEntry(entry, limits, running);
      running.compressed += compressedSize;
      running.uncompressed += uncompressedSize;
    }
    yield entry;
    off += 46 + filenameLen + extraLen + commentLen;
  }
}

/** Decompress one entry's payload, validating the local header and CRC. */
export function readEntryData(buf, entry) {
  const { localHeaderOff } = entry;
  if (read32(buf, localHeaderOff) !== SIG_LFH) {
    throw new ArchiveError(`local file header signature missing for ${entry.filename}`, 'malformed');
  }
  const lfhFilenameLen = read16(buf, localHeaderOff + 26);
  const lfhExtraLen = read16(buf, localHeaderOff + 28);
  const dataStart = localHeaderOff + 30 + lfhFilenameLen + lfhExtraLen;
  if (dataStart + entry.compressedSize > buf.length) {
    throw new ArchiveError(`entry data extends past the end of the archive: ${entry.filename}`, 'malformed');
  }
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);

  let data;
  if (entry.method === 0) {
    data = compressed;
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(compressed);
    } catch (err) {
      throw new ArchiveError(`failed to inflate ${entry.filename}: ${err.message}`, 'inflate-failed');
    }
  } else {
    throw new ArchiveError(
      `unsupported compression method ${entry.method} for ${entry.filename}. ` +
      'Download cadet-agent.zip manually from https://github.com/naishtech/cadet-agent/releases/latest',
      'unsupported-method'
    );
  }

  if (data.length !== entry.uncompressedSize) {
    throw new ArchiveError(`size mismatch for ${entry.filename} (expected ${entry.uncompressedSize}, got ${data.length})`, 'size-mismatch');
  }
  // Verify CRC when the archive provides one (0 means "not recorded").
  if (entry.crc !== 0 && crc32(data) !== entry.crc) {
    throw new ArchiveError(`CRC mismatch for ${entry.filename}`, 'crc-mismatch');
  }
  return data;
}

/**
 * Extract a ZIP into targetDir with full containment and limit enforcement.
 * `filter` may return `{ skip: true }` to omit an entry. Returns extracted paths.
 */
export function extractArchive(buf, targetDir, { limits = DEFAULT_ARCHIVE_LIMITS, filter = null } = {}) {
  if (buf.length > limits.maxCompressedBytes) {
    throw new ArchiveError(`archive is ${buf.length} bytes, over the compressed limit of ${limits.maxCompressedBytes}`, 'compressed-too-large');
  }
  const extracted = [];
  const skipped = [];
  for (const entry of readEntries(buf, limits)) {
    if (entry.isDirectory) continue;
    if (filter) {
      const decision = filter(entry);
      if (decision === false || decision?.skip) { skipped.push(entry.filename); continue; }
    }
    const outPath = assertContained(targetDir, entry.filename);
    const data = readEntryData(buf, entry);
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, data);
    extracted.push(outPath);
  }
  return { extracted, skipped, targetDir: normalize(targetDir) };
}

/** Read a single entry's bytes without extracting (used for the manifest). */
export function readArchiveEntry(buf, name, limits = DEFAULT_ARCHIVE_LIMITS) {
  const normalized = name.replace(/\\/g, '/');
  for (const entry of readEntries(buf, limits)) {
    if (entry.isDirectory) continue;
    if (entry.filename.replace(/^\.\//, '') === normalized.replace(/^\.\//, '')) {
      return readEntryData(buf, entry);
    }
  }
  return null;
}
