/**
 * Cadet-Agent harness budget accounting.
 *
 * Deterministic counters over the resolved policy. Consumed by the ledger,
 * verification runner, CLI, and installer. A budget result is machine-readable
 * and can never be confused with success: `ok === false` for warnings and stops.
 *
 * Contract: docs/core/HarnessContract.md §3 (budgets) and §4 (estimation).
 */

import { budgetForScope, warnThreshold, PolicyError } from './policy.mjs';

export const BUDGET_RESULTS = Object.freeze(['ok', 'warning', 'exhausted']);

const COUNTER_TO_BUDGET = Object.freeze({
  contextTokens: 'maxContextTokens',
  outputTokens: 'maxOutputTokens',
  toolCalls: 'maxToolCalls',
  retries: 'maxTotalRetries',
  wallClockMs: 'maxWallClockMs',
  estimatedCostUsd: 'maxEstimatedCostUsd',
  downloadedBytes: 'maxDownloadedBytes',
  decompressedBytes: 'maxDecompressedBytes',
  archiveFiles: 'maxArchiveFiles',
});

/** Per-something counters that are tracked separately from the run totals. */
function emptyCounters() {
  return {
    contextTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    retries: 0,
    wallClockMs: 0,
    estimatedCostUsd: 0,
    downloadedBytes: 0,
    decompressedBytes: 0,
    archiveFiles: 0,
  };
}

function requireNonNegative(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PolicyError(`Budget counter "${name}" must be a non-negative finite number (got ${value}).`);
  }
}

/**
 * A budget tracker for one scope (a run or a story).
 * Immutable reads: `snapshot()` is a frozen copy.
 */
export class BudgetTracker {
  constructor(policy, scope = 'perRun') {
    this.scope = scope;
    this.limits = budgetForScope(policy, scope);
    const caps = budgetForScope(policy, 'perRun');
    this.caps = caps; // hard safety ceilings, applied on top of scope overrides
    this.counters = emptyCounters();
    this.events = [];
    // Counters whose value could not be measured. An unmeasurable cost budget
    // must never be treated as satisfied (contract §4).
    this.unknown = new Set();
  }

  /** Mark a counter as unmeasurable (e.g. provider cost with no rate card). */
  markUnknown(name, reason = 'value not measurable') {
    if (!(name in this.counters)) {
      throw new PolicyError(`Unknown budget counter "${name}".`);
    }
    this.unknown.add(name);
    this.events.push({ type: 'budget-unknown', counter: name, reason, at: new Date().toISOString() });
  }

  /**
   * Add to a counter. Throws on unknown counter or invalid value rather than
   * silently recording a wrong number.
   */
  add(name, amount, meta = {}) {
    if (!(name in this.counters)) {
      throw new PolicyError(`Unknown budget counter "${name}".`);
    }
    requireNonNegative(name, amount);
    this.counters[name] += amount;
    if (meta.reason) {
      this.events.push({ type: 'budget-add', counter: name, amount, reason: meta.reason, at: new Date().toISOString() });
    }
    return this.evaluate(name);
  }

  set(name, value) {
    if (!(name in this.counters)) {
      throw new PolicyError(`Unknown budget counter "${name}".`);
    }
    requireNonNegative(name, value);
    this.counters[name] = value;
    return this.evaluate(name);
  }

  /** Evaluate one counter (or all) against its budget. */
  evaluate(name) {
    const names = name ? [name] : Object.keys(this.counters);
    const checks = names.map((n) => this.check(n));
    const worst = checks.reduce((acc, c) => (c.status === 'exhausted' ? c : acc.status === 'exhausted' ? acc : c.status === 'warning' ? c : acc), { status: 'ok' });
    return {
      status: worst.status,
      ok: worst.status === 'ok',
      exhausted: worst.status === 'exhausted',
      checks,
    };
  }

  check(name) {
    const budgetKey = COUNTER_TO_BUDGET[name];
    const limit = this.limits[budgetKey];
    const cap = this.caps[budgetKey] || limit;
    const used = this.counters[name];
    const hard = Math.min(limit?.hard ?? Infinity, cap?.hard ?? Infinity);
    const warn = limit ? warnThreshold(limit) : null;
    let status = 'ok';
    if (hard !== Infinity && used >= hard) status = 'exhausted';
    else if (warn !== null && used >= warn) status = 'warning';
    return {
      counter: name,
      budget: budgetKey,
      used,
      hard: hard === Infinity ? null : hard,
      warn,
      remaining: hard === Infinity ? null : Math.max(0, hard - used),
      fraction: hard && hard !== Infinity ? used / hard : 0,
      status,
    };
  }

