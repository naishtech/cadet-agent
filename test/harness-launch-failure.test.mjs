import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLaunchFailure, commandInterpreter, resolveCommandInterpreter, isWslShim,
  POSIX_INTERPRETERS, LAUNCH_FAILURE_SIGNATURES,
  runVerificationLoop, runCommand,
} from '../src/harness/verification.mjs';
import { defaultPolicy } from '../src/harness/policy.mjs';

const policy = defaultPolicy();

function fakeResult(over = {}) {
  return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', durationMs: 5, outputBytes: 5, artifactPath: null, artifactHash: null, preview: '', errorMessage: '', ...over };
}

function loopDeps(results) {
  let i = 0;
  const commands = [];
  return {
    runCommandImpl: async (command) => {
      commands.push(command);
      const r = results[Math.min(i, results.length - 1)];
      i++;
      return r;
    },
    sleepImpl: async () => {},
    commands,
  };
}

const notRequired = () => ({ required: false, ok: true, interpreter: null, usable: [], shims: [], reason: null });

// ── A launch failure is not a test result ───────────────────────────────

describe('verification — launch failure detection', () => {
  it('treats a spawn error as a launch failure, not a test failure', () => {
    const r = detectLaunchFailure(fakeResult({ exitCode: null, errorMessage: 'spawn bash ENOENT' }));
    assert.equal(r.launchFailed, true);
    assert.match(r.reason, /never created/);
    assert.match(r.reason, /spawn bash ENOENT/);
  });

  it('treats the POSIX command-not-found exit codes as launch failures', () => {
    assert.equal(detectLaunchFailure(fakeResult({ exitCode: 127 })).launchFailed, true);
    assert.equal(detectLaunchFailure(fakeResult({ exitCode: 126 })).launchFailed, true);
  });

  it('treats a cmd.exe "not recognized" failure as a launch failure', () => {
    const r = detectLaunchFailure(fakeResult({
      exitCode: 1,
      stderr: "'bash' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n",
    }));
    assert.equal(r.launchFailed, true);
  });

  it('treats the WSL stub error as a launch failure', () => {
    const r = detectLaunchFailure(fakeResult({
      exitCode: 1,
      stderr: '<3>WSL (12) ERROR: CreateProcessCommon:559: execvpe(/bin/bash) failed: No such file or directory\n',
    }));
    assert.equal(r.launchFailed, true);
  });

  it('treats a WSL install with no distribution as a launch failure', () => {
    const r = detectLaunchFailure(fakeResult({
      exitCode: 1,
      stderr: 'Windows Subsystem for Linux has no installed distributions.\n',
    }));
    assert.equal(r.launchFailed, true);
  });

  it('does not treat a genuine assertion failure as a launch failure', () => {
    const r = detectLaunchFailure(fakeResult({ exitCode: 1, stderr: 'AssertionError: expected 1 to equal 2' }));
    assert.equal(r.launchFailed, false);
    assert.equal(r.reason, null);
  });

  it('does not treat a genuine non-zero test exit as a launch failure', () => {
    assert.equal(detectLaunchFailure(fakeResult({ exitCode: 2, stdout: 'Tests: 3 failed, 1 passed' })).launchFailed, false);
    assert.equal(detectLaunchFailure(fakeResult({ exitCode: 1 })).launchFailed, false);
  });

  it('does not treat success as a launch failure', () => {
    assert.equal(detectLaunchFailure(fakeResult({ exitCode: 0 })).launchFailed, false);
  });

  it('exposes the signature list it matches on', () => {
    assert.ok(Array.isArray(LAUNCH_FAILURE_SIGNATURES));
    assert.ok(LAUNCH_FAILURE_SIGNATURES.some((s) => /not recognized/.test(s)));
  });

  it('flags the reported case — a shell that never ran the suite', () => {
    // Observed on Windows: bare `bash` resolved to the WSL stub, which cannot exec
    // a real shell. The suite never starts, yet the exit code is non-zero.
    const r = detectLaunchFailure(fakeResult({
      exitCode: 127,
      stderr: 'bash: run-tests.sh: No such file or directory\n',
    }));
    assert.equal(r.launchFailed, true);
  });
});

// ── Interpreter resolution ─────────────────────────────────────────────

