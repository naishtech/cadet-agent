import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { inflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com/repos/naishtech/cadet-agent/releases/latest';
const USER_AGENT = 'cadet-agent-cli';

// ── ZIP parser (zero-dependency, handles store + deflate) ───────────────────

const SIG_EOCD  = 0x06054b50;
const SIG_CD    = 0x02014b50;
const SIG_LFH   = 0x04034b50;

function read32(buf, off) { return buf.readUInt32LE(off); }
function read16(buf, off) { return buf.readUInt16LE(off); }

function findEocd(buf) {
  // Search backwards from end for EOCD signature (comment is max 65535 bytes)
  const maxStart = Math.max(0, buf.length - 65535 - 22);
  for (let i = buf.length - 22; i >= maxStart; i--) {
    if (read32(buf, i) === SIG_EOCD) return i;
  }
  throw new Error('Not a valid ZIP file: EOCD signature not found');
}

function* centralDirectoryEntries(buf, cdOffset, cdSize) {
  let off = cdOffset;
  const end = cdOffset + cdSize;
  while (off < end) {
    if (read32(buf, off) !== SIG_CD) break;
    const method           = read16(buf, off + 10);
    const compressedSize   = read32(buf, off + 20);
    const uncompressedSize = read32(buf, off + 24);
    const filenameLen      = read16(buf, off + 28);
    const extraLen         = read16(buf, off + 30);
    const commentLen       = read16(buf, off + 32);
    const localHeaderOff   = read32(buf, off + 42);
    const filename         = buf.toString('utf-8', off + 46, off + 46 + filenameLen);

    // Skip directory entries (trailing / in filename, or uncompressedSize == 0 with no method)
    if (!filename.endsWith('/')) {
      yield { filename, method, compressedSize, uncompressedSize, localHeaderOff };
    }

    off += 46 + filenameLen + extraLen + commentLen;
  }
}

function extractFile(buf, entry, targetDir) {
  const { filename, method, compressedSize, localHeaderOff } = entry;

  // Read local file header to get filename + extra lengths (they may differ from CD)
  const lfhFilenameLen = read16(buf, localHeaderOff + 26);
  const lfhExtraLen    = read16(buf, localHeaderOff + 28);

  const dataStart = localHeaderOff + 30 + lfhFilenameLen + lfhExtraLen;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  let data;
  if (method === 0) {
    // Stored — no compression
    data = compressed;
  } else if (method === 8) {
    // Deflate
    data = inflateRawSync(compressed);
  } else {
    throw new Error(`Unsupported compression method ${method} for ${filename}`);
  }

  const outPath = join(targetDir, filename);
  mkdirSync(dirname(outPath), { recursive: true });
  const ws = createWriteStream(outPath);
  Readable.from(data).pipe(ws);

  return outPath;
}

function extractZip(buf, targetDir) {
  const eocdOff = findEocd(buf);
  const cdSize  = read32(buf, eocdOff + 12);
  const cdOff   = read32(buf, eocdOff + 16);

  const paths = [];
  for (const entry of centralDirectoryEntries(buf, cdOff, cdSize)) {
    const outPath = extractFile(buf, entry, targetDir);
    paths.push(outPath);
  }
  return paths;
}

// ── GitHub release download ─────────────────────────────────────────────────

async function fetchLatestRelease() {
  console.log('🔍 Fetching latest Cadet-Agent release...');

  const res = await fetch(GITHUB_API, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/vnd.github+json',
    },
  });

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        `GitHub API rate-limited (${res.status}). ` +
        'Set GITHUB_TOKEN env var for higher limits, or try again later.'
      );
    }
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

function findZipAsset(release) {
  const asset = release.assets?.find(a => a.name === 'cadet-agent.zip');
  if (!asset) {
    throw new Error(
      `Release ${release.tag_name} does not contain cadet-agent.zip.\n` +
      `Available assets: ${(release.assets || []).map(a => a.name).join(', ') || 'none'}`
    );
  }
  return asset;
}

async function downloadZip(url) {
  console.log('⬇️  Downloading cadet-agent.zip...');

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/octet-stream',
    },
  });

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const contentLength = res.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  // Stream to buffer with progress
  const chunks = [];
  let downloaded = 0;
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (total > 0) {
      const pct = Math.round((downloaded / total) * 100);
      process.stdout.write(`\r   ${pct}% (${(downloaded / 1024).toFixed(0)} KB / ${(total / 1024).toFixed(0)} KB)`);
    }
  }
  if (total > 0) process.stdout.write('\n');

  return Buffer.concat(chunks);
}

// ── Public install entry ────────────────────────────────────────────────────

export async function install(targetDir) {
  console.log(`📦 Cadet-Agent — installing to ${targetDir}\n`);

  // 1. Fetch release metadata
  const release = await fetchLatestRelease();
  console.log(`   Latest: ${release.tag_name} (published ${release.published_at})\n`);

  // 2. Find zip asset
  const asset = findZipAsset(release);

  // 3. Download
  const zipBuf = await downloadZip(asset.browser_download_url);
  console.log(`   Downloaded ${(zipBuf.length / 1024).toFixed(0)} KB\n`);

  // 4. Extract
  console.log('📂 Extracting...');
  const extracted = extractZip(zipBuf, targetDir);

  // 5. Report
  console.log(`\n✅ Cadet-Agent ${release.tag_name} installed! Extracted ${extracted.length} files.\n`);

  // Print per-IDE next steps
  console.log('── Next steps ──');
  console.log('  GitHub Copilot:');
  console.log('    Start a chat: /cadet');
  console.log('  Cursor:');
  console.log('    Already active — .cursor\\rules\\cadet-agent.md loads automatically');
  console.log('  Continue:');
  console.log('    Already active — .continue\\rules\\cadet-agent.md loads automatically');
  console.log('  Claude Code:');
  console.log('    Already active — .claude\\skills\\cadet-agent.md loads as a project skill');
  console.log('');
}
