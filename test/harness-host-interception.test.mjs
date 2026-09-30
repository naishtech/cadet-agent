/**
 * Phase 8 — host interception.
 *
 * The bug this file pins: enforcement used to be inferred from the presence of a file the framework
 * itself ships, so "Copilot hook: installed" was true in every repository and for every host. A
 * claim that cannot be false is not a measurement, so the tests below assert what the report does
 * when a mechanism is present and broken, present and unactivated, and absent — and that the level
 * is reported per action rather than per repository.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  HOSTS, INTERCEPTION_ACTIONS, ENFORCEMENT_LEVELS, REPO_HOOK, hostById,
  probeHostHook, probeRepoGitHook, enforcementMatrix,
} from '../src/harness/index.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'bin', 'cli.mjs');

function runCli(args, cwd = repoRoot) {
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf-8', cwd, windowsHide: true });
  let json = null;
  for (const text of [r.stdout, r.stderr]) {
    if (!text) continue;
    const start = text.indexOf('{');
    if (start < 0) continue;
    try { json = JSON.parse(text.slice(start)); } catch { /* the other stream */ }
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** Run the shipped guard script with a payload, the way a host would. */
function runGuard(command, toolName = 'bash', root = repoRoot) {
  const script = join(root, '.github/hooks/scripts/git-guard.sh');
  const r = spawnSync('bash', [script], {
    encoding: 'utf-8', cwd: root, windowsHide: true,
    input: JSON.stringify({ toolName, toolInput: command }),
  });
  const match = `${r.stdout}`.match(/"permissionDecision"\s*:\s*"([a-z]+)"/);
  return { status: r.status, decision: match ? match[1] : null, stdout: r.stdout, stderr: r.stderr };
}

/** A repository carrying the shipped files, so probes can be measured against a broken copy. */
function copyOfRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cadet-hosts-'));
  mkdirSync(join(dir, '.github/hooks/scripts'), { recursive: true });
  copyFileSync(join(repoRoot, '.github/hooks/git-guard.json'), join(dir, '.github/hooks/git-guard.json'));
  copyFileSync(join(repoRoot, '.github/hooks/scripts/git-guard.sh'), join(dir, '.github/hooks/scripts/git-guard.sh'));
  mkdirSync(join(dir, '.githooks'), { recursive: true });
  copyFileSync(join(repoRoot, REPO_HOOK.path), join(dir, REPO_HOOK.path));
  return dir;
}

describe('host interception — the declaration', () => {
  it('declares a level for every action of every host, and nothing invented', () => {
    const matrix = enforcementMatrix(repoRoot, { verify: false });
    assert.deepEqual(matrix.rows.map((r) => r.host).sort(), HOSTS.map((h) => h.id).sort());
    for (const row of matrix.rows) {
      assert.deepEqual(Object.keys(row.actions).sort(), [...INTERCEPTION_ACTIONS].sort(),
        `${row.host} must declare every action`);
      for (const action of INTERCEPTION_ACTIONS) {
        const cell = row.actions[action];
        assert.ok(ENFORCEMENT_LEVELS.includes(cell.level), `${row.host}/${action} has an unknown level: ${cell.level}`);
        assert.ok(['probe', 'declared'].includes(cell.establishedBy));
        assert.ok(cell.reason.length > 20, `${row.host}/${action} needs a reason a reader can act on`);
      }
    }
    assert.equal(matrix.verified, false);
    assert.match(matrix.hostHook.reason, /not probed/);
  });

  it('names the portable control, and its activation step', () => {
    assert.equal(REPO_HOOK.configKey, 'core.hooksPath');
    assert.equal(REPO_HOOK.path, '.githooks/pre-commit');
    assert.ok(hostById('copilot').hook.covers.includes('git-write'));
    assert.equal(hostById('cursor').hook, null, 'Cursor has no hook, and the declaration says so');
    assert.equal(existsSync(join(repoRoot, 'docs/core/HostInterception.md')), true, 'the matrix is documented');
  });
});

