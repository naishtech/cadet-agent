/**
 * Cadet-Agent verification runner.
 *
 * Deterministic, bounded verification with a single retry classifier. Skills may
 * supply policy (commands, flaky signatures) but may not invent classifications.
 *
 * Contract: docs/core/HarnessContract.md §4 (retry classifier), §5 (commands), §6 (loop).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEvidence, computeInputTreeHash } from './state.mjs';
import { hashCriteria, sha256Bytes, timestamp, newId } from './util.mjs';
import { BudgetTracker, budgetExhaustedResult, evaluateHardStop } from './budget.mjs';
import { redactString } from './redaction.mjs';

export const RETRY_CLASSES = Object.freeze(['deterministic', 'transient', 'repair', 'unknown']);
export const RESULT_STATUSES = Object.freeze(['passed', 'failed', 'flaky', 'blocked', 'timed-out']);

/** Backoff schedule for transient retries (ms). */
export const TRANSIENT_BACKOFF_MS = Object.freeze([250, 1000, 4000]);

/** Default flaky signatures (configurable via policy.estimation? no — via verification policy). */
export const DEFAULT_FLAKY_SIGNATURES = Object.freeze([
  'econnreset',
  'etimedout',
  'socket hang up',
  'connection refused',
  'temporarily unavailable',
  'service unavailable',
  'process launch failed',
  'eaddrnotavail',
]);

const DETERMINISTIC_SIGNATURES = Object.freeze([
  'assertionerror',
  'expected',
  'syntaxerror',
  'compile error',
  'compilationerror',
  'cs0',
  'analyzer',
  'unt',
  'invalid input',
  'usage:',
  'unknown option',
  'no such file',
  'cannot find module',
  'unhandled rejection',
]);

const TRANSIENT_SIGNATURES = DEFAULT_FLAKY_SIGNATURES;

/**
 * Classify a command result. The classifier is the single source of truth for
 * retry behavior — nothing else may decide to retry.
 *
 * Returns `{ retryClass, reason, retryable }`.
 */
export function classifyResult({ exitCode = null, timedOut = false, stdout = '', stderr = '', errorMessage = '', flakySignatures = DEFAULT_FLAKY_SIGNATURES } = {}) {
  const haystack = `${errorMessage}\n${stderr}\n${stdout}`.toLowerCase();

  if (timedOut) {
    // A timeout is deterministic unless its signature is explicitly configured flaky.
    if (flakySignatures.some((s) => haystack.includes(s))) {
      return { retryClass: 'transient', reason: 'timeout with a configured flaky signature', retryable: true };
    }
    return { retryClass: 'deterministic', reason: 'reproducible timeout does not retry automatically', retryable: false };
  }

  if (TRANSIENT_SIGNATURES.some((s) => haystack.includes(s))) {
    return { retryClass: 'transient', reason: `matched transient signature`, retryable: true };
  }

  if (exitCode === 0) {
    return { retryClass: 'deterministic', reason: 'success', retryable: false };
  }

  if (DETERMINISTIC_SIGNATURES.some((s) => haystack.includes(s))) {
    return { retryClass: 'deterministic', reason: 'matched a deterministic failure signature', retryable: false };
  }

  if (exitCode !== null && exitCode !== 0) {
    return { retryClass: 'unknown', reason: `unrecognized failure (exit ${exitCode}); escalate`, retryable: false };
  }

  return { retryClass: 'unknown', reason: 'unrecognized result; escalate', retryable: false };
}

/** A `repair` retry is only valid when it references the failed evidence and changed files. */
export function classifyRepair({ failedEvidenceId, changedFiles = [] } = {}) {
  if (!failedEvidenceId) {
    return { retryClass: 'unknown', reason: 'repair retry requires a failed evidence reference', retryable: false };
  }
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { retryClass: 'unknown', reason: 'repair retry requires changed files', retryable: false };
  }
  return { retryClass: 'repair', reason: 'code/config repair followed by a rerun', retryable: true, failedEvidenceId, changedFiles };
}

/**
 * Run a command and capture bounded output. Never buffers unbounded output:
 * output beyond `maxInlineBytes` is written to an artifact.
 *
 * Returns `{ exitCode, signal, timedOut, stdout, stderr, durationMs, outputBytes, artifactPath, artifactHash, preview }`.
 */