  /** Per-step retry check; `maxRetriesPerStep` is separate from the run total. */
  checkStepRetries(stepRetries) {
    const per = this.limits.maxRetriesPerStep?.hard ?? Infinity;
    const total = this.check('retries');
    let status = 'ok';
    if (stepRetries >= per) status = 'exhausted';
    else if (stepRetries + 1 >= per) status = 'warning';
    if (total.status === 'exhausted') status = 'exhausted';
    else if (status === 'ok' && total.status === 'warning') status = 'warning';
    return {
      counter: 'retriesPerStep',
      used: stepRetries,
      hard: per === Infinity ? null : per,
      remaining: per === Infinity ? null : Math.max(0, per - stepRetries),
      status,
    };
  }

  snapshot() {
    const checks = Object.keys(this.counters).map((n) => this.check(n));
    return Object.freeze({
      scope: this.scope,
      counters: { ...this.counters },
      checks,
      events: [...this.events],
    });
  }

  /** Machine-readable final result. `ok` is true only when every budget is within limits. */
  result() {
    const evaluation = this.evaluate();
    const unknownCost = this.unknown.has('estimatedCostUsd');
    return {
      status: evaluation.status,
      ok: evaluation.status === 'ok' && !unknownCost,
      exhausted: evaluation.status === 'exhausted',
      checks: evaluation.checks,
      counters: { ...this.counters },
      unknown: [...this.unknown],
      costUnmeasurable: unknownCost,
    };
  }
}

/**
 * A hard-stop result. Always `ok: false` — callers must never treat this as success.
 */
export function budgetExhaustedResult(reason, detail = {}) {
  return {
    status: 'exhausted',
    ok: false,
    exhausted: true,
    exitCode: 3,
    code: 'budget-exhausted',
    reason,
    ...detail,
  };
}

/** Compute a consumption report row for display (no secrets involved). */
export function budgetReport(tracker) {
  return tracker.result().checks.map((c) => ({
    budget: c.budget,
    used: c.used,
    hard: c.hard,
    remaining: c.remaining,
    overage: c.hard !== null && c.used > c.hard,
    status: c.status,
  }));
}

/**
 * Evaluate all tracked counters for a hard stop. Returns
 * `{ exhausted, reason, checks }`. A hard stop must block the operation, not
 * merely record a warning.
 */
export function evaluateHardStop(tracker) {
  const result = tracker.result();
  if (result.exhausted) {
    const first = result.checks.find((c) => c.status === 'exhausted');
    return {
      exhausted: true,
      blocked: true,
      reason: first ? `${first.budget} budget exhausted (used ${first.used} of ${first.hard})` : 'budget exhausted',
      checks: result.checks,
    };
  }
  if (result.costUnmeasurable) {
    const costCheck = result.checks.find((c) => c.counter === 'estimatedCostUsd');
    // Only block when a cost budget is actually configured.
    if (costCheck && costCheck.hard !== null) {
      return {
        exhausted: false,
        blocked: true,
        reason: 'provider cost is unmeasurable (no rate card); the cost budget cannot be confirmed',
        checks: result.checks,
      };
    }
  }
  return { exhausted: false, blocked: false, reason: null, checks: result.checks };
}

/**
 * Estimate tokens from UTF-8 byte length (contract §4).
 * Marked as an estimate so it can never be mistaken for provider telemetry.
 */
export function estimateTokens(textOrBytes, policy) {
  const bytes = typeof textOrBytes === 'number'
    ? textOrBytes
    : Buffer.byteLength(String(textOrBytes ?? ''), 'utf-8');
  const per = policy?.estimation?.bytesPerToken || 3;
  return {
    tokens: Math.ceil(bytes / per),
    bytes,
    source: 'estimate',
    confidence: 'low',
  };
}

/**
 * Estimate provider cost from tokens and a rate card.
 * Returns `{ known: false }` when no rate card exists — USD is never invented.
 */
export function estimateCost(inputTokens, outputTokens, policy) {
  const model = policy?.model;
  const card = model && policy?.estimation?.rateCards?.[model];
  if (!card) {
    return { known: false, usd: null, source: 'unknown', model: model || null };
  }
  const usd = inputTokens * (card.inputRate ?? 0) + outputTokens * (card.outputRate ?? 0);
  return {
    known: true,
    usd: Math.round(usd * 10000) / 10000,
    source: 'estimate',
    model,
    rateCardId: card.id || model,
    effectiveDate: card.effectiveDate || null,
  };
}

/** Normalize provider or estimated usage. Unknown is `unknown`, never zero. */
export function normalizeUsage(usage, policy) {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.bytes === undefined)) {
    return { source: 'unknown', inputTokens: null, outputTokens: null, confidence: 'unknown' };
  }
  if (usage.source === 'provider') {
    return {
      source: 'provider',
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedTokens: usage.cachedTokens ?? null,
      confidence: 'high',
    };
  }
  const est = estimateTokens(usage.bytes ?? 0, policy);
  return {
    source: 'estimate',
    inputTokens: usage.inputTokens ?? est.tokens,
    outputTokens: usage.outputTokens ?? 0,
    cachedTokens: null,
    confidence: est.confidence,
  };
}

export { COUNTER_TO_BUDGET };
