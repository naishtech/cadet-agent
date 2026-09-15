import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { install, sync } from './install.mjs';
import {
  validateState, migrateStateFile, readState, writeState, evaluateTransition, applyTransition,
  workItemIdOf, loadPolicy, RunLedger, loadRun, listRuns, cleanupRuns, buildReport, formatReport,
  runVerificationLoop, commandForGate, detectCapabilities, runsDir, gitChangedFiles, PolicyError, StateError,
  detectRepoRole, describeRepoRole, GATES, manualConfirmation,
  parseTestInventory, parseStoryCriteria, compareCoverage, describeCoverageGaps,
  createEvidence, newId, computeInputTreeHash, hashCriteria,
  collectDeclaredTestNames, reconcileTestNames,
  resolveCommand, describeCommand, describeAllCommands, checkUnattendedRequirements, COMMANDS,
} from './harness/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion() {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version;
}

function showHelp() {
  console.log(`
  ██████╗ █████╗ ██████╗ ███████╗████████╗
  ██╔════╝██╔══██╗██╔══██╗██╔════╝╚══██╔══╝
  ██║     ███████║██║  ██║█████╗     ██║
  ██║     ██╔══██║██║  ██║██╔══╝     ██║
  ╚██████╗██║  ██║██████╔╝███████╗   ██║
   ╚═════╝╚═╝  ╚═╝╚═════╝ ╚══════╝   ╚═╝

  Cross-IDE agent framework for Unity/C# game-development

  Usage:
    npx cadet-agent@latest init     Install Cadet-Agent into the current directory
    npx cadet-agent@latest init --target <dir>   Install into a specific directory
    npx cadet-agent@latest sync     Update framework, preserving local policies/plans
    npx cadet-agent@latest sync --target <dir>   Sync a specific directory

    cadet-agent state validate      Validate .cadet/state.json against the v2 schema
    cadet-agent state migrate       Atomically migrate v1 state to v2 (backup on write)
    cadet-agent state transition --to <phase>   Enforce the transition matrix + evidence
    cadet-agent state transition --to <phase> --dry-run   Check only; writes nothing

    cadet-agent harness record      Append a sanitized span/evidence/decision event
    cadet-agent harness confirm     Record manual-confirmation evidence (writes ledger + state)
    cadet-agent harness verify      Run a bounded, classified verification loop
    cadet-agent harness verify-acs  Verify declared AC↔test coverage against a test report
    cadet-agent harness report      Summarize budget consumption and failures
    cadet-agent harness cleanup     Apply the retention policy to .cadet/runs/
    cadet-agent harness capabilities  Report available CLI/Unity/MCP/hook/token/cost telemetry

  Options:
    --target, -t  Target directory (default: current working directory)
    --source       Release API URL override (for forked deployments)
    --format       human|json (default: human)
    --to           Target phase (state transition)
    --gate         Gate name (harness verify|confirm)
    --command      Command override (harness verify)
    --files        Comma-separated relevant files to bind evidence to (harness verify|confirm)
    --commit       Revision the gate attests, as a hex SHA (harness verify|confirm)
    --reason       Why automation was unavailable (harness confirm)
    --expires-at   ISO-8601 expiry bounding the confirmation (harness confirm)
    --environment  key=value,... describing what was verified (harness confirm)
    --scope        Comma-separated scope of the confirmation (harness confirm)
    --story        Story markdown declaring the acceptance criteria (harness verify-acs)
    --report       Test report to derive the inventory from (harness verify-acs|matrix-check)
    --matrix       TDD matrix markdown to check (harness matrix-check)
    --inventory    Newline-separated test names, when no report is available (harness matrix-check)
    --agents-md    keep|overwrite|merge for an existing AGENTS.md (init/sync)
    --older-than-ms  Age bound, in ms, for records cleanup may delete (harness cleanup; required)
    --dry-run      Report what a mutating command would do and write nothing (all mutating commands)
    --yes, -y      Never prompt; keep existing files (non-interactive installs)
    --help, -h    Show this help (valid at any depth; never writes)
    --version, -v Show version number
`);
}

/**
 * Does the invocation ask for help?
 *
 * Scanned against the raw argv rather than the parsed options on purpose. Once
 * parsing begins, `--help` in a value position (`--target --help`) is consumed
 * as another flag's argument and never seen again — so it must be detected
 * before `parseArgs` runs. `--` ends flag scanning, so a literal `--help` after
 * it is an operand and does not trigger help.
 */
function wantsHelp(argv) {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return false;
    if (a === '--help' || a === '-h') return true;
  }
  return false;
}

