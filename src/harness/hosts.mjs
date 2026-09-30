/**
 * Host interception — what a host can actually stop, measured.
 *
 * The problem this module exists to fix: enforcement used to be inferred from the presence of a
 * file. A fresh install ships `.github/hooks/git-guard.json`, so "Copilot hook: installed" was
 * true for every consumer repository whether or not Copilot was ever used, and whether or not the
 * host consulted the hook. A claim that cannot be false is not a measurement.
 *
 * Three levels, from the plan's host-interception contract:
 *
 *   - `native`   — the host blocks (or asks about) the action before execution. Claimed only when
 *                  the configured mechanism is present AND its probe answers correctly here.
 *   - `external` — a control outside the host decides: a repository Git hook that is installed and
 *                  verified, or an OS/client approval policy that the framework cannot read.
 *   - `advisory` — instructions ask for compliance and nothing intercepts. This is the floor, and
 *                  it is the honest level for most host/action pairs.
 *
 * The level is reported PER ACTION, never per repository — that was the shape of the old bug.
 * A host that can intercept tool calls is not thereby intercepting anything in particular, and a
 * guard that asks about `git commit` is not a control over arbitrary shell commands.
 */

import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** The actions the contract requires a level for. */
export const INTERCEPTION_ACTIONS = Object.freeze([
  'git-write',
  'shell-command',
  'filesystem-write',
  'unity-mutation',
  'context-load',
  'harness-routing',
]);

/** The three levels, strongest first. */
export const ENFORCEMENT_LEVELS = Object.freeze(['native', 'external', 'advisory']);

/** How a level was established: a probe the framework ran, or a declaration it cannot verify. */
export const ESTABLISHED_BY = Object.freeze(['probe', 'declared']);

/** Interpreters a declared PowerShell variant may run under, best first. */
export const POWERSHELL_INTERPRETERS = Object.freeze(['pwsh', 'powershell']);

/** Where a host's pointer files live, and the guard it can carry. */
export const HOSTS = Object.freeze([
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    pointerRoot: '.github/',
    hook: {
      configPath: '.github/hooks/git-guard.json',
      scripts: { bash: '.github/hooks/scripts/git-guard.sh', powershell: '.github/hooks/scripts/git-guard.ps1' },
      covers: ['git-write'],
    },
    clientPolicy: 'Copilot asks for approval on terminal commands according to its own settings; the shipped PreToolUse hook adds a decision for git writes.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    pointerRoot: '.claude/',
    hook: null,
    clientPolicy: 'Claude Code honours hooks and permission modes; this repository configures neither, so nothing is intercepted until a hook is added and probed.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    pointerRoot: '.cursor/',
    hook: null,
    clientPolicy: 'Cursor has no PreToolUse equivalent. Its auto-run and approval settings are the only control, and the framework cannot read them.',
  },
  {
    id: 'continue',
    label: 'Continue',
    pointerRoot: '.continue/',
    hook: null,
    clientPolicy: 'Continue has no PreToolUse equivalent; approval is a client setting outside the repository.',
  },
  {
    id: 'deep-code',
    label: 'Deep Code',
    pointerRoot: '.agents/',
    hook: null,
    clientPolicy: 'No hook. `.deepcode/settings.json` → `permissions.ask` with `mutate-git-log` is the external route; the framework cannot verify it from the repository.',
  },
  {
    id: 'hermes',
    label: 'Hermes',
    pointerRoot: '.agents/',
    hook: null,
    clientPolicy: 'No hook. Hermes command-approval policies are the external route; the framework cannot verify them from the repository.',
  },
  {
    id: 'cross-client',
    label: 'Cross-client (AGENTS.md)',
    pointerRoot: 'AGENTS.md',
    hook: null,
    clientPolicy: 'A root pointer file with no execution surface of its own; every level is advisory.',
  },
]);

/** The host declaration by id, or null. */
export function hostById(id) {
  return HOSTS.find((h) => h.id === id) || null;
}

/** The repository Git hook this framework ships, and the git config key that activates it. */
export const REPO_HOOK = Object.freeze({
  path: '.githooks/pre-commit',
  hooksPath: '.githooks',
  configKey: 'core.hooksPath',
});

