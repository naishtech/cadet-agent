/**
 * The runtime context protocol: plan, record, validate.
 *
 * Cadet does not inject context into a model — hosts own model context. What the framework can
 * do is state what a phase REQUIRES, let a host report what it actually loaded, and compare the
 * two. That comparison is the whole point: "the agent read the skill file" is otherwise an
 * assertion nobody can check, and an assertion nobody can check is how a workflow becomes
 * ceremony.
 *
 * Four levels, and the difference between them is who can vouch for the loads:
 *
 *   - `enforced`  — a hook blocked substantive action until the plan was loaded, and the record
 *                   names the hook. The claim is refused unless that file exists: a host without
 *                   a hook cannot claim enforcement, and saying so is more useful than pretending
 *                   every host is equal.
 *   - `recorded`  — the host reported what it loaded. Observed, but not prevented.
 *   - `estimated` — nobody reported; the plan is used to infer what was probably loaded. Useful
 *                   for a post-hoc reading, and never a pass.
 *   - `unavailable` — there is no information at all.
 *
 * `ContextManifest` does the work — hashes, sizes, dedup, budget — so a plan and a record are the
 * same kind of object as every other manifest this framework keeps. This module adds only the
 * rules: what a phase requires, what a record may claim, and when the two disagree.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ContextManifest } from './context.mjs';
import { sha256, timestamp } from './util.mjs';

/** The levels a record may carry, strongest first. */
export const CONTEXT_LEVELS = Object.freeze(['enforced', 'recorded', 'estimated', 'unavailable']);

/** Where the active plan and record live. Preserved: `sync` never touches them. */
export const CONTEXT_DIR = '.cadet/context';
export const CONTEXT_PLAN_FILE = 'plan.json';
export const CONTEXT_RECORD_FILE = 'record.json';

export class ContextProtocolError extends Error {
  constructor(message, code = 'context-protocol') {
    super(message);
    this.name = 'ContextProtocolError';
    this.code = code;
  }
}

/**
 * Which skill governs each phase.
 *
 * This mirrors the Skill Inventory in `.cadet/agent/core/cadet-agent.md`, and a test asserts that
 * every phase has an entry and every named file exists. It is a table rather than a convention so
 * that a phase with no skill is a visible omission instead of a silent gap.
 */
export const PHASE_SKILL = Object.freeze({
  'context-resolution': 'Resume.md',
  requirements: 'Requirements.md',
  requirementsComplete: 'Requirements.md',
  architecture: 'Architecture.md',
  architectureComplete: 'DesignReview.md',
  spikes: 'Spike.md',
  'story-breakdown': 'StoryBreakdown.md',
  implementation: 'TDD.md',
  review: 'CodeReview.md',
  validation: 'Resume.md',
  closed: 'Resume.md',
});

/** The runtime contract every phase reads. */
const HARNESS_CONTRACT = '.cadet/agent/core/Harness.md';
const KICKOFF = '.cadet/agent/core/cadet-agent.md';