describe('host interception — the probes', () => {
  it('verifies the shipped guard: it asks about a git write and stays silent on a read', () => {
    const probe = probeHostHook(repoRoot);
    assert.equal(probe.verified, true, probe.reason);
    assert.equal(probe.decisions.gitWrite, 'ask');
    assert.equal(probe.decisions.benign, null);
  });

  it('refuses to count a hook whose script does nothing', () => {
    // The old bug in one fixture: the CONFIG is present, because the framework ships it. A guard
    // that cannot decide is not enforcement, and the level must fall accordingly.
    const dir = copyOfRepo();
    try {
      writeFileSync(join(dir, '.github/hooks/scripts/git-guard.sh'), '#!/usr/bin/env bash\nexit 0\n');
      const probe = probeHostHook(dir);
      assert.equal(probe.verified, false);
      assert.match(probe.reason, /did not ask about a git commit/);

      const matrix = enforcementMatrix(dir, { verify: true });
      const copilot = matrix.rows.find((r) => r.host === 'copilot');
      assert.equal(copilot.actions['git-write'].level, 'advisory',
        'a configured hook that does not decide leaves the action advisory, not native');
      assert.match(copilot.actions['git-write'].reason, /did not verify/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to count a hook config that points at nothing', () => {
    const dir = copyOfRepo();
    try {
      rmSync(join(dir, '.github/hooks/scripts/git-guard.sh'));
      const probe = probeHostHook(dir);
      assert.equal(probe.verified, false);
      assert.match(probe.reason, /points at nothing/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('verifies the repository Git hook only when it is installed, activated and correct', () => {
    const dir = copyOfRepo();
    try {
      // Present but not activated: git never runs it, so it protects nothing.
      const inactive = probeRepoGitHook(dir);
      assert.equal(inactive.verified, false);
      assert.equal(inactive.activated, false);
      assert.match(inactive.reason, /core\.hooksPath/);

      spawnSync('git', ['init', '-q', '.'], { cwd: dir, encoding: 'utf-8' });
      spawnSync('git', ['-C', dir, 'config', 'core.hooksPath', REPO_HOOK.hooksPath], { encoding: 'utf-8' });
      assert.equal(probeRepoGitHook(dir).verified, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports the repository hook as the portable level for a host with no hook of its own', () => {
    const dir = copyOfRepo();
    try {
      spawnSync('git', ['init', '-q', '.'], { cwd: dir, encoding: 'utf-8' });
      spawnSync('git', ['-C', dir, 'config', 'core.hooksPath', REPO_HOOK.hooksPath], { encoding: 'utf-8' });
      const matrix = enforcementMatrix(dir, { verify: true });
      const cursor = matrix.rows.find((r) => r.host === 'cursor');
      assert.equal(cursor.actions['git-write'].level, 'external');
      assert.equal(cursor.actions['git-write'].establishedBy, 'probe');
      assert.equal(cursor.actions['shell-command'].level, 'advisory',
        'the portable control covers git writes, and nothing else: the level is per action');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('host interception — the repository hook is correct', () => {
  it('accepts a valid state document and refuses an unreadable one', () => {
    const dir = copyOfRepo();
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      writeFileSync(join(dir, '.cadet/state.json'), JSON.stringify({
        version: 4, stateVersion: 4,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        epics: {}, gates: {}, gateEvidence: [],
      }, null, 2));
      const ok = spawnSync('bash', [join(dir, REPO_HOOK.path)], { cwd: dir, encoding: 'utf-8', windowsHide: true });
      assert.equal(ok.status, 0, ok.stderr);

      writeFileSync(join(dir, '.cadet/state.json'), '{ this is not json');
      const bad = spawnSync('bash', [join(dir, REPO_HOOK.path)], { cwd: dir, encoding: 'utf-8', windowsHide: true });
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /readable JSON/);
      assert.match(bad.stderr, /--no-verify/, 'the escape hatch is named rather than hidden');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not refuse a commit for unfinished work: that is the gate system job', () => {
    const dir = copyOfRepo();
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      // A valid document with every gate false: work in progress, which must still commit.
      writeFileSync(join(dir, '.cadet/state.json'), JSON.stringify({
        version: 4, stateVersion: 4,
        session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' },
        activeWorkItem: { epicId: 'e', storyId: 's.md' },
        epics: { e: { status: 'in-progress', stories: { 's.md': 'in-progress' } } },
        gates: { testsPassed: false }, gateEvidence: [],
      }, null, 2));
      const r = spawnSync('bash', [join(dir, REPO_HOOK.path)], { cwd: dir, encoding: 'utf-8', windowsHide: true });
      assert.equal(r.status, 0, 'an unmet gate is not a broken document');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('skips without failing when there is no state document at all', () => {
    const dir = copyOfRepo();
    try {
      const r = spawnSync('bash', [join(dir, REPO_HOOK.path)], { cwd: dir, encoding: 'utf-8', windowsHide: true });
      assert.equal(r.status, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('host interception — bypass attempts against the shipped guard', () => {
  const shouldAsk = [
    ['git commit -m "x"', 'the plain form'],
    ['git -c user.name=x commit -m y', 'an option with a value'],
    ['git --no-pager commit', 'a global option'],
    ['/usr/bin/git commit -m x', 'a path-qualified binary'],
    ['git.exe commit -m x', 'the Windows executable name'],
    ['sh -c "git commit -m x"', 'a shell wrapper'],
    ["bash -lc 'git push origin main'", 'a login shell wrapper'],
    ['cd /tmp && git push', 'a chained command'],
    ['git push --force-with-lease origin main', 'a force push'],
    ['gh pr merge 42 --squash', 'the GitHub CLI merge'],
    ['GIT_AUTHOR_NAME=x git commit -m y', 'an environment prefix'],
    // Commit-family plumbing. It does not move a ref, so a strict reader could call this a false
    // positive — and asking is the safe direction for it, so the guard asks and the test says so
    // rather than pretending the classifier is narrower than it is.
    ['git commit-tree HEAD^{tree} -m x', 'commit-family plumbing'],
  ];

  for (const [command, description] of shouldAsk) {
    it(`asks about ${description}`, () => {
      assert.equal(runGuard(command).decision, 'ask', `${command} must require approval`);
    });
  }

  const shouldPass = [
    ['git status', 'a read-only status'],
    ['git log --oneline -3', 'a read-only log'],
    ['git diff HEAD', 'a read-only diff'],
    ['npm test', 'an unrelated command'],
    ['git rev-parse HEAD', 'a read-only plumbing command'],
    ['git show --stat', 'a read-only inspection'],
    ['node scripts/check-no-engine.mjs', 'an architecture check'],
  ];

  for (const [command, description] of shouldPass) {
    it(`stays silent on ${description}`, () => {
      assert.equal(runGuard(command).decision, null, `${command} must not require approval`);
    });
  }

  it('fails closed on malformed input, and says so', () => {
    const script = join(repoRoot, '.github/hooks/scripts/git-guard.sh');
    const r = spawnSync('bash', [script], { encoding: 'utf-8', cwd: repoRoot, windowsHide: true, input: '{ not json' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /"permissionDecision": "deny"/);
    assert.match(r.stderr, /malformed JSON/);
  });
});

describe('host interception — a level is a fact about THIS repository', () => {
  // The defect this pins: `levelFor` read `native` for Copilot straight out of the static host
  // table, with no existsSync and no probe — so an EMPTY repository was reported as natively
  // protected. That is the same defect as the `hook.copilot` boolean C19 removed, one level up:
  // true everywhere, measuring nothing.
  it('does not claim native in a repository with no hook at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadet-hosts-empty-'));
    try {
      mkdirSync(join(dir, '.cadet'), { recursive: true });
      const matrix = enforcementMatrix(dir, { verify: false });
      const copilot = matrix.rows.find((r) => r.host === 'copilot').actions['git-write'];
      assert.equal(copilot.level, 'advisory', 'no hook file means no native level');
      assert.equal(copilot.establishedBy, 'declared');
      assert.match(copilot.reason, /no \.github\/hooks\/git-guard\.json/);
      // And the portable control is not credited either, for the same reason.
      const cursor = matrix.rows.find((r) => r.host === 'cursor').actions['git-write'];
      assert.equal(cursor.level, 'advisory');
      assert.match(cursor.reason, /no \.githooks\/pre-commit/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('claims native only where the repository configures the mechanism', () => {
    const matrix = enforcementMatrix(repoRoot, { verify: false });
    const copilot = matrix.rows.find((r) => r.host === 'copilot').actions['git-write'];
    assert.equal(copilot.level, 'native');
    assert.equal(copilot.establishedBy, 'declared', 'unprobed: it says so rather than claiming a measurement');
    assert.match(copilot.reason, /git-guard\.json/);
  });
});

describe('host interception — every declared variant is measured', () => {
  /** A runner that answers availability probes and payloads the way a working guard would. */
  const fakeRunner = ({ available, answer }) => (cmd, args, opts = {}) => {
    if (args.includes('-c') || args.includes('-Command')) {
      return { status: available.includes(cmd) ? 0 : 1, stdout: '', stderr: '' };
    }
    const payload = JSON.parse(opts.input || '{}');
    const decision = answer(cmd, payload.toolInput);
    return { status: 0, stdout: decision ? JSON.stringify({ hookSpecificOutput: { permissionDecision: decision } }) : '', stderr: '' };
  };
  const correct = (cmd, command) => (/\bgit\b.*\bcommit\b/.test(command) ? 'ask' : null);
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'cadet-hosts-variants-'));
    mkdirSync(join(d, '.github/hooks/scripts'), { recursive: true });
    copyFileSync(join(repoRoot, '.github/hooks/git-guard.json'), join(d, '.github/hooks/git-guard.json'));
    copyFileSync(join(repoRoot, '.github/hooks/scripts/git-guard.sh'), join(d, '.github/hooks/scripts/git-guard.sh'));
    copyFileSync(join(repoRoot, '.github/hooks/scripts/git-guard.ps1'), join(d, '.github/hooks/scripts/git-guard.ps1'));
    return d;
  };

  it('verifies when one variant runs and names the one it could not measure', () => {
    const d = dir();
    try {
      // Only bash exists here: the PowerShell variant must be reported as unmeasured, not counted
      // as a pass and not used to deny the level.
      const probe = probeHostHook(d, undefined, { runner: fakeRunner({ available: ['bash'], answer: correct }) });
      assert.equal(probe.verified, true, probe.reason);
      assert.equal(probe.variants.bash.verified, true);
      assert.equal(probe.variants.powershell.verified, null);
      assert.match(probe.reason, /unmeasured here: powershell/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('verifies through PowerShell alone when bash is absent', () => {
    const d = dir();
    try {
      // The case the old probe could not express: a Windows host with no bash on PATH. Before, the
      // bash-only probe could not pass at all, so the mechanism it was measuring was capped at
      // `advisory` on the hosts most likely to use the PowerShell variant.
      const probe = probeHostHook(d, undefined, { runner: fakeRunner({ available: ['pwsh'], answer: correct }) });
      assert.equal(probe.verified, true, probe.reason);
      assert.equal(probe.variants.powershell.interpreter, 'pwsh');
      assert.match(probe.reason, /unmeasured here: bash/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('refuses the level when a variant that ran answered wrongly', () => {
    const d = dir();
    try {
      const probe = probeHostHook(d, undefined, {
        runner: fakeRunner({ available: ['bash', 'pwsh'], answer: (cmd, command) => (cmd === 'bash' ? correct(cmd, command) : 'ask') }),
      });
      assert.equal(probe.verified, false);
      assert.match(probe.reason, /did not answer correctly in every variant that ran/);
      assert.match(probe.reason, /pwsh: decided something about a read-only git command/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('host interception — the shipped PowerShell guard is runnable on Windows', () => {
  // The defect this pins, found by asking whether the probe measured what the host runs: the
  // shipped guard is UTF-8 WITHOUT a BOM and contains em dashes inside a double-quoted string.
  // Windows PowerShell 5.1 - the default `powershell` on every Windows machine - decodes a
  // BOM-less UTF-8 file with the ANSI code page, so byte 0x94 of an em dash becomes U+201D, which
  // it reads as a string terminator: the file fails to parse, the guard exits 0 with no decision,
  // and NOTHING is intercepted on exactly the host the variant is declared for. Adding the BOM
  // (which the repository's own `package-agent.ps1` already had) fixes it.
  const guard = join(repoRoot, '.github/hooks/scripts/git-guard.ps1');

  it('carries a UTF-8 BOM, so an ANSI-decoding interpreter parses it correctly', () => {
    const bytes = readFileSync(guard);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM-less UTF-8 PowerShell file with non-ASCII in it is a parse error under Windows PowerShell 5.1');
  });

  it('runs under Windows PowerShell and answers ask/silent', (t) => {
    const which = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf-8', windowsHide: true });
    if (which.status !== 0) return t.skip('Windows PowerShell is not available here');
    const decide = (command) => {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-File', guard], {
        encoding: 'utf-8', cwd: repoRoot, windowsHide: true,
        input: JSON.stringify({ toolName: 'run_in_terminal', toolInput: command }),
      });
      const m = `${r.stdout}`.match(/"permissionDecision"\s*:\s*"([a-z]+)"/);
      return { status: r.status, decision: m ? m[1] : null, stderr: r.stderr };
    };
    const write = decide('git commit -m "x"');
    assert.equal(write.stderr, '', 'the guard must parse, not fail');
    assert.equal(write.decision, 'ask');
    assert.equal(decide('git status').decision, null);
  });
});

describe('host interception — the report', () => {
  it('reports per action, and never infers enforcement from a file being present', () => {
    // The repository being measured ships BOTH files, and the measured answer is still allowed to
    // be "advisory": that is the whole point of measuring rather than looking.
    const r = runCli(['harness', 'capabilities', '--verify-host', '--format', 'json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.json?.enforcement?.verified, true);
    assert.equal(typeof r.json.capabilities.hook.verified, 'boolean');
    assert.equal(Object.hasOwn(r.json.capabilities.hook, 'copilot'), false,
      'the old per-repository boolean is gone: it read true for every consumer');
    for (const row of r.json.enforcement.rows) {
      assert.deepEqual(Object.keys(row.actions).sort(), [...INTERCEPTION_ACTIONS].sort());
    }
    for (const line of r.json.enforcement.rows) {
      for (const action of INTERCEPTION_ACTIONS) assert.ok(line.actions[action].reason);
    }
  });

  it('marks the unverified report as declared rather than measured', () => {
    const r = runCli(['harness', 'capabilities', '--format', 'json']);
    assert.equal(r.json?.enforcement?.verified, false);
    assert.match(r.json.enforcement.hostHook.reason, /not probed/);
  });

  it('fails the whole report loudly if a host declaration is malformed', () => {
    // Cheap guard on the data table itself: a level outside the vocabulary would make the report
    // unreadable at exactly the moment someone is relying on it.
    for (const host of HOSTS) {
      assert.ok(host.id && host.label && host.pointerRoot, `host ${host.id} is incomplete`);
      if (host.hook) assert.ok(Array.isArray(host.hook.covers));
    }
  });
});
