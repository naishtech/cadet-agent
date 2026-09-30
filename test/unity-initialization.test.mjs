/**
 * Initialization for a Unity consumer — detection, and the one edit made to the
 * seeded policy file.
 *
 * `.cadet/harness.json` ships with `reachability.enabled: false`, because the package
 * cannot know at build time whether the consumer is Unity. A new Unity project gets
 * the gate turned on afterwards. Three things must hold, and each is silent when it
 * does not: a non-Unity project must NOT get the gate (it would ask for declarations
 * in a repository with no user-facing runtime); a consumer that owns its own policy
 * file must NOT be touched at all; and the edit must never leave a half-written or
 * unparseable file behind.
 *
 * The last three cases are the composition-root probe, which is the only thing that
 * can prove the wiring, and the difference the record must show between a
 * declaration-only check and a probe that ran.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { buildMinimalZip } from './helpers/zip.mjs';
import {
  detectUnityProject, enableReachabilitySeed, policyFilePath, willCreatePolicyFile,
  extractZipWithManifest,
} from '../src/install.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');
const SEED = join(repoRoot, '.cadet', 'harness.json');
const MANIFEST = JSON.parse(readFileSync(join(repoRoot, '.cadet', 'agent', 'core', 'FrameworkManifest.json'), 'utf-8'));

const seedText = () => readFileSync(SEED, 'utf-8');

function runCli(args) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
  let json = null;
  for (const stream of [res.stdout, res.stderr]) { try { json = JSON.parse(stream); break; } catch { /* other */ } }
  return { status: res.status, json, text: (res.stdout + res.stderr).trim() };
}

function tmp(name) {
  return mkdtempSync(join(tmpdir(), `cadet-${name}-`));
}