const normalise = (path) => String(path).replace(/\\/g, '/').replace(/^\.\//, '');

/** Read a JSON file, or null when it is absent or unreadable. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function entry(reference, { tier, reason, authority, required }) {
  return { reference: normalise(reference), tier, reason, authority, required };
}

/**
 * What the current phase requires, and what merely helps.
 *
 * Required means: a context-complete checkpoint cannot be claimed without it. The list is derived
 * from state and the framework's own layout rather than from a new policy key, because a policy
 * that restates the framework's folder conventions is another thing to keep in step.
 */
export function planEntries({ targetDir, policy, state = null }) {
  const phase = state?.session?.currentPhase || 'context-resolution';
  const required = [];
  const advisory = [];

  required.push(entry(KICKOFF, {
    tier: 'tier0', reason: 'always-load: the directive that routes every other decision', authority: 'framework', required: true,
  }));
  required.push(entry(HARNESS_CONTRACT, {
    tier: 'tier0', reason: 'the runtime contract for gates, evidence and budgets', authority: 'framework', required: true,
  }));
  for (const ref of ['.cadet/harness.json', '.cadet/state.json']) {
    required.push(entry(ref, {
      tier: 'tier0', reason: 'the active policy and the session state the phase reads', authority: 'session', required: true,
    }));
  }

  // The phase's own instruction: the skill the dispatch table names.
  const skillFile = phase === 'architectureComplete' && policy?.designReview?.enabled !== true
    ? 'StoryBreakdown.md'
    : PHASE_SKILL[phase];
  if (skillFile) {
    required.push(entry(join('.cadet/agent/core/skills', skillFile), {
      tier: 'tier1', reason: `the skill this phase dispatches (${phase})`, authority: 'framework', required: true,
    }));
  }

  // The work item in flight, and the epic it belongs to.
  const epicId = state?.activeWorkItem?.epicId || null;
  const storyId = state?.activeWorkItem?.storyId || null;
  if (epicId && storyId) {
    required.push(entry(join('.cadet/agent/project-plans', epicId, storyId), {
      tier: 'tier1', reason: 'the active story: its status, its acceptance criteria, its reachability', authority: 'session', required: true,
    }));
  }
  if (epicId) {
    advisory.push(entry(join('.cadet/agent/project-plans', epicId, 'Epic.md'), {
      tier: 'tier1', reason: 'the epic this story belongs to', authority: 'repository', required: false,
    }));
  }

  // Everything that helps and nothing that blocks: the artifacts a reader wants nearby.
  if (epicId && storyId) {
    advisory.push(entry(join('.cadet/agent/project-plans', epicId, 'reviews', storyId.replace(/\.md$/, '-review.md')), {
      tier: 'tier2', reason: 'a review of this story, when one exists', authority: 'repository', required: false,
    }));
  }
  for (const ref of ['requirements.md', 'technical-design.md']) {
    advisory.push(entry(join('.cadet/agent/project-plans', ref), {
      tier: 'tier2', reason: 'planning context the phase may reason about', authority: 'repository', required: false,
    }));
  }

  return { phase, required, advisory };
}

/**
 * Build the plan: the entries above, resolved through `ContextManifest` so each carries its hash,
 * size, estimated tokens and budget effect.
 */
export function buildContextPlan({ targetDir, policy, state = null } = {}) {
  const { phase, required, advisory } = planEntries({ targetDir, policy, state });

  // A plan is a READING, not a load, and the load bounds must not bound it.
  //
  // Two bounds apply to a real load — the per-step expansion limit and the context-token hard
  // limit — and both throw when exceeded, because a step that would blow the budget must not
  // proceed. A plan exists to answer whether the budget is blown, so it has to be able to look
  // past the limit and report it. Hence: measure with the limit lifted, compare with the real
  // limit, and put the answer in `budget.fits`.
  //
  // `policy` must be a resolved policy (as `loadPolicy`/`validatePolicy` return it): the budget
  // tracker reads `scopes`, and a partially built object is not a policy.
  const planningPolicy = {
    ...policy,
    budgets: policy?.budgets
      ? { ...policy.budgets, maxContextTokens: { ...(policy.budgets.maxContextTokens || {}), hard: null, warn: null } }
      : policy?.budgets,
  };
  const manifest = new ContextManifest({ policy: planningPolicy, rootDir: targetDir, maxExpansionPerStep: 128 });
  const resolved = { required: [], advisory: [] };
  const absent = [];

  for (const [group, list] of Object.entries({ required, advisory })) {
    for (const item of list) {
      const present = existsSync(join(targetDir, item.reference));
      if (!present) {
        absent.push({ reference: item.reference, required: item.required });
        resolved[group].push({ ...item, present: false, hash: null, bytes: 0, estimatedTokens: 0 });
        continue;
      }
      const { item: loaded } = manifest.load({
        reference: item.reference,
        tier: item.tier,
        reason: item.reason,
        authority: item.authority,
        step: 'plan',
      });
      resolved[group].push({ ...item, present: true, hash: loaded.hash, bytes: loaded.bytes, estimatedTokens: loaded.estimatedTokens });
    }
  }

  const requiredTokens = resolved.required.reduce((a, i) => a + i.estimatedTokens, 0);
  const advisoryTokens = resolved.advisory.reduce((a, i) => a + i.estimatedTokens, 0);
  const hard = policy?.budgets?.maxContextTokens?.hard ?? null;
  const requiredBytes = resolved.required.reduce((a, i) => a + i.bytes, 0);

  return {
    workItemId: state?.activeWorkItem ? `${state.activeWorkItem.epicId}::${state.activeWorkItem.storyId}` : null,
    phase,
    plannedAt: timestamp(),
    required: resolved.required,
    advisory: resolved.advisory,
    absent,
    denied: manifest.manifest().denied,
    budget: {
      requiredBytes,
      requiredTokens,
      advisoryTokens,
      totalTokens: requiredTokens + advisoryTokens,
      hardContextTokens: hard,
      // The honest number: a plan that cannot be loaded inside the budget is a plan the host
      // will silently truncate, so it is reported rather than left to be discovered.
      fits: hard === null ? null : requiredTokens <= hard,
    },
  };
}

/** Write the plan, and say where it went. */
export function writeContextPlan(targetDir, plan) {
  const path = join(targetDir, CONTEXT_DIR, CONTEXT_PLAN_FILE);
  mkdirSync(join(targetDir, CONTEXT_DIR), { recursive: true });
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  return path;
}

/** Read the plan file, or null. */
export function readContextPlan(targetDir) {
  return readJson(join(targetDir, CONTEXT_DIR, CONTEXT_PLAN_FILE));
}

/** Read the record file, or null. */
export function readContextRecord(targetDir) {
  return readJson(join(targetDir, CONTEXT_DIR, CONTEXT_RECORD_FILE));
}

/**
 * Build a record of what the host loaded.
 *
 * `loaded` is a list of references. Each is hashed AT RECORD TIME, which is what makes a later
 * edit detectable: validate compares that hash with the file's, so "the agent read the skill file
 * and then the file changed" is a stale read rather than an invisible one.
 */
export function buildContextRecord({
  targetDir, policy, state = null, plan = null, level = 'recorded',
  loaded = [], enforcedBy = null, host = null, notes = [], now = new Date(),
} = {}) {
  if (!CONTEXT_LEVELS.includes(level)) {
    throw new ContextProtocolError(`unknown context level "${level}" (expected one of ${CONTEXT_LEVELS.join(', ')})`, 'unknown-level');
  }
  // A host without a hook cannot claim enforcement. Rather than downgrade the claim silently —
  // which would let a false statement into the record and read as a pass — the claim is refused
  // and the remedy named.
  if (level === 'enforced') {
    if (!enforcedBy) {
      throw new ContextProtocolError(
        'a context record may claim "enforced" only by naming the hook that enforced it: pass --enforced-by <path to the hook>. '
        + 'A host without a hook records the plan as "recorded" instead, which says what was observed without claiming it was prevented.',
        'enforcement-unverifiable',
      );
    }
    const hookPath = join(targetDir, normalise(enforcedBy));
    if (!existsSync(hookPath)) {
      throw new ContextProtocolError(
        `the record names "${enforcedBy}" as the enforcing hook, and that file does not exist in this repository. `
        + 'An enforcement claim has to name a mechanism that is really there.',
        'enforcement-unverifiable',
      );
    }
    // Existing is not enough, and this is the difference between a claim the framework checks and
    // one it takes on trust: a repository with a git guard has a hook file, and naming it to claim
    // context enforcement would be false. The hook must DECLARE that it enforces context, so
    // "hosts without hooks cannot claim enforced context" is enforced rather than asserted.
    if (!declaresContextEnforcement(hookPath)) {
      throw new ContextProtocolError(
        `"${enforcedBy}" exists but does not declare that it enforces context. A hook that guards something else `
        + 'is not a context mechanism: declare "{\"enforces\": [\"context\"]}" in the hook file to make the claim, '
        + 'or record the run as "recorded", which says what was observed without claiming it was prevented.',
        'enforcement-unverifiable',
      );
    }
  }

  const manifest = new ContextManifest({ policy, rootDir: targetDir, maxExpansionPerStep: 128 });
  const resolved = [];
  for (const reference of loaded.map(normalise)) {
    const present = existsSync(join(targetDir, reference));
    if (!present) {
      resolved.push({ reference, present: false, hash: null, bytes: 0, estimatedTokens: 0 });
      continue;
    }
    const { item } = manifest.load({ reference, tier: 'tier1', reason: 'reported as loaded by the host', authority: 'host', step: 'record' });
    resolved.push({ reference, present: true, hash: item.hash, bytes: item.bytes, estimatedTokens: item.estimatedTokens });
  }

  const itemId = state?.activeWorkItem ? `${state.activeWorkItem.epicId}::${state.activeWorkItem.storyId}` : null;
  return {
    recordedAt: now.toISOString(),
    workItemId: itemId,
    phase: state?.session?.currentPhase || null,
    level,
    enforcedBy: enforcedBy ? normalise(enforcedBy) : null,
    host: host || null,
    loaded: resolved,
    plannedRequired: (plan?.required || []).map((i) => i.reference),
    notes: [...notes],
  };
}

/** Write the record. */
export function writeContextRecord(targetDir, record) {
  const path = join(targetDir, CONTEXT_DIR, CONTEXT_RECORD_FILE);
  mkdirSync(join(targetDir, CONTEXT_DIR), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  return path;
}

/** Parse a host transcript: one JSON object per line, each naming a `reference`. */
export function parseTranscript(text) {
  const loaded = [];
  const problems = [];
  for (const [i, line] of String(text).split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      problems.push(`line ${i + 1} is not JSON (${err.message})`);
      continue;
    }
    const reference = parsed.reference || parsed.path || parsed.file;
    if (typeof reference !== 'string' || reference.trim() === '') {
      problems.push(`line ${i + 1} names no reference`);
      continue;
    }
    loaded.push(normalise(reference));
  }
  return { loaded, problems };
}

/**
 * Compare the plan, the record and the files as they are now.
 *
 * The verdict answers one question: could a context-complete checkpoint be claimed? Only when
 * every required reference was loaded, nothing required has changed since, the record belongs to
 * the work item in flight, and the level is one that observes rather than infers.
 */
export function validateContextRecord({ targetDir, plan, record }) {
  const required = plan?.required || [];
  const advisory = plan?.advisory || [];
  const reasons = [];

  if (!record) {
    return {
      ok: false, level: null, code: 'no-record',
      missingRequired: required.filter((i) => i.present).map((i) => i.reference),
      staleRequired: [], advisoryMissing: advisory.filter((i) => i.present).map((i) => i.reference),
      reasons: ['no context record exists: run "cadet-agent harness context record" after loading the plan, or the checkpoint cannot be claimed'],
    };
  }

  // Work-item invalidation: a record from a previous story says nothing about this one.
  if (record.workItemId && plan?.workItemId && record.workItemId !== plan.workItemId) {
    return {
      ok: false, level: record.level, code: 'work-item-changed',
      missingRequired: required.filter((i) => i.present).map((i) => i.reference),
      staleRequired: [], advisoryMissing: [],
      reasons: [`the record belongs to ${record.workItemId}, and the active work item is ${plan.workItemId}: it was taken before the story boundary, so it describes different context`],
    };
  }

  // An enforcement claim whose mechanism has gone is no longer an enforcement claim.
  if (record.level === 'enforced' && (!record.enforcedBy || !existsSync(join(targetDir, record.enforcedBy)))) {
    reasons.push(`the record claims enforcement by "${record.enforcedBy || '(nothing)'}", which is not in the repository: the claim cannot stand`);
    return { ok: false, level: record.level, code: 'enforcement-unverifiable', missingRequired: [], staleRequired: [], advisoryMissing: [], reasons };
  }

  const loadedByRef = new Map((record.loaded || []).map((i) => [i.reference, i]));
  const missingRequired = [];
  const staleRequired = [];
  for (const item of required) {
    if (!item.present) continue; // an absent file is a plan problem, reported separately
    const loaded = loadedByRef.get(item.reference);
    if (!loaded) {
      missingRequired.push(item.reference);
      continue;
    }
    // Hash comparison: the file changed after the host says it read it.
    const current = existsSync(join(targetDir, item.reference)) ? loadedNowHash(targetDir, item.reference) : null;
    if (current !== null && loaded.hash !== current) staleRequired.push(item.reference);
  }

  const advisoryMissing = advisory.filter((i) => i.present && !loadedByRef.has(i.reference)).map((i) => i.reference);
  const absentRequired = required.filter((i) => !i.present).map((i) => i.reference);

  // An inferred level cannot certify a checkpoint. "Not verified" and "verified clean" must not
  // look the same, which is the same rule `state validate --verify-sealed` follows.
  if (record.level === 'estimated' || record.level === 'unavailable') {
    reasons.push(`the record's level is "${record.level}": nobody observed what was loaded, so a context-complete checkpoint cannot be claimed from it`);
    return { ok: false, level: record.level, code: 'context-unverified', missingRequired, staleRequired, advisoryMissing, reasons };
  }

  if (missingRequired.length > 0) reasons.push(`required context was never loaded: ${missingRequired.join(', ')}`);
  if (staleRequired.length > 0) reasons.push(`required context changed after it was recorded: ${staleRequired.join(', ')}`);
  if (absentRequired.length > 0) reasons.push(`the plan requires references that do not exist in this repository: ${absentRequired.join(', ')} — the plan is wrong, not the host`);
  if (advisoryMissing.length > 0) {
    reasons.push(`advisory context was not loaded (reported, never blocking): ${advisoryMissing.join(', ')}`);
  }

  const ok = missingRequired.length === 0 && staleRequired.length === 0 && absentRequired.length === 0;
  return {
    ok,
    level: record.level,
    code: ok ? 'context-complete' : 'context-incomplete',
    missingRequired, staleRequired, advisoryMissing, absentRequired,
    reasons,
  };
}

/**
 * Does this hook file declare context enforcement?
 *
 * The declaration is a JSON field — `"enforces": ["context"]` — because a claim needs a mechanism
 * that says what it does. Left as prose it would be unverifiable, and an unverifiable enforcement
 * claim is exactly the kind of assertion this framework exists to refuse.
 */
export function declaresContextEnforcement(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    const declared = parsed?.enforces ?? parsed?.hooks?.enforces;
    return Array.isArray(declared) && declared.map((d) => String(d).toLowerCase()).includes('context');
  } catch {
    return false;
  }
}

/** The current hash of a file, for the staleness comparison. */
function loadedNowHash(targetDir, reference) {
  try {
    return sha256(readFileSync(join(targetDir, reference)));
  } catch {
    return null;
  }
}

/**
 * A short reading for a report: the level, and what is missing or stale.
 *
 * It never upgrades a level. A report that calls advisory loading "enforced" is worse than no
 * report, because the reader stops looking.
 */
export function describeContextState({ plan, record, verdict = null }) {
  if (!record) {
    return { level: 'unavailable', line: 'Context: unavailable — no record; the host has not said what it loaded.' };
  }
  const required = (plan?.required || []).filter((i) => i.present).length;
  const loaded = (record.loaded || []).filter((i) => i.present).length;
  const bits = [`Context: ${record.level}`, `${loaded}/${required} required loaded`];
  if (verdict) {
    if (verdict.missingRequired?.length) bits.push(`missing: ${verdict.missingRequired.join(', ')}`);
    if (verdict.staleRequired?.length) bits.push(`stale: ${verdict.staleRequired.join(', ')}`);
    if (verdict.advisoryMissing?.length) bits.push(`advisory not loaded: ${verdict.advisoryMissing.length}`);
  }
  return { level: record.level, line: `${bits.join(' — ')}.` };
}
