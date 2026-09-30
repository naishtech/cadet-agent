#!/usr/bin/env node
/**
 * Demonstration: install into clean fixtures, with no published release.
 *
 * `cadet-agent init` and `sync` download the PUBLISHED release, so the install path cannot normally
 * be exercised before a version bump. This driver removes that dependency without removing the
 * install path from the test: it serves the locally built `cadet-agent.zip` from a double of the
 * release API and points the real CLI at it with `--source`. Everything downstream of the download
 * is the shipped code — the extraction, the policy seed, Unity detection, the create-only rule, the
 * repo-role marker.
 *
 * The only thing left unexercised is GitHub's own API and the asset hosting, which is what a
 * published release adds.
 *
 * Usage:  node scripts/demonstrations/install-walk.mjs [--keep]
 * Exits non-zero if any expectation fails.
 */

import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/** Scratch space: the caller's TMPDIR when set, so probes stay out of the system temp directory. */
const scratchRoot = process.env.TMPDIR || process.env.BH_AGENT_WORKSPACE || tmpdir();

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');
const zipPath = join(repoRoot, 'cadet-agent.zip');
const keep = process.argv.includes('--keep');

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};

/**
 * Run the CLI and WAIT for it. It must be asynchronous: this process serves the release double, so a
 * blocking spawn would leave the child's own download request unanswered until the child exited.
 */
const run = (args, cwd) => new Promise((resolve) => {
  const child = spawn('node', [cli, ...args], { cwd, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

/** git init, which cannot recurse into the server and so can stay synchronous. */
const gitInit = (dir) => spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', '.'], { cwd: dir, encoding: 'utf-8' });

/** A minimal double of the GitHub release API, serving the locally built asset. */
async function serveRelease() {
  const zip = readFileSync(zipPath);
  const server = createServer((req, res) => {
    if (req.url.includes('/releases/latest')) {
      const port = server.address().port;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        tag_name: 'v0.0.0-local',
        assets: [{ name: 'cadet-agent.zip', browser_download_url: `http://127.0.0.1:${port}/cadet-agent.zip` }],
      }));
      return;
    }
    if (req.url.includes('cadet-agent.zip')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(zip.length) });
      res.end(zip);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/releases/latest` };
}

/** A clean Node repository: nothing but a package.json, which is what a new consumer has. */
function nodeFixture() {
  const dir = join(scratchRoot, `cadet-demo-node-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'clean-node-fixture', version: '1.0.0' }, null, 2));
  gitInit(dir);
  return dir;
}

