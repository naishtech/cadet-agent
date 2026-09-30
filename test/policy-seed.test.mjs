/**
 * The consumer policy seed — what `.cadet/harness.json` declares to a NEW consumer.
 *
 * The package ships the framework's own policy file as a create-only seed (contract C8, and
 * product-plan §5.5). Two failures are possible and both are silent, so this file tests for them:
 *
 *   1. The seed is not a legal policy. `validatePolicy` runs on the consumer's machine, at
 *      `loadPolicy` time, so a malformed seed would break every new consumer's first command.
 *   2. The seed declares a default that does not bind. A policy key spelled differently, or a
 *      rule the CLI never consults, reads as protection and provides none — the exact defect
 *      the seed exists to remove.
 *
 * The extraction and preservation half lives in `sync.test.mjs`, which owns the zip tooling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  validatePolicy, computeInputTreeHash, GATES, gateBuilder, HUMAN_ACCEPTANCE_GATE,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');
const SEED = join(repoRoot, '.cadet', 'harness.json');

const seedPolicy = () => JSON.parse(readFileSync(SEED, 'utf-8'));

function runCli(args) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
  let json = null;
  for (const stream of [res.stdout, res.stderr]) {
    try { json = JSON.parse(stream); break; } catch { /* other stream */ }
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

/** A consumer tree with a state file, and the seed copied in as its policy. */
function makeConsumer({ policy = seedPolicy() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-seed-'));
  mkdirSync(join(dir, '.cadet'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 2,
    stateVersion: 2,
    session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
    gates: {},
    gateEvidence: [],
    changeHistory: [],
  }, null, 2));
  if (policy !== null) {
    writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(policy, null, 2) + '\n');
  }
  return dir;
}

describe('policy seed — the file that ships must be a legal policy', () => {
  it('passes validatePolicy, so a new consumer can load it', () => {
    assert.doesNotThrow(() => validatePolicy(seedPolicy()));
  });

  it('declares strict closure on, which is the point of seeding a file at all', () => {
    const p = validatePolicy(seedPolicy());
    assert.equal(p.strictClosure.enabled, true);
    assert.equal(p.strictClosure.revalidateOnClosure, true);
    // OFF: with it on, every revalidated gate must be re-recorded at every transition even when
    // nothing changed. Measured cost in a real project with the rule on: 26 `testsPassed` records,
    // one per transition, each run costing a Unity editor launch. `revalidateOnClosure` stays on, so
    // a gate whose bound files changed is still refused.
    assert.equal(p.strictClosure.requireFreshRevalidation, false);
    assert.equal(p.strictClosure.manualConfirmation.requireReason, true);
    assert.equal(p.strictClosure.manualConfirmation.requireExpiresAt, true);
    assert.equal(p.strictClosure.manualConfirmation.requireEnvironment, true);
    assert.equal(p.strictClosure.manualConfirmation.requireScope, true);
    assert.equal(p.strictClosure.manualConfirmation.maxValidityMs, 24 * 60 * 60 * 1000);
    // The seed must prohibit manual evidence for exactly the gates the registry
    // marks `manual: false` — a declaration with no enforcement is the defect the
    // seed exists to remove, and this is where the two are made to agree.
    const registrySaysNo = GATES.filter((g) => gateBuilder(g)?.manual === false);
    assert.deepEqual([...p.strictClosure.disallowManualFor].sort(), [...registrySaysNo].sort());
    for (const gate of p.strictClosure.disallowManualFor) {
      assert.ok(GATES.includes(gate), `${gate} must be a real gate`);
    }
    assert.deepEqual([...p.strictClosure.disallowManualFor].sort(),
      ['acceptanceCriteriaValidated', 'architectureFitnessPassed', 'reachabilityAddressed', 'testsPassed']);
  });

  it('declares the reachability block, off, for the Unity detection to turn on', () => {
    const p = validatePolicy(seedPolicy());
    assert.equal(p.reachability.enabled, false);
    assert.equal(p.reachability.command, null);
  });
});