const P = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf-8', windowsHide: true, ...opts });

/** Can this interpreter run here? Probed, not assumed from the platform. */
function interpreterRuns(cmd, kind, runner) {
  const probe = kind === 'powershell'
    ? runner(cmd, ['-NoProfile', '-Command', 'exit 0'])
    : runner(cmd, ['-c', 'exit 0']);
  return probe.status === 0;
}

/**
 * Probe the host hook: does the configured mechanism answer this repository's questions?
 *
 * "Where safe" means no network, no editor, and no writes: the probe feeds the guard a synthetic
 * PreToolUse payload — one git write, one benign call — and checks that it decides the way its
 * contract says.
 *
 * EVERY declared variant is measured, and that matters: the shipped config declares the guard twice
 * (a `.sh` for bash and a `.ps1` for PowerShell), and a Windows host runs the PowerShell one. A probe
 * that only ran the bash variant credited a level to a script the host may never execute, and on a
 * machine without bash it could not pass at all — capping the mechanism it was supposed to measure
 * at `advisory`. A variant that cannot be launched here is recorded as unmeasured and named in the
 * reason, rather than counted either way.
 */
export function probeHostHook(targetDir, host = hostById('copilot'), { runner = P } = {}) {
  const config = host?.hook?.configPath ? join(targetDir, host.hook.configPath) : null;
  if (!config || !host?.hook?.scripts) return { verified: false, reason: 'this host carries no configured hook', decisions: {}, variants: {} };
  if (!existsSync(config)) return { verified: false, reason: `${host.hook.configPath} is not present`, decisions: {}, variants: {} };

  const variants = {};
  const measured = [];
  const unmeasurable = [];

  for (const [kind, relPath] of Object.entries(host.hook.scripts)) {
    const script = join(targetDir, relPath);
    if (!existsSync(script)) {
      variants[kind] = { present: false, verified: false, reason: `${relPath} is not present, so the hook config points at nothing` };
      measured.push(kind);
      continue;
    }
    const candidates = kind === 'powershell' ? POWERSHELL_INTERPRETERS : ['bash'];
    const interpreter = candidates.find((cmd) => interpreterRuns(cmd, kind, runner));
    if (!interpreter) {
      variants[kind] = { present: true, verified: null, interpreter: null, reason: `no ${kind} interpreter on this host, so this variant could not be measured` };
      unmeasurable.push(kind);
      continue;
    }
    const decide = (payload) => {
      const r = runner(interpreter, kind === 'powershell' ? ['-NoProfile', '-File', script] : [script], { input: JSON.stringify(payload), cwd: targetDir });
      const match = `${r.stdout || ''}`.match(/"permissionDecision"\s*:\s*"([a-z]+)"/);
      return { status: r.status, decision: match ? match[1] : null, stderr: r.stderr || '' };
    };
    const write = decide({ toolName: 'run_in_terminal', toolInput: 'git commit -m "x"' });
    const benign = decide({ toolName: 'run_in_terminal', toolInput: 'git status' });
    const ok = write.decision === 'ask' && benign.decision === null;
    variants[kind] = {
      present: true,
      interpreter,
      verified: ok,
      decisions: { gitWrite: write.decision, benign: benign.decision },
      reason: ok
        ? `${interpreter}: asks about git writes and stays silent on read-only commands`
        : write.decision !== 'ask'
          ? `${interpreter}: did not ask about a git commit (it answered "${write.decision || 'nothing'}")`
          : `${interpreter}: decided something about a read-only git command (it answered "${benign.decision}")`,
    };
    measured.push(kind);
  }

  const decisions = Object.values(variants).find((v) => v.decisions)?.decisions || {};
  const verifiedVariants = measured.filter((k) => variants[k].verified === true);
  const failedVariants = measured.filter((k) => variants[k].verified === false);
  const note = unmeasurable.length ? `; unmeasured here: ${unmeasurable.join(', ')}` : '';
  if (verifiedVariants.length > 0 && failedVariants.length === 0) {
    return { verified: true, decisions, variants, reason: `the guard answers correctly (${verifiedVariants.map((k) => variants[k].reason).join('; ')})${note}` };
  }
  if (verifiedVariants.length === 0 && failedVariants.length === 0) {
    return { verified: false, decisions, variants, reason: `no declared variant of the guard could be measured here${note || ' (none is present)'}` };
  }
  return {
    verified: false, decisions, variants,
    reason: `the guard did not answer correctly in every variant that ran (${failedVariants.map((k) => variants[k].reason).join('; ')})${note}`,
  };
}

