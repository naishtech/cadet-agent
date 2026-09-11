/**
 * Cadet-Agent execution ledger.
 *
 * Creates and persists sanitized run records: spans, evidence, decisions,
 * budget accounting, and capability labels. All structured values pass through
 * redaction before persistence, and output beyond the inline limit is written to
 * a bounded artifact with a diagnostic preview.
 *
 * Contract: docs/core/HarnessContract.md §4 (accounting), §8 (privacy), §9 (retention).
 */

import {
  mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { newId, timestamp, sha256Bytes } from './util.mjs';
import { redact, redactString, REDACTED } from './redaction.mjs';
import { BudgetTracker, normalizeUsage, estimateCost, budgetReport } from './budget.mjs';
import { writeJsonAtomic } from './state.mjs';

export const RUN_SCHEMA_VERSION = 2;

class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function runsDir(targetDir) {
  return join(targetDir, '.cadet', 'runs');
}

/** A single run: created empty, appended to, then finalized. */
export class RunLedger {
  constructor({ targetDir = process.cwd(), policy, runId = null, workItemId = null, phase = null, budgets = null, capabilities = null } = {}) {
    if (!policy) throw new LedgerError('RunLedger requires a resolved policy');
    this.targetDir = targetDir;
    this.policy = policy;
    this.runId = runId || newId();
    this.workItemId = workItemId;
    this.phase = phase;
    this.tracker = budgets || new BudgetTracker(policy);
    this.capabilities = capabilities;
    this.startedAt = timestamp();
    this.finishedAt = null;
    this.spans = [];
    this.evidence = [];
    this.decisions = [];
    this.usage = null;
    this.status = 'running';
    this.retention = {
      rawPromptRetained: false,
      keepOnFailure: policy.retention?.keepOnFailure ?? true,
    };
  }

  /** Append a sanitized span. Never stores secrets. */
  addSpan(span) {
    const safe = redact({ ...span, runId: this.runId, spanId: span.spanId || newId() });
    this.spans.push(safe);
    return safe;
  }

  /** Append an evidence record (already structured; redacted defensively). */
  addEvidence(evidence) {
    const safe = redact(evidence);
    this.evidence.push(safe);
    return safe;
  }

  /** Append a decision (transition, escalation, budget override, stop). */
  addDecision(decision) {
    const safe = redact({ decisionId: decision.decisionId || newId(), runId: this.runId, createdAt: decision.createdAt || timestamp(), ...decision });
    this.decisions.push(safe);
    return safe;
  }

  /** Record provider or estimated usage and update the cost budget. */
  recordUsage(usage) {
    const normalized = normalizeUsage(usage, this.policy);
    const cost = estimateCost(normalized.inputTokens ?? 0, normalized.outputTokens ?? 0, this.policy);
    this.usage = {
      ...normalized,
      usd: cost.known ? cost.usd : null,
      model: cost.model,
      rateCardId: cost.known ? cost.rateCardId : null,
      effectiveDate: cost.known ? cost.effectiveDate : null,
    };
    if (cost.known) {
      this.tracker.set('estimatedCostUsd', cost.usd);
    } else {
      // Unknown cost must not silently satisfy the cost envelope: mark the
      // counter unmeasurable so a configured cost budget cannot be confirmed.
      this.tracker.markUnknown('estimatedCostUsd', 'no provider rate card available');
      this.usage.costUnknown = true;
    }
    return this.usage;
  }

  /**
   * Record bounded tool output. Output over `maxInlineBytes` is written to a
   * redacted artifact; only path, hash, byte count, and a redacted preview are
   * stored inline. Redaction is mandatory and runs before anything reaches disk.
   */
  recordOutput({ name = 'output', output, status = 'ok', tool = null, args = {}, durationMs = null, exitCode = null, retryNumber = 0 } = {}) {
    const rawText = typeof output === 'string' ? output : JSON.stringify(output ?? '');
    // Redaction is mandatory: never add an option to bypass it.
    const text = redactString(rawText);
    const bytes = Buffer.byteLength(text, 'utf-8');
    const maxInline = this.policy.output?.maxInlineBytes ?? 64 * 1024;
    const previewBytes = this.policy.output?.previewBytes ?? 4 * 1024;
    // Estimated output tokens (contract §4) so output volume is bounded too.
    const per = this.policy.estimation?.bytesPerToken || 3;
    this.tracker.add('outputTokens', Math.ceil(bytes / per));

    let artifactPath = null;
    let artifactHash = null;
    if (bytes > maxInline) {
      const dir = join(runsDir(this.targetDir), 'artifacts');
      mkdirSync(dir, { recursive: true });
      const full = join(dir, `${this.runId}-${name}-${newId().slice(0, 8)}.log`);
      writeFileSync(full, text, 'utf-8');
      artifactPath = full;
      // Hash covers the exact persisted (redacted) bytes.
      artifactHash = sha256Bytes(Buffer.from(text, 'utf-8'));
    }

    return this.addSpan({
      kind: 'tool-output',
      name,
      tool,
      args: redact(args),
      result: status,
      exitCode,
      durationMs,
      outputBytes: bytes,
      artifactPath,
      artifactHash,
      preview: artifactPath ? text.slice(0, previewBytes) : null,
      retryNumber,
      status,
    });
  }

  finalize({ status = null } = {}) {
    this.finishedAt = timestamp();
    const result = this.tracker.result();
    // The budget result is authoritative for failure states: a caller may not
    // label an exhausted, blocked, or unmeasurable-cost run as success.
    let effective = status || (result.exhausted ? 'exhausted' : result.ok ? 'ok' : 'warning');
    const unsafeToClaimSuccess = result.exhausted || result.costUnmeasurable === true;
    if (unsafeToClaimSuccess && (effective === 'ok' || effective === 'warning' || effective === 'running')) {
      effective = result.exhausted ? 'exhausted' : 'blocked';
    }
    this.status = effective;
    return this.toRecord();
  }

  toRecord() {
    return {
      runId: this.runId,
      schemaVersion: RUN_SCHEMA_VERSION,
      workItemId: this.workItemId,
      phase: this.phase,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      status: this.status,
      spans: this.spans,
      evidence: this.evidence,
      decisions: this.decisions,
      budget: this.tracker.result(),
      usage: this.usage,
      capabilities: this.capabilities,
      retention: this.retention,
    };
  }

  /** Persist the ledger to `.cadet/runs/<runId>.json` (atomically). */
  persist() {
    const dir = runsDir(this.targetDir);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${this.runId}.json`);
    // Atomic write: a process interruption cannot truncate a run record.
    writeJsonAtomic(path, this.toRecord());
    return path;
  }
}

/** Load a run record by id. */
export function loadRun(targetDir, runId) {
  const path = join(runsDir(targetDir), `${runId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** List run records (id + status + timestamps), newest first. */
export function listRuns(targetDir) {
  const dir = runsDir(targetDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return { runId: rec.runId, status: rec.status, startedAt: rec.startedAt, finishedAt: rec.finishedAt, file: f };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/**
 * Apply the retention policy: delete successful run records unless
 * `retainRunRecords` is set; keep failed runs when `keepOnFailure`. Never deletes
 * unrelated files.
 */
export function cleanupRuns(targetDir, policy, { olderThanMs = null, now = new Date() } = {}) {
  const runs = listRuns(targetDir);
  const retainAll = policy?.retention?.retainRunRecords === true;
  const keepOnFailure = policy?.retention?.keepOnFailure !== false;
  const deleted = [];
  const kept = [];

  for (const run of runs) {
    const age = now.getTime() - new Date(run.startedAt).getTime();
    const oldEnough = olderThanMs === null || age >= olderThanMs;
    const failed = ['failed', 'blocked', 'exhausted'].includes(run.status);
    if (retainAll) { kept.push(run.runId); continue; }
    if (failed && keepOnFailure) { kept.push(run.runId); continue; }
    if (!oldEnough) { kept.push(run.runId); continue; }
    try {
      unlinkSync(join(runsDir(targetDir), run.file));
      deleted.push(run.runId);
    } catch {
      kept.push(run.runId);
    }
  }
  return { deleted, kept };
}

/**
 * Build a secret-free run report: budget consumption and failures.
 * Unknown telemetry is labeled, never replaced with invented values.
 */
export function buildReport(run) {
  const checks = run.budget?.checks || [];
  return {
    runId: run.runId,
    status: run.status,
    workItemId: run.workItemId,
    phase: run.phase,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    budgets: checks.map((c) => ({
      budget: c.budget,
      used: c.used,
      hard: c.hard,
      remaining: c.remaining,
      overage: c.hard !== null && c.used > c.hard,
      status: c.status,
    })),
    toolCalls: checks.find((c) => c.counter === 'toolCalls')?.used ?? null,
    retries: checks.find((c) => c.counter === 'retries')?.used ?? null,
    usage: run.usage
      ? {
        source: run.usage.source,
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        usd: run.usage.usd,
        model: run.usage.model,
        costUnknown: run.usage.costUnknown === true || run.usage.usd === null,
      }
      : { source: 'unknown', costUnknown: true },
    telemetry: {
      tokenTelemetry: run.capabilities?.tokenTelemetry?.provider ? 'provider' : 'unavailable-estimated-or-unknown',
      costTelemetry: run.usage?.usd != null ? 'estimated' : 'unavailable',
      mcp: run.capabilities?.mcp?.available ? 'available' : 'unavailable',
    },
    failures: (run.spans || []).filter((s) => ['failed', 'blocked', 'exhausted', 'timed-out'].includes(s.status || s.result)),
    spanCount: (run.spans || []).length,
    evidenceCount: (run.evidence || []).length,
    decisionCount: (run.decisions || []).length,
  };
}

/** Machine-readable, secret-free report summary for display. */
export function formatReport(run) {
  const r = buildReport(run);
  const lines = [];
  lines.push(`Run ${r.runId} — ${r.status}`);
  lines.push(`  Work item: ${r.workItemId || 'unscoped'}  Phase: ${r.phase || 'unknown'}`);
  lines.push('  Budgets:');
  for (const b of r.budgets) {
    const cap = b.hard === null ? 'unbounded' : String(b.hard);
    lines.push(`    ${b.budget.padEnd(22)} used ${String(b.used).padStart(8)} / ${cap.padStart(8)} (${b.status})${b.overage ? ' OVER' : ''}`);
  }
  lines.push(`  Usage: tokens=${r.usage.source}; usd=${r.usage.usd ?? 'unknown'}`);
  lines.push(`  Telemetry: ${r.telemetry.tokenTelemetry}; cost=${r.telemetry.costTelemetry}; mcp=${r.telemetry.mcp}`);
  if (r.failures.length) {
    lines.push(`  Failures (${r.failures.length}):`);
    for (const f of r.failures.slice(0, 20)) lines.push(`    ${f.kind || 'span'} ${f.name || f.tool || ''} ${f.result || f.status}`);
  }
  return lines.join('\n');
}

export { LedgerError, REDACTED, budgetReport };