describe('policy seed — the declared defaults actually bind', () => {
  it('demands the strict manual-confirmation metadata', () => {
    const dir = makeConsumer();
    try {
      const res = runCli(['harness', 'confirm', '--gate', 'storyTrackingUpdated',
        '--scope', 'epic-1::story-1.md', '--files', 'src/a.mjs',
        '--reason', 'the story and epic markdown agree with state',
        '--target', dir, '--format', 'json']);
      assert.equal(res.status, 1, `expected refusal: ${res.stdout}${res.stderr}`);
      assert.equal(res.json?.code, 'strict-metadata-missing');
      assert.ok(res.json.missing.includes('--expires-at'), `missing: ${res.json.missing}`);
      assert.ok(res.json.missing.includes('--environment'), `missing: ${res.json.missing}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('caps a manual confirmation at the 24-hour bound the seed declares', () => {
    const dir = makeConsumer();
    try {
      const base = ['harness', 'confirm', '--gate', 'storyTrackingUpdated',
        '--scope', 'epic-1::story-1.md', '--files', 'src/a.mjs', '--environment', 'fixture',
        '--reason', 'the story and epic markdown agree with state', '--target', dir, '--format', 'json'];

      const twoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const tooLong = runCli([...base, '--expires-at', twoDays]);
      assert.equal(tooLong.status, 1);
      assert.equal(tooLong.json?.code, 'validity-exceeded');

      const twelveHours = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const accepted = runCli([...base, '--expires-at', twelveHours]);
      assert.equal(accepted.status, 0, `expected acceptance: ${accepted.stdout}${accepted.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('applies the seed to no consumer that owns its own policy', () => {
    // The override path a consumer uses: its own file, kept byte-for-byte by create-only sync.
    const own = seedPolicy();
    own.strictClosure.manualConfirmation.requireExpiresAt = false;
    own.strictClosure.manualConfirmation.requireEnvironment = false;
    own.strictClosure.manualConfirmation.maxValidityMs = 604800000;
    const dir = makeConsumer({ policy: own });
    try {
      const res = runCli(['harness', 'confirm', '--gate', 'storyTrackingUpdated',
        '--scope', 'epic-1::story-1.md', '--files', 'src/a.mjs',
        '--reason', 'the story and epic markdown agree with state',
        '--target', dir, '--format', 'json']);
      assert.equal(res.status, 0, `a consumer's own policy must win: ${res.stdout}${res.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── Strict closure must reach the transition the CLI performs (audit F7) ─────

describe('policy seed — strict closure binds a CLI transition, not only a module call', () => {
  const IMPLEMENTATION_GATES = ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated'];
  const REVALIDATED = [...IMPLEMENTATION_GATES, 'codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated'];
  const PRIMARY = 'designArtifactSyncConfirmed';
  const workItemId = 'epic-1::story-1.md';

  /**
   * A validation-phase consumer. The earlier gates bind `src/b.mjs`; only the closing
   * gate binds `src/a.mjs`. That split is what makes the strict switch visible at the
   * CLI: without strict closure only the closing gate is re-checked, so editing
   * `src/b.mjs` refuses the transition only when the revalidated set is enforced.
   */
  function validationFixture({ requireFreshRevalidation = false } = {}) {
    const dir = makeConsumer();
    if (requireFreshRevalidation) {
      const p = seedPolicy();
      p.strictClosure.requireFreshRevalidation = true;
      writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(p, null, 2) + '\n');
    }
    writeFileSync(join(dir, 'src', 'b.mjs'), 'export const b = 1;\n');
    const lastTransitionAt = new Date();
    const older = new Date(lastTransitionAt.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    let n = 0;
    const record = (gate, file) => ({
      evidenceId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      workItemId,
      acceptanceCriterionId: null,
      phase: gate === PRIMARY ? 'validation' : 'implementation',
      gate,
      status: 'passed',
      command: 'fixture',
      result: 'exit 0',
      exitCode: 0,
      inputTreeHash: computeInputTreeHash(dir, [file]),
      criteriaHash: 'b'.repeat(64),
      relevantFiles: [file],
      createdAt: older,
      expiresAt: new Date(lastTransitionAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      source: 'automated',
    });
    const state = {
      version: 2,
      stateVersion: 2,
      session: { workflowPath: 'large', currentPhase: 'validation', trackingMode: 'markdown' },
      activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
      epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'in-progress' } } },
      gates: Object.fromEntries(GATES.map((g) => [g, true])),
      gateEvidence: [
        ...REVALIDATED.map((gate) => record(gate, 'src/b.mjs')),
        record(PRIMARY, 'src/a.mjs'),
        // The shipped seed turns human acceptance on, so a consumer closing an epic
        // under it must carry a person's record. It cannot be automated evidence, and
        // the two prose fields are what the record is for.
        {
          ...record(HUMAN_ACCEPTANCE_GATE, 'src/a.mjs'),
          // Accept at validation, then close: the record belongs to the phase before
          // the transition it satisfies, so it is written in `validation`.
          phase: 'validation',
          status: 'manual-confirmation',
          source: 'manual-confirmation',
          command: null,
          exitCode: null,
          witness: 'launched the level and watched the wave advance',
          limitations: 'none',
        },
      ],
      lastTransition: { from: 'review', to: 'validation', at: lastTransitionAt.toISOString() },
      changeHistory: [],
    };
    writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(state, null, 2));
    return dir;
  }

  const dryRun = (dir) => runCli(['state', 'transition', '--to', 'closed', '--dry-run', '--target', dir, '--format', 'json']);
  const touchB = (dir) => writeFileSync(join(dir, 'src', 'b.mjs'), 'export const b = 2;\n');

  it('refuses closure when a gate only strict closure re-checks went stale', () => {
    const dir = validationFixture();
    try {
      const start = dryRun(dir);
      assert.equal(start.json?.allowed, true, `the starting fixture must be closable: ${start.stdout}${start.stderr}`);
      touchB(dir);
      const res = dryRun(dir);
      assert.equal(res.json?.allowed, false, `strict closure must refuse: ${res.stdout}${res.stderr}`);
      assert.ok((res.json.missingGates || []).includes('testsPassed'),
        `expected testsPassed among ${JSON.stringify(res.json.missingGates)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lets the same transition stand with strict closure off, so the refusal came from strict closure', () => {
    const dir = validationFixture();
    try {
      const off = seedPolicy();
      // The strict block reduces to the switch: the validator refuses any other key
      // while it is off, because the setting would be inert.
      off.strictClosure = { enabled: false };
      writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(off, null, 2) + '\n');
      touchB(dir);
      const res = dryRun(dir);
      assert.equal(res.json?.allowed, true, `without strict closure the transition stands: ${res.stdout}${res.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an unchanged tree when the consumer turns the recency rule on', () => {
    // The trade-off the seed decides: with the rule on, a record older than the last
    // transition is refused even though nothing it binds has changed.
    const dir = validationFixture({ requireFreshRevalidation: true });
    try {
      const res = dryRun(dir);
      assert.equal(res.json?.allowed, false, `the recency rule must refuse: ${res.stdout}${res.stderr}`);
      assert.match(JSON.stringify(res.json.staleEvidence || []), /predates the last transition/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