function parseArgs(argv) {
  const opts = { format: 'human', targetDir: process.cwd(), sourceUrl: null, rest: [] };
  // argv[2] is the top-level command (`state`/`harness`/`init`/...); argv[3] begins
  // the subcommand and its options.
  //
  // `value()` reads the argument a flag expects and rejects the case where the
  // next token is itself a flag. Without this check `--target --format` bound
  // the literal string "--format" as the target directory and then wrote a
  // ledger into a directory named `--format/` — a stray write, from a typo, in
  // an arbitrary place. A silently swallowed option is worse than a rejected
  // one because the command still reports success.
  //
  // A negative number is allowed through: it is a plausible value (`--older-than-ms -1`)
  // and cannot be mistaken for one of this CLI's flags, all of which are words.
  //
  // `i` is declared here, outside the loop, because `value()` must advance the
  // shared cursor — a closure over a loop-scoped `i` would not exist yet at
  // definition time.
  let i = 3;
  const value = (flag) => {
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith('-') && !/^-\d/.test(next))) {
      fail(opts, `Option ${flag} requires a value.`, () => 1, { ok: false, code: 'missing-option-value', option: flag });
    }
    i += 1;
    return next;
  };
  for (i = 3; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--target': case '-t': opts.targetDir = value(a); break;
      case '--source': opts.sourceUrl = value(a); break;
      case '--format': opts.format = value(a); break;
      case '--to': opts.to = value(a); break;
      case '--gate': opts.gate = value(a); break;
      case '--command': opts.command = value(a); break;
      case '--work-item': opts.workItemId = value(a); break;
      case '--phase': opts.phase = value(a); break;
      case '--run': opts.runId = value(a); break;
      case '--type': opts.type = value(a); break;
      case '--reason': opts.reason = value(a); break;
      case '--expires-at': opts.expiresAt = value(a); break;
      case '--environment': opts.environment = value(a); break;
      case '--scope': opts.scope = value(a).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--evidence-status': opts.evidenceStatus = value(a); break;
      // Track that the flag was supplied even when its value is empty, so an
      // empty `--files ""` is rejected rather than silently falling back to the
      // working-tree scan (which could bind evidence to Cadet's own files).
      case '--files': opts.filesGiven = true; opts.files = value(a).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--story': opts.story = value(a); break;
      case '--report': opts.report = value(a); break;
      // AR-1: the revision a gate record attests, so a gate-related fix claim
      // can be traced to the commit that contains it.
      case '--commit': opts.commitGiven = true; opts.commit = value(a); break;
      case '--matrix': opts.matrix = value(a); break;
      case '--inventory': opts.inventory = value(a); break;
      case '--write-coverage': opts.writeCoverage = true; break;
      case '--strict-orphans': opts.strictOrphans = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--older-than-ms': opts.olderThanMs = Number(value(a)); break;
      case '--agents-md': opts.agentsMd = value(a); break;
      case '--yes': case '-y': opts.yes = true; break;
      default: opts.rest.push(a);
    }
  }
  return opts;
}

function emit(opts, human, json) {
  if (opts.format === 'json') {
    console.log(JSON.stringify(json, null, 2));
  } else {
    console.log(human);
  }
}

/**
 * Parse `--environment "projectPath=...,editorVersion=...,tool=...,host=..."`
 * into an object. Unknown keys are preserved: an unusual environment is still
 * evidence, and silently dropping a field would misrepresent what was verified.
 */
