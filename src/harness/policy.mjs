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
  // APPENDED, never reordered: C3 forbids renaming a gate, and every recorded
  // name must keep its meaning. This one is additionally OPT-IN — see
  // REACHABILITY_GATE and DEFAULT_REACHABILITY below.
  'reachabilityAddressed',
  // APPENDED by the design-review change. Also OPT-IN, and required on exactly one
  // edge — see DESIGN_REVIEW_GATE / DESIGN_REVIEW_TRANSITION_FROM.
  'designReviewCompleted',
  // APPENDED by the human-acceptance change. HUMAN-OWNED: no reviewer's record can
  // stand in for the person who accepts the work. OPT-IN, and required only when an
  // epic closes — see HUMAN_ACCEPTANCE_GATE.
  'humanAcceptanceConfirmed',
  // APPENDED by the architecture-fitness change. OPT-IN, and required only when the
  // project has declared checks — see ARCHITECTURE_GATE.
  'architectureFitnessPassed',
]);

/**
 * The gate that is required only when a repository enables the reachability
 * policy.
 *
 * WHY IT IS CONDITIONAL RATHER THAN SIMPLY REQUIRED. Every existing consumer has
 * stories written before the declaration existed, so making this mandatory at
 * the matrix level would block every in-flight story on a framework update — the
 * one thing a compatibility-preserving change must not do. The precedent is
 * `strictClosure` and `allowEmptyFreshness`: a new guarantee ships behind a
 * switch whose OFF state is byte-identical to the previous behaviour.
 *
 * WHAT TURNS IT ON: `reachability.enabled` in `.cadet/harness.json`. When it is
 * on, `review -> validation` requires this gate; when it is off (the default)
 * the gate list is exactly what it was before this gate existed.
 */
export const REACHABILITY_GATE = 'reachabilityAddressed';

/**
 * The transition (`from` phase) the reachability gate attaches to: entering
 * `validation`, i.e. `review -> validation`. Named rather than inlined because
 * the placement is a decision, and a later edit that silently moved it to
 * implementation would ask for the wiring before the story has been reviewed.
 */
export const REACHABILITY_TRANSITION_FROM = 'review';

/**
 * Default reachability policy (contract v6 §2).
 *
 * `enabled: false` is deliberate and load-bearing: it is what makes adopting
 * this framework version a no-op for a repository that has not opted in.
 * `command: null` means no project-owned probe is configured, in which case the
 * declaration is checked and the CLI states plainly that the wiring itself was
 * not proven — rather than implying a guarantee it did not establish.
 */
export const DEFAULT_REACHABILITY = Object.freeze({
  enabled: false,
  command: null,
});

/**
 * The formal design-review gate.
 *
 * It guards ONE edge: from a completed design into story breakdown. A review that
 * runs after the work items exist cannot remove work; a review that runs before them
 * is the last point at which "do not build this" is still cheap, which is the whole
 * reason the gate exists.
 */
export const DESIGN_REVIEW_GATE = 'designReviewCompleted';

/** The `from` phase the design-review gate attaches to (`-> story-breakdown`). */
export const DESIGN_REVIEW_TRANSITION_FROM = 'architectureComplete';

/**
 * Default design-review policy.
 *
 * `enabled: false` keeps adopting this framework version a no-op for a repository
 * that has not asked for the review gate — the same property `reachability` and
 * `strictClosure` have. The shipped policy file for a NEW consumer turns it on,
 * which is where a new project meets the review; an existing consumer owns its own
 * file and therefore its own answer.
 */
export const DEFAULT_DESIGN_REVIEW = Object.freeze({
  enabled: false,
});

/**
 * The human-acceptance gate.
 *
 * It answers a question no test can: did a person accept what was built. It is
 * required on `validation -> closed` — epic closure — and never on
 * `validation -> implementation`, the next-story loop, because a story moving on to
 * the next one is not a release and the loop must stay unblocked.
 */
