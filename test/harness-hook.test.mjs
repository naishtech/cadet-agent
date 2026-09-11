import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHook, detectWrite, hookOutput, RELEVANT_TOOLS } from '../src/harness/hook.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const shellGuard = join(repoRoot, '.github', 'hooks', 'scripts', 'git-guard.sh');

function payload(toolName, toolInput) {
  return JSON.stringify({ toolName, toolInput });
}

describe('hook — decision logic', () => {
  it('asks for approval on git commit', () => {
    const r = evaluateHook(payload('run_in_terminal', 'git commit -m "x"'));
    assert.equal(r.decision, 'ask');
    assert.equal(r.output.hookSpecificOutput.permissionDecision, 'ask');
    assert.match(r.output.hookSpecificOutput.permissionDecisionReason, /git commit/);
  });

  it('asks for approval on git push', () => {
    const r = evaluateHook(payload('bash', 'git push origin main'));
    assert.equal(r.decision, 'ask');
  });

  it('asks for approval on gh pr merge', () => {
    const r = evaluateHook(payload('execute', 'gh pr merge 42 --squash'));
    assert.equal(r.decision, 'ask');
  });

  it('passes read-only git commands', () => {
    for (const cmd of ['git status', 'git log --oneline', 'git diff', 'git fetch', 'git pull', 'git branch', 'gh pr view 1']) {
      assert.equal(evaluateHook(payload('bash', cmd)).decision, 'pass', `should pass: ${cmd}`);
    }
  });

  it('blocks malformed JSON with a structured hook-error', () => {
    const r = evaluateHook('{ this is not json');
    assert.equal(r.decision, 'deny');
    assert.equal(r.code, 'hook-error');
    assert.equal(r.output.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('blocks a recognized shell tool with unrecognized input', () => {
    const r = evaluateHook(JSON.stringify({ toolName: 'bash', toolInput: 123 }));
    // numeric input is coerced to a string command that does not match a write -> pass
    assert.equal(r.decision, 'pass');
    const r2 = evaluateHook(JSON.stringify({ toolName: 'bash', toolInput: '' }));
    assert.equal(r2.decision, 'deny');
    assert.equal(r2.code, 'hook-error');
  });

  it('passes non-relevant tools', () => {
    assert.equal(evaluateHook(payload('read_file', 'git commit -m x')).decision, 'pass');
    assert.equal(evaluateHook(payload('edit', 'x')).decision, 'pass');
  });

  it('passes an empty payload', () => {
    assert.equal(evaluateHook('').decision, 'pass');
    assert.equal(evaluateHook('   ').decision, 'pass');
  });

  it('tolerates light command obfuscation', () => {
    assert.equal(detectWrite('g\\it commit -m x'), 'git commit');
    assert.equal(detectWrite('"git" commit -m x'), 'git commit');
    assert.equal(detectWrite('git -c user.name=x commit -m y'), 'git commit');
    assert.equal(detectWrite('git --no-pager push origin main'), 'git push');
  });

  it('fail-open mode is explicit and logged', () => {
    const diagnostics = [];
    const r = evaluateHook('{ bad json', { mode: 'fail-open', log: (m) => diagnostics.push(m) });
    assert.equal(r.decision, 'pass');
    assert.equal(r.compatibilityMode, 'fail-open');
    assert.ok(diagnostics.length >= 1, 'fail-open must log a diagnostic');
  });

  it('serializes only the host output', () => {
    const r = evaluateHook(payload('bash', 'git commit -m x'));
    const out = hookOutput(r);
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(hookOutput({ output: null }), '');
  });

  it('exposes the expected relevant tools', () => {
    assert.deepEqual([...RELEVANT_TOOLS], ['run_in_terminal', 'execute', 'bash', 'shell']);
  });
});

describe('hook — git-guard.sh script', () => {
  function runGuard(input, { cwd = repoRoot, env = {} } = {}) {
    return spawnSync('bash', [shellGuard], {
      input,
      encoding: 'utf-8',
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
  }

  it('emits ask for git commit', () => {
    const res = runGuard(payload('run_in_terminal', 'git commit -m "x"'));
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  });

  it('emits ask for git push', () => {
    const res = runGuard(payload('bash', 'git push origin main'));
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'ask');
  });

  it('emits deny for malformed JSON', () => {
    const res = runGuard('{ not json');
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('emits nothing for a read-only git command', () => {
    const res = runGuard(payload('bash', 'git status'));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  it('emits nothing for a non-relevant tool', () => {
    const res = runGuard(payload('read_file', 'git commit'));
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  it('honors fail-open via the environment variable and logs to stderr', () => {
    const res = runGuard('{ not json', { env: { CADET_GIT_GUARD_MODE: 'fail-open' } });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
    assert.match(res.stderr, /fail-open/);
  });

  it('blocks an obfuscated git commit', () => {
    const res = runGuard(payload('bash', 'git   -c  user.name=x   commit -m y'));
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'ask');
  });
});