function parseEnvironment(raw) {
  const env = {};
  if (!raw) return env;
  for (const part of String(raw).split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      const key = part.trim();
      if (key) env[key] = true;
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

function fail(opts, message, code = json => json.exitCode || 1, json = {}) {
  const exitCode = code(json);
  if (opts.format === 'json') {
    console.error(JSON.stringify({ ok: false, error: message, ...json }, null, 2));
  } else {
    console.error(`\n❌ ${message}`);
  }
  process.exit(exitCode);
}

// ── state commands ──────────────────────────────────────────────────────────

async function cmdState(opts) {
  const sub = opts.rest[0];
  const statePath = join(opts.targetDir, '.cadet', 'state.json');

  if (sub === 'validate') {
    const { exists, state } = readState(opts.targetDir);
    if (!exists) {
      // Report the detected repo role instead of a bare ok. In the framework
      // source repository a missing state file is expected, not a silent pass —
      // saying so prevents story/gate reasoning against a repo that has no story.
      const role = detectRepoRole(opts.targetDir);
      const repoRoleDetail = describeRepoRole(role);
      emit(
        opts,
        `No .cadet/state.json found (nothing to validate).\n   Repo role: ${role.role} (${role.source}, ${role.confidence} confidence) — ${repoRoleDetail}`,
        { ok: true, valid: true, exists: false, repoRole: role.role, repoRoleDetail, repoRoleSource: role.source },
      );
      return;
    }
    // Pass rootDir so stale/foreign evidence is caught at validation time, and
    // the resolved policy so strict-closure rules are actually enforced. Without
    // the policy, `strictClosure` was invisible here and every strict rule was
    // silently skipped — the feature would "install cleanly and do nothing".
    const policy = loadPolicy(opts.targetDir);
    const result = validateState(state, { rootDir: opts.targetDir, strictClosure: policy.strictClosure });
    const role = detectRepoRole(opts.targetDir);
    const repoRoleDetail = describeRepoRole(role);
    if (opts.format === 'json') {
      emit(opts, '', { ok: result.valid, valid: result.valid, errors: result.errors, warnings: result.warnings, repoRole: role.role, repoRoleDetail });
    } else {
      if (result.valid) console.log(`✅ state.json is valid (v${state.version}).`);
      else {
        console.error('❌ state.json is invalid:');
        for (const e of result.errors) console.error(`   ${e.path}: ${e.message}`);
      }
      for (const w of result.warnings) console.log(`   ⚠️  ${w.path}: ${w.message}`);
      console.log(`   Repo role: ${role.role} — ${repoRoleDetail}`);
    }
    if (!result.valid) process.exit(1);
    return;
  }

  if (sub === 'migrate') {
    const result = migrateStateFile(statePath, { backup: true });
    if (opts.format === 'json') {
      emit(opts, '', { ok: true, migrated: result.migrated, statePath: result.statePath });
    } else if (result.migrated) {
      console.log(`✅ Migrated ${statePath} to v2 (backup: ${statePath}.v1.bak).`);
    } else {
      console.log('✅ state.json is already v2 — nothing to migrate.');
    }
    return;
  }

  if (sub === 'transition') {
    if (!opts.to) fail(opts, 'state transition requires --to <phase>');
    const { exists, state } = readState(opts.targetDir);
    if (!exists) fail(opts, 'No .cadet/state.json found. Initialise state before transitioning.', () => 2);
    // Freshness is enforced against the current working tree: evaluateTransition
    // recomputes each gate's input-tree hash from the evidence's relevant files.
    //
    // `--dry-run` reports the SAME verdict and stops. It is the only safe way to
    // ask "would this transition be allowed?" — running the command without the
    // flag applies the transition. A check that is documented as a dry run must
    // not have side effects, so the write below is gated on `!opts.dryRun`.
    const evaluation = evaluateTransition(state, opts.to, { rootDir: opts.targetDir });
    if (!evaluation.allowed) {
      const detail = {
        ok: false,
        allowed: false,
        dryRun: opts.dryRun === true,
        applied: false,
        missingGates: evaluation.missingGates,
        staleEvidence: evaluation.staleEvidence,
        errors: evaluation.errors,
      };
      const lines = [`❌ Transition rejected${opts.dryRun ? ' (dry run — nothing was written)' : ''}:`];
      for (const e of evaluation.errors) lines.push(`   ${e}`);
      if (evaluation.missingGates.length) lines.push(`   missing gates/evidence: ${evaluation.missingGates.join(', ')}`);
      for (const s of evaluation.staleEvidence) lines.push(`   stale: ${s.gate} — ${s.reason || (s.reasons || []).join('; ')}`);
      if (opts.format === 'json') emit(opts, '', detail);
      else console.error(lines.join('\n'));
      process.exit(1);
    }
    if (opts.dryRun) {
      emit(
        opts,
        `✅ Transition ${state.session?.currentPhase} → ${opts.to} would be allowed (dry run — nothing was written).`,
        { ok: true, allowed: true, dryRun: true, applied: false, to: opts.to, from: state.session?.currentPhase },
      );
      return;
    }
    const next = applyTransition(state, opts.to, { rootDir: opts.targetDir });
    writeState(opts.targetDir, next);
    emit(opts, `✅ Transitioned to ${opts.to}.`, { ok: true, allowed: true, dryRun: false, applied: true, to: opts.to });
    return;
  }

  fail(opts, `Unknown state subcommand: ${sub || '(none)'}. Use validate|migrate|transition.`);
}

// ── harness commands ────────────────────────────────────────────────────────

async function cmdHarness(opts) {
  const sub = opts.rest[0];
  const policy = loadPolicy(opts.targetDir);

  if (sub === 'capabilities') {
    const caps = detectCapabilities({ targetDir: opts.targetDir });
    // The command registry is published here so an agent can *ask* which
    // commands write instead of inferring it from a name or trusting a flag it
    // must remember to pass. It is informational: the safety guarantee does not
    // depend on the agent reading it, because the dispatcher enforces the
    // registry regardless.
    const commands = describeAllCommands();
    if (opts.format === 'json') emit(opts, '', { ok: true, capabilities: caps, commands });
    else {
      console.log('Cadet-Agent capability report');
      console.log(`  CLI:            ${caps.cli ? 'available' : 'unavailable'}`);
      console.log(`  Unity CLI:      ${caps.unityCli.available ? `available (${caps.unityCli.version || 'version unknown'})` : 'unavailable — compile/analyzer gates fall back to manual confirmation'}`);
      console.log(`  MCP:            ${caps.mcp.available ? 'configured' : 'unavailable — live inspection not available'}`);
      console.log(`  Copilot hook:   ${caps.hook.copilot ? 'installed' : 'not installed'}`);
      console.log(`  Token telemetry:${caps.tokenTelemetry.provider ? ' provider' : ' estimate/unknown'}`);
      console.log(`  Cost telemetry: ${caps.costTelemetry.available ? 'available' : `unavailable (${caps.costTelemetry.reason})`}`);
      console.log(`  Note: ${caps.hook.note}`);
      console.log('  Commands (mutating commands honour --dry-run; nothing writes without it being declared):');
      for (const c of commands) {
        const bound = c.requiresForUnattended.length ? ` [unattended requires ${c.requiresForUnattended.join(', ')}]` : '';
        console.log(`    ${c.mutates ? 'WRITES ' : 'read   '} ${c.command}${bound}`);
      }
    }
    return;
  }

  if (sub === 'confirm') {
    const gate = opts.gate;
    if (!gate) fail(opts, 'harness confirm requires --gate <gate>');
    if (!GATES.includes(gate)) fail(opts, `unknown gate "${gate}". Valid gates: ${GATES.join(', ')}`);

    const { exists, state } = readState(opts.targetDir);
    if (!exists) fail(opts, 'No .cadet/state.json found. Initialise state before recording confirmation.', () => 2);

    const strict = policy.strictClosure?.enabled === true ? policy.strictClosure : null;
    const mc = strict?.manualConfirmation || null;
    // One reference instant for the whole command, captured before any work.
    // Reading Date.now() at the check instead made the validity boundary
    // non-deterministic: process latency absorbed a small overage, so the same
    // input could pass or fail run to run.
    const requestedAt = new Date();

    // Collect EVERY missing field so the caller fixes the record in one pass,
    // rather than discovering one omission per invocation.
    const missing = [];
    if (mc?.requireReason !== false && strict && (!opts.reason || String(opts.reason).trim() === '')) missing.push('--reason');
    if (mc?.requireExpiresAt !== false && strict) {
      if (!opts.expiresAt) missing.push('--expires-at');
      else if (Number.isNaN(Date.parse(opts.expiresAt))) missing.push('--expires-at (not an ISO-8601 date-time)');
    }
    if (mc?.requireEnvironment !== false && strict && (!opts.environment || String(opts.environment).trim() === '')) missing.push('--environment');
    if (mc?.requireScope !== false && strict && (!opts.scope || opts.scope.length === 0)) missing.push('--scope');
    if (missing.length) {
      fail(opts, `strictClosure requires manual-confirmation metadata. Missing: ${missing.join(', ')}.`, () => 1, { ok: false, gate, code: 'strict-metadata-missing', missing });
    }

    // A gate listed in disallowManualFor may never be satisfied by a human
    // assertion; point at the automated path instead of accepting the record.
    if (strict && Array.isArray(strict.disallowManualFor) && strict.disallowManualFor.includes(gate)) {
      fail(opts, `manual-confirmation is not permitted for gate "${gate}" under strictClosure.disallowManualFor; run "cadet-agent harness verify --gate ${gate}" instead.`, () => 1, { ok: false, gate, code: 'manual-disallowed' });
    }

    // Bound the validity window: an expiry far in the future is how a manual
    // assertion silently becomes permanent. Measured against `requestedAt`, the
    // single instant captured at command start, so the boundary is deterministic
    // and agrees with `validateState` (which anchors to the present too).
    if (mc?.maxValidityMs !== null && mc?.maxValidityMs !== undefined && opts.expiresAt) {
      const window = Date.parse(opts.expiresAt) - requestedAt.getTime();
      if (Number.isFinite(window) && window > mc.maxValidityMs) {
        fail(opts, `requested validity ${window}ms exceeds strictClosure.manualConfirmation.maxValidityMs (${mc.maxValidityMs}ms).`, () => 1, { ok: false, gate, code: 'validity-exceeded', requestedMs: window, maxValidityMs: mc.maxValidityMs });
      }
    }

    // Freshness binding mirrors `harness verify`: never record a gate against an
    // unknown input tree unless the repository explicitly opted out.
    const allowEmpty = policy?.allowEmptyFreshness === true;
    if (opts.filesGiven && (!opts.files || opts.files.length === 0)) {
      fail(opts, '--files was given with no paths. Pass a comma-separated list of the files this gate covers (e.g. --files src/Foo.cs,test/FooTests.cs), or omit --files to auto-detect changed files.', () => 1, { ok: false, gate, code: 'empty-files' });
    }
    let relevantFiles;
    if (opts.files && opts.files.length) {
      relevantFiles = opts.files.map((f) => f.replace(/\\/g, '/'));
    } else {
      const changed = gitChangedFiles(opts.targetDir);
      if (!changed.available) {
        if (!allowEmpty) {
          fail(opts, `cannot establish freshness coverage: ${changed.reason}. Pass --files <paths>, or enable allowEmptyFreshness in .cadet/harness.json.`, () => 1, { ok: false, gate, code: 'freshness-unavailable' });
        }
        relevantFiles = [];
      } else {
        relevantFiles = changed.files;
      }
    }

    const workItemId = state ? workItemIdOf(state) : 'unscoped';
    const phase = state?.session?.currentPhase || 'implementation';
    // Reuse the command-start instant so the recorded createdAt and the validity
    // check describe the same moment.
    const at = requestedAt;
    const environment = parseEnvironment(opts.environment);

    const { evidence } = manualConfirmation({
      gate,
      workItemId,
      phase,
      projectPath: environment.projectPath || null,
      editorVersion: environment.editorVersion || null,
      scope: opts.scope || [],
      reason: opts.reason || null,
      expiresAt: opts.expiresAt || null,
      environment,
      relevantFiles,
      rootDir: opts.targetDir,
      approvedBy: opts.approvedBy || 'user',
      commit: opts.commit || null,
      at,
    });

    // Ledger first, then state. The ledger is append-only and merely references
    // the evidence id; state.json carries the gate claim. Writing state first
    // would let an interruption leave a gate claimed true with no ledger entry.
    // This order fails toward "less proven", never "claimed but unbacked".
    const ledger = new RunLedger({
      targetDir: opts.targetDir,
      policy,
      runId: state?.activeRunId || null,
      workItemId,
      phase,
    });
    ledger.addEvidence(evidence);
    ledger.addDecision({
      kind: 'manual-confirmation',
      reason: opts.reason || 'manual confirmation recorded',
      gate,
      evidenceId: evidence.evidenceId,
      approvedBy: evidence.approvedBy || 'user',
    });
    ledger.finalize({ status: 'ok' });
    const ledgerPath = ledger.persist();

    const next = { ...state };
    const prior = Array.isArray(state.gateEvidence) ? state.gateEvidence : [];
    next.gateEvidence = [
      // Immutability: supersede prior passing evidence, never delete it.
      ...prior.map((e) => (e.gate === gate && (e.status === 'passed' || e.status === 'manual-confirmation')
        ? { ...e, status: 'superseded', supersededBy: evidence.evidenceId }
        : e)),
      evidence,
    ];
    next.gates = { ...(state.gates || {}), [gate]: true };
    writeState(opts.targetDir, next);

    const superseded = prior.filter((e) => e.gate === gate && (e.status === 'passed' || e.status === 'manual-confirmation')).length;
    emit(
      opts,
      `✅ Recorded manual confirmation for gate "${gate}". Evidence: ${evidence.evidenceId}\n   Ledger: ${ledgerPath}`,
      { ok: true, gate, evidenceId: evidence.evidenceId, runId: ledger.runId, path: ledgerPath, stateUpdated: true, superseded },
    );
    return;
  }

  if (sub === 'record') {
    const { state } = readState(opts.targetDir);
    const ledger = new RunLedger({
      targetDir: opts.targetDir,
      policy,
      runId: opts.runId || state?.activeRunId || null,
      workItemId: opts.workItemId || (state ? workItemIdOf(state) : null),
      phase: opts.phase || state?.session?.currentPhase || null,
    });
    const type = opts.type || 'tool-call';
    const reason = opts.reason || opts.rest[1] || 'recorded event';
    if (type === 'decision') {
      ledger.addDecision({ kind: 'stop', reason });
    } else if (type === 'verification') {
      ledger.addSpan({ kind: 'verification', name: opts.gate || 'manual', status: opts.evidenceStatus || 'ok', reason });
    } else {
      ledger.addSpan({ kind: type, name: opts.gate || type, status: 'ok', reason, tool: opts.tool || null });
    }
    ledger.finalize();
    const path = ledger.persist();
    emit(opts, `✅ Recorded ${type} event in ${path}.`, { ok: true, runId: ledger.runId, path });
    return;
  }

  if (sub === 'verify') {
    const gate = opts.gate;
    if (!gate) fail(opts, 'harness verify requires --gate <gate>');
    const { state } = readState(opts.targetDir);
    const caps = detectCapabilities({ targetDir: opts.targetDir });
    const descriptor = opts.command
      ? { command: opts.command, tool: 'custom', automated: true }
      : commandForGate(gate, { policy, projectPath: opts.targetDir, unityAvailable: caps.unityCli.available });

    if (!descriptor.automated || !descriptor.command) {
      const detail = { ok: false, gate, blocked: true, reason: descriptor.reason || 'no automated command available' };
      if (opts.format === 'json') emit(opts, '', detail);
      else console.error(`❌ Cannot automate gate "${gate}": ${detail.reason}. Record a manual confirmation instead.`);
      process.exit(1);
    }

    const ledger = new RunLedger({
      targetDir: opts.targetDir,
      policy,
      runId: state?.activeRunId || null,
      workItemId: state ? workItemIdOf(state) : null,
      phase: state?.session?.currentPhase || null,
      capabilities: caps,
    });

    // Relevant files bind the evidence to a concrete input tree so later edits
    // invalidate it. Prefer an explicit --files list; otherwise use the working
    // tree's changed files. If git cannot be queried and no files were supplied,
    // freshness coverage cannot be established — fail safe rather than record a
    // passing gate against an empty input tree. `allowEmptyFreshness` is the
    // explicit, visible opt-out.
    const allowEmpty = policy?.allowEmptyFreshness === true;
    let relevantFiles;
    let filesSource;
    if (opts.filesGiven && (!opts.files || opts.files.length === 0)) {
      fail(opts, '--files was given with no paths. Pass a comma-separated list of the files this gate covers (e.g. --files src/Foo.cs,test/FooTests.cs), or omit --files to auto-detect changed files.', () => 1, { ok: false, gate, code: 'empty-files' });
    }
    if (opts.files && opts.files.length) {
      relevantFiles = opts.files.map((f) => f.replace(/\\/g, '/'));
      filesSource = 'explicit';
    } else {
      const changed = gitChangedFiles(opts.targetDir);
      if (!changed.available) {
        if (!allowEmpty) {
          const detail = {
            ok: false,
            gate,
            blocked: true,
            code: 'freshness-unavailable',
            reason: `cannot establish freshness coverage: ${changed.reason}. Pass --files <paths> to bind evidence to the relevant files, or enable allowEmptyFreshness in .cadet/harness.json to opt into unscoped evidence.`,
          };
          if (opts.format === 'json') emit(opts, '', detail);
          else console.error(`❌ ${detail.reason}`);
          process.exit(1);
        }
        relevantFiles = [];
        filesSource = 'unscoped (allowEmptyFreshness)';
      } else {
        relevantFiles = changed.files;
        filesSource = 'working-tree';
      }
    }

    if (relevantFiles.length === 0 && !allowEmpty && filesSource !== 'explicit') {
      const detail = {
        ok: false,
        gate,
        blocked: true,
        code: 'freshness-unavailable',
        reason: 'no relevant files were found to bind evidence to. Pass --files <paths>, or enable allowEmptyFreshness in .cadet/harness.json to opt into unscoped evidence.',
      };
      if (opts.format === 'json') emit(opts, '', detail);
      else console.error(`❌ ${detail.reason}`);
      process.exit(1);
    }

    // Red-before-green applies to testable work items; a `no_test_required`
    // change is exempt (contract §5).
    const noTestRequired = state?.session?.workflowPath === 'no_test_required';

    // Record how the relevant files were chosen (provenance) in the ledger.
    ledger.addDecision({
      kind: 'stop',
      reason: `freshness-bound via ${filesSource}`,
      scope: relevantFiles.join(',') || '(none)',
    });

    const result = await runVerificationLoop({
      gate,
      command: descriptor.command,
      tool: descriptor.tool,
      workItemId: ledger.workItemId || 'unscoped',
      phase: ledger.phase || 'implementation',
      relevantFiles,
      rootDir: opts.targetDir,
      commit: opts.commit || null,
      policy,
      budgets: ledger.tracker,
      artifactDir: join(runsDir(opts.targetDir), 'artifacts'),
      priorEvidence: Array.isArray(state?.gateEvidence) ? state.gateEvidence : [],
      requireRedFirst: noTestRequired ? false : null,
    });

    for (const a of result.attempts) ledger.addEvidence(a.evidence);
    ledger.finalize({ status: result.ok ? 'ok' : 'failed' });
    const path = ledger.persist();

    // Close the loop: record the produced evidence in state.json so
    // `state transition` can see it. A passing verification flips the gate
    // only when it is evidence-backed; a failing one records the attempt.
    let stateUpdated = false;
    if (state) {
      const next = { ...state };
      next.gateEvidence = [...(Array.isArray(state.gateEvidence) ? state.gateEvidence : []), ...result.attempts.map((a) => a.evidence)];
      if (Array.isArray(next.gateEvidence)) {
        // Mark prior evidence for this gate as superseded by the new record.
        const newest = result.finalEvidence?.evidenceId;
        next.gateEvidence = next.gateEvidence.map((e) =>
          e.gate === gate && e.evidenceId !== newest && e.status === 'passed' && result.ok
            ? { ...e, status: 'superseded', supersededBy: newest }
            : e);
      }
      if (result.ok) {
        next.gates = { ...(state.gates || {}), [gate]: true };
      }
      writeState(opts.targetDir, next);
      stateUpdated = true;
    }

    if (opts.format === 'json') {
      emit(opts, '', { ok: result.ok, status: result.status, gate, attempts: result.attempts.length, stopReason: result.stopReason, runId: ledger.runId, path, stateUpdated, repoRole: detectRepoRole(opts.targetDir).role });
    } else if (result.ok) {
      console.log(`✅ Gate "${gate}" verified (${result.attempts.length} attempt(s)). Ledger: ${path}`);
    } else {
      console.error(`❌ Gate "${gate}" failed (${result.status}, ${result.stopReason || 'no reason'}). Ledger: ${path}`);
    }
    if (!result.ok) process.exit(1);
    return;
  }

  if (sub === 'verify-acs') {
    // Mechanical AC↔test verification (contract v4). Declared tests must appear
    // in the inventory of a run that actually executed them; a name that was
    // never written cannot be asserted into coverage.
    if (!opts.story) fail(opts, 'harness verify-acs requires --story <path>');
    const { exists, state } = readState(opts.targetDir);
    const strict = policy.strictClosure?.enabled === true;
    const workItemId = state ? workItemIdOf(state) : 'unscoped';
    const phase = state?.session?.currentPhase || 'implementation';

    let criteria;
    try {
      ({ criteria } = parseStoryCriteria(opts.story));
    } catch (err) {
      fail(opts, `cannot parse story "${opts.story}": ${err.message}`, () => 1, { ok: false, code: 'story-parse', story: opts.story });
    }
    if (criteria.length === 0) {
      fail(opts, `story "${opts.story}" declares no acceptance criteria (expected a "## Acceptance Criteria" section).`, () => 1, { ok: false, code: 'no-criteria', story: opts.story });
    }

    // Resolve the inventory: an explicit --report, else the artifact of the most
    // recent passing testsPassed evidence. Neither resolving is `blocked`, never
    // a pass — an unproven inventory cannot satisfy coverage.
    let reportText = null;
    let reportSource = null;
    let reportPath = null;
    if (opts.report) {
      try {
        reportText = readFileSync(opts.report, 'utf-8');
        reportSource = 'explicit';
        reportPath = opts.report;
      } catch (err) {
        fail(opts, `cannot read --report "${opts.report}": ${err.message}`, () => 1, { ok: false, code: 'report-unreadable', report: opts.report });
      }
    } else if (exists) {
      const prior = Array.isArray(state.gateEvidence) ? state.gateEvidence : [];
      const passing = prior
        .filter((e) => e.gate === 'testsPassed' && e.status === 'passed' && e.artifactPath)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const newest = passing[0];
      if (newest) {
        try {
          reportText = readFileSync(newest.artifactPath, 'utf-8');
          reportSource = 'testsPassed-evidence';
          reportPath = newest.artifactPath;
        } catch { /* fall through to blocked */ }
      }
    }
    if (reportText === null) {
      const detail = { ok: false, story: opts.story, blocked: true, code: 'no-test-report', reason: 'no test report available: pass --report <path>, or run `cadet-agent harness verify --gate testsPassed` first so its artifact can be read.' };
      if (opts.format === 'json') emit(opts, '', detail);
      else console.error(`❌ ${detail.reason}`);
      process.exit(1);
    }

    const inventory = parseTestInventory(reportText);
    const coverage = compareCoverage(criteria, inventory);
    const gaps = describeCoverageGaps(coverage);
    // The inverse direction: tests that ran but are declared on no AC. Always
    // reported; only fatal when explicitly requested, because a consumer may
    // legitimately carry helper tests that belong to no single criterion.
    const orphanGaps = describeCoverageGaps(coverage, { includeOrphans: true }).slice(gaps.length);
    const orphans = coverage.orphaned || [];

    // Under strict closure an unknown/empty inventory can never prove coverage,
    // even if every AC declared no tests in a way that looked consistent.
    const unknownInventory = inventory.format === 'unknown' || inventory.names.length === 0;
    const orphanBlocking = opts.strictOrphans === true && orphans.length > 0;
    const effectiveOk = coverage.ok && !unknownInventory && !orphanBlocking;

    if (!strict) {
      // v2/v3 parity: report, write nothing, exit 0.
      if (opts.format === 'json') {
        emit(opts, '', { ok: effectiveOk, story: opts.story, ac: coverage.ac, orphaned: orphans, inventorySize: coverage.inventorySize, format: inventory.format, gateSet: false, reportPath });
      } else if (effectiveOk) {
        console.log(`✅ AC coverage verified for ${opts.story} (${coverage.ac.length} criteria, ${coverage.inventorySize} tests in inventory).`);
        console.log('   strictClosure is off — reported only, state.json unchanged.');
        if (orphans.length > 0) {
          // A warning goes to stderr even on the success path, so it is not lost
          // in stdout piping and matches how every other warning is emitted.
          console.error(`   ⚠️  ${orphans.length} test(s) declared on no acceptance criterion (reported only):`);
          for (const g of orphanGaps) console.error(g);
        }
      } else {
        console.error(`⚠️  AC coverage gaps in ${opts.story} (strictClosure off — reported only):`);
        if (unknownInventory) console.error(`   no test inventory could be derived from ${reportPath || 'the report'} (format: ${inventory.format}).`);
        for (const g of gaps) console.error(g);
        for (const g of orphanGaps) console.error(g);
      }
      if (!effectiveOk) process.exit(1);
      return;
    }

    if (!effectiveOk) {
      const detail = { ok: false, story: opts.story, ac: coverage.ac, orphaned: orphans, inventorySize: coverage.inventorySize, format: inventory.format, gateSet: false, code: unknownInventory ? 'inventory-unknown' : (orphanBlocking ? 'orphaned-tests' : 'coverage-gap') };
      if (opts.format === 'json') emit(opts, '', detail);
      else {
        console.error(`❌ Cannot set acceptanceCriteriaValidated for ${opts.story}:`);
        if (unknownInventory) console.error(`   no test inventory could be derived from ${reportPath || 'the report'} (format: ${inventory.format}). An unparseable report proves nothing.`);
        for (const g of gaps) console.error(g);
        if (orphanBlocking) for (const g of orphanGaps) console.error(g);
      }
      process.exit(1);
    }

    if (orphans.length > 0) {
      // Passing, but the inverse-direction drift is visible rather than silent.
      const notice = `⚠️  ${orphans.length} test(s) ran but are declared on no acceptance criterion (not fatal; pass --strict-orphans to enforce).`;
      if (opts.format === 'json') console.error(notice);
      else for (const g of [notice, ...orphanGaps]) console.error(g);
    }

    const at = new Date();
    const criteriaStrings = coverage.ac.flatMap((a) => [a.id, ...a.declared]);
    const nowIso = at.toISOString();
    const evidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId: null,
      phase,
      gate: 'acceptanceCriteriaValidated',
      status: 'passed',
      command: `harness verify-acs --story ${opts.story}`,
      result: `AC coverage verified: ${coverage.ac.length} criteria, inventory ${coverage.inventorySize} (${inventory.format})`,
      exitCode: 0,
      inputTreeHash: computeInputTreeHash(opts.targetDir, [opts.story, ...(reportPath ? [reportPath] : [])]),
      criteriaHash: hashCriteria(criteriaStrings),
      relevantFiles: [opts.story, ...(reportPath ? [reportPath] : [])].map((f) => f.replace(/\\/g, '/')),
      createdAt: at,
      expiresAt: null,
      // Schema + validator require an object carrying a `scope`, not a bare
      // string: state.schema.json#/$defs/evidence references
      // harness.schema.json#/$defs/freshnessPolicy, which has required:["scope"]
      // with scope ∈ story|phase|run|manual.
      freshnessPolicy: { scope: 'story' },
      source: 'automated',
    });

    let coveragePath = null;
    if (opts.writeCoverage) {
      const base = opts.story.replace(/\.md$/, '');
      coveragePath = `${base}.coverage.json`;
      const doc = {
        schemaVersion: 1,
        story: opts.story.replace(/\\/g, '/'),
        generatedAt: nowIso,
        ac: coverage.ac,
        inventorySize: coverage.inventorySize,
        format: inventory.format,
      };
      try { writeFileSync(coveragePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8'); } catch { coveragePath = null; }
    }

    // Ledger first, then state — the v3 ordering: fail toward "less proven".
    const ledger = new RunLedger({ targetDir: opts.targetDir, policy, runId: state?.activeRunId || null, workItemId, phase });
    ledger.addEvidence(evidence);
    ledger.addDecision({ kind: 'stop', reason: `AC coverage verified via ${reportSource}`, scope: `${coverage.ac.length} criteria` });
    ledger.finalize({ status: 'ok' });
    const ledgerPath = ledger.persist();

    if (exists) {
      const next = { ...state };
      const priorEv = Array.isArray(state.gateEvidence) ? state.gateEvidence : [];
      next.gateEvidence = [
        ...priorEv.map((e) => (e.gate === 'acceptanceCriteriaValidated' && (e.status === 'passed' || e.status === 'manual-confirmation')
          ? { ...e, status: 'superseded', supersededBy: evidence.evidenceId }
          : e)),
        evidence,
      ];
      next.gates = { ...(state.gates || {}), acceptanceCriteriaValidated: true };
      writeState(opts.targetDir, next);
    }

    if (opts.format === 'json') {
      emit(opts, '', { ok: true, story: opts.story, ac: coverage.ac, inventorySize: coverage.inventorySize, format: inventory.format, gateSet: exists, coveragePath, evidenceId: evidence.evidenceId, runId: ledger.runId, path: ledgerPath });
    } else {
      console.log(`✅ acceptanceCriteriaValidated for ${opts.story} (${coverage.ac.length} criteria, inventory ${coverage.inventorySize}, ${inventory.format}).`);
      console.log(`   Ledger: ${ledgerPath}`);
      if (coveragePath) console.log(`   Coverage: ${coveragePath}`);
    }
    return;
  }

  if (sub === 'report') {
    const runs = listRuns(opts.targetDir);
    const target = opts.runId || runs[0]?.runId;
    if (!target) fail(opts, 'No run records found in .cadet/runs/.', () => 2);
    const run = loadRun(opts.targetDir, target);
    if (!run) fail(opts, `Run ${target} not found.`, () => 2);
    if (opts.format === 'json') emit(opts, '', { ok: true, report: buildReport(run) });
    else console.log(formatReport(run));
    return;
  }

  // AR-5. Reconcile a TDD matrix's DELIVERED test-name claims against a compiled
  // inventory. Read-only: it reports, and never writes state, so it can be run at
  // authoring time (before anything has been implemented) as well as in a gate.
  if (sub === 'matrix-check') {
    if (!opts.matrix) fail(opts, 'harness matrix-check requires --matrix <path-to-matrix.md>');
    const matrixPath = resolve(opts.targetDir, opts.matrix);
    let matrixText;
    try {
      matrixText = readFileSync(matrixPath, 'utf-8');
    } catch (err) {
      fail(opts, `cannot read matrix ${opts.matrix}: ${err.message}`, () => 2);
    }

    // The inventory may come from a run report (strongest: it proves the test
    // RAN) or from C# sources (a name inventory only). Prefer a report.
    let inventory = null;
    let inventorySource = null;
    if (opts.report) {
      const reportPath = resolve(opts.targetDir, opts.report);
      let reportText;
      try {
        reportText = readFileSync(reportPath, 'utf-8');
      } catch (err) {
        fail(opts, `cannot read report ${opts.report}: ${err.message}`, () => 2);
      }
      const parsed = parseTestInventory(reportText);
      if (parsed && parsed.format !== 'unknown' && parsed.names.length > 0) {
        inventory = new Set(parsed.names);
        inventorySource = `${opts.report} (${parsed.format})`;
      }
    }
    if (!inventory && opts.inventory) {
      const invPath = resolve(opts.targetDir, opts.inventory);
      let raw;
      try {
        raw = readFileSync(invPath, 'utf-8');
      } catch (err) {
        fail(opts, `cannot read inventory ${opts.inventory}: ${err.message}`, () => 2);
      }
      inventory = new Set(String(raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      inventorySource = opts.inventory;
    }

    const collected = collectDeclaredTestNames(matrixText);
    if (!inventory) {
      // Without an inventory this cannot prove anything, so it must not report
      // success. Returning the collected names is still useful at authoring time:
      // it shows what the matrix claims, and the caller can spot a name they know
      // they never wrote.
      const detail = {
        ok: false,
        code: 'inventory-unavailable',
        matrix: opts.matrix,
        claims: collected.claims,
        intents: collected.intents,
      };
      if (opts.format === 'json') emit(opts, '', detail);
      else {
        console.error('❌ No inventory supplied, so no claim can be checked. Pass --report <test-results> (preferred, proves the test ran) or --inventory <names.txt>.');
        console.error(`   The matrix declares ${collected.claims.length} delivered claim(s) across ${collected.intents.length} undelivered intention(s).`);
      }
      process.exit(1);
    }

    const result = reconcileTestNames(collected, inventory);
    const ok = result.missingFromInventory.length === 0;
    const detail = {
      ok,
      matrix: opts.matrix,
      inventory: inventorySource,
      checked: result.checked,
      intents: collected.intents.length,
      missingFromInventory: result.missingFromInventory,
      unmatchedIntents: result.unmatchedIntents,
    };
    if (opts.format === 'json') emit(opts, '', detail);
    else if (ok) {
      console.log(`✅ Every delivered test-name claim exists in the inventory (${result.checked} checked from ${inventorySource}).`);
      if (result.unmatchedIntents.length > 0) {
        console.log(`   ℹ️  ${result.unmatchedIntents.length} undelivered intention(s) now exist and the row may be stale — consider marking it DELIVERED.`);
      }
    } else {
      console.error(`❌ ${result.missingFromInventory.length} delivered test-name claim(s) do not exist in the inventory (${inventorySource}):`);
      for (const n of result.missingFromInventory) console.error(`   "${n}" — declared as delivered but absent. Attach it to the criterion it proves, or correct the name.`);
    }
    if (!ok) process.exit(1);
    return;
  }

  if (sub === 'cleanup') {
    const { deleted, kept } = cleanupRuns(opts.targetDir, policy, {
      olderThanMs: Number.isFinite(opts.olderThanMs) ? opts.olderThanMs : null,
    });
    emit(opts, `✅ Cleanup: deleted ${deleted.length} run(s), kept ${kept.length}.`, { ok: true, deleted, kept });
    return;
  }

  fail(opts, `Unknown harness subcommand: ${sub || '(none)'}. Use record|confirm|verify|verify-acs|matrix-check|report|cleanup|capabilities.`);
}

export async function run(argv) {
  const command = argv[2];

  // `--help`/`-h` is a global, read-only flag: it must be honoured at ANY depth
  // (`harness record --help`, `state transition --help`) and must short-circuit
  // before dispatch. Previously it was only recognised as `argv[2]`, so a nested
  // help flag fell through into `parseArgs`'s `rest` array — and mutating
  // subcommands acted on it. `harness record --help` appended a ledger,
  // `harness cleanup --help` applied the retention policy and deleted run
  // records, and `state migrate --help` wrote a `.v1.bak` backup. "Checking the
  // help" is not a read-only operation if help is never actually checked.
  if (wantsHelp(argv)) {
    showHelp();
    return;
  }

  const opts = parseArgs(argv);
  const commandKey = resolveCommand(argv);

  // Global `--dry-run`, driven by the registry rather than by each handler.
  //
  // This is the structural fix for the class of bug where a mutating command
  // simply did not check the flag: `--dry-run` was parsed globally but honoured
  // by one command, so `harness record --dry-run` wrote a ledger and
  // `cleanup --dry-run` would have deleted records. Declaring which commands
  // write, and honouring the flag for all of them here, means a new mutating
  // command is covered the moment it is registered — no per-handler check to
  // remember, and no way to forget one.
  //
  // A read-only command needs no interception: it is asserted not to write.
  // A command may opt out when its dry-run is an *evaluation* rather than a
  // no-op: `state transition --dry-run` reports the same verdict a real
  // transition would, so its handler owns the flag. See `evaluatesOnDryRun`.
  if (opts.dryRun === true && commandKey && COMMANDS[commandKey].mutates === true && COMMANDS[commandKey].evaluatesOnDryRun !== true) {
    emit(
      opts,
      `✅ Dry run: \"${commandKey}\" would run and may write ${(COMMANDS[commandKey].writes || []).join(', ') || 'state'} — nothing was written.`,
      {
        ok: true,
        dryRun: true,
        applied: false,
        command: commandKey,
        mutates: true,
        writes: COMMANDS[commandKey].writes || [],
      },
    );
    return;
  }

  // A destructive command that may run unattended must carry an explicit,
  // content-bearing bound on what it acts on. `--older-than-ms` states *what*
  // to delete; a bare confirmation flag would only state *that* something was
  // approved, which an agent can pass without knowing what it is approving.
  if (commandKey) {
    const guard = checkUnattendedRequirements(commandKey, opts);
    if (!guard.ok) fail(opts, guard.reason, () => 1, { ok: false, command: commandKey, code: 'unattended-requirement-missing', missing: guard.missing });
  }

  // Validate the create-only policy flag early so a typo fails loudly.
  const AGENTS_MD_MODES = ['keep', 'overwrite', 'merge'];
  if (opts.agentsMd !== undefined && !AGENTS_MD_MODES.includes(opts.agentsMd)) {
    console.error(`Invalid --agents-md value "${opts.agentsMd}" (expected: ${AGENTS_MD_MODES.join('|')})`);
    process.exit(1);
  }
  const installOpts = {
    sourceUrl: opts.sourceUrl,
    yes: opts.yes === true,
    createOnlyPolicy: opts.agentsMd ? { 'AGENTS.md': opts.agentsMd } : undefined,
  };

  try {
    switch (command) {
      case 'init':
        await install(opts.targetDir, installOpts);
        break;
      case 'sync':
        await sync(opts.targetDir, installOpts);
        break;
      case 'state':
        await cmdState(opts);
        break;
      case 'harness':
        await cmdHarness(opts);
        break;
      case '--version':
      case '-v':
        console.log(`cadet-agent v${getVersion()}`);
        break;
      case '--help':
      case '-h':
      case undefined:
        showHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run cadet-agent --help for usage.');
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof PolicyError || err instanceof StateError) {
      fail(opts, err.message);
    }
    throw err;
  }
}
