import { createWriteStream, mkdirSync, readFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { runUpgrades } from './upgrades.mjs';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_API = 'https://api.github.com/repos/naishtech/cadet-agent/releases/latest';
const USER_AGENT = 'cadet-agent-cli';

function resolveApiUrl(override) {
  return override || process.env.CADET_AGENT_RELEASE_URL || DEFAULT_API;
}

function normalizeVersion(v) {
  return (v || '').replace(/^v/, '');
}

function buildHeaders(extra = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    ...extra,
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

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
    throw new Error(
      `Unsupported compression method ${method} for ${filename}.\n` +
      `This zip uses a compression format this CLI doesn't support.\n` +
      `Try downloading cadet-agent.zip manually from:\n` +
      `  https://github.com/naishtech/cadet-agent/releases/latest`
    );
  }

  const outPath = join(targetDir, filename);
  mkdirSync(dirname(outPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const rs = Readable.from(data);
    const ws = createWriteStream(outPath);
    rs.pipe(ws);
    ws.on('finish', () => resolve(outPath));
    ws.on('error', (err) => reject(new Error(`Write failed for ${filename}: ${err.message}`)));
    rs.on('error', (err) => reject(new Error(`Read failed for ${filename}: ${err.message}`)));
  });
}

async function extractZip(buf, targetDir) {
  const eocdOff = findEocd(buf);
  const cdSize  = read32(buf, eocdOff + 12);
  const cdOff   = read32(buf, eocdOff + 16);

  // ZIP64 detection — 0xFFFFFFFF in 32-bit fields means real values are in ZIP64 extra records
  if (cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    throw new Error(
      'This zip uses ZIP64 format, which is not supported.\n' +
      'Try downloading cadet-agent.zip manually from:\n' +
      '  https://github.com/naishtech/cadet-agent/releases/latest'
    );
  }

  const paths = [];
  for (const entry of centralDirectoryEntries(buf, cdOff, cdSize)) {
    const outPath = await extractFile(buf, entry, targetDir);
    paths.push(outPath);
  }
  return paths;
}

// ── GitHub release download ─────────────────────────────────────────────────

async function fetchLatestRelease(apiUrl) {
  const url = resolveApiUrl(apiUrl);
  console.log('🔍 Fetching latest Cadet-Agent release...');

  const res = await fetch(url, {
    headers: buildHeaders({ 'Accept': 'application/vnd.github+json' }),
  });

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        `GitHub API rate-limited (${res.status}). ` +
        'Set GITHUB_TOKEN or GH_TOKEN env var for authenticated requests, or try again later.'
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
    headers: buildHeaders({ 'Accept': 'application/octet-stream' }),
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

export async function install(targetDir, opts = {}) {
  console.log(`📦 Cadet-Agent — installing to ${targetDir}\n`);

  // 1. Fetch release metadata
  const release = await fetchLatestRelease(opts.sourceUrl);
  const releaseVersion = normalizeVersion(release.tag_name);
  console.log(`   Latest: v${releaseVersion} (published ${release.published_at})\n`);

  // 2. Find zip asset
  const asset = findZipAsset(release);

  // 3. Download
  const zipBuf = await downloadZip(asset.browser_download_url);
  console.log(`   Downloaded ${(zipBuf.length / 1024).toFixed(0)} KB\n`);

  // 4. Extract
  console.log('📂 Extracting...');
  const extracted = await extractZip(zipBuf, targetDir);

  // 5. Report
  console.log(`\n✅ Cadet-Agent v${releaseVersion} installed! Extracted ${extracted.length} files.\n`);

  // Print per-IDE next steps
  console.log('── Next steps ──');
  console.log('  GitHub Copilot:');
  console.log('    Select "Cadet Agent" from the agent picker in Copilot Chat');
  console.log('    Slash commands: /cadet-requirements, /cadet-architecture, /cadet-spike,');
  console.log('      /cadet-breakdown, /cadet-tdd, /cadet-debug, /cadet-review, /cadet-resume');
  console.log('    Reviewer: select "Cadet Agent Reviewer" from the agent picker');
  console.log('  Cursor:');
  console.log('    Already active — .cursor\\rules\\cadet-agent.md loads automatically (alwaysApply)');
  console.log('    Ask for a phase by name: "run the requirements skill", "do a code review", etc.');
  console.log('    Reviewer: enable the cadet-agent-reviewer rule (alwaysApply: false)');
  console.log('    Git guard: manual — see .cursor\\rules\\cadet-agent.md for instructions');
  console.log('  Continue:');
  console.log('    Already active — .continue\\rules\\cadet-agent.md loads as a project rule');
  console.log('    Slash commands: /cadet-requirements, /cadet-architecture, /cadet-spike,');
  console.log('      /cadet-breakdown, /cadet-tdd, /cadet-debug, /cadet-review, /cadet-resume');
  console.log('    Reviewer: /cadet-agent-reviewer');
  console.log('    Git guard: manual — see .continue\\rules\\cadet-agent.md for instructions');
  console.log('  Claude Code:');
  console.log('    Already active — .claude\\skills\\cadet-agent.md loads as a project skill');
  console.log('    Slash commands: /cadet-requirements, /cadet-architecture, /cadet-spike,');
  console.log('      /cadet-breakdown, /cadet-tdd, /cadet-debug, /cadet-review, /cadet-resume');
  console.log('    Reviewer: /cadet-agent-reviewer');
  console.log('    Git guard: manual — see .claude\\skills\\cadet-agent.md for instructions');
  console.log('');
}

// ── Manifest-aware extraction ───────────────────────────────────────────────

function matchesPreservedPath(filename, preservedPaths) {
  // Normalize: strip leading dot (zip paths like ".cadet/agent/policies/...")
  const normalized = filename.replace(/^\.?\/?/, '');
  for (const preserved of preservedPaths) {
    const p = preserved.replace(/^\.?\/?/, '');
    if (normalized === p || normalized.startsWith(p + '/') || normalized.startsWith(p + '\\')) {
      return true;
    }
  }
  return false;
}

function matchesManagedPath(filename, managedPaths) {
  const normalized = filename.replace(/^\.?\/?/, '').replace(/\\/g, '/');
  for (const m of managedPaths) {
    const mn = m.replace(/^\.?\/?/, '').replace(/\\/g, '/');
    if (normalized === mn || normalized.startsWith(mn + '/')) {
      return true;
    }
  }
  return false;
}

function walkDir(dir, fn) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fn);
    } else {
      fn(fullPath, relative(dir, fullPath));
    }
  }
}

