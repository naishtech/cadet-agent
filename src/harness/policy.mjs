/**
 * Cadet-Agent harness policy.
 *
 * Loads hard-coded conservative defaults, optionally overlays a repository-local
 * `.cadet/harness.json`, validates the merged result, and exposes the resolved
 * budget/limit policy used by every other harness module.
 *
 * Contract: docs/core/HarnessContract.md §3. Phase names and gate names are frozen
 * compatibility invariants — this module may validate them but must not rename them.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Frozen phase names (compatibility invariant C1). */
export const PHASES = Object.freeze([
  'context-resolution',
  'requirements',
  'requirementsComplete',
  'architecture',
  'architectureComplete',
  'spikes',
  'story-breakdown',
  'implementation',
  'review',
  'validation',
  'closed',
]);

/** Frozen gate names (compatibility invariant C3). */
export const GATES = Object.freeze([
  'codeReviewCompleted',
  'testsPassed',
  'storyTrackingUpdated',
  'compileCheckConfirmed',
  'unityAnalyzerClean',
  'acceptanceCriteriaValidated',
  'securityReviewPassed',
  'designArtifactSyncConfirmed',
]);

/** Legal phase transitions (compatibility invariant C4). */
export const TRANSITIONS = Object.freeze({
  implementation: { to: 'review', gates: ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated'] },
  review: { to: 'validation', gates: ['codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated'] },
  validation: { to: 'closed', gates: ['designArtifactSyncConfirmed'] },
});

/** Evidence statuses. */
export const EVIDENCE_STATUSES = Object.freeze(['passed', 'failed', 'blocked', 'manual-confirmation', 'superseded']);

/** Retry classes. */
export const RETRY_CLASSES = Object.freeze(['deterministic', 'transient', 'repair', 'unknown']);

/** Context tiers. */
export const CONTEXT_TIERS = Object.freeze(['tier0', 'tier1', 'tier2', 'tier3']);

const MIB = 1024 * 1024;

/**
 * Conservative default budgets. Every value is validated at load time.
 * `hard` is the hard-stop threshold; `warn` is the soft-warning threshold (fraction 0..1).
 */
export const DEFAULT_BUDGETS = Object.freeze({
  maxContextTokens:       { hard: 64000,    warn: 0.80, unit: 'tokens' },
  maxOutputTokens:        { hard: 8000,     warn: 0.80, unit: 'tokens' },
  maxToolCalls:           { hard: 80,       warn: 0.75, unit: 'calls' },
  maxRetriesPerStep:      { hard: 2,        warn: null, unit: 'retries' },
  maxTotalRetries:        { hard: 8,        warn: 0.75, unit: 'retries' },
  maxWallClockMs:         { hard: 30 * 60 * 1000, warn: 0.80, unit: 'ms' },
  maxEstimatedCostUsd:    { hard: 2.00,     warn: 0.80, unit: 'usd' },
  maxDownloadedBytes:     { hard: 25 * MIB, warn: 0.80, unit: 'bytes' },
  maxDecompressedBytes:   { hard: 100 * MIB, warn: 0.80, unit: 'bytes' },
  maxArchiveFiles:        { hard: 2000,     warn: 0.80, unit: 'files' },
});

/**
 * Hard safety ceilings. A repository override may raise a hard limit only when an
 * explicit compatibility flag is set; it may never lower one below the default
 * without the same explicit flag (contract §3, plan §5.3).
 */
export const HARD_CEILINGS = Object.freeze({
  maxDownloadedBytes: 100 * MIB,
  maxDecompressedBytes: 500 * MIB,
  maxArchiveFiles: 10000,
  maxWallClockMs: 4 * 60 * 60 * 1000,
});

/** Default archive-safety limits (Phase 6 consumes these). */
export const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxCompressedBytes: 25 * MIB,
  maxDecompressedBytes: 100 * MIB,
  maxFiles: 2000,
  maxFilenameBytes: 240,
  maxCompressionRatio: 100,
});

/** Default tool-output and retention policy. */
export const DEFAULT_OUTPUT_POLICY = Object.freeze({
  maxInlineBytes: 64 * 1024,
  previewBytes: 4 * 1024,
});

export const DEFAULT_RETENTION = Object.freeze({
  keepOnFailure: true,
  retainRunRecords: false,
  retainRawPrompt: false,
});

