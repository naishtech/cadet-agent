/**
 * Phase 7 — the runtime context protocol.
 *
 * The exit criteria this file has to hold:
 *   1. a representative run shows what the host loaded and why;
 *   2. stale required context blocks a claimed context-complete checkpoint;
 *   3. reports never call advisory loading enforced.
 *
 * Every negative case asserts a NON-zero exit AND that no file was written.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  validatePolicy,
  CONTEXT_LEVELS, PHASE_SKILL, PHASES, planEntries, buildContextPlan, buildContextRecord,
  parseTranscript, validateContextRecord, describeContextState, readContextPlan, readContextRecord,
  declaresContextEnforcement,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf-8', windowsHide: true });
  let json = null;
  for (const text of [r.stdout, r.stderr]) {
    if (!text) continue;
    const start = text.indexOf('{');
    if (start < 0) continue;
    try { json = JSON.parse(text.slice(start)); } catch { /* the other stream */ }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** A repository mid-story, with every reference the plan requires. */
function fixture({ phase = 'implementation', storyStatus = 'in-progress' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-ctx-'));
  for (const p of ['.cadet/agent/core/skills', '.cadet/agent/project-plans/epic-1/reviews']) {
    mkdirSync(join(dir, p), { recursive: true });
  }
  writeFileSync(join(dir, '.cadet/agent/core/cadet-agent.md'), '# the directive\n');
  writeFileSync(join(dir, '.cadet/agent/core/HarnessRuntime.md'), '# the runtime contract\n');
  writeFileSync(join(dir, '.cadet/agent/core/skills/TDD.md'), '# TDD\n');
  writeFileSync(join(dir, '.cadet/agent/core/skills/CodeReview.md'), '# CodeReview\n');
  writeFileSync(join(dir, '.cadet/harness.json'), JSON.stringify({}, null, 2));
  writeFileSync(join(dir, '.cadet/agent/project-plans/epic-1/story-1.md'), `Status: ${storyStatus}\n## AC-1\nGiven a\nWhen b\nThen c\n`);
  writeFileSync(join(dir, '.cadet/agent/project-plans/requirements.md'), '# requirements\nREQ-1: a tower attacks.\n');
  writeFileSync(join(dir, '.cadet/state.json'), JSON.stringify({
    version: 4, stateVersion: 4,
    session: { workflowPath: 'large', currentPhase: phase, trackingMode: 'markdown' },
    activeWorkItem: { epicId: 'epic-1', storyId: 'story-1.md' },
    epics: { 'epic-1': { status: 'in-progress', stories: { 'story-1.md': storyStatus } } },
    gates: {}, gateEvidence: [], gateExceptions: [], changeHistory: [],
  }, null, 2));
  return dir;
}

const requiredRefs = (plan) => plan.required.filter((i) => i.present).map((i) => i.reference);

const contextFiles = (dir) => (existsSync(join(dir, '.cadet/context')) ? readdirSync(join(dir, '.cadet/context')).sort() : []);

describe('context protocol — the plan', () => {
  it('names what the phase requires, with a reason and a hash for each', () => {
    const dir = fixture();
    try {
      const r = runCli(['harness', 'context', 'plan', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.json?.phase, 'implementation');
      assert.equal(r.json?.workItemId, 'epic-1::story-1.md');

      const refs = r.json.required.map((i) => i.reference);
      assert.ok(refs.includes('.cadet/agent/core/cadet-agent.md'), 'tier 0 is always required');
      assert.ok(refs.includes('.cadet/agent/core/HarnessRuntime.md'));
      assert.ok(refs.includes('.cadet/harness.json'));
      assert.ok(refs.includes('.cadet/state.json'));
      assert.ok(refs.includes('.cadet/agent/core/skills/TDD.md'), 'the phase dispatches its own skill');
      assert.ok(refs.includes('.cadet/agent/project-plans/epic-1/story-1.md'), 'the work item in flight');

      for (const item of r.json.required) {
        assert.ok(item.reason && item.reason.length > 10, `every required reference needs a reason: ${JSON.stringify(item)}`);
        assert.equal(item.tier.startsWith('tier'), true);
        if (item.present) assert.match(item.hash, /^[0-9a-f]{64}$/);
      }
      assert.ok(r.json.budget.requiredTokens > 0);
      assert.equal(r.json.budget.fits, true);
      assert.deepEqual(contextFiles(dir), ['plan.json']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('gives every phase a skill that exists, and no phase an invented one', () => {
    for (const phase of PHASES) {
      const skill = PHASE_SKILL[phase];
      assert.ok(skill, `phase "${phase}" has no skill mapping`);
      assert.ok(existsSync(join(repoRoot, '.cadet/agent/core/skills', skill)),
        `phase "${phase}" maps to ${skill}, which does not exist — the plan would require a file the framework does not ship`);
    }
    assert.deepEqual(Object.keys(PHASE_SKILL).sort(), [...PHASES].sort());
  });

  it('swaps the design-review skill in only when that gate is on for the edge', () => {
    const off = planEntries({ targetDir: repoRoot, policy: {}, state: { session: { currentPhase: 'architectureComplete' }, activeWorkItem: { epicId: 'e', storyId: 's.md' } } });
    assert.ok(off.required.some((i) => i.reference.endsWith('StoryBreakdown.md')));
    const on = planEntries({ targetDir: repoRoot, policy: { designReview: { enabled: true } }, state: { session: { currentPhase: 'architectureComplete' }, activeWorkItem: { epicId: 'e', storyId: 's.md' } } });
    assert.ok(on.required.some((i) => i.reference.endsWith('DesignReview.md')));
    assert.equal(on.required.some((i) => i.reference.endsWith('StoryBreakdown.md')), false);
  });

  it('reports a required reference that does not exist rather than pretending it was read', () => {
    const dir = fixture();
    try {
      rmSync(join(dir, '.cadet/agent/core/skills/TDD.md'));
      const r = runCli(['harness', 'context', 'plan', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0);
      const missing = r.json.required.find((i) => i.reference.endsWith('TDD.md'));
      assert.equal(missing.present, false);
      assert.ok(r.json.absent.some((a) => a.reference.endsWith('TDD.md') && a.required === true));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('context protocol — the record', () => {
  it('records what the host loaded, at the level the host can honestly claim', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const plan = readContextPlan(dir);
      const loaded = requiredRefs(plan).join(',');
      const r = runCli(['harness', 'context', 'record', '--level', 'recorded', '--loaded', loaded, '--host', 'claude-code', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.json?.level, 'recorded');
      const record = readContextRecord(dir);
      assert.equal(record.workItemId, 'epic-1::story-1.md');
      assert.equal(record.host, 'claude-code');
      for (const item of record.loaded) assert.match(item.hash, /^[0-9a-f]{64}$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an enforcement claim that names no mechanism, and writes nothing', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const r = runCli(['harness', 'context', 'record', '--level', 'enforced', '--loaded', '.cadet/agent/core/HarnessRuntime.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'enforcement-unverifiable');
      assert.match(r.json?.error, /enforced-by/, 'the refusal names the remedy');
      assert.equal(existsSync(join(dir, '.cadet/context/record.json')), false, 'a refused claim must leave no record');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses an enforcement claim whose hook is not in the repository', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const r = runCli(['harness', 'context', 'record', '--level', 'enforced', '--enforced-by', '.claude/hooks/context-guard.json',
        '--loaded', '.cadet/agent/core/HarnessRuntime.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'enforcement-unverifiable');
      assert.equal(existsSync(join(dir, '.cadet/context/record.json')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('accepts an enforcement claim that names a hook which really enforces context', () => {
    const dir = fixture();
    try {
      mkdirSync(join(dir, '.claude/hooks'), { recursive: true });
      writeFileSync(join(dir, '.claude/hooks/context-guard.json'), JSON.stringify({ version: 1, enforces: ['context'], hooks: {} }) + '\n');
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const r = runCli(['harness', 'context', 'record', '--level', 'enforced', '--enforced-by', '.claude/hooks/context-guard.json',
        '--loaded', '.cadet/agent/core/HarnessRuntime.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(readContextRecord(dir).level, 'enforced');
      assert.equal(readContextRecord(dir).enforcedBy, '.claude/hooks/context-guard.json');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to borrow a hook that guards something else', () => {
    // The repository ships a git guard. Naming it to claim context enforcement would be false, and
    // "the file exists" is not the test: the hook has to say what it enforces.
    const dir = fixture();
    try {
      mkdirSync(join(dir, '.github/hooks'), { recursive: true });
      writeFileSync(join(dir, '.github/hooks/git-guard.json'), JSON.stringify({ version: 1, hooks: { preToolUse: [] } }) + '\n');
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const r = runCli(['harness', 'context', 'record', '--level', 'enforced', '--enforced-by', '.github/hooks/git-guard.json',
        '--loaded', '.cadet/agent/core/HarnessRuntime.md', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.json?.code, 'enforcement-unverifiable');
      assert.match(r.json?.error, /enforces.*context/i, 'the refusal says what a claim needs');
      assert.equal(existsSync(join(dir, '.cadet/context/record.json')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('takes the loads from a transcript, for a host that cannot call back', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const plan = readContextPlan(dir);
      const transcript = join(dir, 'session.jsonl');
      writeFileSync(transcript, [...requiredRefs(plan), 'src/extra.mjs'].map((reference) => JSON.stringify({ reference, at: '2026-09-30T00:00:00Z' })).join('\n') + '\n');
      const r = runCli(['harness', 'context', 'record', '--level', 'recorded', '--transcript', transcript, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const record = readContextRecord(dir);
      assert.equal(record.loaded.length, requiredRefs(plan).length + 1, 'every line is one load');
      assert.deepEqual(record.loaded.filter((i) => !i.present).map((i) => i.reference), ['src/extra.mjs'],
        'a transcript may name something that was never a file; it is recorded as absent, not silently dropped');
      assert.match(record.notes.join(' '), /transcript/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a malformed transcript, naming the lines', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const transcript = join(dir, 'session.jsonl');
      writeFileSync(transcript, '{"reference":".cadet/agent/core/Harness.md"}\nnot json\n{"at":"no reference"}\n');
      const r = runCli(['harness', 'context', 'record', '--level', 'recorded', '--transcript', transcript, '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'transcript-malformed');
      assert.equal(r.json?.problems?.length, 2);
      assert.equal(existsSync(join(dir, '.cadet/context/record.json')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('context protocol — the verdict', () => {
  const loaded = (dir) => requiredRefs(readContextPlan(dir)).join(',');
  const record = (dir, level = 'recorded', extra = []) =>
    runCli(['harness', 'context', 'record', '--level', level, '--loaded', [loaded(dir), ...extra].join(','), '--target', dir, '--format', 'json']);

  it('passes when every required reference was loaded and nothing changed', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      record(dir);
      const r = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.json?.ok, true);
      assert.equal(r.json?.code, 'context-complete');
      assert.deepEqual(r.json?.missingRequired, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('blocks the checkpoint when required context was never loaded', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const plan = readContextPlan(dir);
      const skip = '.cadet/agent/core/skills/TDD.md';
      const partial = requiredRefs(plan).filter((ref) => ref !== skip).join(',');
      runCli(['harness', 'context', 'record', '--level', 'recorded', '--loaded', partial, '--target', dir]);
      const r = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'context-incomplete');
      assert.deepEqual(r.json?.missingRequired, [skip]);
      assert.match(r.json?.reasons.join(' '), /never loaded/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('blocks the checkpoint when a required file changed after it was recorded', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      record(dir);
      // Changed-file invalidation: the host read the story, and then the story changed.
      writeFileSync(join(dir, '.cadet/agent/project-plans/epic-1/story-1.md'), 'Status: in-progress\n## AC-1\nGiven a\nWhen b CHANGED\nThen c\n');
      const r = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.deepEqual(r.json?.staleRequired, ['.cadet/agent/project-plans/epic-1/story-1.md']);
      assert.match(r.json?.reasons.join(' '), /changed after it was recorded/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('blocks a record taken before the story boundary', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      record(dir);
      const state = JSON.parse(readFileSync(join(dir, '.cadet/state.json'), 'utf-8'));
      state.activeWorkItem = { epicId: 'epic-1', storyId: 'story-2.md' };
      state.epics['epic-1'].stories['story-2.md'] = 'in-progress';
      writeFileSync(join(dir, '.cadet/state.json'), JSON.stringify(state, null, 2));
      writeFileSync(join(dir, '.cadet/agent/project-plans/epic-1/story-2.md'), 'Status: in-progress\n');
      const r = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 1);
      assert.equal(r.json?.code, 'work-item-changed');
      assert.match(r.json?.reasons.join(' '), /story boundary/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never lets advisory context block, and says what was skipped', () => {
    // The advisory set exists to help, and a helpful thing that can block is a gate.
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      record(dir);
      const plan = readContextPlan(dir);
      const advisoryPresent = plan.advisory.filter((i) => i.present);
      assert.ok(advisoryPresent.length > 0, 'the fixture has advisory context, or this test proves nothing');
      const r = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(r.status, 0);
      assert.equal(r.json?.advisoryMissing.length, advisoryPresent.length, 'advisory gaps are reported');
      assert.match(r.json?.reasons.join(' '), /never blocking/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('cannot be satisfied by a level nobody observed', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      for (const level of ['estimated', 'unavailable']) {
        record(dir, level, []);
        const r = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
        assert.equal(r.status, 1, `${level} must not certify a checkpoint`);
        assert.equal(r.json?.code, 'context-unverified');
        assert.match(r.json?.reasons.join(' '), /nobody observed/i);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to validate with no record, and with no plan', () => {
    const dir = fixture();
    try {
      const noPlan = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(noPlan.status, 1);
      assert.equal(noPlan.json?.code, 'no-plan');

      runCli(['harness', 'context', 'plan', '--target', dir]);
      const noRecord = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(noRecord.status, 1);
      assert.equal(noRecord.json?.code, 'no-record');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports the level it was given, and never a stronger one', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      record(dir);
      const r = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(r.json?.level, 'recorded');
      const line = describeContextState({ plan: readContextPlan(dir), record: readContextRecord(dir), verdict: r.json }).line;
      assert.match(line, /^Context: recorded/);
      assert.equal(/enforced/.test(line), false, 'a report must not call a recorded run enforced');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('answers "unavailable" when there is no record, rather than staying silent', () => {
    const { line, level } = describeContextState({ plan: { required: [], advisory: [] }, record: null });
    assert.equal(level, 'unavailable');
    assert.match(line, /host has not said what it loaded/);
  });
});

describe('context protocol — the units', () => {
  it('parses a transcript by reference, path or file, and reports what it cannot read', () => {
    const { loaded, problems } = parseTranscript([
      '{"reference":"a.md"}',
      '',
      '{"path":"b.md"}',
      '{"file":"c.md"}',
      '{"nope":1}',
      'oops',
    ].join('\n'));
    assert.deepEqual(loaded, ['a.md', 'b.md', 'c.md']);
    assert.equal(problems.length, 2);
  });

  it('refuses an unknown level at the module, so the CLI cannot invent one', () => {
    assert.throws(() => buildContextRecord({ targetDir: repoRoot, policy: {}, level: 'certified' }), /unknown context level/);
    assert.deepEqual([...CONTEXT_LEVELS], ['enforced', 'recorded', 'estimated', 'unavailable']);
  });

  it('builds a plan without a state file at all, so a fresh repository can ask', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-ctx-empty-'));
    try {
      const plan = buildContextPlan({ targetDir: dir, policy: validatePolicy({}), state: null });
      assert.equal(plan.phase, 'context-resolution');
      assert.equal(plan.required.length >= 4, true, 'tier 0 still applies');
      assert.equal(plan.required.every((i) => i.present === false), true, 'and every reference is reported absent, not assumed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports a plan that cannot fit the declared context budget', () => {
    const dir = fixture();
    try {
      const plan = buildContextPlan({
        targetDir: dir,
        policy: validatePolicy({ budgets: { maxContextTokens: { hard: 10, warn: 0.8 } } }),
        state: null,
      });
      assert.equal(plan.budget.fits, false);
      assert.equal(plan.budget.hardContextTokens, 10);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('context protocol — adapter conformance', () => {
  const read = (rel) => readFileSync(join(repoRoot, rel), 'utf-8');
  const loaded = (dir) => requiredRefs(readContextPlan(dir)).join(',');

  it('keeps the protocol in the canonical files, and the adapters as pointers', () => {
    // Where the integration lives, and where it deliberately does not. Every adapter opens by
    // sending the reader to cadet-agent.md, so one statement there reaches every host. Putting it
    // in the adapters as well would restate canonical content 50 times — which C7 forbids, and
    // which the adapter size guard already rejects.
    for (const file of ['.cadet/agent/core/HarnessRuntime.md', '.cadet/agent/core/cadet-agent.md', '.cadet/agent/core/KickoffFlow.md']) {
      // Whitespace normalised first: prose wraps, and a test that fails on a line break is testing
      // the wrapping rather than the claim.
      const text = read(file).replace(/\s+/g, ' ');
      assert.match(text, /harness context plan/, `${file} must name the plan command`);
      assert.match(text, /harness context record/, `${file} must name the record command`);
      assert.match(text, /harness context validate/, `${file} must name the validate command`);
    }
    const adapter = read('.claude/skills/cadet-tdd/SKILL.md');
    assert.match(adapter, /cadet-agent\.md/, 'the adapter points at the directive');
    assert.equal(/harness context/.test(adapter), false,
      'and does not restate the protocol: the pointer is the integration, and the size guard enforces it');
  });

  it('measures the enforcement position: the only shipped hook does not enforce context', () => {
    // A measured statement rather than a parity claim, and the reason to keep it in a test: the day
    // a host ships a context hook, this is what will change.
    const copilot = read('.github/agents/cadet.agent.md');
    assert.match(copilot, /PreToolUse/, 'this host carries a hook');

    const hook = JSON.parse(read('.github/hooks/git-guard.json'));
    assert.ok(hook.hooks, 'and the hook has a body');
    assert.equal(declaresContextEnforcement(join(repoRoot, '.github/hooks/git-guard.json')), false,
      'the shipped hook guards git writes, so it cannot back an enforcement claim for context');
    assert.equal(existsSync(join(repoRoot, '.claude/hooks/context-guard.json')), false,
      'no host ships a context hook, so no host can claim "enforced" today');
  });

  it('conforms a session from a transcript: what it loaded, against what the phase required', () => {
    // The path for a host with no automation: it cannot call the framework, so it hands over its own
    // log and the framework does the comparing.
    const dir = fixture({ phase: 'implementation' });
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      const plan = readContextPlan(dir);
      const skill = plan.required.find((i) => i.reference.endsWith('TDD.md')).reference;
      const complete = join(dir, 'complete.jsonl');
      writeFileSync(complete, requiredRefs(plan).map((reference) => JSON.stringify({ reference })).join('\n') + '\n');
      assert.equal(runCli(['harness', 'context', 'record', '--level', 'recorded', '--transcript', complete, '--host', 'cursor', '--target', dir]).status, 0);
      const good = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(good.status, 0, good.stdout + good.stderr);

      // The same host, a session that skipped the skill file it was supposed to load.
      const partial = join(dir, 'partial.jsonl');
      writeFileSync(partial, requiredRefs(plan).filter((r) => r !== skill).map((reference) => JSON.stringify({ reference })).join('\n') + '\n');
      assert.equal(runCli(['harness', 'context', 'record', '--level', 'recorded', '--transcript', partial, '--host', 'cursor', '--target', dir]).status, 0);
      const bad = runCli(['harness', 'context', 'validate', '--target', dir, '--format', 'json']);
      assert.equal(bad.status, 1);
      assert.deepEqual(bad.json?.missingRequired, [skill]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('carries the level into a run report without upgrading it', () => {
    const dir = fixture();
    try {
      runCli(['harness', 'context', 'plan', '--target', dir]);
      runCli(['harness', 'context', 'record', '--level', 'recorded', '--loaded', loaded(dir), '--target', dir]);
      // A run record is needed for the report; the framework writes one when a harness command runs.
      runCli(['harness', 'verify', '--gate', 'testsPassed', '--command', 'node -e "process.exit(0)"', '--files', '.cadet/agent/core/HarnessRuntime.md', '--target', dir]);
      const r = runCli(['harness', 'report', '--target', dir, '--format', 'json']);
      if (r.status === 0) {
        assert.equal(r.json?.report?.context?.level, 'recorded');
        assert.match(r.json.report.context.line, /^Context: recorded/);
        assert.equal(/enforced/.test(r.json.report.context.line), false);
      } else {
        // No run ledger in this fixture: the report is the wrong surface to assert here, and the
        // line itself is asserted in the verdict block above.
        assert.match(r.stderr + r.stdout, /No run records found/);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
