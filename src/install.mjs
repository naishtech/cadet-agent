import { readFileSync, unlinkSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { runUpgrades } from './upgrades.mjs';
import {
  extractArchive, readArchiveEntry, findEocd,
  DEFAULT_ARCHIVE_LIMITS, ArchiveError,
} from './harness/archive.mjs';
import { REPO_ROLES, REPO_ROLE_MARKER } from './harness/repo-role.mjs';

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

// ── Create-only paths (never overwrite an existing consumer file) ─────────────
//
// Some packaged files are advisory conveniences that a consumer repository may
// already own (currently root `AGENTS.md`). These are listed in the manifest as
// `createOnlyPaths`: written when absent, and never overwritten when present.
// The canonical copy always remains available at the repository URL below.

const REPO_URL = 'https://github.com/naishtech/cadet-agent';

/** Tag-pinned URL for a create-only file, so the link cannot drift. */
export function createOnlyUrl(relPath, version) {
  const tag = version && version !== 'unknown' ? `v${normalizeVersion(version)}` : 'main';
  return `${REPO_URL}/blob/${tag}/${relPath}`;
}

function normalizeRel(p) {
  return p.replace(/^\.?\//, '').replace(/\\/g, '/');
}

/** Does an absolute-or-relative entry match a create-only path (exact file)? */
function matchesCreateOnly(entryName, createOnlyPaths) {
  const n = normalizeRel(entryName);
  return (createOnlyPaths || []).some((c) => normalizeRel(c) === n);
}

/**
 * Decide how to handle a create-only path that already exists on disk.
 * Returns 'keep' | 'overwrite' | 'merge'.
 *
 * Non-interactive (no TTY, --yes, or an explicit policy) always resolves to the
 * safe 'keep' — a scripted/CI install must never clobber a consumer file.
 */
async function resolveExistingCreateOnly({ relPath, mode, interactive }) {
  if (mode) return mode; // explicit --agents-md=keep|overwrite|merge
  if (!interactive) return 'keep';

  const answer = await promptLine(
    `\n⚠️  ${relPath} already exists in this repository.\n` +
    `   [k] Keep mine (leave it untouched)   [o] Overwrite with Cadet's   [m] Merge Cadet's block\n` +
    `   Keep yours? (K/o/m): `
  );
  const a = (answer || '').trim().toLowerCase();
  if (a === 'o' || a === 'overwrite') return 'overwrite';
  if (a === 'm' || a === 'merge') return 'merge';
  return 'keep';
}

/** Read one line from stdin. Resolves to '' if stdin ends without an answer. */
function promptLine(question) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      done(answer);
      rl.close();
    });
    // Only fall back to '' if the stream closes with no answer (EOF/piped input).
    rl.on('close', () => done(''));
  });
}