export const HUMAN_ACCEPTANCE_GATE = 'humanAcceptanceConfirmed';

/** The `from` phase the human-acceptance gate attaches to (`-> closed`). */
export const HUMAN_ACCEPTANCE_TRANSITION_FROM = 'validation';

/**
 * Default human-acceptance policy. Opt-in, on the same reasoning as every other
 * switch in this file: adopting a framework version must not add a requirement to a
 * repository that did not ask for it. The shipped policy file turns it on for a new
 * consumer.
 */
export const DEFAULT_HUMAN_ACCEPTANCE = Object.freeze({
  enabled: false,
});

/**
 * The architecture-fitness gate.
 *
 * The project declares executable constraints — dependency direction, forbidden
 * references — as registered checks, and a failing required check blocks review. The
 * gate is opt-in, and it is doubly so: it joins `implementation -> review` only when
 * the block is enabled AND at least one check is declared, so a repository that
 * declares nothing sees exactly the transition matrix it saw before.
 */
export const ARCHITECTURE_GATE = 'architectureFitnessPassed';

/** The transition the gate joins: `implementation -> review`. */
export const ARCHITECTURE_TRANSITION_FROM = 'implementation';
export const ARCHITECTURE_TRANSITION_TO = 'review';

/**
 * Default architecture-fitness policy.
 *
 * `checks` may be declared while `enabled` is false: the block is then documentation of
 * what the project intends to enforce, and nothing runs. The reverse — enabled with no
 * checks — is inert as well, which is the property that keeps this gate out of the
 * frozen gate lists of every project that has not declared one.
 */
export const DEFAULT_ARCHITECTURE_FITNESS = Object.freeze({
  enabled: false,
  checks: Object.freeze([]),
});

/** Severities a check may declare. `advisory` failures are reported, never blocking. */
export const CHECK_SEVERITIES = Object.freeze(['required', 'advisory']);

/** Check keys, and their defaults. One table, so a new key cannot be half-wired. */
const CHECK_FIELDS = Object.freeze({
  id: null, command: null, cwd: '.', files: null, timeoutMs: null,
  severity: 'required', refs: null, artifact: null, artifactFormat: 'text',
});

/** A repository-relative path: no absolute paths, no walks out of the tree. */
function assertRelativePath(value, field, id) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PolicyError(`"architectureFitness.checks[].${field}" must be a non-empty string (check "${id}").`);
  }
  const normalised = value.replace(/\\/g, '/');
  if (normalised.startsWith('/') || /^[A-Za-z]:/.test(normalised) || normalised.split('/').includes('..')) {
    throw new PolicyError(`"architectureFitness.checks[].${field}" must be repository-relative and must not walk out of the tree (check "${id}", value "${value}").`);
  }
  return normalised;
}