describe('verification — interpreter resolution', () => {
  it('extracts a bare interpreter leader and ignores everything else', () => {
    assert.equal(commandInterpreter('bash run-tests.sh'), 'bash');
    assert.equal(commandInterpreter('  npm test  '), 'npm');
    assert.equal(commandInterpreter('"C:\\Program Files\\Git\\bin\\bash.exe" -c x'), 'C:\\Program Files\\Git\\bin\\bash.exe');
    assert.equal(commandInterpreter(''), null);
    assert.equal(commandInterpreter(null), null);
  });

  it('recognises the WSL shim locations and nothing else', () => {
    assert.equal(isWslShim('C:\\Windows\\System32\\bash.exe'), true);
    assert.equal(isWslShim('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe'), true);
    assert.equal(isWslShim('C:\\Windows\\System32\\wsl.exe'), true);
    assert.equal(isWslShim('C:\\Program Files\\Git\\usr\\bin\\bash.exe'), false);
    assert.equal(isWslShim('/usr/bin/bash'), false);
  });

  it('does not require resolution for a non-POSIX command', () => {
    const r = resolveCommandInterpreter('npm test', { platform: 'win32', candidates: () => [] });
    assert.equal(r.required, false);
    assert.equal(r.ok, true);
  });

  it('does not require resolution off Windows', () => {
    const r = resolveCommandInterpreter('bash run-tests.sh', { platform: 'linux', candidates: () => [] });
    assert.equal(r.ok, true);
  });

  it('refuses a POSIX interpreter that resolves only to the WSL stub, with an actionable reason', () => {
    const r = resolveCommandInterpreter('bash run-tests.sh', {
      platform: 'win32',
      candidates: () => ['C:\\Windows\\System32\\bash.exe', 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe'],
    });
    assert.equal(r.required, true);
    assert.equal(r.ok, false);
    assert.match(r.reason, /Windows Subsystem for Linux/);
    assert.match(r.reason, /bash/);
    assert.equal(r.usable.length, 0);
    assert.equal(r.shims.length, 2);
  });

  it('accepts a real bash on PATH', () => {
    const r = resolveCommandInterpreter('bash run-tests.sh', {
      platform: 'win32',
      candidates: () => ['C:\\Program Files\\Git\\usr\\bin\\bash.exe'],
      probe: () => true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.usable.length, 1);
  });

  it('refuses when a real candidate exists but cannot execute', () => {
    const r = resolveCommandInterpreter('bash x.sh', {
      platform: 'win32',
      candidates: () => ['C:\\Program Files\\Git\\usr\\bin\\bash.exe'],
      probe: () => false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /not runnable|usable/i);
  });

  it('treats the suffixed bash.exe leader as the same ambiguity', () => {
    const r = resolveCommandInterpreter('bash.exe run-tests.sh', {
      platform: 'win32',
      candidates: () => ['C:\\Windows\\System32\\bash.exe'],
    });
    assert.equal(r.required, true);
    assert.equal(r.ok, false);
  });

  it('lists the POSIX interpreters it guards', () => {
    assert.ok(POSIX_INTERPRETERS.includes('bash'));
    assert.ok(POSIX_INTERPRETERS.includes('sh'));
    assert.ok(!POSIX_INTERPRETERS.includes('npm'));
  });
});

// ── The red-before-green integrity property ────────────────────────────

describe('verification — a non-launch cannot be a red', () => {
  it('records a non-launching attempt as blocked, not failed, and does not retry it', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 127, stderr: "'nosuchcmd' is not recognized as an internal or external command" })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'nosuchcmd', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
      resolveInterpreterImpl: notRequired,
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.ok, false);
    assert.equal(result.stopReason, 'launch-failed');
    assert.equal(deps.commands.length, 1);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].evidence.status, 'blocked');
    assert.equal(result.attempts[0].status, 'blocked');
  });

  it('surfaces a concrete diagnostic naming the command', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 127 })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'bash run-tests.sh', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
      resolveInterpreterImpl: notRequired,
    });
    assert.match(result.diagnostic, /bash run-tests\.sh/);
  });

  it('does not let a blocked launch failure license a green (prior evidence)', async () => {
    const green = loopDeps([fakeResult({ exitCode: 0, stdout: 'all tests passed' })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'bash run-tests.sh', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: true,
      priorEvidence: [{ gate: 'testsPassed', workItemId: 'w', status: 'blocked', stopReason: 'launch-failed' }],
      runCommandImpl: green.runCommandImpl, sleepImpl: green.sleepImpl,
      resolveInterpreterImpl: notRequired,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'red-required');
  });

  it('stops at a launch failure and never reports a passing gate', async () => {
    // Attempt 1 never launched. A command that cannot launch is not retried, and
    // the record it leaves must not be readable as a red.
    const deps = loopDeps([
      fakeResult({ exitCode: 127, stderr: 'bash: run-tests.sh: No such file or directory' }),
      fakeResult({ exitCode: 0, stdout: 'all tests passed' }),
    ]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'bash run-tests.sh', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: true, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
      resolveInterpreterImpl: notRequired,
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.ok, false);
    assert.equal(result.attempts.length, 1, 'a command that cannot launch is not retried');
    assert.equal(result.attempts[0].evidence.status, 'blocked');
    assert.notEqual(result.attempts[0].evidence.status, 'failed');

    // Carrying that record forward still cannot license a green.
    const green = loopDeps([fakeResult({ exitCode: 0, stdout: 'all tests passed' })]);
    const later = await runVerificationLoop({
      gate: 'testsPassed', command: 'bash run-tests.sh', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: true,
      priorEvidence: [result.attempts[0].evidence],
      runCommandImpl: green.runCommandImpl, sleepImpl: green.sleepImpl,
      resolveInterpreterImpl: notRequired,
    });
    assert.equal(later.status, 'failed');
    assert.equal(later.stopReason, 'red-required');
  });

  it('still lets a genuine red license a green (guard against over-correction)', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 0, stdout: 'all tests passed' })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: true,
      priorEvidence: [{ gate: 'testsPassed', workItemId: 'w', status: 'failed' }],
      runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
      resolveInterpreterImpl: notRequired,
    });
    assert.equal(result.status, 'passed');
  });
});

