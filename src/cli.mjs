import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { install, sync } from './install.mjs';
import {
  validateState, migrateStateFile, readState, writeState, evaluateTransition, applyTransition,
  workItemIdOf, loadPolicy, RunLedger, loadRun, listRuns, cleanupRuns, buildReport, formatReport,
  runVerificationLoop, commandForGate, detectCapabilities, runsDir, gitChangedFiles, PolicyError, StateError,
  detectRepoRole, describeRepoRole,
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

    cadet-agent harness record      Append a sanitized span/evidence/decision event
    cadet-agent harness verify      Run a bounded, classified verification loop
    cadet-agent harness report      Summarize budget consumption and failures
    cadet-agent harness cleanup     Apply the retention policy to .cadet/runs/
    cadet-agent harness capabilities  Report available CLI/Unity/MCP/hook/token/cost telemetry

  Options:
    --target, -t  Target directory (default: current working directory)
    --source       Release API URL override (for forked deployments)
    --format       human|json (default: human)
    --to           Target phase (state transition)
    --gate         Gate name (harness verify)
    --command      Command override (harness verify)
    --files        Comma-separated relevant files to bind evidence to (harness verify)
    --agents-md    keep|overwrite|merge for an existing AGENTS.md (init/sync)
    --yes, -y      Never prompt; keep existing files (non-interactive installs)
    --help, -h    Show this help
    --version, -v Show version number
`);
}

function parseArgs(argv) {
  const opts = { format: 'human', targetDir: process.cwd(), sourceUrl: null, rest: [] };
  // argv[2] is the top-level command (`state`/`harness`/`init`/...); argv[3] begins
  // the subcommand and its options.
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--target': case '-t': opts.targetDir = argv[++i]; break;
      case '--source': opts.sourceUrl = argv[++i]; break;
      case '--format': opts.format = argv[++i] || 'human'; break;
      case '--to': opts.to = argv[++i]; break;
      case '--gate': opts.gate = argv[++i]; break;
      case '--command': opts.command = argv[++i]; break;
      case '--work-item': opts.workItemId = argv[++i]; break;
      case '--phase': opts.phase = argv[++i]; break;
      case '--run': opts.runId = argv[++i]; break;
      case '--type': opts.type = argv[++i]; break;
      case '--reason': opts.reason = argv[++i]; break;
      case '--evidence-status': opts.evidenceStatus = argv[++i]; break;
      case '--files': opts.files = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--older-than-ms': opts.olderThanMs = Number(argv[++i]); break;
      case '--agents-md': opts.agentsMd = argv[++i]; break;
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
    // Pass rootDir so stale/foreign evidence is caught at validation time.
    const result = validateState(state, { rootDir: opts.targetDir });
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
    const evaluation = evaluateTransition(state, opts.to, { rootDir: opts.targetDir });
    if (!evaluation.allowed) {
      const detail = {
        ok: false,
        allowed: false,
        missingGates: evaluation.missingGates,
        staleEvidence: evaluation.staleEvidence,
        errors: evaluation.errors,
      };
      const lines = ['❌ Transition rejected:'];
      for (const e of evaluation.errors) lines.push(`   ${e}`);
      if (evaluation.missingGates.length) lines.push(`   missing gates/evidence: ${evaluation.missingGates.join(', ')}`);
      for (const s of evaluation.staleEvidence) lines.push(`   stale: ${s.gate} — ${s.reason || (s.reasons || []).join('; ')}`);
      if (opts.format === 'json') emit(opts, '', detail);
      else console.error(lines.join('\n'));
      process.exit(1);
    }
    const next = applyTransition(state, opts.to, { rootDir: opts.targetDir });
    writeState(opts.targetDir, next);
    emit(opts, `✅ Transitioned to ${opts.to}.`, { ok: true, allowed: true, to: opts.to });
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
    if (opts.format === 'json') emit(opts, '', { ok: true, capabilities: caps });
    else {
      console.log('Cadet-Agent capability report');
      console.log(`  CLI:            ${caps.cli ? 'available' : 'unavailable'}`);
      console.log(`  Unity CLI:      ${caps.unityCli.available ? `available (${caps.unityCli.version || 'version unknown'})` : 'unavailable — compile/analyzer gates fall back to manual confirmation'}`);
      console.log(`  MCP:            ${caps.mcp.available ? 'configured' : 'unavailable — live inspection not available'}`);
      console.log(`  Copilot hook:   ${caps.hook.copilot ? 'installed' : 'not installed'}`);
      console.log(`  Token telemetry:${caps.tokenTelemetry.provider ? ' provider' : ' estimate/unknown'}`);
      console.log(`  Cost telemetry: ${caps.costTelemetry.available ? 'available' : `unavailable (${caps.costTelemetry.reason})`}`);
      console.log(`  Note: ${caps.hook.note}`);
    }
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

  if (sub === 'cleanup') {
    const { deleted, kept } = cleanupRuns(opts.targetDir, policy, {
      olderThanMs: Number.isFinite(opts.olderThanMs) ? opts.olderThanMs : null,
    });
    emit(opts, `✅ Cleanup: deleted ${deleted.length} run(s), kept ${kept.length}.`, { ok: true, deleted, kept });
    return;
  }

  fail(opts, `Unknown harness subcommand: ${sub || '(none)'}. Use record|verify|report|cleanup|capabilities.`);
}

export async function run(argv) {
  const command = argv[2];
  const opts = parseArgs(argv);

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