/** Default token/cost estimation policy. */
export const DEFAULT_ESTIMATION = Object.freeze({
  bytesPerToken: 3,
  // Known rate cards keyed by model id. Absence of a card => no USD is reported.
  rateCards: Object.freeze({}),
});

/** Git-guard hook behavior. */
export const DEFAULT_HOOK_POLICY = Object.freeze({
  mode: 'ask-on-recognized-write', // or 'fail-open' (opt-in, visible)
});

const BUDGET_KEYS = Object.keys(DEFAULT_BUDGETS);

class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolicyError';
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/**
 * Validate a single budget override. Returns the normalized entry or throws PolicyError.
 */
function validateBudgetOverride(key, value, defaults) {
  const def = defaults[key];
  if (!def) {
    throw new PolicyError(`Unknown budget key "${key}".`);
  }
  if (isPlainObject(value)) {
    const out = { ...def };
    for (const field of Object.keys(value)) {
      if (field !== 'hard' && field !== 'warn') {
        throw new PolicyError(`Budget "${key}" has unknown field "${field}".`);
      }
      const fv = value[field];
      if (field === 'hard') {
        if (!isFiniteNumber(fv) || fv < 0) {
          throw new PolicyError(`Budget "${key}.hard" must be a non-negative finite number.`);
        }
        out.hard = fv;
      } else {
        if (fv !== null && (!isFiniteNumber(fv) || fv < 0 || fv > 1)) {
          throw new PolicyError(`Budget "${key}.warn" must be null or a fraction between 0 and 1.`);
        }
        out.warn = fv;
      }
    }
    return out;
  }
  if (!isFiniteNumber(value) || value < 0) {
    throw new PolicyError(`Budget "${key}" must be a non-negative finite number or an object.`);
  }
  return { ...def, hard: value };
}

/**
 * A project may never lower a hard safety ceiling, and may only exceed it with an
 * explicit compatibility flag.
 */
function enforceCeilings(resolved, { allowCeilingOverride = false } = {}) {
  for (const [key, ceiling] of Object.entries(HARD_CEILINGS)) {
    const value = resolved.budgets[key]?.hard;
    if (value === undefined) continue;
    if (value > ceiling && !allowCeilingOverride) {
      throw new PolicyError(
        `Budget "${key}" (${value}) exceeds the hard safety ceiling (${ceiling}). ` +
        `Set allowBudgetCeilingOverride in .cadet/harness.json to opt in explicitly.`
      );
    }
  }
}

/**
 * Parse and validate a repository harness policy document.
 * Unknown top-level keys are rejected so misconfiguration fails loudly.
 */