export function runCommand(command, {
  cwd = process.cwd(),
  env = {},
  timeoutMs = 30 * 60 * 1000,
  maxInlineBytes = 64 * 1024,
  previewBytes = 4 * 1024,
  artifactDir = null,
  shell = true,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawnImpl(command, { cwd, env: { ...process.env, ...env }, shell, windowsHide: true });
    } catch (err) {
      resolve({
        exitCode: null, signal: null, timedOut: false, stdout: '', stderr: '',
        durationMs: Date.now() - startedAt, outputBytes: 0, artifactPath: null,
        artifactHash: null, preview: '', errorMessage: err.message,
      });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let finished = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxInlineBytes) stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxInlineBytes) stderrChunks.push(chunk);
    });

    const finish = (exitCode, signal, errorMessage = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const outputBytes = stdoutBytes + stderrBytes;

      let artifactPath = null;
      let artifactHash = null;
      if (outputBytes > maxInlineBytes && artifactDir) {
        try {
          mkdirSync(artifactDir, { recursive: true });
          const full = join(artifactDir, `output-${newId()}.log`);
          // Redact before persisting: the artifact must never contain secrets,
          // even though the in-memory copy is kept raw for classification.
          const body = redactString(`${stdout}\n${stderr}`);
          writeFileSync(full, body, 'utf-8');
          artifactPath = full;
          // Hash covers the exact persisted (redacted) bytes.
          artifactHash = sha256Bytes(Buffer.from(body, 'utf-8'));
        } catch {
          artifactPath = null;
        }
      }
      const preview = redactString((stdout + stderr).slice(0, previewBytes));
      resolve({
        exitCode, signal, timedOut, stdout, stderr, durationMs, outputBytes,
        artifactPath, artifactHash, preview, errorMessage,
      });
    };

    child.on('error', (err) => finish(null, null, err.message));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/**
 * Build a verification command descriptor for a gate.
 * Project-specific commands (analyzer/compile/test) come from `.cadet/harness.json`.
 */
export function commandForGate(gate, { projectPath = '.', policy = null, unityAvailable = false } = {}) {
  switch (gate) {
    case 'testsPassed':
      return policy?.testCommand
        ? { command: policy.testCommand, tool: 'test', automated: true }
        : { command: 'npm test', tool: 'test', automated: true };
    case 'compileCheckConfirmed':
      if (policy?.compileCommand) {
        return { command: policy.compileCommand, tool: 'unity-build', automated: true };
      }
      if (unityAvailable) {
        return {
          command: `unity build ${projectPath} --target StandaloneWindows64 -o "${join(projectPath, 'Temp', 'cadet-build')}" --format json`,
          tool: 'unity-build',
          automated: true,
        };
      }
      return { command: null, tool: 'manual-confirmation', automated: false, reason: 'Unity CLI unavailable' };
    case 'unityAnalyzerClean':
      if (policy?.analyzerCommand) {
        return {
          command: `unity run ${projectPath} --command ${policy.analyzerCommand} --format json`,
          tool: 'unity-analyzer',
          automated: true,
        };
      }
      return { command: null, tool: 'unity-analyzer', automated: false, reason: 'analyzer command not declared in .cadet/harness.json' };
    default:
      return { command: null, tool: 'agent-owned', automated: false, reason: `${gate} is agent-owned` };
  }
}

/** Detect zero `UNT*` diagnostics in a Unity analyzer JSON envelope. */
export function analyzerClean(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const text = JSON.stringify(parsed);
    return !/UNT\d+/.test(text);
  } catch {
    // Non-JSON: treat any UNT token in the raw text as a finding.
    return !/UNT\d+/.test(stdout);
  }
}

/**
 * The verification loop contract (contract §6). Runs a command once, classifies,
 * retries only when the class is retryable and budget remains, and records every
 * attempt. No attempt ever overwrites a previous one.
 *
 * `runner` is injectable for tests: `async (attempt) => { exitCode, ... }`.
 */
