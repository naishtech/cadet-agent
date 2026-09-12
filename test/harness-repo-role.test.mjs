import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  REPO_ROLES, REPO_ROLE_MARKER, detectRepoRole, isFrameworkSourceWithoutWorkItem, describeRepoRole,
} from '../src/harness/repo-role.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, { cwd = repoRoot } = {}) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function tmpProject() {
  return mkdtempSync(join(tmpdir(), 'cadet-role-'));
}

/** Lay down a framework-source-shaped tree: manifest present, no state, no plans. */
function makeFrameworkSource(dir) {
  mkdirSync(join(dir, '.cadet', 'agent', 'core'), { recursive: true });
  writeFileSync(
    join(dir, '.cadet', 'agent', 'core', 'FrameworkManifest.json'),
    JSON.stringify({ frameworkName: 'Cadet-Agent', frameworkVersion: '0.27.0' }, null, 2),
  );
  return dir;
}

/** Lay down a consumer-project-shaped tree: active state file present. */
function makeConsumer(dir, { withPlans = false } = {}) {
  mkdirSync(join(dir, '.cadet', 'agent', 'core'), { recursive: true });
  writeFileSync(
    join(dir, '.cadet', 'agent', 'core', 'FrameworkManifest.json'),
    JSON.stringify({ frameworkName: 'Cadet-Agent', frameworkVersion: '0.27.0' }, null, 2),
  );
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 2, stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: {}, gates: {}, gateEvidence: [], changeHistory: [],
  }, null, 2));
  if (withPlans) mkdirSync(join(dir, '.cadet', 'agent', 'project-plans'), { recursive: true });
  return dir;
}

describe('repo-role — detection', () => {
  it('reports framework-source when the manifest exists but there is no state or plans', () => {
    const dir = makeFrameworkSource(tmpProject());
    try {
      const info = detectRepoRole(dir);
      assert.equal(info.role, REPO_ROLES.FRAMEWORK);
      assert.equal(info.source, 'structural');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports consumer-project when a state.json exists', () => {
    const dir = makeConsumer(tmpProject());
    try {
      assert.equal(detectRepoRole(dir).role, REPO_ROLES.CONSUMER);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports consumer-project when only project-plans exists', () => {
    const dir = tmpProject();
    try {
      mkdirSync(join(dir, '.cadet', 'agent', 'project-plans'), { recursive: true });
      assert.equal(detectRepoRole(dir).role, REPO_ROLES.CONSUMER);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports unknown for a bare directory with no Cadet install', () => {
    const dir = tmpProject();
    try {
      const info = detectRepoRole(dir);
      assert.equal(info.role, 'unknown');
      assert.equal(info.confidence, 'low');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a marker overrides structural signals and is reported at high confidence', () => {
    // Consumer-shaped tree, but the marker says framework-source.
    const dir = makeConsumer(tmpProject());
    try {
      writeFileSync(join(dir, REPO_ROLE_MARKER), 'framework-source\n');
      const info = detectRepoRole(dir);
      assert.equal(info.role, REPO_ROLES.FRAMEWORK);
      assert.equal(info.source, 'marker');
      assert.equal(info.confidence, 'high');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('ignores a malformed marker and falls back to structural signals', () => {
    const dir = makeFrameworkSource(tmpProject());
    try {
      writeFileSync(join(dir, REPO_ROLE_MARKER), 'nonsense-value\n');
      assert.equal(detectRepoRole(dir).role, REPO_ROLES.FRAMEWORK);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('isFrameworkSourceWithoutWorkItem is false once state exists', () => {
    const dir = makeConsumer(tmpProject());
    try {
      assert.equal(isFrameworkSourceWithoutWorkItem(dir), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('describeRepoRole names the contribution workflow for framework-source', () => {
    assert.match(describeRepoRole({ role: REPO_ROLES.FRAMEWORK }), /CONTRIBUTING\.md/);
  });
});

describe('cli — repo identity reporting', () => {
  it('state validate states the role instead of a bare ok for a missing state file', () => {
    const dir = makeFrameworkSource(tmpProject());
    try {
      const res = runCli(['state', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.exists, false);
      assert.equal(out.repoRole, REPO_ROLES.FRAMEWORK);
      assert.match(out.repoRoleDetail, /CONTRIBUTING\.md/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('state validate reports consumer-project when state exists', () => {
    const dir = makeConsumer(tmpProject());
    try {
      const out = JSON.parse(runCli(['state', 'validate', '--target', dir, '--format', 'json']).stdout);
      assert.equal(out.repoRole, REPO_ROLES.CONSUMER);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('state validate prints the role in human output', () => {
    const dir = makeFrameworkSource(tmpProject());
    try {
      const res = runCli(['state', 'validate', '--target', dir]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /framework-source/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('harness verify reports the repo role in its JSON result', () => {
    const dir = makeConsumer(tmpProject());
    try {
      const res = runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(3)"', '--files', '.cadet/state.json', '--target', dir, '--format', 'json']);
      const out = JSON.parse(res.stdout);
      assert.equal(out.repoRole, REPO_ROLES.CONSUMER);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
