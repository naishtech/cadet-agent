/**
 * The formal design review — the gate, its edge, and the artifact contract.
 *
 * This file exists because a gate that cannot fail is decoration. Three failures are
 * possible and each is tested: the gate not being required at all (an empty check),
 * the gate being required on the WRONG edge (the `spikes` route into story
 * breakdown), and the artifact check passing something it should refuse (a contested
 * decision with nobody's name against it).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  parseDesignReviewArtifact, FINDING_DISPOSITIONS, GATES, gateBuilder, MANUAL_ONLY_GATES,
  DESIGN_REVIEW_GATE, DESIGN_REVIEW_TRANSITION_FROM, conditionalEdgeGates, validatePolicy,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args) {
  const res = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true });
  let json = null;
  for (const stream of [res.stdout, res.stderr]) { try { json = JSON.parse(stream); break; } catch { /* other */ } }
  return { status: res.status, json, text: (res.stdout + res.stderr).trim() };
}

const VALID_ARTIFACT = [
  '# Design Review: the tower targeting feature',
  '',
  'Reviewer: the architecture reviewer',
  'Inputs: technical-design.md, requirements.md, ADR-0003',
  'Date: 2026-09-30',
  '',
  '## Findings',
  '',
  '| ID | Finding | Severity | Disposition | Reference |',
  '|---|---|---|---|---|',
  '| DR-1 | The design assumes one tower per lane, which no requirement states | high | accepted | technical-design.md §2.1 |',
  '| DR-2 | Targeting needs line-of-sight, deferred until the collision layer lands | medium | deferred | epic-4::story-2.md |',
  '| DR-3 | The event bus is unnecessary for two listeners | medium | contested | technical-design.md §4 |',
  '',
  '## Resolution',
  '',
  '- DR-3: the owner keeps the event bus for the replay feature — resolved by the owner',
  '',
].join('\n');