export async function runVerificationLoop({
  gate,
  command,
  workItemId,
  phase,
  acceptanceCriterionId = null,
  relevantFiles = [],
  criteria = [],
  rootDir = process.cwd(),
  policy,
  budgets,
  runCommandImpl = runCommand,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttemptsOverride = null,
  tool = 'test',
  maxInlineBytes,
  previewBytes,
  artifactDir = null,
  flakySignatures = DEFAULT_FLAKY_SIGNATURES,
  priorEvidence = [],
  requireRedFirst = null,
  now = () => new Date(),
} = {}) {
  const tracker = budgets || new BudgetTracker(policy);
  const attempts = [];
  const inputTreeHash = computeInputTreeHash(rootDir, relevantFiles);
  const criteriaHash = hashCriteria(criteria);
  const perStepLimit = maxAttemptsOverride ?? (policy?.budgets?.maxRetriesPerStep?.hard ?? 2) + 1;

  // Red-before-green: a testable gate must not be satisfied by green evidence
  // unless a prior failed (red) record exists for the same work item and gate.
  // `requireRedFirst` may be set explicitly; otherwise it applies to
  // `testsPassed` by default.
  const redFirstRequired = requireRedFirst === null ? gate === 'testsPassed' : requireRedFirst === true;
  const priorRed = Array.isArray(priorEvidence)
    && priorEvidence.some((e) => e && e.gate === gate && e.workItemId === workItemId && e.status === 'failed');

  let lastResult = null;
  let stopped = false;

  for (let attempt = 1; attempt <= perStepLimit; attempt++) {
    const startedAt = now();
    const result = await runCommandImpl(command, { cwd: rootDir, timeoutMs: policy?.budgets?.maxWallClockMs?.hard, maxInlineBytes, previewBytes, artifactDir });
    tracker.add('toolCalls', 1);
    tracker.add('wallClockMs', result.durationMs || 0);
    // Command output counts against the output-token budget (estimated from the
    // UTF-8 byte length), so the output budget is enforced rather than advisory.
    const bytesPerToken = policy?.estimation?.bytesPerToken || 3;
    tracker.add('outputTokens', Math.ceil((result.outputBytes || 0) / bytesPerToken));

    // Hard budgets are enforceable, not advisory: if this attempt pushed a hard
    // limit (tool calls, wall-clock, output tokens, cost), stop immediately and
    // never report a passing gate.
    const hardStop = evaluateHardStop(tracker, { policy });

    const classification = classifyResult({ ...result, flakySignatures });
    const passed = result.exitCode === 0 && !result.timedOut;
    let gatePassed = passed;
    if (gate === 'unityAnalyzerClean' && passed) {
      gatePassed = analyzerClean(result.stdout);
    }
    // A gate can never be satisfied when a hard budget was exceeded, or when a
    // configured budget (e.g. cost) could not be measured.
    if (hardStop.exhausted || hardStop.blocked) gatePassed = false;

    const evidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId,
      phase,
      gate,
      status: hardStop.exhausted || hardStop.blocked
        ? 'blocked'
        : (gatePassed ? 'passed' : (result.timedOut ? 'blocked' : 'failed')),
      command,
      result: hardStop.exhausted
        ? `budget-exhausted: ${hardStop.reason}`
        : (hardStop.blocked ? `budget-blocked: ${hardStop.reason}` : describeResult(result)),
      exitCode: result.exitCode,
      artifactPath: result.artifactPath,
      artifactHash: result.artifactHash,
      inputTreeHash,
      criteriaHash,
      relevantFiles,
      createdAt: startedAt,
      source: 'automated',
    });

    attempts.push({
      attempt,
      spanId: newId(),
      tool,
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      outputBytes: result.outputBytes,
      artifactPath: result.artifactPath,
      artifactHash: result.artifactHash,
      status: result.timedOut ? 'timed-out' : (gatePassed ? 'passed' : 'failed'),
      retryClass: classification.retryClass,
      retryReason: classification.reason,
      evidence,
    });

    lastResult = result;

    if (hardStop.exhausted || hardStop.blocked) {
      return finalize({
        status: 'failed',
        attempts,
        tracker,
        inputTreeHash,
        criteriaHash,
        stopReason: hardStop.exhausted ? 'budget-exhausted' : 'budget-blocked',
        diagnostic: hardStop.reason,
      });
    }

    if (gatePassed) {
      // Enforce red-before-green for testable gates. A red record may come from
      // prior state or from an earlier failed attempt in this same loop.
      const inLoopRed = attempts.slice(0, -1).some((a) => a.status === 'failed');
      if (redFirstRequired && !priorRed && !inLoopRed) {
        return finalize({
          status: 'failed',
          attempts,
          tracker,
          inputTreeHash,
          criteriaHash,
          stopReason: 'red-required',
          diagnostic: 'a failing (red) record is required before a green testsPassed result; run the test against the unimplemented behavior first',
        });
      }
      return finalize({ status: 'passed', attempts, tracker, inputTreeHash, criteriaHash });
    }
    if (result.timedOut) {
      if (classification.retryable && tracker.checkStepRetries(attempt - 1).status !== 'exhausted') {
        // fall through to retry
      } else {
        return finalize({ status: 'timed-out', attempts, tracker, inputTreeHash, criteriaHash });
      }
    }
    if (!classification.retryable) {
      return finalize({
        status: 'failed',
        attempts,
        tracker,
        inputTreeHash,
        criteriaHash,
        stopReason: classification.retryClass,
        diagnostic: classification.reason,
      });
    }

    // Retryable — check both the per-step and total retry budgets.
    // `attempt` counts executions; retries performed so far = attempt - 1.
    const stepCheck = tracker.checkStepRetries(attempt - 1);
    if (stepCheck.status === 'exhausted') {
      return finalize({ status: 'failed', attempts, tracker, inputTreeHash, criteriaHash, stopReason: 'retry-exhausted', diagnostic: 'retry budget exhausted' });
    }
    const runCheck = tracker.check('retries');
    if (runCheck.status === 'exhausted') {
      return finalize({ status: 'failed', attempts, tracker, inputTreeHash, criteriaHash, stopReason: 'retry-exhausted', diagnostic: 'total retry budget exhausted' });
    }
    const timeCheck = tracker.check('wallClockMs');
    if (timeCheck.status === 'exhausted') {
      return finalize({ status: 'failed', attempts, tracker, inputTreeHash, criteriaHash, stopReason: 'budget-exhausted', diagnostic: 'wall-clock budget exhausted' });
    }

    tracker.add('retries', 1);
    const backoff = TRANSIENT_BACKOFF_MS[Math.min(attempt - 1, TRANSIENT_BACKOFF_MS.length - 1)];
    if (attempt < perStepLimit) {
      await sleepImpl(backoff);
    }
    stopped = false;
  }

  return finalize({
    status: 'failed',
    attempts,
    tracker,
    inputTreeHash,
    criteriaHash,
    stopReason: 'retry-exhausted',
    diagnostic: 'retry limit reached',
  });
}