function deleteObsoleteManagedFiles(targetDir, managedPaths, zipFilenames) {
  const normalizedZip = new Set(
    zipFilenames.map(f => f.replace(/^\.\//, '').replace(/\\/g, '/'))
  );
  const deleted = [];

  for (const managed of managedPaths) {
    const mn = managed.replace(/^\.\//, '').replace(/\\/g, '/');
    const managedPath = join(targetDir, managed.replace(/^\.\//, ''));
    const stat = (() => { try { return statSync(managedPath); } catch { return null; } })();
    if (!stat) continue;

    if (stat.isFile()) {
      // Single-file managed path — check if it's in the zip
      if (!normalizedZip.has(mn)) continue;
    } else if (stat.isDirectory()) {
      walkDir(managedPath, (filePath, rel) => {
        const relNorm = rel.replace(/\\/g, '/');
        const fullRel = mn + '/' + relNorm;
        if (!normalizedZip.has(fullRel)) {
          try {
            unlinkSync(filePath);
            deleted.push(filePath);
          } catch {
            // File may already be gone or locked — skip
          }
        }
      });
    }
  }
  return deleted;
}

async function extractZipWithManifest(buf, targetDir, { preserved, managed }) {
  const eocdOff = findEocd(buf);
  const cdSize  = read32(buf, eocdOff + 12);
  const cdOff   = read32(buf, eocdOff + 16);

  if (cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    throw new Error(
      'This zip uses ZIP64 format, which is not supported.\n' +
      'Try downloading cadet-agent.zip manually from:\n' +
      '  https://github.com/naishtech/cadet-agent/releases/latest'
    );
  }

  const updated = [];
  const preserved_list = [];
  const added = [];
  const zipFilenames = [];

  for (const entry of centralDirectoryEntries(buf, cdOff, cdSize)) {
    zipFilenames.push(entry.filename);
    if (matchesPreservedPath(entry.filename, preserved)) {
      preserved_list.push(entry.filename);
      continue;
    }
    const outPath = await extractFile(buf, entry, targetDir);
    if (matchesManagedPath(entry.filename, managed)) {
      updated.push(outPath);
    } else {
      added.push(outPath);
    }
  }

  // Delete obsolete managed files no longer in the zip (renamed/removed managed paths)
  const deleted = deleteObsoleteManagedFiles(targetDir, managed, zipFilenames);

  return { updated, preserved: preserved_list, added, deleted, zipFilenames };
}

// ── Removed-managed-path cleanup ─────────────────────────────────────────────

export function findManagedPathsInZip(buf) {
  try {
    const eocdOff = findEocd(buf);
    const cdSize  = read32(buf, eocdOff + 12);
    const cdOff   = read32(buf, eocdOff + 16);

    for (const entry of centralDirectoryEntries(buf, cdOff, cdSize)) {
      const fn = entry.filename.replace(/^\.\//, '').replace(/\\/g, '/');
      if (fn === '.cadet/agent/core/FrameworkManifest.json') {
        // Extract just this one entry to read managedPaths
        const lfhFilenameLen = read16(buf, entry.localHeaderOff + 26);
        const lfhExtraLen    = read16(buf, entry.localHeaderOff + 28);
        const dataStart = entry.localHeaderOff + 30 + lfhFilenameLen + lfhExtraLen;
        const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
        let data;
        if (entry.method === 0) data = compressed;
        else if (entry.method === 8) data = inflateRawSync(compressed);
        else break;
        const manifest = JSON.parse(data.toString('utf-8'));
        return manifest.managedPaths || [];
      }
    }
  } catch {
    // Not a valid zip or manifest not found
  }
  return [];
}

export function deleteRemovedManagedPaths(targetDir, oldManaged, newManaged) {
  const newSet = new Set(newManaged.map(p => p.replace(/^\.\//, '').replace(/\\/g, '/')));
  const deleted = [];

  for (const old of oldManaged) {
    const oldNorm = old.replace(/^\.\//, '').replace(/\\/g, '/');
    if (newSet.has(oldNorm)) continue;

    // This path was in the old manifest but is absent from the new one — remove it
    const fullPath = join(targetDir, old.replace(/^\.\//, ''));
    const st = (() => { try { return statSync(fullPath); } catch { return null; } })();
    if (!st) continue;

    if (st.isFile()) {
      try { unlinkSync(fullPath); deleted.push(fullPath); } catch {}
    } else if (st.isDirectory()) {
      walkDir(fullPath, (filePath) => {
        try { unlinkSync(filePath); deleted.push(filePath); } catch {}
      });
    }
  }
  return deleted;
}

// ── Public sync entry ───────────────────────────────────────────────────────

export async function sync(targetDir, opts = {}) {
  console.log(`🔄 Cadet-Agent — syncing ${targetDir}\n`);

  // 1. Read existing manifest
  const manifestPath = join(targetDir, '.cadet', 'agent', 'core', 'FrameworkManifest.json');
  let existingManifest = null;
  let oldVersion = 'none';
  try {
    existingManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    oldVersion = existingManifest.frameworkVersion || 'unknown';
    console.log(`   Existing install: v${normalizeVersion(oldVersion)}`);
  } catch {
    console.log('   No existing install found — performing full install.\n');
    return install(targetDir, opts);
  }

  // 2. Fetch release metadata
  const release = await fetchLatestRelease(opts.sourceUrl);
  const newVersion = normalizeVersion(release.tag_name);
  const oldVersionNorm = normalizeVersion(oldVersion);
  console.log(`   Latest: v${newVersion} (published ${release.published_at})\n`);

  if (oldVersionNorm === newVersion) {
    console.log(`✅ Already up to date (v${oldVersionNorm}). Nothing to sync.\n`);
    return;
  }

  // 3. Download
  const asset = findZipAsset(release);
  const zipBuf = await downloadZip(asset.browser_download_url);
  console.log(`   Downloaded ${(zipBuf.length / 1024).toFixed(0)} KB\n`);

  // 4. Extract with manifest awareness
  console.log('📂 Extracting (preserving local policies and plans)...');
  const result = await extractZipWithManifest(zipBuf, targetDir, {
    preserved: existingManifest.preservedPaths || [],
    managed: existingManifest.managedPaths || [],
  });

  // 4b. Find new managed paths from the zip and delete any old paths that were removed
  const newManagedPaths = findManagedPathsInZip(zipBuf);
  const removedDeleted = deleteRemovedManagedPaths(
    targetDir,
    existingManifest.managedPaths || [],
    newManagedPaths
  );
  if (removedDeleted.length > 0) {
    result.deleted.push(...removedDeleted);
  }

  // 4c. Run version-based upgrades (migrations for renamed/removed files)
  const upgradeDeleted = runUpgrades(targetDir, oldVersionNorm, newVersion);
  if (upgradeDeleted.length > 0) {
    result.deleted.push(...upgradeDeleted);
  }

  // 5. Report
  console.log('');
  console.log(`✅ Cadet-Agent synced: v${oldVersionNorm} → v${newVersion}`);
  console.log(`   Updated:  ${result.updated.length} files`);
  if (result.preserved.length > 0) {
    console.log(`   Preserved: ${result.preserved.length} files (local policies/plans)`);
  }
  if (result.added.length > 0) {
    console.log(`   New:      ${result.added.length} files`);
  }
  if (result.deleted.length > 0) {
    console.log(`   Removed:  ${result.deleted.length} files (no longer managed)`);
  }
  console.log('');

  // Print per-IDE next steps
  console.log('── Next steps ──');
  console.log('  Framework files updated. Start a fresh chat for changes to take effect:');
  console.log('    Select "Cadet Agent" from the agent picker in Copilot Chat');
  console.log('');
}
