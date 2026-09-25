/**
 * Cadet-Agent verification runner.
 *
 * Deterministic, bounded verification with a single retry classifier. Skills may
 * supply policy (commands, flaky signatures) but may not invent classifications.
 *
 * Contract: docs/core/HarnessContract.md §4 (retry classifier), §5 (commands), §6 (loop).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEvidence, computeInputTreeHash } from './state.mjs';
import { hashCriteria, sha256Bytes, timestamp, newId } from './util.mjs';
import { BudgetTracker, budgetExhaustedResult, evaluateHardStop } from './budget.mjs';
import { redactString } from './redaction.mjs';
import { whichAll } from './routing.mjs';

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
 * A command that never launched produced no test result, so it can never be a red.
 *
 * These are shell- and launcher-level signatures for "the program was not found",
 * as distinct from "the program ran and reported failure". They matter most on
 * Windows, where `shell: true` hands the command string to `cmd.exe`: a bare `bash`
 * resolves through Windows PATH to the Windows Subsystem for Linux stub, which
 * fails without ever exec'ing a shell. The command looks like it ran and failed;
 * nothing ran at all.
 */
export const LAUNCH_FAILURE_SIGNATURES = Object.freeze([
  // cmd.exe: the shell could not find the program on PATH.
  'is not recognized as an internal or external command',
  // POSIX shells: the shell could not find the program.
  'command not found',
  // The WSL launcher could not exec the distribution's shell.
  'execvpe(',
  'has no installed distributions',
  'wsl (',
]);

/** POSIX shell conventions: 126 = found but not executable, 127 = command not found. */
export const LAUNCH_FAILURE_EXIT_CODES = Object.freeze([126, 127]);

/**
 * Decide whether a result means the command never actually ran. Returns
 * `{ launchFailed, reason }`; `reason` is a concrete diagnostic, never generic.
 *
 * The bias is deliberate: a launch failure must be *blocked*, never *failed*,
 * because `failed` is the record that satisfies red-before-green. When in doubt
 * the safe direction is "no test result", not "the tests failed".
 */
export function detectLaunchFailure({ exitCode = null, timedOut = false, stdout = '', stderr = '', errorMessage = '' } = {}) {
  // A timed-out process did launch; it is not a launch failure.
  if (timedOut) return { launchFailed: false, reason: null };

  // A spawn-level error means the process was never created at all.
  if (errorMessage) {
    return { launchFailed: true, reason: `the process was never created (${errorMessage})` };
  }

  const haystack = `${stderr}\n${stdout}`.toLowerCase();
  const signature = LAUNCH_FAILURE_SIGNATURES.find((s) => haystack.includes(s));
  if (signature) {
    return { launchFailed: true, reason: `the shell reported "${signature}"` };
  }

  if (LAUNCH_FAILURE_EXIT_CODES.includes(exitCode)) {
    return {
      launchFailed: true,
      reason: `exit ${exitCode} is the shell convention for an interpreter that could not be found or executed`,
    };
  }

  return { launchFailed: false, reason: null };
}

/**
 * POSIX interpreters whose bare name is ambiguous under `cmd.exe`: Windows ships a
 * `bash.exe` stub that resolves but cannot run without a WSL distribution.
 */
export const POSIX_INTERPRETERS = Object.freeze(['bash', 'sh', 'dash', 'zsh', 'ksh']);