function resolveArchitectureCheck(raw, seenIds) {
  if (!isPlainObject(raw)) throw new PolicyError('"architectureFitness.checks[]" must be an object.');
  for (const key of Object.keys(raw)) {
    if (!(key in CHECK_FIELDS)) throw new PolicyError(`Unknown "architectureFitness.checks[]" key "${key}".`);
  }
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.id)) {
    throw new PolicyError('"architectureFitness.checks[].id" must be a stable lowercase slug (a-z, 0-9, hyphen), so a report can name the same check across runs.');
  }
  if (seenIds.has(raw.id)) {
    throw new PolicyError(`duplicate "architectureFitness.checks[].id" "${raw.id}": a check id must identify one check, or a report cannot say which one failed.`);
  }
  seenIds.add(raw.id);
  if (typeof raw.command !== 'string' || raw.command.trim() === '') {
    throw new PolicyError(`"architectureFitness.checks[].command" is required (check "${raw.id}"): a check without a command cannot prove anything.`);
  }
  const cwd = raw.cwd === undefined ? '.' : assertRelativePath(raw.cwd, 'cwd', raw.id);
  const severity = raw.severity === undefined ? 'required' : raw.severity;
  if (!CHECK_SEVERITIES.includes(severity)) {
    throw new PolicyError(`"architectureFitness.checks[].severity" must be one of ${CHECK_SEVERITIES.join(', ')} (check "${raw.id}").`);
  }
  let timeoutMs = null;
  if (raw.timeoutMs !== undefined && raw.timeoutMs !== null) {
    if (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs <= 0) {
      throw new PolicyError(`"architectureFitness.checks[].timeoutMs" must be a positive integer (check "${raw.id}").`);
    }
    timeoutMs = raw.timeoutMs;
  }
  const files = raw.files === undefined || raw.files === null ? [] : raw.files;
  if (!Array.isArray(files)) throw new PolicyError(`"architectureFitness.checks[].files" must be an array of repository-relative paths (check "${raw.id}").`);
  const scopes = files.map((f) => assertRelativePath(f, 'files', raw.id));
  const refs = raw.refs === undefined || raw.refs === null ? [] : raw.refs;
  if (!Array.isArray(refs) || refs.some((r) => typeof r !== 'string' || r.trim() === '')) {
    throw new PolicyError(`"architectureFitness.checks[].refs" must be an array of non-empty strings — the design or ADR identifiers this check enforces (check "${raw.id}").`);
  }
  let artifact = null;
  let artifactFormat = 'text';
  if (raw.artifact !== undefined && raw.artifact !== null) {
    artifact = assertRelativePath(raw.artifact, 'artifact', raw.id);
    if (raw.artifactFormat !== undefined) {
      if (!['json', 'text'].includes(raw.artifactFormat)) {
        throw new PolicyError(`"architectureFitness.checks[].artifactFormat" must be "json" or "text" (check "${raw.id}").`);
      }
      artifactFormat = raw.artifactFormat;
    }
  } else if (raw.artifactFormat !== undefined && raw.artifactFormat !== null && raw.artifactFormat !== 'text') {
    throw new PolicyError(`"architectureFitness.checks[].artifactFormat" needs an "artifact": there is no file to read as ${raw.artifactFormat} (check "${raw.id}").`);
  }
  return { id: raw.id, command: raw.command, cwd, files: scopes, timeoutMs, severity, refs: [...refs], artifact, artifactFormat };
}

function resolveArchitectureFitness(raw) {
  if (raw === undefined) return { enabled: false, checks: [] };
  if (!isPlainObject(raw)) throw new PolicyError('"architectureFitness" must be an object.');
  for (const key of Object.keys(raw)) {
    if (!['enabled', 'checks'].includes(key)) throw new PolicyError(`Unknown "architectureFitness" key "${key}".`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new PolicyError('"architectureFitness.enabled" must be a boolean.');
  }
  if (raw.checks !== undefined && !Array.isArray(raw.checks)) {
    throw new PolicyError('"architectureFitness.checks" must be an array of checks.');
  }
  const seenIds = new Set();
  const checks = (raw.checks || []).map((c) => resolveArchitectureCheck(c, seenIds));
  return { enabled: raw.enabled === true, checks };
}

/**
 * Is the block doing anything? Enabled AND given a check.
 *
 * Both halves are required, and this is the single definition the evaluator, the CLI and
 * the tests share: a project with no checks must not see this gate in any list, and a
 * block that is declared but disabled must behave as though it were absent.
 */
export function architectureFitnessActive(policy) {
  const block = policy?.architectureFitness;
  return block?.enabled === true && Array.isArray(block.checks) && block.checks.length > 0;
}

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
  'pre-harness-story',
  // Work a user cannot reach or observe: framework internals, tooling, refactors that
  // change no behaviour. It is a property of the work item rather than a gap in the
  // evidence, so it carries no default expiry (see below) and it must name who
  // accepted the judgement (EXCEPTION_REQUIRES_REVIEW_NOTE).
  'non-user-facing',
]);