export function validatePolicy(raw, defaults = DEFAULT_BUDGETS) {
  if (!isPlainObject(raw)) {
    throw new PolicyError('Harness policy must be a JSON object.');
  }
  const allowed = new Set([
    '$schema',
    'budgets', 'archive', 'output', 'retention', 'estimation', 'hook',
    'allowBudgetCeilingOverride', 'scopes', 'model', 'analyzerCommand',
    'compileCommand', 'testCommand', 'allowEmptyFreshness',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new PolicyError(`Unknown harness policy key "${key}".`);
    }
  }

  const budgets = {};
  for (const [key, def] of Object.entries(defaults)) {
    budgets[key] = { ...def };
  }
  if (raw.budgets !== undefined) {
    if (!isPlainObject(raw.budgets)) {
      throw new PolicyError('"budgets" must be an object.');
    }
    for (const [key, value] of Object.entries(raw.budgets)) {
      budgets[key] = validateBudgetOverride(key, value, defaults);
    }
  }

  const archive = { ...DEFAULT_ARCHIVE_LIMITS, ...(raw.archive || {}) };
  for (const [key, value] of Object.entries(raw.archive || {})) {
    if (!(key in DEFAULT_ARCHIVE_LIMITS)) {
      throw new PolicyError(`Unknown archive limit "${key}".`);
    }
    if (!isNonNegativeInt(value)) {
      throw new PolicyError(`Archive limit "${key}" must be a non-negative integer.`);
    }
  }

  const output = { ...DEFAULT_OUTPUT_POLICY, ...(raw.output || {}) };
  for (const [key, value] of Object.entries(raw.output || {})) {
    if (!(key in DEFAULT_OUTPUT_POLICY)) {
      throw new PolicyError(`Unknown output policy key "${key}".`);
    }
    if (!isNonNegativeInt(value)) {
      throw new PolicyError(`Output policy "${key}" must be a non-negative integer.`);
    }
  }

  const retention = { ...DEFAULT_RETENTION, ...(raw.retention || {}) };
  for (const [key, value] of Object.entries(raw.retention || {})) {
    if (!(key in DEFAULT_RETENTION)) {
      throw new PolicyError(`Unknown retention key "${key}".`);
    }
    if (typeof value !== 'boolean') {
      throw new PolicyError(`Retention "${key}" must be a boolean.`);
    }
  }

  const estimation = {
    ...DEFAULT_ESTIMATION,
    ...(raw.estimation || {}),
    rateCards: { ...(raw.estimation?.rateCards || {}) },
  };
  if (!isNonNegativeInt(estimation.bytesPerToken) || estimation.bytesPerToken < 1) {
    throw new PolicyError('"estimation.bytesPerToken" must be a positive integer.');
  }

  const hook = { ...DEFAULT_HOOK_POLICY, ...(raw.hook || {}) };
  if (!['ask-on-recognized-write', 'fail-open'].includes(hook.mode)) {
    throw new PolicyError('"hook.mode" must be "ask-on-recognized-write" or "fail-open".');
  }

  const allowCeilingOverride = raw.allowBudgetCeilingOverride === true;

  const resolved = {
    budgets,
    archive,
    output,
    retention,
    estimation,
    hook,
    allowBudgetCeilingOverride: allowCeilingOverride,
    allowEmptyFreshness: raw.allowEmptyFreshness === true,
    scopes: raw.scopes || { perRun: {}, perStory: {} },
    model: raw.model || null,
    analyzerCommand: raw.analyzerCommand || null,
    compileCommand: raw.compileCommand || null,
    testCommand: raw.testCommand || null,
  };

  if (raw.scopes !== undefined) {
    if (!isPlainObject(raw.scopes)) throw new PolicyError('"scopes" must be an object.');
    for (const scope of ['perRun', 'perStory']) {
      const s = raw.scopes[scope];
      if (s === undefined) continue;
      if (!isPlainObject(s)) throw new PolicyError(`"scopes.${scope}" must be an object.`);
      for (const [key, value] of Object.entries(s)) {
        const v = validateBudgetOverride(key, isPlainObject(value) ? value.hard ?? value : value, defaults);
        if (value !== null && isPlainObject(value) && value.warn !== undefined) {
          if (value.warn !== null && (!isFiniteNumber(value.warn) || value.warn < 0 || value.warn > 1)) {
            throw new PolicyError(`"scopes.${scope}.${key}.warn" must be null or a fraction between 0 and 1.`);
          }
        }
        s[key] = v.hard;
      }
    }
  }

  enforceCeilings(resolved, { allowCeilingOverride });

  return resolved;
}

/** Returns the built-in default policy, fully validated. */
export function defaultPolicy() {
  return validatePolicy({});
}

export function policyPath(targetDir) {
  return join(targetDir, '.cadet', 'harness.json');
}

/**
 * Load the resolved policy for a repository. Missing file => defaults.
 * Malformed/unknown-typed policy throws PolicyError rather than silently degrading.
 */
export function loadPolicy(targetDir, { defaults = DEFAULT_BUDGETS } = {}) {
  const path = policyPath(targetDir);
  if (!existsSync(path)) {
    return { ...validatePolicy({}, defaults), sourcePath: null };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new PolicyError(`Failed to parse ${path}: ${err.message}`);
  }
  return { ...validatePolicy(raw, defaults), sourcePath: path };
}

/** Resolve the effective budget for a scope, applying per-run/per-story overrides. */
export function budgetForScope(policy, scope = 'perRun') {
  const budgets = {};
  for (const [key, def] of Object.entries(policy.budgets)) {
    budgets[key] = { ...def };
  }
  const overrides = policy.scopes?.[scope] || {};
  for (const [key, value] of Object.entries(overrides)) {
    if (budgets[key]) budgets[key] = { ...budgets[key], hard: value };
  }
  return budgets;
}

/** Warning threshold for a budget, or null when the budget has no warning. */
export function warnThreshold(def) {
  if (def.warn === null || def.warn === undefined) return null;
  return def.hard * def.warn;
}

export { PolicyError, BUDGET_KEYS, MIB };