/**
 * Probe the repository Git hook: installed, activated, and correct?
 *
 * A hook in `.githooks/` does nothing until `core.hooksPath` points at it, and a claim that it
 * protects commits would be false until then. Correctness is probed by running it against a valid
 * and an invalid state document in a scratch directory of its own, so the probe never touches the
 * repository it is measuring.
 */
export function probeRepoGitHook(targetDir, { runner = P } = {}) {
  const hookPath = join(targetDir, REPO_HOOK.path);
  if (!existsSync(hookPath)) {
    return { verified: false, reason: `${REPO_HOOK.path} is not installed in this repository`, activated: false };
  }
  const configured = runner('git', ['-C', targetDir, 'config', '--get', REPO_HOOK.configKey]);
  const hooksPath = (configured.stdout || '').trim();
  const activated = hooksPath !== '' && hooksPath.replace(/^\.\//, '') === REPO_HOOK.hooksPath;
  if (!activated) {
    return {
      verified: false, activated: false,
      reason: `the hook exists but ${REPO_HOOK.configKey} is "${hooksPath || '(unset)'}", so git never runs it — run "git config ${REPO_HOOK.configKey} ${REPO_HOOK.hooksPath}"`,
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), 'cadet-hook-probe-'));
  try {
    // The hook resolves its repository with `git rev-parse --show-toplevel || pwd`. If the scratch
    // directory happened to sit inside a work tree, that would return the ENCLOSING repository and
    // the probe would validate a state document it never wrote — a verdict about the wrong tree.
    // Probe the ceiling before trusting the run.
    const topLevel = runner('git', ['-C', scratch, 'rev-parse', '--show-toplevel']);
    const resolved = `${topLevel.stdout || ''}`.trim();
    if (resolved !== '') {
      return {
        verified: false, activated,
        reason: `the probe's scratch directory sits inside the git work tree ${resolved}, so the hook would judge that repository instead of the fixture`,
      };
    }
    mkdirSync(join(scratch, '.cadet'), { recursive: true });
    const valid = { version: 4, stateVersion: 4, session: { workflowPath: 'large', currentPhase: 'implementation', trackingMode: 'markdown' }, epics: {}, gates: {}, gateEvidence: [] };
    writeFileSync(join(scratch, '.cadet', 'state.json'), JSON.stringify(valid, null, 2));
    const okRun = runner('bash', [hookPath], { cwd: scratch });
    writeFileSync(join(scratch, '.cadet', 'state.json'), '{ not json');
    const badRun = runner('bash', [hookPath], { cwd: scratch });
    if (okRun.status !== 0) {
      return { verified: false, activated, reason: `the hook refused a valid state document (exit ${okRun.status}): ${(okRun.stderr || okRun.stdout || '').trim().slice(0, 200)}` };
    }
    if (badRun.status === 0) {
      return { verified: false, activated, reason: 'the hook accepted an unreadable state document, so it does not protect anything' };
    }
    return { verified: true, activated, reason: 'the hook runs, accepts a valid state document and refuses an unreadable one' };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The measured matrix: one level per host per action.
 *
 * `verify: true` runs the probes. Without it the declared position is returned and marked
 * `declared`, which is what the report prints — the point is that a reader can always tell a
 * probe result from a declaration.
 */
export function enforcementMatrix(targetDir, { runner = P, verify = false } = {}) {
  const hostHook = verify ? probeHostHook(targetDir, hostById('copilot'), { runner }) : null;
  const repoHook = verify ? probeRepoGitHook(targetDir, { runner }) : null;

  const rows = HOSTS.map((host) => {
    const actions = {};
    for (const action of INTERCEPTION_ACTIONS) {
      actions[action] = levelFor(host, action, { hostHook, repoHook, verify, targetDir });
    }
    return { host: host.id, label: host.label, pointerRoot: host.pointerRoot, clientPolicy: host.clientPolicy, actions };
  });

  return {
    verified: verify === true,
    hostHook: hostHook || { verified: false, reason: 'not probed (pass --verify-host to measure)', decisions: {} },
    repoHook: repoHook || { verified: false, reason: 'not probed (pass --verify-host to measure)' },
    rows,
  };
}

/**
 * The level for one host/action pair.
 *
 * The rules, in order, and each one is a fact about a control rather than about a file that exists:
 *
 *   1. `native` — the host carries a hook whose probe passed AND whose declared coverage includes
 *      this action. A verified hook that does not cover the action does not raise it.
 *   2. `external` — the action is a git write and the repository Git hook is verified and activated.
 *      This is the portable control: it works for every host, because git runs it.
 *   3. `advisory` — nothing intercepts. Named as the floor rather than described as a gap.
 */
function levelFor(host, action, { hostHook, repoHook, verify, targetDir }) {
  const covered = host.hook?.covers?.includes(action) === true;
  // A configured mechanism is a fact about THIS repository, and it is checked even when the
  // mechanism is not run. Reading the level from the static host table alone put `native` on a
  // repository with no hook at all — the same defect as the `hook.copilot` boolean this file
  // replaced, one level up: true everywhere, measuring nothing. "Configured" is now a file the
  // report looked for, and the reason says which file.
  const configured = covered && host.hook?.configPath
    ? existsSync(join(targetDir, host.hook.configPath)) : false;
  if (covered) {
    if (!verify) {
      if (!configured) {
        return { level: 'advisory', establishedBy: 'declared', reason: `${host.label} carries a hook for ${action}, and this repository has no ${host.hook.configPath}: nothing intercepts it here` };
      }
      return { level: 'native', establishedBy: 'declared', reason: `${host.label} carries a hook for ${action} and this repository configures it (${host.hook.configPath}); run "harness capabilities --verify-host" to measure whether it decides` };
    }
    if (hostHook?.verified) {
      return { level: 'native', establishedBy: 'probe', reason: `${hostHook.reason} (covers ${host.hook.covers.join(', ')})` };
    }
    return { level: 'advisory', establishedBy: 'probe', reason: `the hook for ${action} did not verify: ${hostHook?.reason}` };
  }
  if (action === 'git-write') {
    if (!verify) {
      // The same rule for the portable control: a declared `external` for a repository with no
      // hook is a claim about a file that is not there.
      if (!existsSync(join(targetDir, REPO_HOOK.path))) {
        return { level: 'advisory', establishedBy: 'declared', reason: `nothing decides a git write in this repository: there is no ${REPO_HOOK.path}, and its installation is "git config ${REPO_HOOK.configKey} ${REPO_HOOK.hooksPath}"` };
      }
      return { level: 'external', establishedBy: 'declared', reason: `${REPO_HOOK.path} is present; run "harness capabilities --verify-host" to measure whether it is activated and correct` };
    }
    if (repoHook?.verified) {
      return { level: 'external', establishedBy: 'probe', reason: repoHook.reason };
    }
    return { level: 'advisory', establishedBy: 'probe', reason: `no control decides a git write for this host: ${repoHook?.reason}` };
  }
  if (action === 'context-load') {
    return {
      level: 'advisory', establishedBy: verify ? 'probe' : 'declared',
      reason: 'no host here ships a hook that declares it enforces context, so a run records its loads ("recorded") rather than claiming they were prevented',
    };
  }
  return {
    level: 'advisory', establishedBy: verify ? 'probe' : 'declared',
    reason: `${host.label} has no configured control for ${action}: the client policy documented for this host is the only route, and the framework cannot read it`,
  };
}

/** A compact human reading of the matrix, for the capability report. */
export function describeEnforcement(matrix) {
  const lines = [];
  for (const row of matrix.rows) {
    const cells = INTERCEPTION_ACTIONS.map((a) => `${a}=${row.actions[a].level}`).join(' ');
    lines.push(`  ${row.label.padEnd(26)} ${cells}`);
  }
  return lines;
}