/** A tree marked as a Unity project the way Unity marks one. */
function markUnity(dir, { primary = true } = {}) {
  if (primary) {
    mkdirSync(join(dir, 'ProjectSettings'), { recursive: true });
    writeFileSync(join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.6.0f1\n');
    return;
  }
  mkdirSync(join(dir, 'Assets'), { recursive: true });
  mkdirSync(join(dir, 'Packages'), { recursive: true });
  writeFileSync(join(dir, 'Packages', 'manifest.json'), '{"dependencies":{}}\n');
}

/** A package whose policy content is the seed the repo ships. */
function seedZip() {
  return buildMinimalZip([
    { name: '.cadet/agent/core/FrameworkManifest.json', content: JSON.stringify(MANIFEST) },
    { name: '.cadet/harness.json', content: seedText() },
  ]);
}

function extraction(dir) {
  return extractZipWithManifest(seedZip(), dir, {
    preserved: MANIFEST.preservedPaths,
    managed: MANIFEST.managedPaths,
    createOnly: MANIFEST.createOnlyPaths,
  });
}

describe('unity detection — conservative, and offline', () => {
  it('reads ProjectVersion.txt as the authoritative marker', () => {
    const dir = tmp('unity-high');
    try {
      markUnity(dir);
      const d = detectUnityProject(dir);
      assert.equal(d.unity, true);
      assert.equal(d.confidence, 'high');
      assert.equal(d.marker, 'ProjectSettings/ProjectVersion.txt');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts Assets plus a package manifest only when the authoritative marker is absent', () => {
    const dir = tmp('unity-medium');
    try {
      markUnity(dir, { primary: false });
      const d = detectUnityProject(dir);
      assert.equal(d.unity, true);
      assert.equal(d.confidence, 'medium');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not call an ordinary repository a Unity project', () => {
    const dir = tmp('not-unity');
    try {
      mkdirSync(join(dir, 'Assets'), { recursive: true }); // Assets alone is not enough
      writeFileSync(join(dir, 'README.md'), '# not unity\n');
      const d = detectUnityProject(dir);
      assert.equal(d.unity, false);
      assert.equal(d.confidence, 'none');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the seeded reachability block — one edit, never a half edit', () => {
  it('turns the gate on for a Unity project, changing only that token', () => {
    const dir = tmp('enable');
    try {
      markUnity(dir);
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      writeFileSync(policyFilePath(dir), seedText());

      const result = enableReachabilitySeed(dir);
      assert.equal(result.changed, true);
      assert.equal(result.detection.marker, 'ProjectSettings/ProjectVersion.txt');

      const after = readFileSync(policyFilePath(dir), 'utf-8');
      assert.equal(after, seedText().replace('"reachability": {\n    "enabled": false', '"reachability": {\n    "enabled": true'));
      assert.equal(JSON.parse(after).reachability.enabled, true);
      assert.equal(JSON.parse(after).reachability.command, null, 'no probe is configured, by design');
      // Everything else survived byte-for-byte.
      assert.equal(JSON.parse(after).strictClosure.enabled, true);
      assert.equal(JSON.parse(after).budgets.maxContextTokens.hard, 64000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('is idempotent: a second run has nothing left to change', () => {
    const dir = tmp('idempotent');
    try {
      markUnity(dir);
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      writeFileSync(policyFilePath(dir), seedText());
      assert.equal(enableReachabilitySeed(dir).changed, true);
      const again = enableReachabilitySeed(dir);
      assert.equal(again.changed, false);
      assert.match(again.reason, /not in the seeded form/);
      assert.equal(JSON.parse(readFileSync(policyFilePath(dir), 'utf-8')).reachability.enabled, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves a non-Unity project exactly as seeded', () => {
    const dir = tmp('non-unity');
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      writeFileSync(policyFilePath(dir), seedText());
      const result = enableReachabilitySeed(dir);
      assert.equal(result.changed, false);
      assert.equal(result.reason, 'not a Unity project');
      assert.equal(readFileSync(policyFilePath(dir), 'utf-8'), seedText());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to guess at a policy file it did not write', () => {
    const dir = tmp('foreign');
    try {
      markUnity(dir);
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const own = '{\n  "reachability": {"enabled": false, "command": null}\n}\n';
      writeFileSync(policyFilePath(dir), own);
      const result = enableReachabilitySeed(dir);
      assert.equal(result.changed, false);
      assert.match(result.reason, /not in the seeded form/);
      assert.equal(readFileSync(policyFilePath(dir), 'utf-8'), own, 'byte-identical');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('has nothing to do when the consumer has no policy file', () => {
    const dir = tmp('no-file');
    try {
      markUnity(dir);
      assert.equal(willCreatePolicyFile(dir), true);
      assert.equal(enableReachabilitySeed(dir).changed, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('installation — the seed lands, and only a Unity project has it turned on', () => {
  it('gives a new Unity consumer the gate on', async () => {
    const dir = tmp('install-unity');
    try {
      markUnity(dir);
      const seeded = willCreatePolicyFile(dir);
      assert.equal(seeded, true);
      const result = await extraction(dir);
      assert.equal(result.kept.includes('.cadet/harness.json'), false, 'nothing to keep yet');
      assert.equal(enableReachabilitySeed(dir).changed, true);
      const policy = JSON.parse(readFileSync(policyFilePath(dir), 'utf-8'));
      assert.equal(policy.reachability.enabled, true);
      assert.equal(policy.strictClosure.enabled, true, 'the seed still carries the strict defaults');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves the gate off for a new non-Unity consumer', async () => {
    const dir = tmp('install-plain');
    try {
      writeFileSync(join(dir, 'README.md'), '# a plain repository\n');
      await extraction(dir);
      const policy = JSON.parse(readFileSync(policyFilePath(dir), 'utf-8'));
      assert.equal(policy.reachability.enabled, false);
      assert.equal(enableReachabilitySeed(dir).changed, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never touches a policy file the consumer already owns', async () => {
    const dir = tmp('install-owned');
    try {
      markUnity(dir);
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const own = '{"budgets":{"maxToolCalls":42}}\n';
      writeFileSync(policyFilePath(dir), own);

      assert.equal(willCreatePolicyFile(dir), false, 'the consumer owns the file, so it is not this run\'s to edit');
      const result = await extraction(dir);
      assert.ok(result.kept.includes('.cadet/harness.json'));
      assert.equal(readFileSync(policyFilePath(dir), 'utf-8'), own);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── The probe, and the difference it must make in the record ─────────────────

describe('reachability — the composition-root probe, on a Unity fixture', () => {
  function unityFixture({ withProbe = true, registered = true } = {}) {
    const dir = tmp('probe');
    markUnity(dir);
    mkdirSync(join(dir, '.cadet', 'agent', 'project-plans', 'epic-1'), { recursive: true });
    mkdirSync(join(dir, 'Assets', 'Scripts'), { recursive: true });
    mkdirSync(join(dir, 'Tools'), { recursive: true });
    writeFileSync(join(dir, 'Assets', 'Scripts', 'GameBootstrap.cs'),
      registered
        ? 'class GameBootstrap { void Start() { Register(new TowerSystem()); } }\n'
        : 'class GameBootstrap { void Start() { } }\n');
    writeFileSync(join(dir, 'Tools', 'reachability-probe.mjs'), [
      "import { readFileSync } from 'node:fs';",
      "const src = readFileSync('Assets/Scripts/GameBootstrap.cs', 'utf-8');",
      "if (!src.includes('TowerSystem')) { console.error('the composition root does not register TowerSystem'); process.exit(1); }",
      "console.log('TowerSystem is registered in the composition root');",
    ].join('\n'));
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify({
      reachability: withProbe ? { enabled: true, command: 'node Tools/reachability-probe.mjs' } : { enabled: true, command: null },
    }, null, 2));
    writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
      version: 4, stateVersion: 4,
      session: { workflowPath: 'large', currentPhase: 'review', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
      gates: {}, gateEvidence: [], gateExceptions: [], changeHistory: [],
    }, null, 2));
    writeFileSync(join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', 'story-1.md'),
      '# Story\n\nReachability: witnessed — the player picks the tower from the build menu and it fires.\n');
    return dir;
  }

  const storyPath = '.cadet/agent/project-plans/epic-1/story-1.md';

  it('passes when the composition root registers the system', () => {
    const dir = unityFixture();
    try {
      const r = runCli(['harness', 'verify-reachability', '--story', storyPath, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.text);
      assert.equal(r.json.probe.ok, true);
      assert.equal(r.json.probe.command, 'node Tools/reachability-probe.mjs');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails when the composition root does not register it, and says which check failed', () => {
    const dir = unityFixture({ registered: false });
    try {
      const r = runCli(['harness', 'verify-reachability', '--story', storyPath, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json.code, 'probe-failed');
      assert.equal(r.json.probe.ok, false);
      assert.match(r.json.probe.preview, /does not register TowerSystem/);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.deepEqual(state.gateEvidence || [], [], 'a failed probe must not record evidence');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('records a declaration-only check as unproven rather than as proof', () => {
    const dir = unityFixture({ withProbe: false });
    try {
      const r = runCli(['harness', 'verify-reachability', '--story', storyPath, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.text);
      assert.equal(r.json.probe, null);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const record = state.gateEvidence.find((e) => e.gate === 'reachabilityAddressed');
      assert.ok(record, 'the declaration check records the gate');
      assert.match(record.result, /no project probe configured/);
      assert.equal(record.gateContract, 'reachabilityAddressed@1');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('tells the two apart in the record when the probe DID run', () => {
    const dir = unityFixture();
    try {
      const r = runCli(['harness', 'verify-reachability', '--story', storyPath, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.text);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      const record = state.gateEvidence.find((e) => e.gate === 'reachabilityAddressed');
      assert.match(record.result, /project probe exit 0/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  for (const form of ['relative', 'absolute']) {
    it(`binds the ${form} --story path repo-relative, so the story can go stale`, () => {
      const dir = unityFixture({ withProbe: false });
      try {
        const arg = form === 'relative' ? storyPath : join(dir, storyPath);
        const r = runCli(['harness', 'verify-reachability', '--story', arg, '--target', dir, '--format', 'json']);
        assert.equal(r.status, 0, r.text);
        const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
        const record = state.gateEvidence.find((e) => e.gate === 'reachabilityAddressed');
        assert.deepEqual(record.relevantFiles, [storyPath], 'stored relative to the repository root');

        // The binding is real: edit the story and the record must no longer be fresh.
        writeFileSync(join(dir, '.cadet', 'agent', 'project-plans', 'epic-1', 'story-1.md'),
          '# Story\n\nReachability: witnessed — the player picks the tower and it fires twice over.\n');
        const after = runCli(['state', 'transition', '--to', 'validation', '--dry-run', '--target', dir, '--format', 'json']);
        assert.equal(after.json?.allowed, false, `the record must go stale: ${after.text}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