function describeResult(result) {
  if (result.timedOut) return 'timed-out';
  if (result.exitCode === 0) return 'exit 0';
  return `exit ${result.exitCode}`;
}

function finalize({ status, attempts, tracker, inputTreeHash, criteriaHash, stopReason = null, diagnostic = null }) {
  const flattened = ['passed', 'flaky'].includes(status) ? status : status;
  return {
    status,
    ok: status === 'passed',
    gateSatisfied: status === 'passed',
    stopReason,
    diagnostic,
    attempts,
    evidence: attempts.map((a) => a.evidence),
    finalEvidence: attempts.length ? attempts[attempts.length - 1].evidence : null,
    inputTreeHash,
    criteriaHash,
    budget: tracker.result(),
  };
}

/**
 * Build a manual-confirmation evidence record when automation is unavailable.
 * Recorded as a user-owned decision, never imitated as automated evidence.
 */
export function manualConfirmation({
  gate, workItemId, phase, projectPath, editorVersion, scope, acceptanceCriterionId = null,
  relevantFiles = [], criteria = [], rootDir = process.cwd(), approvedBy = 'user', at = new Date(),
  reason = null, expiresAt = null, environment = null, expiresInMs = null,
} = {}) {
  const inputTreeHash = computeInputTreeHash(rootDir, relevantFiles);
  // v3 quality fields. `scope` is declared both as the free-text `result` line
  // (v2 shape, kept for audit) and as a machine-checkable array when supplied.
  //
  // SECURITY: `reason`, `result`, `scope` and the environment values are free
  // human prose and are persisted into state.json, which is committed. The run
  // ledger is redacted; state must be too, or a pasted token ends up in git.
  // Redaction has no bypass (contract §8).
  const scopeList = (Array.isArray(scope) ? scope : (scope ? [scope] : [])).map(redactString);
  const safeReason = reason === null || reason === undefined ? null : redactString(String(reason));
  const env = Object.fromEntries(
    Object.entries(environment || (projectPath || editorVersion
      ? { projectPath: projectPath || null, editorVersion: editorVersion || null }
      : {})).map(([k, v]) => [k, typeof v === 'string' ? redactString(v) : v]),
  );
  const hasEnv = Object.keys(env).length > 0;
  const expiry = expiresAt || (expiresInMs ? new Date(at.getTime() + expiresInMs) : null);
  const resultText = [
    'manual confirmation:',
    projectPath ? `project=${redactString(String(projectPath))}` : null,
    editorVersion ? `editor=${redactString(String(editorVersion))}` : null,
    scopeList.length ? `scope=${scopeList.join('; ')}` : null,
    safeReason ? `reason=${safeReason}` : null,
  ].filter(Boolean).join(' ');

  const evidence = {
    ...createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId,
      phase,
      gate,
      status: 'manual-confirmation',
      command: null,
      result: resultText,
      exitCode: null,
      inputTreeHash,
      criteriaHash: hashCriteria(criteria),
      relevantFiles,
      createdAt: at,
      expiresAt: expiry,
      source: 'manual-confirmation',
    }),
    // Present only when supplied, so a v2-shaped record is unchanged when the
    // caller does not ask for the v3 fields. Values are already redacted above.
    ...(safeReason !== null ? { reason: safeReason } : {}),
    ...(hasEnv ? { environment: env } : {}),
    ...(scopeList.length ? { scope: scopeList } : {}),
  };
  return { evidence, approvedBy, projectPath, editorVersion, scope: scopeList, reason: safeReason, environment: env, recordedAt: timestamp(at) };
}

/** Convenience: is the verification result an exhaustion that must not read as success? */
export function isBudgetExhaustion(result) {
  return result?.stopReason === 'budget-exhausted';
}

export { budgetExhaustedResult };
