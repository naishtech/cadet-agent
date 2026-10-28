import { readFileSync, unlinkSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
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

/**
 * True when we may prompt: an interactive TTY, not disabled by --yes.
 * `interactive: true` states the answer explicitly, which is how the tests drive
 * the wizard without a terminal.
 */
export function canPrompt(opts = {}) {
  if (opts.yes === true) return false;
  if (opts.interactive === false) return false;
  if (opts.interactive === true) return true;
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
  const seededPolicy = willCreatePolicyFile(targetDir);
  const createOnly = readCreateOnlyPathsFromZip(zipBuf);
  const componentsManifest = readComponentsFromZip(zipBuf);
  const choice = await configureInstall(componentsManifest, targetDir, {
    ...opts,
    interactive: canPrompt(opts),
  });
  if (choice.cancelled) {
    console.log('   Cancelled. Nothing was written.');
    return;
  }
  const selectedComponents = choice.components
    || (componentsManifest ? componentsManifest.components.map((c) => c.id) : null);

  const extracted = await extractZip(zipBuf, targetDir, {
    ...opts,
    components: selectedComponents || undefined,
    createOnlyPaths: createOnly,
    interactive: canPrompt(opts),
  });
  reportCreateOnlySkips(createOnly, targetDir, releaseVersion, opts);

  // 4b. Record the repository role. This install targets a consumer project, and
  // the marker lets later CLI/skill invocations say so instead of guessing.
  const roleMarker = writeRepoRoleMarker(targetDir, REPO_ROLES.CONSUMER);
  console.log(`   Repo role: consumer-project (${roleMarker})`);

  // 4c. A new Unity consumer gets the reachability gate on. The seed declares it
  // off, because the package cannot know the consumer's engine; this is the one
  // edit made to a policy file the framework itself has just created.
  if (seededPolicy) reportSeedReachability(targetDir);

  // 5. Report
  const record = buildInstallRecord({
    targetDir,
    version: releaseVersion,
    components: selectedComponents || [],
    engine: choice.detected,
    written: extracted,
    manifest: componentsManifest,
  });
  writeInstallRecord(targetDir, record);
  console.log(`   Record:   ${record.files.length} files, ${record.components.length} components (${INSTALL_RECORD_PATH.replace(/\\/g, '/')})`);

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
  console.log('  Hermes:');
  console.log('    Already active — .agents\\skills\\cadet-agent\\SKILL.md is discovered as a project skill');
  console.log('    Run `hermes skills trust` once inside the repo to enable project skills');
  console.log('    Slash commands: /cadet-requirements, /cadet-tdd, /cadet-resume, ...');
  console.log('    Reviewer: /cadet-agent-reviewer');
  console.log('    Git guard: no hook — configure command approval policies for commit/push');
  console.log('    Docs: https://hermes-agent.nousresearch.com/docs/');
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
  const rules = extractionRulesFor(buf, opts);

  const { extracted } = extractArchive(buf, targetDir, {
    limits: ARCHIVE_LIMITS,
    filter: (entry) => {
      if (plan.skip.has(normalizeRel(entry.filename))) return { skip: true };
      if (rules && !findRule(entry.filename, rules)) return { skip: true };
      return true;
    },
    mapPath: rules ? (entry) => mapComponentPath(entry.filename, rules) : null,
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
  const rules = extractionRulesFor(buf, opts);

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
      if (rules && !findRule(entry.filename, rules)) {
        return { skip: true };
      }
      return true;
    },
    mapPath: rules ? (entry) => mapComponentPath(entry.filename, rules) : null,
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

// ── Unity detection and the seeded reachability block ───────────────────────

/** The consumer's policy file — the create-only seed, once installed. */
export function policyFilePath(targetDir) {
  return join(targetDir, '.cadet', 'harness.json');
}

/**
 * Will this run create the policy file, or does the consumer already own one?
 *
 * The answer decides whether the framework may touch it at all: a create-only path
 * is the consumer's from the moment it exists.
 */
export function willCreatePolicyFile(targetDir) {
  return !existsSync(policyFilePath(targetDir));
}

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/**
 * Is this tree a Unity project?
 *
 * Conservative on purpose. Turning reachability on for a project with no engine
 * would ask every story to declare how a user reaches its deliverable in a
 * repository where no user does, and the framework would be guessing. Two markers,
 * the first authoritative:
 *
 *   1. `ProjectSettings/ProjectVersion.txt` — Unity writes it into every project it
 *      creates or opens, so its presence is the strongest signal available offline.
 *   2. `Assets/` together with `Packages/manifest.json` — both Unity-specific, used
 *      only when the first is absent (a project whose ProjectSettings was not yet
 *      committed, for example).
 *
 * Anything else is "not a Unity project", and the caller then leaves the policy
 * file exactly as the package shipped it.
 */
export function detectUnityProject(targetDir) {
  if (existsSync(join(targetDir, 'ProjectSettings', 'ProjectVersion.txt'))) {
    return { unity: true, confidence: 'high', marker: 'ProjectSettings/ProjectVersion.txt' };
  }
  if (isDirectory(join(targetDir, 'Assets')) && existsSync(join(targetDir, 'Packages', 'manifest.json'))) {
    return { unity: true, confidence: 'medium', marker: 'Assets/ + Packages/manifest.json' };
  }
  return { unity: false, confidence: 'none', marker: null };
}

/**
 * Turn the seeded reachability block on, for a NEW Unity consumer.
 *
 * The package cannot know at build time whether the consumer is Unity, so the seed
 * declares `reachability.enabled: false` and this is the one edit made to it after
 * installation. `command` stays null on purpose: the declaration is then checked and
 * the wiring is NOT proven, and `harness verify-reachability` records that fact
 * instead of implying a guarantee it did not establish.
 *
 * The caller decides whether the file is this run's to edit (a consumer that owns a
 * policy file keeps every byte of it — see `willCreatePolicyFile`).
 *
 * Never half-edits: the anchor must match exactly once and the result must still
 * parse, or the file is left byte-identical and the reason is returned for the
 * caller to report.
 */
export function enableReachabilitySeed(targetDir) {
  const path = policyFilePath(targetDir);
  if (!existsSync(path)) return { changed: false, reason: 'the consumer has no policy file to edit' };

  const detection = detectUnityProject(targetDir);
  if (!detection.unity) return { changed: false, reason: 'not a Unity project', detection };

  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    return { changed: false, reason: `the policy file could not be read (${err.message})`, detection };
  }

  // The seeded form, written by the package. A consumer's own file will not match,
  // and that is the point: an unrecognised policy is left alone rather than guessed at.
  //
  // The anchor follows the file's own line ending, and that is a product fix, not tidiness:
  // `core.autocrlf=true` is the default on Windows, this file is matched as TEXT, and the package is
  // built from a working tree — so a consumer installed from a Windows checkout gets CRLF in
  // `.cadet/harness.json`, and the anchor written with `\n` never matched. The seeded Unity project
  // then silently kept `reachability.enabled: false`, which is exactly the gate the seed exists to
  // turn on. CI runs on Linux, where the file is LF, so the suite did not see it. The replacement
  // keeps whichever ending the file already uses, so the edit does not rewrite every line of a
  // consumer's policy file either.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const anchor = `"reachability": {${eol}    "enabled": false`;
  if (text.split(anchor).length - 1 !== 1) {
    return { changed: false, reason: 'the reachability block is not in the seeded form, so it was left as it is', detection };
  }

  const next = text.replace(anchor, `"reachability": {${eol}    "enabled": true`);
  try {
    JSON.parse(next);
  } catch {
    return { changed: false, reason: 'the edit would not parse, so the file was left as it is', detection };
  }

  writeFileSync(path, next, 'utf-8');
  return { changed: true, reason: 'reachability is on for this Unity project', detection };
}

/** Apply the seed rule for a new consumer and report it in one line. */
function reportSeedReachability(targetDir) {
  const result = enableReachabilitySeed(targetDir);
  if (result.changed) {
    console.log(`   Reachability: on for this Unity project (${result.detection.marker}); no probe is configured, so a declaration is a claim rather than a proof`);
  } else if (result.detection?.unity) {
    console.log(`   Reachability: left as seeded (${result.reason})`);
  }
  return result;
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

// ── Component manifest (components.json) ────────────────────────────────────
//
// One manifest decides what an install writes and where. `components.json` is
// authored at the repository root and shipped in the zip, with the suite
// version stamped in by the packager. An archive without the file installs
// everything, which is the behaviour every earlier release had.

export const COMPONENTS_FILE = 'components.json';

function normalizePrefix(p) {
  return String(p || '').replace(/^\.?\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizeInstallTo(p) {
  const n = String(p || '').replace(/\\/g, '/').trim();
  if (n === '' || n === '.' || n === './') return '';
  return n.replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

/** Read `components.json` from the archive. Returns null when the zip has none. */
export function readComponentsFromZip(buf) {
  try {
    const data = readArchiveEntry(buf, COMPONENTS_FILE, ARCHIVE_LIMITS);
    if (!data) return null;
    const manifest = JSON.parse(data.toString('utf-8'));
    return Array.isArray(manifest?.components) ? manifest : null;
  } catch {
    return null;
  }
}

/**
 * Resolve which components this install writes.
 *
 * `opts.components` is a list of ids; absent means every component. A
 * `required` component is always added, and an unsatisfied `requires` is an
 * error rather than a silently partial install.
 */
export function selectComponents(manifest, opts = {}) {
  const all = manifest.components;
  const byId = new Map(all.map((c) => [c.id, c]));
  const ids = opts.components ? [...opts.components] : all.map((c) => c.id);

  for (const c of all) {
    if (c.required && !ids.includes(c.id)) ids.push(c.id);
  }

  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`unknown component(s): ${unknown.join(', ')}`);

  for (const id of ids) {
    for (const required of byId.get(id).requires || []) {
      if (!byId.has(required)) throw new Error(`component ${id} requires ${required}, which this package does not define`);
      if (!ids.includes(required)) throw new Error(`component ${id} requires ${required}; select both`);
    }
  }

  return ids
    .map((id) => byId.get(id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Turn selected components into extraction rules, one per archive path prefix.
 * The longest prefix wins, so a nested component can place its files more
 * precisely than the component that contains it.
 *
 * `exclude` entries accept two forms: a bare name (`PROVENANCE.md`) excludes that
 * name anywhere below the prefix, and a trailing slash (`Tests/`) excludes a
 * folder and everything under it.
 */
export function buildExtractionRules(selected) {
  const rules = [];
  for (const c of selected) {
    for (const raw of c.zipPaths || []) {
      const prefix = normalizePrefix(raw);
      if (!prefix) continue;
      rules.push({
        component: c.id,
        prefix,
        installTo: normalizeInstallTo(c.installTo),
        exclude: (c.exclude || []).map(normalizeExclude),
      });
    }
  }
  return rules.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** Keep a trailing slash: it is what marks an exclude as a folder. */
function normalizeExclude(p) {
  return String(p || '').replace(/^\.?\/+/, '').replace(/\\/g, '/');
}

function normalizeEntryName(filename) {
  return String(filename || '').replace(/^\.?\/+/, '').replace(/\\/g, '/');
}

/** The rule that owns an archive entry, or null when no component claims it. */
export function findRule(filename, rules) {
  const name = normalizeEntryName(filename);
  for (const rule of rules) {
    // An exact match means the component names this file, not a folder above it
    // (`.cadet/harness.json`), so the entry keeps its own name.
    if (name === rule.prefix) return { rule, rest: name };
    if (name.startsWith(rule.prefix + '/')) return { rule, rest: name.slice(rule.prefix.length + 1) };
  }
  return null;
}

/** Destination path for an archive entry, or null when it is not installed. */
export function mapComponentPath(filename, rules) {
  const found = findRule(filename, rules);
  if (!found) return null;
  const { rule, rest } = found;
  if (isExcluded(rest, rule.exclude)) return null;
  // No installTo means the component keeps the archive layout, so the entry
  // keeps its own path rather than the part below the prefix.
  return rule.installTo ? `${rule.installTo}/${rest}` : normalizeEntryName(filename);
}

/** Is this path below the component root excluded from the install? */
function isExcluded(rest, excludes) {
  for (const pattern of excludes) {
    if (!pattern) continue;
    if (pattern.endsWith('/')) {
      const folder = pattern.replace(/\/+$/, '');
      if (rest === folder || rest.startsWith(folder + '/')) return true;
    } else if (rest === pattern || rest.endsWith('/' + pattern)) {
      return true;
    }
  }
  return false;
}

/** Extraction rules for this archive, or null when the archive carries no manifest. */
function extractionRulesFor(buf, opts) {
  const manifest = readComponentsFromZip(buf);
  if (!manifest) return null;
  return buildExtractionRules(selectComponents(manifest, opts));
}

// ── Interactive configuration ───────────────────────────────────────────────

/**
 * The hosts the installer can configure, with the folder that proves one is in
 * use here. `id` is the component id; `aliases` are what a user may type.
 */
export const HOSTS = Object.freeze([
  { id: 'host.copilot', aliases: ['copilot', 'github', 'github-copilot'], label: 'GitHub Copilot', marker: '.github' },
  { id: 'host.claude', aliases: ['claude', 'claude-code'], label: 'Claude Code', marker: '.claude' },
  { id: 'host.agents', aliases: ['agents', 'deepcode', 'deep-code', 'hermes'], label: 'Deep Code / Hermes', marker: '.agents' },
  { id: 'host.cursor', aliases: ['cursor'], label: 'Cursor', marker: '.cursor' },
  { id: 'host.continue', aliases: ['continue'], label: 'Continue', marker: '.continue' },
]);

const ENGINE_COMPONENTS = Object.freeze({
  unity: ['engine.unity.plugin', 'engine.unity.cli'],
  unreal: ['engine.unreal.plugin', 'engine.unreal.cli'],
});

/** Which hosts already have a folder in this project. */
export function detectHosts(targetDir) {
  return HOSTS.filter((h) => existsSync(join(targetDir, h.marker))).map((h) => h.id);
}

/** Accept `claude,hermes` or `host.claude,host.agents` and return component ids. */
export function normalizeHostIds(list = []) {
  const ids = [];
  for (const raw of list) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) continue;
    const host = HOSTS.find((h) => h.id === key || h.aliases.includes(key));
    if (host && !ids.includes(host.id)) ids.push(host.id);
  }
  return ids;
}

/** Map one engine name to its engine list. */
export function normalizeEngines(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'unity') return ['unity'];
  if (v === 'unreal') return ['unreal'];
  if (v === 'both') return ['unity', 'unreal'];
  return [];
}

/**
 * The component ids an answer set implies. Pure, so the wizard, the flags and
 * the tests all use the same mapping.
 */
export function componentsForChoice({ hosts = [], engines = [], plugins = true } = {}) {
  const ids = ['core', ...hosts];
  if (plugins) {
    for (const engine of engines) ids.push(...(ENGINE_COMPONENTS[engine] || []));
  }
  return [...new Set(ids)];
}

const YES = new Set(['', 'y', 'yes', 'true', '1']);
const NO = new Set(['n', 'no', 'false', '0']);

/** Parse a comma-separated numbered answer against a list; empty keeps the default. */
export function parseNumberList(answer, length, fallback = []) {
  const text = String(answer || '').trim();
  if (text === '') return fallback;
  if (/^(none|no)$/i.test(text)) return [];
  const picked = [];
  for (const part of text.split(',')) {
    const n = Number(part.trim());
    if (!Number.isInteger(n) || n < 1 || n > length) continue;
    if (!picked.includes(n - 1)) picked.push(n - 1);
  }
  return picked;
}

/**
 * Walk the four questions and return the component list.
 *
 * Precedence, highest first: `--components` (no questions at all),
 * `--hosts/--engine/--plugins`, the detected defaults (no TTY or `--yes`), then
 * the wizard. The wizard never invents an engine: if nothing is detected it
 * offers the choice and takes the answer.
 */
export async function configureInstall(manifest, targetDir, opts = {}) {
  if (!manifest) {
    return { components: null, source: 'archive-defaults', detected: detectProject(targetDir) };
  }

  const available = new Set(manifest.components.map((c) => c.id));
  const detected = detectProject(targetDir);
  const detectedHosts = detectHosts(targetDir);

  if (opts.components) {
    return {
      components: selectComponents(manifest, { components: opts.components }).map((c) => c.id),
      source: 'components-flag',
      detected,
    };
  }

  if (opts.hosts || opts.engine || opts.plugins !== undefined) {
    const hosts = normalizeHostIds(opts.hosts || detectedHosts).filter((id) => available.has(id));
    const engines = normalizeEngines(opts.engine || (detected.engine === 'both' ? 'both' : detected.engine));
    const components = componentsForChoice({ hosts, engines, plugins: opts.plugins !== false })
      .filter((id) => available.has(id));
    return { components: selectComponents(manifest, { components }).map((c) => c.id), source: 'flags', detected };
  }

  const defaults = selectComponents(manifest, {
    components: componentsForChoice({
      hosts: detectedHosts,
      engines: detected.engines,
      plugins: true,
    }).filter((id) => available.has(id)),
  }).map((c) => c.id);

  if (!canPrompt(opts)) {
    return { components: defaults, source: 'detected', detected, hosts: detectedHosts, engines: detected.engines, plugins: true };
  }

  const ask = opts.ask || promptLine;
  const hosts = await askHosts(ask, detectedHosts);
  const engines = await askEngines(ask, detected);
  const plugins = engines.length > 0 ? await askPlugins(ask, engines) : false;

  const chosen = selectComponents(manifest, {
    components: componentsForChoice({ hosts, engines, plugins }).filter((id) => available.has(id)),
  }).map((c) => c.id);
  console.log('');
  console.log('   Summary');
  for (const id of chosen) {
    const c = manifest.components.find((x) => x.id === id);
    const where = c?.installTo && c.installTo !== '.' ? `  ->  ${c.installTo.replace(/\/$/, '')}` : '';
    console.log(`     ${id.padEnd(22)} ${c?.label || ''}${where}`);
  }
  const confirmed = await ask(`   Write these files? (Y/n): `);
  if (NO.has(String(confirmed || '').trim().toLowerCase())) {
    return { components: chosen, source: 'wizard', cancelled: true, detected, hosts, engines, plugins };
  }
  return { components: chosen, source: 'wizard', detected, hosts, engines, plugins };
}

async function askHosts(ask, detectedHosts) {
  console.log('');
  console.log('   1/4  Which coding tools do you use?');
  HOSTS.forEach((h, i) => {
    const mark = detectedHosts.includes(h.id) ? ' *' : '';
    console.log(`        ${i + 1}. ${h.label}${mark}`);
  });
  const detectedLabels = HOSTS.filter((h) => detectedHosts.includes(h.id)).map((h) => h.label);
  const hint = detectedLabels.length ? detectedLabels.join(', ') : 'none';
  const answer = await ask(`        Numbers, comma separated (Enter = ${hint}): `);
  const picked = parseNumberList(answer, HOSTS.length, detectedHosts.map((id) => HOSTS.findIndex((h) => h.id === id)));
  return picked.map((i) => HOSTS[i].id);
}

async function askEngines(ask, detected) {
  console.log('');
  const label = detected.engine === 'both' ? 'Unity and Unreal' : (detected.engine || 'none detected');
  console.log(`   2/4  Which engine?  unity / unreal / both   (detected: ${label})`);
  const answer = await ask(`        Engine (Enter = ${detected.engine || 'skip'}): `);
  const engines = normalizeEngines(answer);
  if (engines.length) return engines;
  return detected.engines;
}

async function askPlugins(ask, engines) {
  console.log('');
  const answer = await ask(`   3/4  Install the ${engines.join(' + ')} tooling and CLI? (Y/n): `);
  const text = String(answer || '').trim().toLowerCase();
  if (NO.has(text)) return false;
  return YES.has(text) ? true : true;
}

// ── Install record ──────────────────────────────────────────────────────────

export const INSTALL_RECORD_PATH = join('.cadet', 'agent', 'install.json');

export function installRecordPath(targetDir) {
  return join(targetDir, INSTALL_RECORD_PATH);
}

/** The record of what this install wrote, or null when there is none. */
export function readInstallRecord(targetDir) {
  try {
    return JSON.parse(readFileSync(installRecordPath(targetDir), 'utf-8'));
  } catch {
    return null;
  }
}

export function writeInstallRecord(targetDir, record) {
  const path = installRecordPath(targetDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  return path;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Which component owns a file at its installed path.
 *
 * Attribution follows the install roots, not the archive prefixes: the record
 * names `Assets/Covyne/Cadet/Editor/Window.cs`, while the rule that placed it
 * says `packages/unity`. The longest install root wins, and anything outside
 * every engine root belongs to core.
 */
function componentForInstalledPath(rel, components, manifest) {
  const byRoot = [];
  const byArchivePath = [];
  for (const c of manifest?.components || []) {
    if (!components.includes(c.id)) continue;
    const root = normalizeInstallTo(c.installTo);
    if (root) byRoot.push({ component: c.id, prefix: root });
    for (const raw of c.zipPaths || []) {
      const prefix = normalizePrefix(raw);
      if (prefix) byArchivePath.push({ component: c.id, prefix });
    }
  }

  const longest = (entries) => {
    for (const entry of entries.sort((a, b) => b.prefix.length - a.prefix.length)) {
      if (rel === entry.prefix || rel.startsWith(entry.prefix + '/')) return entry.component;
    }
    return null;
  };

  // An install root answers first: `Assets/Covyne/Cadet/...` belongs to the
  // component that put it there, whatever its archive path was.
  const byRootHit = longest(byRoot);
  if (byRootHit) return byRootHit;
  // A component installed in place keeps its archive path, so the archive prefix
  // identifies it: `.claude/...` is Claude Code's, not core's.
  return longest(byArchivePath) || 'core';
}

/**
 * Describe what this run wrote: every file with its hash, the components, the
 * engine, and the roots the components installed into.
 *
 * The hashes are what make uninstall possible without guessing, and what lets a
 * later sync say "12 files changed since install" instead of overwriting in silence.
 */
export function buildInstallRecord({ targetDir, version, components, engine, written, manifest, previous = null }) {
  const byPath = new Map();
  for (const entry of previous?.files || []) {
    if (entry?.path) byPath.set(entry.path, entry);
  }

  for (const absolute of written) {
    const rel = relative(targetDir, absolute).replace(/\\/g, '/');
    byPath.set(rel, {
      path: rel,
      sha256: sha256File(join(targetDir, rel)),
      component: componentForInstalledPath(rel, components, manifest),
    });
  }

  // A file the record names but the disk no longer has was removed by an
  // upgrade or by the consumer. Drop it: a record that lists absent files makes
  // uninstall report failures that are not failures.
  const files = [...byPath.values()]
    .filter((entry) => existsSync(join(targetDir, entry.path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const dirs = [...new Set(
    (manifest?.components || [])
      .filter((c) => components.includes(c.id))
      .map((c) => normalizeInstallTo(c.installTo))
      .filter(Boolean),
  )].sort();

  const targets = {};
  for (const [name, ids] of Object.entries(ENGINE_COMPONENTS)) {
    const selected = ids.filter((id) => components.includes(id));
    if (!selected.length) continue;
    const comp = (manifest?.components || []).find((c) => c.id === selected[0]);
    targets[name] = { pluginRoot: normalizeInstallTo(comp?.installTo) || null };
  }

  const engines = engine?.engines || [];
  return {
    schemaVersion: 1,
    suiteVersion: version || null,
    installedAt: new Date().toISOString(),
    components: [...components].sort(),
    engine: { primary: engines[0] || null, secondary: engines[1] || null },
    targets,
    dirs,
    files,
  };
}

/**
 * Infer the component set from what is on disk, for a project installed before
 * records existed (0.63.x). Probes only paths the framework itself created.
 */
export function inferComponentsFromDisk(targetDir) {
  const ids = ['core'];
  for (const host of HOSTS) {
    if (existsSync(join(targetDir, host.marker))) ids.push(host.id);
  }
  if (isDirectory(join(targetDir, 'Assets', 'Covyne', 'Cadet'))) {
    ids.push('engine.unity.plugin');
    if (existsSync(join(targetDir, 'Assets', 'Covyne', 'Cadet', 'CLI', 'dist.sh'))) ids.push('engine.unity.cli');
  }
  if (existsSync(join(targetDir, 'Plugins', 'CadetBuild', 'CadetBuild.uplugin'))) {
    ids.push('engine.unreal.plugin');
    if (existsSync(join(targetDir, 'Plugins', 'CadetBuild', 'CLI', 'dist.sh'))) ids.push('engine.unreal.cli');
  }
  return ids;
}



// ── Project detection ───────────────────────────────────────────────────────

/**
 * Is this an Unreal project?
 *
 * A `.uproject` at the root is the strong marker. `Source/` plus a
 * `Config/DefaultEngine.ini` is the medium one, and it covers a project whose
 * descriptor is not committed yet.
 */
export function detectUnrealProject(targetDir) {
  const uproject = (() => {
    try {
      return readdirSync(targetDir).find((f) => f.toLowerCase().endsWith('.uproject')) || null;
    } catch {
      return null;
    }
  })();
  if (uproject) return { unreal: true, confidence: 'high', marker: uproject };
  if (isDirectory(join(targetDir, 'Source')) && existsSync(join(targetDir, 'Config', 'DefaultEngine.ini'))) {
    return { unreal: true, confidence: 'medium', marker: 'Source/ + Config/DefaultEngine.ini' };
  }
  return { unreal: false, confidence: 'none', marker: null };
}

/**
 * One answer for "what engine is this project", so the installer asks once.
 * `engine` is 'unity', 'unreal', 'both' or null.
 */
export function detectProject(targetDir) {
  const unity = detectUnityProject(targetDir);
  const unreal = detectUnrealProject(targetDir);
  const engines = [];
  if (unity.unity) engines.push('unity');
  if (unreal.unreal) engines.push('unreal');
  const engine = engines.length === 0 ? null : engines.length === 2 ? 'both' : engines[0];
  return { engine, engines, unity, unreal };
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

  // 3b. Which components does this project own? The record answers. A project
  // installed before records existed is inferred from disk, once, and the
  // inference is written at the end of this run.
  const zipComponents = readComponentsFromZip(zipBuf);
  const record = readInstallRecord(targetDir);
  const components = record?.components?.length
    ? record.components
    : inferComponentsFromDisk(targetDir);
  if (!record?.components?.length) {
    console.log(`   No install record: inferred ${components.length} components from disk`);
  }
  if (zipComponents) {
    const added = zipComponents.components.map((c) => c.id).filter((id) => !components.includes(id));
    if (added.length) {
      console.log(`   Not installed (new in this release): ${added.join(', ')}`);
      console.log('   Add them with: npx cadet-agent@latest init --components <ids>');
    }
  }
  console.log('');

  // 4. Extract with manifest awareness. Create-only paths (e.g. AGENTS.md) are
  // never overwritten when the consumer already has them.
  console.log('📂 Extracting (preserving local policies and plans)...');
  const seededPolicy = willCreatePolicyFile(targetDir);
  const createOnly = readCreateOnlyPathsFromZip(zipBuf);
  const result = await extractZipWithManifest(zipBuf, targetDir, {
    preserved: existingManifest.preservedPaths || [],
    managed: existingManifest.managedPaths || [],
    createOnly,
    components,
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

  // 4d. Same rule as `install`: a consumer that has just received the seed and is a
  // Unity project gets the reachability gate on. A consumer that already owned the
  // file is not touched, which is why this runs only when the seed was written.
  if (seededPolicy) reportSeedReachability(targetDir);

  // 4e. Refresh the record: same components, the new version, and hashes for
  // every file this run wrote. Files the record still names but the disk no
  // longer has are dropped by the builder.
  const refreshed = buildInstallRecord({
    targetDir,
    version: newVersion,
    components,
    engine: detectProject(targetDir),
    written: [...result.updated, ...result.added],
    manifest: zipComponents,
    previous: record,
  });
  writeInstallRecord(targetDir, refreshed);

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