/** Default expiry (in days) per category. `null` means "no default bound". */
export const EXCEPTION_EXPIRY_DAYS = Object.freeze({
  'manual-compile': 7,
  'budget-override': null,      // scoped to the run that overrode it
  'analyzer-fallback': 30,
  'unscoped-freshness': 1,
  'documentation-only': null,   // scoped to the work item
  'tooling-gap': 14,
  // No default bound: this records a PERMANENT historical fact (a story closed
  // before the harness existed, whose gates were never recorded as evidence).
  // The gap will never close on its own, so a time-bounded exception would only
  // re-raise the same finding every N days without anything having changed.
  'pre-harness-story': null,
  // Scoped to the work item, like `documentation-only`: "this epic is not
  // user-facing" is not a fact that expires, it is a statement about the epic, and a
  // time bound would only re-raise a finding that nothing has changed.
  'non-user-facing': null,
});

/** Categories whose exception must carry a closure review note. */
export const EXCEPTION_REQUIRES_REVIEW_NOTE = Object.freeze([
  'manual-compile',
  'budget-override',
  'analyzer-fallback',
  'unscoped-freshness',
  'tooling-gap',
  // Who decided that this work is not user-facing, and what would change that
  // judgement. Without the note the exception is an unattributed claim that the
  // acceptance gate did not apply, which is exactly the claim a reviewer must see.
  'non-user-facing',
]);

/**
 * Gates with no automated builder: no command can produce their evidence, so a
 * record someone makes is the only route.
 *
 * The class is named for that fact alone. It holds two kinds of gate, and the
 * distinction between them is `owner` in the registry: an **agent** gate records a
 * judgement a reviewer made (`codeReviewCompleted`), and a **human** gate records a
 * person's own decision (`humanAcceptanceConfirmed`), which no reviewer's record can
 * stand in for. Either way a human may write the record — the framework never forces
 * a judgement onto an agent — so `harness confirm` accepts every gate in this list.
 *
 * Why they are refused in `strictClosure.disallowManualFor`: that flag forbids manual
 * confirmation, and for these gates manual confirmation is the ONLY route. Listing one
 * would leave the gate unsatisfiable rather than stricter, so the refusal protects a
 * consumer from a policy it cannot satisfy. (The earlier name and wording said
 * "agent-owned … can never be satisfied by a human assertion", which the code never
 * enforced, a consumer's own records contradicted, and a human-owned gate would have
 * made nonsense of. Corrected 2026-09-30 by owner decision.)
 *
 * The set must agree with the registry's non-automated gates
 * (`src/harness/gates.mjs`); `auditGateRegistry` fails if the two drift.
 */
export const MANUAL_ONLY_GATES = Object.freeze([
  'codeReviewCompleted',
  'securityReviewPassed',
  'designArtifactSyncConfirmed',
  'humanAcceptanceConfirmed',
]);

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
  // `reachabilityAddressed` is in the default set because, whenever the
  // repository has opted in, the gate is mechanically checkable by
  // `harness verify-reachability` — the declaration check runs even with no
  // probe configured — so a manual assertion can add nothing and can skip the
  // declaration entirely (contract v6 §2). With strictClosure off the refusal
  // does not apply, matching how `testsPassed` is treated.
  // Every gate here has an automated path in EVERY environment Cadet supports, so
  // a manual confirmation is always a substitute for something available.
  // `compileCheckConfirmed`, `unityAnalyzerClean` and `storyTrackingUpdated` are
  // deliberately absent: their automated path can be missing (no Unity CLI, no
  // project script), so forbidding manual confirmation would leave them
  // unsatisfiable instead of stricter. `acceptanceCriteriaValidated` joined in
  // 2026-09-30 (owner decision) — `harness verify-acs` is its path everywhere, and
  // the two lists (this fallback and the seeded policy file) must name one set.
  // A gate joins this list when a command can always prove it, so a hand record would
  // substitute for something available. `architectureFitnessPassed` belongs here for the
  // same reason: the check that proves it is declared in the project's own policy.
  disallowManualFor: Object.freeze([
    'testsPassed', 'acceptanceCriteriaValidated', 'reachabilityAddressed',
    'architectureFitnessPassed',
  ]),
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
    // No command produces this gate's evidence, so forbidding manual confirmation
    // would make the gate unsatisfiable instead of stricter.
    if (MANUAL_ONLY_GATES.includes(gate)) {
      throw new PolicyError(`"strictClosure.disallowManualFor" cannot contain "${gate}": no command produces its evidence, so forbidding manual confirmation would leave the gate unsatisfiable.`);
    }
  }
  out.disallowManualFor = [...out.disallowManualFor];

  return out;
}