// ── The preflight refuses before executing anything ────────────────────

describe('verification — uninterruptible interpreter preflight', () => {
  it('refuses, without executing, when the interpreter is only the WSL stub', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 0 })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'bash run-tests.sh', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
      resolveInterpreterImpl: () => ({
        required: true, ok: false, interpreter: 'bash', usable: [], shims: ['C:\\Windows\\System32\\bash.exe'],
        reason: "'bash' resolves only to the Windows Subsystem for Linux stub (C:\\Windows\\System32\\bash.exe)",
      }),
    });
    assert.equal(deps.commands.length, 0, 'nothing may execute when the interpreter cannot run');
    assert.equal(result.status, 'blocked');
    assert.equal(result.stopReason, 'launch-failed');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].evidence.status, 'blocked');
    assert.match(result.diagnostic, /Windows Subsystem for Linux/);
  });

  it('runs normally when resolution is not required', async () => {
    const deps = loopDeps([fakeResult({ exitCode: 0 })]);
    const result = await runVerificationLoop({
      gate: 'testsPassed', command: 'npm test', workItemId: 'w', phase: 'implementation',
      policy, requireRedFirst: false, runCommandImpl: deps.runCommandImpl, sleepImpl: deps.sleepImpl,
      resolveInterpreterImpl: notRequired,
    });
    assert.equal(result.status, 'passed');
    assert.equal(deps.commands.length, 1);
  });
});

// ── Real processes (host-dependent) ────────────────────────────────────

describe('verification — runCommand reports launch failure on a real process', () => {
  it('flags a genuinely missing command', async (t) => {
    if (process.platform !== 'win32') return t.skip('cmd.exe resolution is Windows-specific');
    const r = await runCommand('cadet-definitely-not-a-command-98765', { cwd: process.cwd(), timeoutMs: 15000 });
    assert.equal(r.launchFailed, true);
  });

  it('does not flag a real command that exits non-zero', async () => {
    const r = await runCommand('node -e "process.exit(2)"', { cwd: process.cwd(), timeoutMs: 15000 });
    assert.equal(r.exitCode, 2);
    assert.equal(r.launchFailed, false);
  });
});
