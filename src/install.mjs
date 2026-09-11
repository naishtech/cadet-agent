import { readFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runUpgrades } from './upgrades.mjs';
import {
  extractArchive, readArchiveEntry, findEocd,
  DEFAULT_ARCHIVE_LIMITS, ArchiveError,
} from './harness/archive.mjs';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_API = 'https://api.github.com/repos/naishtech/cadet-agent/releases/latest';
const USER_AGENT = 'cadet-agent-cli';

/** Network timeouts and bounded download limits. */
const FETCH_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 120_000;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

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

/** fetch with an AbortController timeout; never leaves a request hanging. */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── ZIP extraction (hardened via src/harness/archive.mjs) ────────────────────
//
// Containment and resource limits live in the archive module; these wrappers
// preserve the historical return shapes while refusing anything unsafe.

const ARCHIVE_LIMITS = DEFAULT_ARCHIVE_LIMITS;

export { ArchiveError, findEocd };

/** Extract every file entry into targetDir, returning the written paths. */
export async function extractZip(buf, targetDir) {
  const { extracted } = extractArchive(buf, targetDir, { limits: ARCHIVE_LIMITS });
  return extracted;
}

// ── GitHub release download ─────────────────────────────────────────────────

async function fetchLatestRelease(apiUrl) {
  const url = resolveApiUrl(apiUrl);
  console.log('🔍 Fetching latest Cadet-Agent release...');

  const res = await fetchWithTimeout(url, {
    headers: buildHeaders({ 'Accept': 'application/vnd.github+json' }),
  }, FETCH_TIMEOUT_MS);

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

  const res = await fetchWithTimeout(url, {
    headers: buildHeaders({ 'Accept': 'application/octet-stream' }),
  }, FETCH_TIMEOUT_MS);

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const contentLength = res.headers.get('content-length');
  const declared = contentLength ? parseInt(contentLength, 10) : 0;
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new ArchiveError(
      `Refusing download: declared size ${declared} bytes exceeds the ${MAX_DOWNLOAD_BYTES}-byte limit`,
      'download-too-large'
    );
  }

  // Stream to buffer with progress, enforcing a hard size cap and read timeout.
  const chunks = [];
  let downloaded = 0;
  const reader = res.body.getReader();
  const readTimer = setTimeout(() => { try { reader.cancel('read timeout'); } catch { /* ignore */ } }, READ_TIMEOUT_MS);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      if (downloaded > MAX_DOWNLOAD_BYTES) {
        try { await reader.cancel('size limit'); } catch { /* ignore */ }
        throw new ArchiveError(
          `Refusing download: body exceeded the ${MAX_DOWNLOAD_BYTES}-byte limit`,
          'download-too-large'
        );
      }
      chunks.push(value);
      if (declared > 0) {
        const pct = Math.round((downloaded / declared) * 100);
        process.stdout.write(`\r   ${pct}% (${(downloaded / 1024).toFixed(0)} KB / ${(declared / 1024).toFixed(0)} KB)`);
      }
    }
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    if (err.name === 'AbortError') throw new Error(`Download timed out after ${READ_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(readTimer);
  }
  if (declared > 0) process.stdout.write('\n');

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
  console.log('    Already active — .claude\\skills\\cadet-agent\\SKILL.md loads as a project skill');
  console.log('    Slash commands: /cadet-requirements, /cadet-architecture, /cadet-spike,');
  console.log('      /cadet-breakdown, /cadet-tdd, /cadet-debug, /cadet-review, /cadet-resume');
  console.log('    Reviewer: /cadet-agent-reviewer');
  console.log('    Git guard: manual — see .claude\\skills\\cadet-agent\\SKILL.md for instructions');
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
  const root = dir;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        // rel must be relative to the walked root, not the current subdirectory
        fn(fullPath, relative(root, fullPath));
      }
    }
  };
  walk(root);
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

export async function extractZipWithManifest(buf, targetDir, { preserved, managed, limits = ARCHIVE_LIMITS }) {
  const updated = [];
  const preserved_list = [];
  const added = [];
  const zipFilenames = [];

  const { extracted } = extractArchive(buf, targetDir, {
    limits,
    filter: (entry) => {
      zipFilenames.push(entry.filename);
      if (matchesPreservedPath(entry.filename, preserved)) {
        preserved_list.push(entry.filename);
        return { skip: true };
      }
      return true;
    },
  });

  // `extractArchive` skips directory entries; classify the extracted files.
  for (const outPath of extracted) {
    const rel = outPath.replace(/\\/g, '/');
    if (matchesManagedPath(rel, managed)) {
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
    const data = readArchiveEntry(buf, '.cadet/agent/core/FrameworkManifest.json', ARCHIVE_LIMITS);
    if (!data) return [];
    const manifest = JSON.parse(data.toString('utf-8'));
    return manifest.managedPaths || [];
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