/**
 * Resolve and validate the `reachability` policy block (contract v6 §2).
 *
 * Rejected rather than tolerated:
 *   - a `command` set while `enabled` is false, because the probe would never
 *     run. An inert setting is worse than an absent one: it reads as a guard
 *     that exists.
 *   - an empty-string command, which is not a probe.
 *   - any unknown key, so a typo fails loudly instead of silently defaulting.
 */
function resolveReachability(raw) {
  if (raw === undefined) return { ...DEFAULT_REACHABILITY };
  if (!isPlainObject(raw)) throw new PolicyError('"reachability" must be an object.');

  for (const key of Object.keys(raw)) {
    if (key !== 'enabled' && key !== 'command') {
      throw new PolicyError(`Unknown "reachability" key "${key}".`);
    }
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new PolicyError('"reachability.enabled" must be a boolean.');
  }
  if (raw.command !== undefined && raw.command !== null && typeof raw.command !== 'string') {
    throw new PolicyError('"reachability.command" must be a string or null.');
  }
  // A command key that is present but blank is a probe that would never run —
  // rejected, rather than silently normalized to null and forgotten.
  if (typeof raw.command === 'string' && raw.command.trim() === '') {
    throw new PolicyError('"reachability.command" is empty; omit it, or give the probe command to run.');
  }

  const out = {
    enabled: raw.enabled === true,
    command: typeof raw.command === 'string' ? raw.command.trim() : null,
  };

  if (out.enabled !== true && out.command !== null) {
    throw new PolicyError('"reachability.command" is set but "reachability.enabled" is false; the probe would never run. Enable reachability or remove the command.');
  }

  return out;
}

/**
 * Resolve and validate the `designReview` policy block.
 *
 * One key, and unknown keys are rejected so a typo fails loudly: a misspelled
 * `enable` would leave the gate off while reading as if it were on, which is the
 * failure mode this whole registry exists to remove.
 */
function resolveHumanAcceptance(raw) {
  if (raw === undefined) return { ...DEFAULT_HUMAN_ACCEPTANCE };
  if (!isPlainObject(raw)) throw new PolicyError('"humanAcceptance" must be an object.');
  for (const key of Object.keys(raw)) {
    if (key !== 'enabled') throw new PolicyError(`Unknown "humanAcceptance" key "${key}".`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new PolicyError('"humanAcceptance.enabled" must be a boolean.');
  }
  return { enabled: raw.enabled === true };
}

function resolveDesignReview(raw) {
  if (raw === undefined) return { ...DEFAULT_DESIGN_REVIEW };
  if (!isPlainObject(raw)) throw new PolicyError('"designReview" must be an object.');
  for (const key of Object.keys(raw)) {
    if (key !== 'enabled') throw new PolicyError(`Unknown "designReview" key "${key}".`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new PolicyError('"designReview.enabled" must be a boolean.');
  }
  return { enabled: raw.enabled === true };
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
    'reachability', 'designReview', 'humanAcceptance', 'architectureFitness',
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
  const reachability = resolveReachability(raw.reachability);
  const designReview = resolveDesignReview(raw.designReview);
  const humanAcceptance = resolveHumanAcceptance(raw.humanAcceptance);
  const architectureFitness = resolveArchitectureFitness(raw.architectureFitness);

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
    reachability,
    designReview,
    humanAcceptance,
    architectureFitness,
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
