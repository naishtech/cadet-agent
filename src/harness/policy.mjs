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

/**
 * Legal phase transitions (compatibility invariant C4, revised in contract v3).
 *
 * `gates` is unchanged: the v2 frozen list each transition must satisfy.
 * `revalidate` is new in v3 — gates that must be satisfied *again* as a
 * precondition of this transition. It is applied only when
 * `strictClosure.enabled` is true, so with the flag off this table behaves
 * exactly as it did in v2.
 *
 * Why revalidation exists: v2 closure required only
 * `designArtifactSyncConfirmed`, so a gate satisfied early in `implementation`
 * could go stale during a long `review`/`validation` and closure would still
 * succeed. The sets below pin the gates at the point they are cheapest to fix.
 */
export const TRANSITIONS = Object.freeze({
  implementation: {
    to: 'review',
    gates: ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated'],
    revalidate: [],
  },
  review: {
    to: 'validation',
    gates: ['codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated'],
    revalidate: ['testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated'],
  },
  validation: {
    to: 'closed',
    gates: ['designArtifactSyncConfirmed'],
    revalidate: [
      'codeReviewCompleted', 'securityReviewPassed', 'acceptanceCriteriaValidated',
      'testsPassed', 'compileCheckConfirmed', 'unityAnalyzerClean', 'storyTrackingUpdated',
    ],
  },
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

/**
 * Gate-exception taxonomy (contract v3 §4).
 *
 * Two situations that v2 could not distinguish — "this gate cannot be automated
 * here" versus "this work item is a documentation-only change" — need different
 * expiry policies and different levels of review. A category makes that explicit
 * and lets a typo fail loudly instead of classifying as an untyped exception.
 */
export const EXCEPTION_CATEGORIES = Object.freeze([
  'manual-compile',
  'budget-override',
  'analyzer-fallback',
  'unscoped-freshness',
  'documentation-only',
  'tooling-gap',
]);

/** Default expiry (in days) per category. `null` means "no default bound". */
export const EXCEPTION_EXPIRY_DAYS = Object.freeze({
  'manual-compile': 7,
  'budget-override': null,      // scoped to the run that overrode it
  'analyzer-fallback': 30,
  'unscoped-freshness': 1,
  'documentation-only': null,   // scoped to the work item
  'tooling-gap': 14,
});

/** Categories whose exception must carry a closure review note. */
export const EXCEPTION_REQUIRES_REVIEW_NOTE = Object.freeze([
  'manual-compile',
  'budget-override',
  'analyzer-fallback',
  'unscoped-freshness',
  'tooling-gap',
]);

/**
 * Gates that are agent-owned and can never be satisfied by a human assertion,
 * so listing them in `disallowManualFor` would be meaningless. Rejecting them
 * keeps the flag's intent legible (contract v3 §2).
 */
export const AGENT_OWNED_GATES = Object.freeze(['codeReviewCompleted']);

/**
 * Strict-closure policy (contract v3 §2). Absent or `enabled: false` means
 * byte-identical v2 behaviour — the property that makes this opt-in.
 */
export const DEFAULT_STRICT_CLOSURE = Object.freeze({
  enabled: false,
  revalidateOnClosure: true,
  requireFreshRevalidation: true,
  manualConfirmation: Object.freeze({
    requireReason: true,
    requireExpiresAt: true,
    requireEnvironment: true,
    requireScope: true,
    maxValidityMs: 24 * 60 * 60 * 1000,
    // Tolerance for clock skew between the writer and the validator. Without a
    // tolerance, a record created on a machine a few seconds fast would be
    // rejected as future-dated.
    clockSkewToleranceMs: 60 * 1000,
  }),
  disallowManualFor: Object.freeze(['testsPassed']),
});

const STRICT_CLOSURE_KEYS = new Set([
  'enabled', 'revalidateOnClosure', 'requireFreshRevalidation', 'manualConfirmation', 'disallowManualFor',
]);
const MANUAL_CONFIRMATION_KEYS = new Set([
  'requireReason', 'requireExpiresAt', 'requireEnvironment', 'requireScope', 'maxValidityMs',
  'clockSkewToleranceMs',
]);

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
 * Resolve and validate the `strictClosure` policy block (contract v3 §2).
 *
 * Every rejection here is deliberate: a strictness knob that is accepted but
 * never applied is worse than one that is absent, because it lets a reader
 * believe a guarantee exists. `revalidateOnClosure: true` with `enabled: false`
 * is rejected for exactly that reason.
 */
function resolveStrictClosure(raw) {
  if (raw === undefined) return { ...DEFAULT_STRICT_CLOSURE, manualConfirmation: { ...DEFAULT_STRICT_CLOSURE.manualConfirmation }, disallowManualFor: [...DEFAULT_STRICT_CLOSURE.disallowManualFor] };
  if (!isPlainObject(raw)) throw new PolicyError('"strictClosure" must be an object.');

  for (const key of Object.keys(raw)) {
    if (!STRICT_CLOSURE_KEYS.has(key)) {
      throw new PolicyError(`Unknown "strictClosure" key "${key}".`);
    }
  }

  const out = {
    enabled: raw.enabled === true,
    revalidateOnClosure: raw.revalidateOnClosure === undefined ? DEFAULT_STRICT_CLOSURE.revalidateOnClosure : raw.revalidateOnClosure === true,
    requireFreshRevalidation: raw.requireFreshRevalidation === undefined ? DEFAULT_STRICT_CLOSURE.requireFreshRevalidation : raw.requireFreshRevalidation === true,
    manualConfirmation: { ...DEFAULT_STRICT_CLOSURE.manualConfirmation },
    disallowManualFor: raw.disallowManualFor === undefined
      ? [...DEFAULT_STRICT_CLOSURE.disallowManualFor]
      : raw.disallowManualFor,
  };

  for (const key of ['revalidateOnClosure', 'requireFreshRevalidation']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') {
      throw new PolicyError(`"strictClosure.${key}" must be a boolean.`);
    }
  }

  // Contradiction guard: these only take effect when the master switch is on.
  if (out.enabled !== true) {
    for (const key of ['revalidateOnClosure', 'requireFreshRevalidation']) {
      if (raw[key] === true) {
        throw new PolicyError(`"strictClosure.${key}" is true but "strictClosure.enabled" is false; the setting would be inert. Enable strictClosure or remove the override.`);
      }
    }
    if (raw.disallowManualFor !== undefined && raw.disallowManualFor.length > 0) {
      throw new PolicyError('"strictClosure.disallowManualFor" is set but "strictClosure.enabled" is false; the setting would be inert.');
    }
    if (raw.manualConfirmation !== undefined) {
      throw new PolicyError('"strictClosure.manualConfirmation" is set but "strictClosure.enabled" is false; the setting would be inert.');
    }
  }

  if (raw.manualConfirmation !== undefined) {
    if (!isPlainObject(raw.manualConfirmation)) {
      throw new PolicyError('"strictClosure.manualConfirmation" must be an object.');
    }
    for (const key of Object.keys(raw.manualConfirmation)) {
      if (!MANUAL_CONFIRMATION_KEYS.has(key)) {
        throw new PolicyError(`Unknown "strictClosure.manualConfirmation" key "${key}".`);
      }
    }
    for (const key of ['requireReason', 'requireExpiresAt', 'requireEnvironment', 'requireScope']) {
      const v = raw.manualConfirmation[key];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') throw new PolicyError(`"strictClosure.manualConfirmation.${key}" must be a boolean.`);
      out.manualConfirmation[key] = v;
    }
    const mv = raw.manualConfirmation.maxValidityMs;
    if (mv !== undefined) {
      if (mv !== null && (!Number.isInteger(mv) || mv <= 0)) {
        throw new PolicyError('"strictClosure.manualConfirmation.maxValidityMs" must be a positive integer or null.');
      }
      out.manualConfirmation.maxValidityMs = mv;
    }
    const skew = raw.manualConfirmation.clockSkewToleranceMs;
    if (skew !== undefined) {
      if (!Number.isInteger(skew) || skew < 0) {
        throw new PolicyError('"strictClosure.manualConfirmation.clockSkewToleranceMs" must be a non-negative integer.');
      }
      out.manualConfirmation.clockSkewToleranceMs = skew;
    }
  }

  if (!Array.isArray(out.disallowManualFor)) {
    throw new PolicyError('"strictClosure.disallowManualFor" must be an array of gate names.');
  }
  for (const gate of out.disallowManualFor) {
    if (!GATES.includes(gate)) {
      throw new PolicyError(`"strictClosure.disallowManualFor" contains unknown gate "${gate}".`);
    }
    // A gate that is agent-owned can never be manual, so listing it is a no-op
    // that would mislead a reader into thinking a restriction was added.
    if (AGENT_OWNED_GATES.includes(gate)) {
      throw new PolicyError(`"strictClosure.disallowManualFor" cannot contain agent-owned gate "${gate}"; it is never satisfied by manual confirmation.`);
    }
  }
  out.disallowManualFor = [...out.disallowManualFor];

  return out;
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
    'compileCommand', 'testCommand', 'allowEmptyFreshness', 'strictClosure',
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
  const strictClosure = resolveStrictClosure(raw.strictClosure);

  const resolved = {
    budgets,
    archive,
    output,
    retention,
    estimation,
    hook,
    allowBudgetCeilingOverride: allowCeilingOverride,
    allowEmptyFreshness: raw.allowEmptyFreshness === true,
    strictClosure,
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