/** True when we may prompt: an interactive TTY and not disabled by --yes. */
export function canPrompt(opts = {}) {
  if (opts.yes === true) return false;
  if (opts.interactive === false) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Marker block used by the 'merge' resolution. Content between the markers is
// Cadet-owned and replaced on each sync; everything outside is the consumer's.
export const AGENTS_MARKER_BEGIN = '<!-- cadet-agent:begin -->';
export const AGENTS_MARKER_END = '<!-- cadet-agent:end -->';

/** Wrap a body in the Cadet marker block. */
export function wrapWithMarkers(body) {
  return `${AGENTS_MARKER_BEGIN}\n${body.trim()}\n${AGENTS_MARKER_END}`;
}

/**
 * Merge Cadet's marked block into an existing file's text:
 * replace the block if present, otherwise append it. Content outside the
 * markers is preserved verbatim.
 */
export function mergeMarkerBlock(existing, cadetBody) {
  const block = wrapWithMarkers(cadetBody);
  const begin = existing.indexOf(AGENTS_MARKER_BEGIN);
  const end = existing.indexOf(AGENTS_MARKER_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    return existing.slice(0, begin) + block + existing.slice(end + AGENTS_MARKER_END.length);
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}\n`;
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

// ── Repo-role marker ─────────────────────────────────────────────────────────
//
// Cadet is consumed either as a framework source checkout (this repository and
// its forks) or as a consumer project that installs the framework. The two need
// different behaviour — story/gate work does not apply to the framework source.
// Writing a tiny `.cadet/.repo-role` marker makes that boundary machine-checkable
// instead of relying on prose, and it is neither a managed nor a preserved path,
// so sync can never delete or overwrite it by accident.

const VALID_ROLES = [REPO_ROLES.CONSUMER, REPO_ROLES.FRAMEWORK];

/** Read the `.cadet/.repo-role` marker. Returns the role string, or null. */
export function readRepoRoleMarker(targetDir) {
  const path = join(targetDir, REPO_ROLE_MARKER);
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Write the `.cadet/.repo-role` marker, creating `.cadet/` if necessary.
 * Defaults to `consumer-project` — the role of anything that runs `init`/`sync`.
 * Throws on an unrecognized role so a typo fails loudly rather than writing junk.
 */
export function writeRepoRoleMarker(targetDir, role = REPO_ROLES.CONSUMER) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`unknown repo role "${role}" (expected: ${VALID_ROLES.join('|')})`);
  }
  const path = join(targetDir, REPO_ROLE_MARKER);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${role}\n`, 'utf-8');
  return path;
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

  // 4. Extract. Create-only paths (e.g. AGENTS.md) must never overwrite an
  // existing consumer file; if one is skipped, point the user at the source.
  console.log('📂 Extracting...');
  const createOnly = readCreateOnlyPathsFromZip(zipBuf);
  const extracted = await extractZip(zipBuf, targetDir, {
    ...opts,
    createOnlyPaths: createOnly,
    interactive: canPrompt(opts),
  });
  reportCreateOnlySkips(createOnly, targetDir, releaseVersion, opts);

  // 4b. Record the repository role. This install targets a consumer project, and
  // the marker lets later CLI/skill invocations say so instead of guessing.
  const roleMarker = writeRepoRoleMarker(targetDir, REPO_ROLES.CONSUMER);
  console.log(`   Repo role: consumer-project (${roleMarker})`);

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
  console.log('  Deep Code:');
  console.log('    Already active — .agents\\skills\\cadet-agent\\SKILL.md is discovered as a project skill');
  console.log('    List skills with /skills, then pick a cadet-* skill from the / menu');
  console.log('    Reviewer: the cadet-agent-reviewer skill');
  console.log('    Git guard: no hook — approve via .deepcode\\settings.json permissions.ask (mutate-git-log)');
  console.log('    Docs: https://deepcode.vegamo.cn/');
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

/**
 * Resolve create-only paths against the target directory before extraction.
 * Returns:
 *   - skip:    set of normalized paths whose existing copy must be left alone
 *   - merge:   map of normalized path -> existing text (to merge Cadet's block)
 *   - created: normalized paths that do not yet exist (write normally)
 *   - kept:    human-readable list of paths left untouched
 */
async function planCreateOnly(createOnlyPaths, targetDir, opts = {}) {
  const skip = new Set();
  const merge = new Map();
  const created = [];
  const kept = [];

  for (const rel of createOnlyPaths || []) {
    const n = normalizeRel(rel);
    const full = join(targetDir, rel.replace(/^\.?\//, ''));
    if (!existsSync(full)) {
      created.push(n);
      continue;
    }
    const resolution = await resolveExistingCreateOnly({
      relPath: n,
      mode: opts.createOnlyPolicy && opts.createOnlyPolicy[n],
      interactive: canPrompt(opts),
    });
    if (resolution === 'overwrite') continue;             // fall through and write
    if (resolution === 'merge') {
      // Remember the consumer's current text; the Cadet body is read from the
      // archive after extraction (never written over the consumer's file).
      merge.set(n, readFileSync(full, 'utf-8'));
      skip.add(n);
    } else {
      skip.add(n);
    }
    kept.push(n);
  }
  return { skip, merge, created, kept };
}

/** Extract every file entry into targetDir, returning the written paths. */
export async function extractZip(buf, targetDir, opts = {}) {
  const createOnlyPaths = opts.createOnlyPaths || [];
  const plan = await planCreateOnly(createOnlyPaths, targetDir, opts);

  const { extracted } = extractArchive(buf, targetDir, {
    limits: ARCHIVE_LIMITS,
    filter: (entry) => {
      if (plan.skip.has(normalizeRel(entry.filename))) return { skip: true };
      return true;
    },
  });

  applyMerges(plan, targetDir, buf);
  return extracted;
}

/**
 * Merge Cadet's marker block into the existing file for every planned merge.
 * Cadet's body is read from the archive (its entry was skipped, so the
 * consumer's file on disk was never touched). Content outside the markers is
 * preserved.
 */
function applyMerges(plan, targetDir, buf) {
  for (const [rel, existingText] of plan.merge) {
    const full = join(targetDir, rel);
    const data = readArchiveEntry(buf, rel, ARCHIVE_LIMITS);
    if (!data) continue; // archive lacks the file — leave the consumer's text alone
    const cadetBody = data.toString('utf-8');
    writeFileSync(full, mergeMarkerBlock(existingText, cadetBody), 'utf-8');
    plan.merged = plan.merged || [];
    plan.merged.push(full);
  }
}

export async function extractZipWithManifest(buf, targetDir, { preserved, managed, createOnly = [], limits = ARCHIVE_LIMITS, ...opts }) {
  const updated = [];
  const preserved_list = [];
  const added = [];
  const kept = [];
  const zipFilenames = [];

  const plan = await planCreateOnly(createOnly, targetDir, opts);
  kept.push(...plan.kept);

  const { extracted } = extractArchive(buf, targetDir, {
    limits,
    filter: (entry) => {
      zipFilenames.push(entry.filename);
      if (matchesPreservedPath(entry.filename, preserved)) {
        preserved_list.push(entry.filename);
        return { skip: true };
      }
      if (plan.skip.has(normalizeRel(entry.filename))) {
        return { skip: true };
      }
      return true;
    },
  });

  applyMerges(plan, targetDir, buf);

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

  return { updated, preserved: preserved_list, added, deleted, kept, zipFilenames };
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

/** Read `createOnlyPaths` from the manifest inside the zip. */
export function readCreateOnlyPathsFromZip(buf) {
  try {
    const data = readArchiveEntry(buf, '.cadet/agent/core/FrameworkManifest.json', ARCHIVE_LIMITS);
    if (!data) return [];
    const manifest = JSON.parse(data.toString('utf-8'));
    return manifest.createOnlyPaths || [];
  } catch {
    return [];
  }
}

/**
 * Print a note for each create-only path that was left untouched, including a
 * tag-pinned URL so the user can copy the canonical version if they want it.
 */
export function reportCreateOnlySkips(createOnlyPaths, targetDir, version, opts = {}) {
  const skipped = (createOnlyPaths || []).filter((rel) => {
    const full = join(targetDir, rel.replace(/^\.?\//, ''));
    return existsSync(full);
  });
  for (const rel of skipped) {
    const n = normalizeRel(rel);
    const resolution = opts.createOnlyPolicy && opts.createOnlyPolicy[n];
    if (resolution === 'overwrite') continue; // the user chose to replace it
    console.log(`   Kept:     ${n} (existing file left untouched)`);
    console.log(`             Cadet's version: ${createOnlyUrl(n, version)}`);
  }
  return skipped;
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

  // 2b. Ensure the repo-role marker exists even when no files change, so an
  // existing install synced by an older CLI still gets the boundary recorded.
  if (!readRepoRoleMarker(targetDir)) {
    writeRepoRoleMarker(targetDir, REPO_ROLES.CONSUMER);
  }

  if (oldVersionNorm === newVersion) {
    console.log(`✅ Already up to date (v${oldVersionNorm}). Nothing to sync.\n`);
    return;
  }

  // 3. Download
  const asset = findZipAsset(release);
  const zipBuf = await downloadZip(asset.browser_download_url);
  console.log(`   Downloaded ${(zipBuf.length / 1024).toFixed(0)} KB\n`);

  // 4. Extract with manifest awareness. Create-only paths (e.g. AGENTS.md) are
  // never overwritten when the consumer already has them.
  console.log('📂 Extracting (preserving local policies and plans)...');
  const createOnly = readCreateOnlyPathsFromZip(zipBuf);
  const result = await extractZipWithManifest(zipBuf, targetDir, {
    preserved: existingManifest.preservedPaths || [],
    managed: existingManifest.managedPaths || [],
    createOnly,
    ...opts,
    interactive: canPrompt(opts),
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
  reportCreateOnlySkips(createOnly, targetDir, newVersion, opts);
  console.log('');

  // Print per-IDE next steps
  console.log('── Next steps ──');
  console.log('  Framework files updated. Start a fresh chat for changes to take effect:');
  console.log('    Select "Cadet Agent" from the agent picker in Copilot Chat');
  console.log('');
}