function fixture({ enabled = true, phase = 'architectureComplete', artifact = VALID_ARTIFACT, gates = {}, phase2 = null, strict = false, disallowReview = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-review-'));
  mkdirSync(join(dir, '.cadet', 'agent', 'project-plans', 'epic-1'), { recursive: true });
  writeFileSync(join(dir, 'technical-design.md'), '# Technical design\n\nTargeting picks the nearest enemy in the lane.\n');
  writeFileSync(join(dir, 'requirements.md'), '# Requirements\n\nREQ-1: a tower attacks the nearest enemy.\n');
  writeFileSync(join(dir, 'ADR-0003.md'), '# ADR-0003: lane targeting\n');
  writeFileSync(join(dir, 'review.md'), artifact);
  const policy = { designReview: { enabled } };
  if (strict) {
    policy.strictClosure = {
      enabled: true,
      manualConfirmation: { requireReason: true, requireExpiresAt: true, requireEnvironment: true, requireScope: true, maxValidityMs: 86400000 },
    };
    // A consumer may list any gate; this switch reproduces the case where the review
    // gate has been forbidden by hand, which must then be refused.
    if (disallowReview) policy.strictClosure.disallowManualFor = ['designReviewCompleted'];
  }
  writeFileSync(join(dir, '.cadet', 'harness.json'), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify({
    version: 4, stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': 'planned' } } },
    gates, gateEvidence: [], gateExceptions: [], changeHistory: [],
  }, null, 2));
  if (phase2) {
    const s = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
    s.session.currentPhase = phase2;
    writeFileSync(join(dir, '.cadet', 'state.json'), JSON.stringify(s, null, 2));
  }
  return dir;
}

describe('design review — the artifact contract', () => {
  it('reads a well-formed review', () => {
    const p = parseDesignReviewArtifact(VALID_ARTIFACT);
    assert.deepEqual(p.errors, []);
    assert.equal(p.reviewer, 'the architecture reviewer');
    assert.equal(p.findings.length, 3);
    assert.deepEqual(p.contested, ['DR-3']);
    assert.deepEqual(p.resolved, ['DR-3']);
    assert.ok(FINDING_DISPOSITIONS.includes('contested'));
  });

  it('refuses an artifact that shows no review took place', () => {
    const p = parseDesignReviewArtifact('# Notes\n\nWe looked at it and it seems fine.\n');
    const codes = p.errors.map((e) => e.code);
    assert.ok(codes.includes('no-findings-section'));
    assert.ok(codes.includes('no-reviewer'));
    assert.ok(codes.includes('no-inputs'));
  });

  it('refuses a disposition it does not know', () => {
    const p = parseDesignReviewArtifact(VALID_ARTIFACT.replace('| high | accepted |', '| high | looked-at |'));
    assert.deepEqual(p.errors.map((e) => e.code), ['bad-disposition']);
  });

  it('refuses a contested finding with no named resolver — the case the gate exists for', () => {
    const withoutResolution = VALID_ARTIFACT.split('## Resolution')[0] + '## Resolution\n';
    const p = parseDesignReviewArtifact(withoutResolution);
    assert.deepEqual(p.errors.map((e) => e.code), ['contested-unresolved']);

    const unnamed = withoutResolution.replace('## Resolution\n', '## Resolution\n\n- DR-3: the owner keeps it\n');
    assert.deepEqual(parseDesignReviewArtifact(unnamed).errors.map((e) => e.code), ['contested-unresolved'],
      'a resolution with nobody against it is not a resolution');
  });

  it('refuses a disposition that claims something exists elsewhere and names nowhere', () => {
    const p = parseDesignReviewArtifact(VALID_ARTIFACT.replace('| technical-design.md §2.1 |', '| |'));
    assert.deepEqual(p.errors.map((e) => e.code), ['no-reference']);
  });
});

describe('design review — the gate is required, on one edge only', () => {
  it('adds the gate to the design route and to nothing else', () => {
    const on = { designReview: { enabled: true } };
    assert.deepEqual(conditionalEdgeGates('architectureComplete', 'story-breakdown', on), [DESIGN_REVIEW_GATE]);
    assert.deepEqual(conditionalEdgeGates('spikes', 'story-breakdown', on), [],
      'a spike that went straight to breakdown is not a design being approved');
    assert.deepEqual(conditionalEdgeGates('architectureComplete', 'story-breakdown', { designReview: { enabled: false } }), []);
    assert.deepEqual(conditionalEdgeGates('architectureComplete', 'story-breakdown', null), []);
    assert.deepEqual(conditionalEdgeGates(DESIGN_REVIEW_TRANSITION_FROM, 'implementation', on), []);
  });

  it('registers the gate with a contract and no project-command route', () => {
    assert.ok(GATES.includes(DESIGN_REVIEW_GATE));
    const b = gateBuilder(DESIGN_REVIEW_GATE);
    assert.equal(b.owner, 'automated');
    assert.equal(b.projectCommand, false);
    assert.equal(b.manual, true, 'a review is a judgement: the reviewer may record it, agent or human');
    assert.match(b.automatedPath, /harness verify-design-review/);
    assert.equal(MANUAL_ONLY_GATES.includes(DESIGN_REVIEW_GATE), false,
      'it has an automated path, so it is not one of the gates whose only route is manual');
    // The two lists describe different facts and must not be confused: being able to
    // be recorded by hand is not the same as having no automated path.
    assert.equal(validatePolicy({}).strictClosure.disallowManualFor.includes(DESIGN_REVIEW_GATE), false);
  });

  it('is inert until the policy asks for it', () => {
    const dir = fixture({ enabled: false });
    try {
      const r = runCli(['state', 'transition', '--to', 'story-breakdown', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(r.json?.allowed, true, r.text);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('blocks story breakdown until the review is recorded', () => {
    const dir = fixture({ enabled: true });
    try {
      const blocked = runCli(['state', 'transition', '--to', 'story-breakdown', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(blocked.json?.allowed, false);
      assert.deepEqual(blocked.json.missingGates, [DESIGN_REVIEW_GATE]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lets the transition through once the review is recorded, and binds what it reviewed', () => {
    const dir = fixture({ enabled: true });
    try {
      const recorded = runCli(['harness', 'verify-design-review', '--artifact', 'review.md',
        '--files', 'technical-design.md,requirements.md,ADR-0003.md', '--target', dir, '--format', 'json']);
      assert.equal(recorded.status, 0, recorded.text);
      assert.equal(recorded.json.gateSet, true);
      assert.deepEqual(recorded.json.relevantFiles,
        ['review.md', 'technical-design.md', 'requirements.md', 'ADR-0003.md']);

      const allowed = runCli(['state', 'transition', '--to', 'story-breakdown', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(allowed.json?.allowed, true, allowed.text);

      // Freshness is real: change the design and the review is stale.
      writeFileSync(join(dir, 'technical-design.md'), '# Technical design\n\nTargeting picks the FARTHEST enemy.\n');
      const stale = runCli(['state', 'transition', '--to', 'story-breakdown', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(stale.json?.allowed, false, stale.text);
      assert.match(JSON.stringify(stale.json.staleEvidence), /input tree hash changed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to record a review with nothing bound to it', () => {
    const dir = fixture({ enabled: true });
    try {
      const r = runCli(['harness', 'verify-design-review', '--artifact', 'review.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json.code, 'no-inputs-bound');
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.deepEqual(state.gateEvidence || [], []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an unresolved contested finding and records nothing', () => {
    const dir = fixture({ enabled: true, artifact: VALID_ARTIFACT.split('## Resolution')[0] + '## Resolution\n' });
    try {
      const r = runCli(['harness', 'verify-design-review', '--artifact', 'review.md',
        '--files', 'technical-design.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json.code, 'contested-unresolved');
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.deepEqual(state.gateEvidence || [], []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lets a human record the review by hand under strict closure, and opens the edge with it', () => {
    // Strict closure ON is the case that matters: without it the CLI never consults
    // `disallowManualFor`, so a test run without it proves nothing about the list.
    const dir = fixture({ enabled: true, strict: true });
    try {
      const blocked = runCli(['state', 'transition', '--to', 'story-breakdown', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(blocked.json?.allowed, false);

      const recorded = runCli(['harness', 'confirm', '--gate', DESIGN_REVIEW_GATE,
        '--scope', 'epic-1::story-1.md', '--files', 'technical-design.md,requirements.md,review.md',
        '--reason', 'the design review was performed by hand and the artifact is in the plans directory',
        '--environment', 'fixture', '--expires-at', new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        '--target', dir, '--format', 'json']);
      assert.equal(recorded.status, 0, recorded.text);

      const allowed = runCli(['state', 'transition', '--to', 'story-breakdown', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(allowed.json?.allowed, true, allowed.text);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses the hand route when a consumer forbids it, so the switch is real', () => {
    const dir = fixture({ enabled: true, strict: true, disallowReview: true });
    try {
      const r = runCli(['harness', 'confirm', '--gate', DESIGN_REVIEW_GATE,
        '--scope', 'epic-1::story-1.md', '--files', 'technical-design.md',
        '--reason', 'by hand', '--environment', 'fixture',
        '--expires-at', new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'manual-disallowed');
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.deepEqual(state.gateEvidence || [], []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports without recording when the repository has not opted in', () => {
    const dir = fixture({ enabled: false });
    try {
      const r = runCli(['harness', 'verify-design-review', '--artifact', 'review.md',
        '--files', 'technical-design.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.text);
      assert.equal(r.json.gateSet, false);
      assert.equal(r.json.enabled, false);
      const state = JSON.parse(readFileSync(join(dir, '.cadet', 'state.json'), 'utf-8'));
      assert.deepEqual(state.gateEvidence || [], [], 'reported only, state.json unchanged');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not gate the next story inside an epic', () => {
    // The gate is on entering story breakdown, not on re-entering implementation.
    const dir = fixture({ enabled: true, phase: 'validation' });
    try {
      const r = runCli(['state', 'transition', '--to', 'implementation', '--dry-run', '--target', dir, '--format', 'json']);
      assert.equal(r.json?.allowed, true, r.text);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('design review — the policy block', () => {
  it('defaults to off, and rejects an unknown key rather than ignoring it', () => {
    assert.equal(validatePolicy({}).designReview.enabled, false);
    assert.throws(() => validatePolicy({ designReview: { enable: true } }), /Unknown "designReview" key/);
    assert.throws(() => validatePolicy({ designReview: { enabled: 'yes' } }), /must be a boolean/);
  });
});