/** The command's first token, unwrapped from quotes. */
export function commandInterpreter(command) {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** Whether a resolved path is one of the Windows shims for `bash`/`wsl`. */
export function isWslShim(path) {
  if (typeof path !== 'string' || !path) return false;
  const p = path.replace(/\//g, '\\').toLowerCase();
  if (/(^|\\)system32\\bash\.exe$/.test(p)) return true;
  if (/(^|\\)system32\\wsl\.exe$/.test(p)) return true;
  return /(^|\\)windowsapps\\/.test(p);
}

function probeRunnable(path) {
  // `--version` is not universal (dash's `sh` rejects it), so fall back to a
  // trivial execution: the question is only whether this binary can run at all.
  for (const args of [['--version'], ['-c', 'exit 0']]) {
    try {
      const res = spawnSync(path, args, { encoding: 'utf-8', windowsHide: true, shell: false, timeout: 10000 });
      if (res.status === 0) return true;
    } catch { /* try the next probe */ }
  }
  return false;
}

function defaultCandidates(name) {
  return whichAll(name);
}

/**
 * Resolve the command's interpreter before running it. Only a command led by a POSIX
 * interpreter is checked, and only on Windows, so a `cmd` builtin or an ordinary
 * executable is never second-guessed. The command string is not rewritten — the
 * declaration stays the auditable record.
 *
 * `candidates` and `probe` are injectable so the decision is testable without
 * depending on the host's PATH.
 */
export function resolveCommandInterpreter(command, {
  platform = process.platform,
  candidates = null,
  probe = probeRunnable,
} = {}) {
  const interpreter = commandInterpreter(command);
  const raw = interpreter ? interpreter.split(/[\\/]/).pop().toLowerCase() : null;
  // `bash.exe` is the same ambiguity as `bash`, and `where` reports the suffixed form.
  const base = raw ? raw.replace(/\.exe$/, '') : null;

  if (!base || !POSIX_INTERPRETERS.includes(base)) {
    return { required: false, ok: true, interpreter, usable: [], shims: [], reason: null };
  }
  if (platform !== 'win32') {
    return { required: true, ok: true, interpreter, usable: [], shims: [], reason: null };
  }

  const found = (candidates ?? defaultCandidates)(base);
  const shims = found.filter(isWslShim);
  const usable = found.filter((p) => !isWslShim(p) && probe(p));
  if (usable.length) {
    return { required: true, ok: true, interpreter, usable, shims, reason: null };
  }

  let detail;
  if (found.length === 0) {
    detail = 'no installed copy on PATH';
  } else if (shims.length === found.length) {
    detail = `only the Windows Subsystem for Linux stub (${shims.join(', ')})`;
  } else {
    detail = 'the copy on PATH is not runnable';
  }

  return {
    required: true, ok: false, interpreter, usable, shims,
    reason: `'${base}' cannot be run: ${detail}. Install Git for Windows (which provides a real bash) or declare a command that does not need a POSIX interpreter.`,
  };
}

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
 * Returns `{ exitCode, signal, timedOut, stdout, stderr, durationMs, outputBytes, artifactPath, artifactHash, preview, launchFailed, launchFailureReason }`.
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
        launchFailed: true, launchFailureReason: `the process was never created (${err.message})`,
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
      const failure = detectLaunchFailure({ exitCode, timedOut, stdout, stderr, errorMessage });
      resolve({
        exitCode, signal, timedOut, stdout, stderr, durationMs, outputBytes,
        artifactPath, artifactHash, preview, errorMessage,
        launchFailed: failure.launchFailed, launchFailureReason: failure.reason,
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
  commit = null,
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
  resolveInterpreterImpl = resolveCommandInterpreter,
  now = () => new Date(),
} = {}) {
  const tracker = budgets || new BudgetTracker(policy);
  const attempts = [];
  const inputTreeHash = computeInputTreeHash(rootDir, relevantFiles);
  const criteriaHash = hashCriteria(criteria);
  const perStepLimit = maxAttemptsOverride ?? (policy?.budgets?.maxRetriesPerStep?.hard ?? 2) + 1;

  // Refuse a command whose interpreter cannot run, before executing anything. The
  // declared command is not rewritten — the point is that a run which never starts
  // must not leave behind a record that could later be read as a red.
  const interpreter = resolveInterpreterImpl(command, {});
  if (interpreter?.required && !interpreter.ok) {
    const detail = `command never launched: ${interpreter.reason}`;
    const evidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId,
      phase,
      gate,
      status: 'blocked',
      command,
      result: detail,
      exitCode: null,
      inputTreeHash,
      criteriaHash,
      relevantFiles,
      commit,
      createdAt: now(),
      source: 'automated',
    });
    attempts.push({
      attempt: 1,
      spanId: newId(),
      tool,
      command,
      exitCode: null,
      durationMs: 0,
      outputBytes: 0,
      artifactPath: null,
      artifactHash: null,
      status: 'blocked',
      retryClass: 'deterministic',
      retryReason: 'interpreter not runnable',
      evidence,
    });
    return finalize({ status: 'blocked', attempts, tracker, inputTreeHash, criteriaHash, stopReason: 'launch-failed', diagnostic: detail });
  }

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

    // `runCommand` reports this directly; an injected runner may not, so fall back
    // to the same detection over its result. A timed-out process did launch.
    const launch = result.launchFailed === true
      ? { launchFailed: true, reason: result.launchFailureReason || 'the command did not launch' }
      : detectLaunchFailure(result);

    const evidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId,
      phase,
      gate,
      status: hardStop.exhausted || hardStop.blocked
        ? 'blocked'
        : (gatePassed ? 'passed' : (result.timedOut ? 'blocked' : (launch.launchFailed ? 'blocked' : 'failed'))),
      command,
      result: hardStop.exhausted
        ? `budget-exhausted: ${hardStop.reason}`
        : (hardStop.blocked
          ? `budget-blocked: ${hardStop.reason}`
          : (launch.launchFailed ? `launch-failed: ${launch.reason}` : describeResult(result))),
      exitCode: result.exitCode,
      artifactPath: result.artifactPath,
      artifactHash: result.artifactHash,
      inputTreeHash,
      criteriaHash,
      relevantFiles,
      commit,
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
      status: result.timedOut ? 'timed-out' : (gatePassed ? 'passed' : (launch.launchFailed ? 'blocked' : 'failed')),
      retryClass: classification.retryClass,
      retryReason: classification.reason,
      evidence,
    });

    lastResult = result;

    // A command that never launched is not a red, and is not retried: a missing or
    // unrunnable interpreter does not appear on a second attempt. It must never reach
    // the retry machinery or the red-before-green check, so it stops here as blocked.
    if (launch.launchFailed) {
      return finalize({
        status: 'blocked',
        attempts,
        tracker,
        inputTreeHash,
        criteriaHash,
        stopReason: 'launch-failed',
        diagnostic: `command never launched: ${command} — ${launch.reason}`,
      });
    }

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
  reason = null, expiresAt = null, environment = null, expiresInMs = null, commit = null,
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
      commit,
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