/** A clean Unity repository: the shape the framework detects, and nothing Cadet-specific. */
function unityFixture() {
  const dir = join(scratchRoot, `cadet-demo-unity-${Date.now()}`);
  mkdirSync(join(dir, 'ProjectSettings'), { recursive: true });
  mkdirSync(join(dir, 'Assets', 'Scripts'), { recursive: true });
  mkdirSync(join(dir, 'Packages'), { recursive: true });
  writeFileSync(join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.40f1\n');
  writeFileSync(join(dir, 'Packages', 'manifest.json'), JSON.stringify({ dependencies: { 'com.unity.test-framework': '1.3.9' } }, null, 2));
  gitInit(dir);
  return dir;
}

function policyOf(dir) {
  const p = join(dir, '.cadet', 'harness.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

async function walk(label, make, { unity }) {
  console.log(`\n── ${label} ─────────────────────────────────────────────`);
  const dir = make();
  const { server, url } = await serveRelease();
  try {
    console.log(`   fixture: ${dir}`);
    const init = await run(['init', '--yes', '--source', url], dir);
    check(init.status === 0, 'init exits 0', init.status !== 0 ? (init.stderr || init.stdout).trim().slice(0, 200) : '');
    if (init.status !== 0) return;

    // The framework's own files arrived.
    const skills = join(dir, '.cadet', 'agent', 'core', 'skills');
    const skillFiles = existsSync(skills) ? readdirSync(skills).filter((f) => f.endsWith('.md')) : [];
    check(skillFiles.length >= 10, 'canonical skills extracted', `${skillFiles.length} files`);
    check(existsSync(join(dir, '.cadet', 'agent', 'core', 'Harness.md')), 'the harness contract extracted');
    check(existsSync(join(dir, '.githooks', 'pre-commit')), 'the portable Git hook extracted');
    check(existsSync(join(dir, 'AGENTS.md')), 'the root pointer file extracted');

    // The seed, and the two opt-ins.
    const policy = policyOf(dir);
    check(policy !== null, 'the policy seed is valid JSON');
    check(policy?.designReview?.enabled === true, 'design-review gate seeded on');
    check(policy?.humanAcceptance?.enabled === true, 'human-acceptance gate seeded on');
    check(policy?.reachability?.enabled === (unity === true),
      `reachability seeded ${unity ? 'on (Unity project detected)' : 'off (not a Unity project)'}`,
      `got ${policy?.reachability?.enabled}`);

    // Nothing is tracked yet, and the framework says so rather than inventing a document: init
    // installs the framework, and the first work item is what creates state.
    const validator = await run(['state', 'validate', '--target', dir], repoRoot);
    check(validator.status === 0 && /nothing to validate/.test(validator.stdout),
      'state validate reports a missing document without failing (it is a reader)',
      `exit ${validator.status}`);

    // The first-run dead end, as a check: `state begin` refused, and until `state init` existed
    // there was no command that could satisfy it — the only route was a hand-written document.
    const blocked = await run(['state', 'begin', '--epic', 'DEMO-1', '--story', 'story-1.md', '--target', dir], repoRoot);
    check(blocked.status !== 0 && /Initialise state before starting a work item/.test(blocked.stdout + blocked.stderr),
      'and a command that needs state refuses until it exists', `exit ${blocked.status}`);

    const initState = await run(['state', 'init', '--workflow-path', 'large', '--tracking-mode', 'markdown', '--target', dir], repoRoot);
    check(initState.status === 0, 'state init creates the first document',
      initState.status !== 0 ? (initState.stderr || initState.stdout).trim().slice(0, 200) : '');
    const begin = await run(['state', 'begin', '--epic', 'DEMO-1', '--story', 'story-1.md', '--target', dir], repoRoot);
    check(begin.status === 0, 'state begin starts the first work item',
      begin.status !== 0 ? (begin.stderr || begin.stdout).trim().slice(0, 200) : '');
    check(existsSync(join(dir, '.cadet', 'state.json')), 'the work item is recorded in state.json');
    const validate = await run(['state', 'validate', '--target', dir], repoRoot);
    check(validate.status === 0, 'the created state document validates', (validate.stdout || '').trim().split('\n')[0]);
    const transition = await run(['state', 'transition', '--to', 'story-breakdown', '--dry-run', '--target', dir], repoRoot);
    check(transition.status !== 0, 'a gated transition is refused while its gates are unmet',
      `exit ${transition.status}`);
    // The install is usable: the CLI runs against it and reports the measured matrix.
    const caps = await run(['harness', 'capabilities', '--target', dir, '--verify-host', '--format', 'json'], repoRoot);
    let capsJson = null;
    try { capsJson = JSON.parse((caps.stdout || '').slice((caps.stdout || '').indexOf('{'))); } catch { /* reported below */ }
    check(caps.status === 0 && capsJson !== null, 'harness capabilities runs against the fixture');
    check(capsJson?.enforcement?.verified === true, 'the host matrix is measured in the fixture');
    const gitWrite = capsJson?.enforcement?.rows?.find((r) => r.host === 'copilot')?.actions?.['git-write'];
    check(gitWrite?.level === 'native' && gitWrite?.establishedBy === 'probe',
      'the fixture measures Copilot git-write as native by probe', `${gitWrite?.level}/${gitWrite?.establishedBy}`);

    // The create-only rule: a consumer edit survives a sync. This is the property that makes
    // re-running sync safe, and it is worth demonstrating rather than asserting.
    const edited = policy;
    edited.reachability = { ...(edited.reachability || {}), enabled: false, demoEdit: 'consumer-owned' };
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(edited, null, 2));
    const beforeBytes = readFileSync(join(dir, '.cadet', 'harness.json'), 'utf-8');
    const sync = await run(['sync', '--yes', '--source', url], dir);
    const afterBytes = readFileSync(join(dir, '.cadet', 'harness.json'), 'utf-8');
    check(sync.status === 0, 'sync exits 0',
      sync.status !== 0 ? (sync.stderr || sync.stdout).trim().slice(0, 200) : '');
    check(afterBytes.includes('consumer-owned'),
      'the consumer edit survived the sync (create-only respected)',
      afterBytes === beforeBytes ? 'the file is byte-identical' : 'the file changed');

    const rolePath = join(dir, '.cadet', '.repo-role');
    const role = existsSync(rolePath) ? readFileSync(rolePath, 'utf-8').trim() : null;
    check(role === 'consumer-project', 'the repository is marked as a consumer project', String(role));
  } finally {
    server.close();
    if (!keep) rmSync(dir, { recursive: true, force: true });
    else console.log(`   kept: ${dir}`);
  }
}

console.log('Install demonstration — the real init and sync paths, against the locally built package');
console.log(`package: ${zipPath}`);
if (!existsSync(zipPath)) {
  console.error('cadet-agent.zip is missing: run the packaging script first (pwsh -File package-agent.ps1).');
  process.exit(2);
}
console.log(`zip size: ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);

await walk('clean Node fixture', nodeFixture, { unity: false });
await walk('clean Unity fixture', unityFixture, { unity: true });

console.log(`\n${failures === 0 ? 'All expectations held.' : `${failures} expectation(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
