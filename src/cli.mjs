import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { install, sync } from './install.mjs';
import {
  validateState, migrateStateFile, readState, writeState, evaluateTransition, applyTransition,
  workItemIdOf, loadPolicy, RunLedger, loadRun, listRuns, cleanupRuns, buildReport, formatReport,
  runVerificationLoop, commandForGate, detectCapabilities, runsDir, gitChangedFiles, PolicyError, StateError,
  detectRepoRole, describeRepoRole, GATES, PHASES, manualConfirmation, computeStatus,
  gateBuilder, describeGateRefusal,
  gitChangeSet, DEFAULT_REPORT_DIR,
  reconcileArtifacts, PLANS_DEFAULT_DIR,
  parseDesignReviewArtifact, describeDesignReviewGaps, FINDING_DISPOSITIONS,
  DESIGN_REVIEW_GATE, HUMAN_ACCEPTANCE_GATE,
  CONTEXT_LEVELS, buildContextPlan, writeContextPlan, readContextPlan, buildContextRecord,
  writeContextRecord, readContextRecord, parseTranscript, validateContextRecord,
  describeContextState, ContextProtocolError,
  enforcementMatrix, describeEnforcement, INTERCEPTION_ACTIONS,
  ARCHITECTURE_GATE, architectureFitnessActive, runArchitectureChecks, summariseChecks,
  describeCheckResults, DEFAULT_CHECK_TIMEOUT_MS,
  parseTestInventory, parseStoryCriteria, compareCoverage, describeCoverageGaps,
  parseReachabilityDeclaration, validateReachabilityDeclaration, collectWorkItems,
  findDeferralCycles, readSiblingDeclarations, normalizeWorkItemRef, describeReachabilityGaps,
  REACHABILITY_GATE, runCommand,
  parsePlayDeclaration, validatePlayDeclaration, readSiblingPlayDeclarations, describePlayGaps,
  USER_PLAY_GATE,
  createEvidence, newId, computeInputTreeHash, hashCriteria,
  collectDeclaredTestNames, reconcileTestNames,
  resolveCommand, describeCommand, describeAllCommands, checkUnattendedRequirements, COMMANDS,
  selfBoundFiles,
  STATE_VERSION, sealedEvidence, recordEvidence, appendEvidence, sealWorkItem, toStateV4,
  isHistoryExternal, HISTORY_ENTRIES_KEPT, resetGatesForNewWorkItem,
  buildStateBrief, renderStateBrief, writeStateBrief, CONTEXT_BRIEF_FILE,
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

    cadet-agent state init          Create the first .cadet/state.json (never overwrites one)
    cadet-agent state brief         Print the tier-0 summary: phase, work item, gates, archivable records
    cadet-agent state validate      Validate .cadet/state.json against the schema
    cadet-agent state validate --verify-sealed   Also read sealed evidence from commit trailers
    cadet-agent state migrate       Atomically migrate state to the current version (backup on write)
    cadet-agent state migrate --to 4   Compact: archive closed work items' evidence, build the index
    cadet-agent state compact --keep <bound>   Move closed work items' evidence into .cadet/archive/
    cadet-agent state begin --epic <id> --story <file>   Start a work item: reset gates, archive the previous item's evidence
    cadet-agent state seal          Write the active work item's evidence as commit trailers
    cadet-agent state transition --to <phase>   Enforce the transition matrix + evidence
    cadet-agent state transition --to <phase> --dry-run   Check only; writes nothing

    cadet-agent harness record      Append a sanitized span/evidence/decision event
    cadet-agent harness confirm     Record manual-confirmation evidence (writes ledger + state)
    cadet-agent harness verify      Run a bounded, classified verification loop
    cadet-agent harness verify-acs  Verify declared AC↔test coverage against a test report
    cadet-agent harness verify-reachability  Verify a story's declared reachability (opt-in)
    cadet-agent harness verify-play  Verify a story's Play: declaration and record the deferral (opt-in)
    cadet-agent harness verify-design-review  Check the design-review artifact and record the gate (opt-in)
    cadet-agent harness verify-architecture  Run the project's declared architecture checks (opt-in)
    cadet-agent harness context plan  Write what the phase requires, and why (opt-in protocol)
    cadet-agent harness context record  Record what the host loaded, and the level it can claim
    cadet-agent harness context validate  Compare plan, record and current files (read-only)
    cadet-agent harness report      Summarize budget consumption and failures
    cadet-agent harness changes     List the files a story changed, with status, counts, and links
    cadet-agent harness reconcile   Reconcile the planning chain against state.json (read-only)
    cadet-agent harness cleanup     Apply the retention policy to .cadet/runs/
    cadet-agent harness capabilities  Report available CLI/Unity/MCP/hook/token/cost telemetry
    cadet-agent harness status      Print the one-line framework health line (ok, or the problem)

  Options:
    --target, -t  Target directory (default: current working directory)
    --source       Release API URL override (for forked deployments)
    --format       human|json (default: human)
    --to           Target phase (state transition)
    --gate         Gate name (harness verify|confirm)
    --command      Command override (harness verify)
    --files        Comma-separated relevant files to bind evidence to (harness verify|confirm)
    --commit       Revision the gate attests, as a hex SHA (harness verify|confirm)
    --expect-phase Refuse to record a gate unless the current phase matches (harness verify|confirm|verify-acs|verify-reachability)
    --reason       Why a human gate is being recorded — the person's own answer (harness confirm)
    --expires-at   ISO-8601 expiry bounding the confirmation (harness confirm)
    --environment  key=value,... describing what was verified (harness confirm)
    --scope        Comma-separated scope of the confirmation (harness confirm)
    --story        Story markdown declaring the acceptance criteria, reachability or play declaration (harness verify-acs|verify-reachability|verify-play)
    --artifact     Design-review artifact to check (harness verify-design-review)

    --report       Test report to derive the inventory from (harness verify-acs|matrix-check)
    --matrix       TDD matrix markdown to check (harness matrix-check)
    --inventory    Newline-separated test names, when no report is available (harness matrix-check)
    --range        Base revision to diff instead of the working tree (harness changes)
    --relative-to  Directory the emitted links are relative to (harness changes; default .cadet/reports)
    --include-cadet  Keep .cadet/ bookkeeping among the listed files (harness changes)
    --plans-dir    Directory holding the planning artifacts (harness reconcile; default .cadet/agent/project-plans)
    --agents-md    keep|overwrite|merge for an existing AGENTS.md (init/sync)
    --older-than-ms  Age bound, in ms, for records cleanup may delete (harness cleanup; required)
    --keep         always|active|<work-item ids> for what stays in state.json (state compact; required)
    --retain-all   state compact: keep every record of the kept work items; only cross-work-item records leave
    --epic         Epic id of the work item being started (state begin)
    --commit-msg   Path to write the prepared commit message to (state seal)
    --verify-sealed  Also verify evidence sealed in commit trailers (state validate)
    --verify-host  Probe the configured host controls and report the measured level (harness capabilities)
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
      // --expect-phase: a guard against recording a gate into a phase the caller
      // did not intend. See assertExpectedPhase.
      case '--expect-phase': opts.expectPhase = value(a); break;
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
      case '--artifact': opts.artifact = value(a); break;
      // The epic the command acts on: `state begin`'s new work item.
      case '--epic': opts.epicId = value(a); break;
      // state compact: keep every record inline instead of applying the
      // within-work-item retention rule. Made explicit at the call site, because
      // otherwise a reader cannot tell a retained document from an unbounded one.
      case '--retain-all': opts.retainAll = true; break;
      case '--report': opts.report = value(a); break;
      // AR-1: the revision a gate record attests, so a gate-related fix claim
      // can be traced to the commit that contains it.
      case '--commit': opts.commitGiven = true; opts.commit = value(a); break;
      case '--matrix': opts.matrix = value(a); break;
      case '--inventory': opts.inventory = value(a); break;
      case '--range': opts.range = value(a); break;
      case '--relative-to': opts.relativeTo = value(a); break;
      case '--include-cadet': opts.includeCadet = true; break;
      case '--plans-dir': opts.plansDir = value(a); break;
      case '--write-coverage': opts.writeCoverage = true; break;
      case '--strict-orphans': opts.strictOrphans = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--older-than-ms': opts.olderThanMs = Number(value(a)); break;
      // state compact: the bound on what may leave state.json. Content-bearing
      // rather than a confirmation flag, so an unattended agent must state which
      // work items it is keeping inline.
      case '--keep': opts.keep = value(a); break;
      // state seal: where the prepared commit message goes.
      case '--commit-msg': opts.commitMsgPath = value(a); break;
      // state validate: read commit trailers too, not just the live document.
      case '--verify-sealed': opts.verifySealed = true; break;
      // The two flags the acceptance form replaced. They are PARSED so that they can be refused by
      // name: without a case here they fell through into `opts.rest`, the command exited 0, and the
      // values went nowhere — which contradicts this parser's own rule, written a few lines above,
      // that a silently swallowed option is worse than a rejected one because the command still
      // reports success. `harness confirm` refuses them (see the acceptance gate).
      case '--witness': opts.witness = value(a); break;
      case '--limitations': opts.limitations = value(a); break;
      // state init: the first document's declared values. Each is validated before anything is
      // written, so a typo cannot become a state file the rest of the framework then refuses.
      case '--workflow-path': opts.workflowPath = value(a); break;
      case '--tracking-mode': opts.trackingMode = value(a); break;
      case '--learner-tier': opts.learnerTier = value(a); break;
      case '--operating-mode': opts.operatingMode = value(a); break;
      // `--phase` is declared once, above: state init and harness record both read opts.phase.
      case '--verify-host': opts.verifyHost = true; break;
      // The context protocol: what the host loaded, and what it can claim about it.
      case '--level': opts.contextLevel = value(a); break;
      case '--loaded': opts.contextLoaded = value(a).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--enforced-by': opts.enforcedBy = value(a); break;
      case '--transcript': opts.transcript = value(a); break;
      case '--host': opts.host = value(a); break;
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

/**
 * `--expect-phase <phase>` — refuse to record gate evidence into a phase the
 * caller did not intend.
 *
 * The failure this closes is a caller error, not a framework one: `state
 * transition` already reports `allowed: false` and exits 1, but an agent that
 * chains commands with `;` and filters the output reads the *next* command's
 * success as the transition's, and goes on to record the following gates into the
 * phase it never left. The verdict was correct and ignored; the record was then
 * written anyway. This is a check because the mistake recurred after being
 * documented, and a check is what the framework's own doctrine asks for at that
 * point.
 *
 * The flag is opt-in and cheap: omitting it changes nothing. A mismatch is
 * refused before any write, so a stray `--expect-phase` cannot corrupt state —
 * it can only stop the command.
 */
function assertExpectedPhase(opts, state) {
  if (!opts.expectPhase) return;
  if (!PHASES.includes(opts.expectPhase)) {
    fail(opts, `--expect-phase "${opts.expectPhase}" is not a known phase. Valid phases: ${PHASES.join(', ')}.`, () => 1, { ok: false, code: 'unknown-phase', expectedPhase: opts.expectPhase });
  }
  const actual = state?.session?.currentPhase ?? null;
  if (actual === opts.expectPhase) return;
  fail(
    opts,
    `--expect-phase ${opts.expectPhase}, but the current phase is "${actual ?? '(none)'}". `
    + 'Refusing to record evidence for a phase the caller did not intend — re-read .cadet/state.json '
    + '(or run `state transition --dry-run`) and retry once the phase is what you expected.',
    () => 1,
    { ok: false, code: 'phase-mismatch', expectedPhase: opts.expectPhase, actualPhase: actual },
  );
}

// ── evidence archive (contract v5) ──────────────────────────────────────────

/**
 * `.cadet/archive/evidence/` — the append-only home for evidence that has left
 * `state.json`.
 *
 * A directory of per-work-item JSONL files rather than one file, because a single
 * log for a whole repository would be rewritten on every append by anything that
 * wanted to dedupe it, and an audit trail should not be rewritten. One file per
 * work item also means the common read — "what evidence did this story have?" —
 * touches one small file instead of parsing everything.
 */
function evidenceArchiveDir(targetDir) {
  return join(targetDir, '.cadet', 'archive', 'evidence');
}

/** A filesystem-safe file name for a work item id, which contains `::`. */
function archiveFileName(workItemId) {
  const safe = String(workItemId).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return `${safe || 'unscoped'}.jsonl`;
}

/** Every evidenceId already archived, so a repeated compaction is idempotent. */
function readArchivedIds(targetDir) {
  const dir = evidenceArchiveDir(targetDir);
  const ids = new Set();
  if (!existsSync(dir)) return ids;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    let text;
    try { text = readFileSync(join(dir, file), 'utf-8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record?.evidenceId) ids.add(record.evidenceId);
      } catch {
        // A malformed line is skipped rather than fatal: this is an append-only
        // log, and refusing to read the rest of it because of one bad line would
        // make the archive less durable than the file it replaced.
      }
    }
  }
  return ids;
}

/**
 * Append records to the archive, one JSON object per line, grouped by work item.
 *
 * Records whose `evidenceId` is already archived are skipped, so re-running a
 * compaction after a partial failure cannot duplicate history — which matters
 * because this log is the only remaining copy of the records it holds.
 */
function appendEvidenceArchive(targetDir, records) {
  const known = readArchivedIds(targetDir);
  const byFile = new Map();
  let skipped = 0;
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    if (record.evidenceId && known.has(record.evidenceId)) { skipped += 1; continue; }
    const name = archiveFileName(record.workItemId || 'unscoped');
    if (!byFile.has(name)) byFile.set(name, []);
    byFile.get(name).push(JSON.stringify(record));
  }
  if (byFile.size === 0) return { files: [], appended: 0, skipped };
  const dir = evidenceArchiveDir(targetDir);
  mkdirSync(dir, { recursive: true });
  const files = [];
  let appended = 0;
  for (const [name, lines] of byFile) {
    const path = join(dir, name);
    writeFileSync(path, `${lines.join('\n')}\n`, { flag: 'a', encoding: 'utf-8' });
    files.push(path);
    appended += lines.length;
  }
  return { files, appended, skipped };
}

/**
 * Append change-log entries that no longer fit inline to `.cadet/archive/history.jsonl`.
 *
 * `changeHistory` is not retired — eight skills write artifact paths into it and
 * `Resume` reads its tail — so compaction bounds it rather than dropping it. The
 * overflow goes here in full, one entry per line, so bounding the document never
 * destroys the audit trail it used to hold.
 */
function appendHistoryArchive(targetDir, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { path: null, appended: 0 };
  const dir = join(targetDir, '.cadet', 'archive');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'history.jsonl');
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, { flag: 'a', encoding: 'utf-8' });
  return { path, appended: entries.length };
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

    // `--verify-sealed` consults git for evidence sealed into commit trailers,
    // which is where a closed work item's records live from v4 on.
    //
    // It is additive by construction: it can only clear an error that a real
    // sealed record backs, never raise a new one. That direction is deliberate —
    // a check that could fail because git was unavailable would make the
    // read-only validation command depend on the environment it is auditing.
    let sealed = null;
    if (opts.verifySealed) {
      const probe = sealedEvidence(opts.targetDir, { workItemId: workItemIdOf(state) });
      if (!probe.available) {
        // Never a silent pass: "not verified" and "verified clean" must not look
        // the same, matching how a missing rootDir is reported for freshness.
        result.warnings.push({
          path: 'sealedEvidence',
          message: `sealed evidence was not verified: ${probe.reason}. Live evidence only; a gate satisfied by a sealed record will be reported as unbacked.`,
        });
      } else {
        const latestFor = (gate) => probe.records
          .filter((r) => r.gate === gate && (r.status === 'passed' || r.status === 'manual-confirmation') && !r.partial)
          .reduce((a, b) => {
            if (!a) return b;
            return (Date.parse(a.createdAt ?? '') || 0) >= (Date.parse(b.createdAt ?? '') || 0) ? a : b;
          }, null);
        const resolvedBySeal = [];
        const unresolved = [];
        for (const err of result.errors) {
          const match = /^gates\.([A-Za-z]+)$/.exec(String(err.path));
          const record = match ? latestFor(match[1]) : null;
          if (record) {
            resolvedBySeal.push({ gate: match[1], sealedCommit: record.sealedCommit });
            continue;
          }
          unresolved.push(err);
        }
        result.errors = unresolved;
        result.valid = unresolved.length === 0;
        sealed = {
          available: true,
          records: probe.records.length,
          gates: [...new Set(probe.records.map((r) => r.gate))].filter(Boolean).sort(),
          resolvedBySeal,
          diagnostics: probe.diagnostics,
        };
      }
    }

    if (opts.format === 'json') {
      emit(opts, '', {
        ok: result.valid,
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        repoRole: role.role,
        repoRoleDetail,
        ...(sealed ? { sealed } : {}),
      });
    } else {
      if (result.valid) console.log(`✅ state.json is valid (v${state.version}).`);
      else {
        console.error('❌ state.json is invalid:');
        for (const e of result.errors) console.error(`   ${e.path}: ${e.message}`);
      }
      for (const w of result.warnings) console.log(`   ⚠️  ${w.path}: ${w.message}`);
      if (sealed) {
        if (sealed.available) {
          console.log(`   Sealed evidence: ${sealed.records} record(s) in commit trailers; gates: ${sealed.gates.join(', ') || '(none)'}`);
          for (const r of sealed.resolvedBySeal) console.log(`   ✅ ${r.gate} backed by sealed record in ${String(r.sealedCommit).slice(0, 8)}`);
        }
      }
      console.log(`   Repo role: ${role.role} — ${repoRoleDetail}`);
    }
    if (!result.valid) process.exit(1);
    return;
  }

  if (sub === 'migrate') {
    // The archive is written through `beforeWrite`, which runs after the migrated
    // document validates but before the backup and the rename — so a migration
    // that would fail writes nothing at all, while a crash after the archive
    // leaves records in both places rather than neither.
    const archivePaths = [];
    let historyArchived = 0;
    const result = migrateStateFile(statePath, {
      backup: true,
      to: opts.to ?? null,
      keep: opts.keep ?? 'active',
      beforeWrite: ({ archived, archivedHistory }) => {
        const written = appendEvidenceArchive(opts.targetDir, archived);
        archivePaths.push(...written.files);
        const history = appendHistoryArchive(opts.targetDir, archivedHistory);
        if (history.path) archivePaths.push(history.path);
        historyArchived = history.appended;
      },
    });
    const detail = {
      ok: true,
      migrated: result.migrated,
      statePath: result.statePath,
      version: STATE_VERSION,
      archived: result.archived.length,
      archivedHistory: historyArchived,
      promotedExceptions: result.promoted,
      droppedHistoryEntries: result.droppedHistory,
      archivePaths,
      backupPath: result.backupPath ?? null,
    };
    if (opts.format === 'json') {
      emit(opts, '', detail);
    } else if (result.migrated) {
      console.log(`✅ Migrated ${statePath} to v${STATE_VERSION} (backup: ${result.backupPath}).`);
      if (result.archived.length) {
        console.log(`   Archived ${result.archived.length} evidence record(s) to ${evidenceArchiveDir(opts.targetDir)}`);
      }
      if (historyArchived) console.log(`   Archived ${historyArchived} change-log entr(ies) to .cadet/archive/history.jsonl (the last ${HISTORY_ENTRIES_KEPT} stay inline).`);
      if (result.promoted) console.log(`   Promoted ${result.promoted} gate exception(s) out of changeHistory.`);
    } else {
      console.log(`✅ state.json is already v${STATE_VERSION} — nothing to migrate.`);
    }
    return;
  }

  if (sub === 'brief') {
    // THE TIER-0 SUMMARY OF THE DOCUMENT (0.63.0). Read-only, and derived: every field is read from
    // state.json, and the gate rows use `latestEvidenceForGate` — the same reader a gate check uses —
    // so the brief cannot disagree with the machinery about which record is live. It exists because
    // the context plan used to name the 94 KB document itself as an always-load reference.
    const { exists, state } = readState(opts.targetDir);
    if (!exists) fail(opts, 'No .cadet/state.json found.', () => 2);

    const brief = buildStateBrief(state);
    if (opts.format === 'json') {
      emit(opts, '', { ok: true, brief });
    } else {
      emit(opts, renderStateBrief(brief).trimEnd());
    }
    return;
  }

  if (sub === 'compact') {
    const { exists, state } = readState(opts.targetDir);
    if (!exists) fail(opts, 'No .cadet/state.json found.', () => 2);
    // Compaction is the v4 shape, so a v2/v3 document needs the explicit version
    // migration first. Doing it implicitly here would hide a version change
    // inside what a caller thinks is housekeeping.
    if (!isHistoryExternal(state)) {
      fail(opts, `state.json is v${state.version ?? state.stateVersion}; compaction requires v${STATE_VERSION}. Run "cadet-agent state migrate --to ${STATE_VERSION}" first.`, () => 1, { ok: false, code: 'compact-requires-v4' });
    }
    const keep = parseKeepBound(opts.keep);
    const { state: next, archived, archivedHistory } = toStateV4(state, { keep, retainAll: opts.retainAll === true });
    const written = appendEvidenceArchive(opts.targetDir, archived);
    const history = appendHistoryArchive(opts.targetDir, archivedHistory);
    const changed = archived.length > 0 || archivedHistory.length > 0;
    if (changed) writeState(opts.targetDir, next);
    emit(
      opts,
      changed
        ? `✅ Compacted state.json: archived ${archived.length} evidence record(s), ${history.appended} change-log entr(ies); kept ${next.gateEvidence.length} record(s) and ${(next.changeHistory || []).length} entr(ies) inline.${opts.retainAll ? '\n   --retain-all: every kept work item\'s records stay inline, so only cross-work-item records left.' : ''}\n   Archive: ${join(opts.targetDir, '.cadet', 'archive')}`
        : '✅ Nothing to compact: every evidence record and change-log entry is already kept inline.',
      {
        ok: true,
        archived: archived.length,
        archivedHistory: history.appended,
        kept: next.gateEvidence.length,
        appended: written.appended,
        skipped: written.skipped,
        archivePaths: [...written.files, ...(history.path ? [history.path] : [])],
        coverageRows: Object.keys(next.evidenceCoverage || {}).length,
      },
    );
    return;
  }

  if (sub === 'init') {
    // The first state document, as a command.
    //
    // It had no command. `cadet-agent init` installs the framework, and then EVERY entry point
    // refuses: `state begin` says "Initialise state before starting a work item", `state
    // transition` says the same, `harness confirm` says the same — and there was no way to
    // initialise it. The only route was a hand-written document, which is the pattern this
    // framework condemns everywhere else, and the instruction that described it
    // (`skills/Resume.md`) wrote `version: 1` with `session.workflowPath: null` — a document
    // `state validate` REJECTS ("workflowPath is required", "unknown workflowPath \"null\"").
    // So a new consumer's first document was unaudited and, followed literally, invalid; and
    // every later gate reads that document.
    const existing = readState(opts.targetDir);
    if (existing.exists) {
      fail(
        opts,
        'A state document already exists. state init never overwrites one: '
        + 'it is the document every gate reads, and rewriting it silently would discard the '
        + 'evidence those gates were satisfied with. Delete or archive it first if that is '
        + 'really what you want.',
        () => 1,
        { ok: false, code: 'state-exists', path: '.cadet/state.json' },
      );
    }

    const workflowPath = opts.workflowPath || 'large';
    const trackingMode = opts.trackingMode || 'markdown';
    const currentPhase = opts.phase || PHASES[0];
    const values = [
      ['--workflow-path', workflowPath, ['large', 'small', 'no_test_required']],
      ['--tracking-mode', trackingMode, ['markdown', 'github']],
      ['--phase', currentPhase, PHASES],
    ];
    if (opts.learnerTier !== undefined) values.push(['--learner-tier', opts.learnerTier, ['beginner', 'intermediate', 'advanced', 'guided']]);
    if (opts.operatingMode !== undefined) values.push(['--operating-mode', opts.operatingMode, ['instruction-first', 'implementation-first', 'hybrid']]);
    for (const [flag, value, allowed] of values) {
      if (!allowed.includes(value)) {
        fail(opts, `unknown ${flag} value "${value}" (expected one of: ${allowed.join(', ')})`, () => 1, { ok: false, code: 'unknown-value', flag, value, allowed });
      }
    }

    const initial = {
      version: STATE_VERSION,
      stateVersion: STATE_VERSION,
      session: {
        workflowPath,
        currentPhase,
        trackingMode,
        ...(opts.learnerTier !== undefined ? { learnerTier: opts.learnerTier } : {}),
        ...(opts.operatingMode !== undefined ? { operatingMode: opts.operatingMode } : {}),
      },
      activeWorkItem: null,
      gates: Object.fromEntries(GATES.map((g) => [g, false])),
      gateEvidence: [],
      epics: {},
    };

    // Validate before writing, like every other writer here. A document that the framework
    // would refuse must never reach disk: it is the file every gate reads.
    const { errors } = validateState(initial, { rootDir: opts.targetDir });
    if (errors.length > 0) {
      fail(opts, `refusing to write an invalid state document: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`, () => 1, { ok: false, code: 'invalid-state', errors });
    }

    const written = writeState(opts.targetDir, initial);
    emit(
      opts,
      `✅ Created .cadet/state.json (v${STATE_VERSION}): workflowPath "${workflowPath}", phase "${currentPhase}", trackingMode "${trackingMode}".\n`
      + '   The framework is installed and the workflow starts here; nothing is tracked until the first work item ("cadet-agent state begin").',
      { ok: true, version: STATE_VERSION, workflowPath, currentPhase, trackingMode, gates: Object.keys(initial.gates).length, appended: written?.appended ?? 0 },
    );
    return;
  }

  if (sub === 'begin') {
    // The story boundary, as a command.
    //
    // It existed only as a sentence in `skills/Resume.md` — "set `activeWorkItem`,
    // reset gates" — which an agent carried out by editing state.json by hand, and
    // the sentence never mentions evidence. So the previous work item's records
    // stayed inline for ever. On the audited repository that was 63 records and
    // ~3,000 lines, none of which any gate could read: `evidenceFreshness` rejects
    // a record whose `workItemId` is not the active one. `resetGatesForNewWorkItem`
    // already did the job correctly — cleared the evidence, folded it into the
    // coverage index first, dropped expired exceptions, wrote one boundary line —
    // and had no caller. This is the door.
    if (!opts.epicId) fail(opts, 'state begin requires --epic <epicId>');
    if (!opts.story) fail(opts, 'state begin requires --story <storyFile>');
    const { exists, state } = readState(opts.targetDir);
    if (!exists) fail(opts, 'No .cadet/state.json found. Initialise state before starting a work item.', () => 2);

    const fromId = state.activeWorkItem ? workItemIdOf(state) : null;
    const toId = `${opts.epicId}::${opts.story}`;
    if (fromId === toId) {
      fail(opts, `the active work item is already "${toId}"; nothing to begin.`, () => 1, { ok: false, code: 'already-active', workItemId: toId });
    }
    // `closed` is terminal: Resume says new work starts from a fresh session
    // (context-resolution) rather than by beginning a work item inside a plan that
    // is already finished.
    if (state.session?.currentPhase === 'closed') {
      fail(opts, 'the session is closed — start new work from a fresh session (context-resolution) rather than beginning a work item inside a closed plan.', () => 1, { ok: false, code: 'session-closed' });
    }

    // Nothing leaves state.json without being written down first (contract v5 §1).
    // The reset folds the outgoing records into the coverage index, which is a
    // *summary* — so the records themselves are archived here, exactly as `compact`
    // archives a closed work item's, and before the document is written.
    const outgoing = Array.isArray(state.gateEvidence) ? state.gateEvidence : [];
    const written = appendEvidenceArchive(opts.targetDir, outgoing);
    const next = resetGatesForNewWorkItem(state, { epicId: opts.epicId, storyId: opts.story });
    writeState(opts.targetDir, next);
    // The boundary records the outgoing work item as complete (see
    // `resetGatesForNewWorkItem`), so report it: that record is the answer to "is
    // this story finished, with its epic still open?" — the question the framework
    // had no vocabulary for.
    const completed = fromId && Array.isArray(next.storyCompletions)
      ? next.storyCompletions.find((row) => row?.workItemId === fromId) ?? null
      : null;
    emit(
      opts,
      `✅ Began ${toId}.\n   Gates reset; ${outgoing.length} evidence record(s) archived (${written.appended} appended, ${written.skipped} already archived).`
      + (completed
        ? `\n   Completed: ${completed.workItemId} (${completed.evidenceRecords} evidence record(s) behind it)`
        : fromId ? `\n   Previous work item: ${fromId}` : '')
      + `\n   Coverage rows: ${Object.keys(next.evidenceCoverage || {}).length}`,
      {
        ok: true,
        from: fromId,
        to: toId,
        gatesReset: true,
        completed: completed ? { workItemId: completed.workItemId, completedAt: completed.completedAt } : null,
        archived: written.appended,
        alreadyArchived: written.skipped,
        coverageRows: Object.keys(next.evidenceCoverage || {}).length,
        archivePaths: written.files,
      },
    );
    return;
  }

  if (sub === 'seal') {
    const { exists, state } = readState(opts.targetDir);
    if (!exists) fail(opts, 'No .cadet/state.json found.', () => 2);
    const policy = loadPolicy(opts.targetDir);
    const { workItemId, records, lines, partial } = sealWorkItem(state, {
      workItemId: opts.workItemId || null,
      maxBytes: policy.output?.maxInlineBytes,
    });
    if (records.length === 0) {
      fail(opts, `no inline evidence to seal for ${workItemId || '(no active work item)'}. Evidence for a closed work item lives in its commit and .cadet/archive/.`, () => 1, { ok: false, code: 'nothing-to-seal', workItemId });
    }
    // The message file is what makes this compatible with C5: Cadet prepares the
    // message, and the commit is still the user's action.
    const messagePath = opts.commitMsgPath || join(opts.targetDir, '.cadet', 'seal.commit-msg');
    const header = [
      `chore(gates): seal evidence for ${workItemId}`,
      '',
      'Evidence for this work item, written here so it travels with the code.',
      'Edit the subject line to describe the change; keep the trailer block intact —',
      'the records are read back out of it, and altering one changes the commit id.',
      '',
    ].join('\n');
    writeFileSync(messagePath, `${header}${lines.join('\n')}`, 'utf-8');
    const archived = appendEvidenceArchive(opts.targetDir, records);
    const { state: next } = toStateV4(state, { keep: opts.keep ?? 'active' });
    writeState(opts.targetDir, next);
    emit(
      opts,
      [
        `✅ Prepared ${records.length} evidence record(s) for commit.`,
        `   Message:  ${messagePath}`,
        `   Commit:   git commit -F "${messagePath}"`,
        archived.appended ? `   Archived: ${archived.appended} record(s) to ${evidenceArchiveDir(opts.targetDir)}` : '   Archive:  already up to date',
        partial.length ? `   ⚠️  ${partial.length} record(s) exceeded the trailer bound and were marked partial (they cannot satisfy a gate).` : null,
      ].filter(Boolean).join('\n'),
      { ok: true, workItemId, records: records.length, messagePath, archived: archived.appended, partial },
    );
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
    // `policy` is loaded here: `cmdState` does not otherwise need it, but the
    // transition verdict does — the reachability gate joins the requirement only
    // for a repository that has opted in (see requiredGates / REACHABILITY_GATE).
    const transitionPolicy = loadPolicy(opts.targetDir);
    // `strictClosure` is passed alongside the policy so strict closure (v3) is
    // decided from the resolved repository policy on the CLI path too — the
    // same verdict a library caller gets by passing the block explicitly.
    const evaluation = evaluateTransition(state, opts.to, {
      rootDir: opts.targetDir,
      policy: transitionPolicy,
      strictClosure: transitionPolicy.strictClosure,
    });
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
    // The same policy context the pre-check used, so the applied transition is
    // judged by exactly the same rules that allowed it (reachability, strict closure).
    const next = applyTransition(state, opts.to, {
      rootDir: opts.targetDir,
      policy: transitionPolicy,
      strictClosure: transitionPolicy.strictClosure,
    });
    writeState(opts.targetDir, next);
    emit(opts, `✅ Transitioned to ${opts.to}.`, { ok: true, allowed: true, dryRun: false, applied: true, to: opts.to });
    return;
  }

  fail(opts, `Unknown state subcommand: ${sub || '(none)'}. Use brief|validate|migrate|compact|begin|seal|transition.`);
}

/**
 * Parse the `--keep` bound for `state compact`: `always`, `active`, or a
 * comma-separated list of work-item ids. Returns what `toStateV4` expects.
 */
function parseKeepBound(raw) {
  const text = String(raw ?? '').trim();
  if (text === 'always') return 'always';
  if (text === 'active' || text === '') return 'active';
  return text.split(',').map((s) => s.trim()).filter(Boolean);
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
    // What the host can actually stop, per action. `--verify-host` runs the probes; without it the
    // declared position is printed and marked "declared", so a reader can always tell a measurement
    // from a declaration — and never from the presence of a file.
    const matrix = enforcementMatrix(opts.targetDir, { verify: opts.verifyHost === true });
    if (opts.verifyHost === true) caps.hook.verified = matrix.hostHook.verified;
    if (opts.format === 'json') emit(opts, '', { ok: true, capabilities: caps, enforcement: matrix, commands });
    else {
      console.log('Cadet-Agent capability report');
      console.log(`  CLI:            ${caps.cli ? 'available' : 'unavailable'}`);
      console.log(`  Unity CLI:      ${caps.unityCli.available ? `available (${caps.unityCli.version || 'version unknown'})` : 'unavailable — compile/analyzer gates fall back to manual confirmation'}`);
      console.log(`  MCP:            ${caps.mcp.available ? 'configured' : 'unavailable — live inspection not available'}`);
      console.log(`  Token telemetry:${caps.tokenTelemetry.provider ? ' provider' : ' estimate/unknown'}`);
      console.log(`  Cost telemetry: ${caps.costTelemetry.available ? 'available' : `unavailable (${caps.costTelemetry.reason})`}`);
      console.log(`  Host interception (${matrix.verified ? 'measured' : 'declared — pass --verify-host to measure'}):`);
      for (const line of describeEnforcement(matrix)) console.log(line);
      if (matrix.verified) {
        console.log(`  Host hook:      ${matrix.hostHook.verified ? `verified — ${matrix.hostHook.reason}` : `not verified — ${matrix.hostHook.reason}`}`);
        console.log(`  Repo git hook:  ${matrix.repoHook.verified ? `verified — ${matrix.repoHook.reason}` : `not verified — ${matrix.repoHook.reason}`}`);
      } else {
        console.log(`  Note: ${caps.hook.note}`);
      }
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
    assertExpectedPhase(opts, state);

    // A human gate is recorded from the person's own answer, and from nothing else.
    //
    // There is no artifact and no form. These two gates ask what a PERSON did and what they saw,
    // and the answer is a sentence the person said: `--reason` carries it, and the record binds
    // the active work item and whatever files the answer covers. A form was the earlier route and
    // was removed (2026-10-03): it added a document to write, read and keep in sync, and its
    // blank fields stop a lazy agent rather than a dishonest one, so it bought less than it cost.
    const HUMAN_GATE = gate === HUMAN_ACCEPTANCE_GATE || gate === USER_PLAY_GATE;

    if (opts.artifact) {
      fail(
        opts,
        '--artifact is not accepted by "harness confirm": "harness verify-design-review" is the command that takes an artifact. '
        + 'Record a human gate from the person\'s words with --reason.',
        () => 1,
        { ok: false, gate, code: 'artifact-not-applicable' },
      );
    }

    // A caller that passes the removed flags is refused by name rather than recorded, so nothing
    // they typed is silently discarded.
    const removedFlags = ['witness', 'limitations'].filter((k) => opts[k] !== undefined && opts[k] !== null);
    if (removedFlags.length > 0) {
      const flags = removedFlags.map((k) => `--${k}`);
      fail(
        opts,
        `${flags.join(' and ')} no longer exist, so nothing was recorded. A human gate is recorded from the `
        + 'person\'s own answer: ask them, then pass their words to --reason.',
        () => 1,
        { ok: false, gate, code: 'flag-removed', flags },
      );
    }

    // The answer cannot be empty. The form refused three blank fields; the same refusal now stands
    // on one field, and it holds whether or not strictClosure is enabled — an attestation that
    // says nothing is not an attestation.
    if (HUMAN_GATE && (!opts.reason || String(opts.reason).trim() === '')) {
      fail(
        opts,
        `"${gate}" is a person's record, so --reason must carry what they said. `
        + 'Ask them what they did and what they saw, then record their answer.',
        () => 1,
        { ok: false, gate, code: 'reason-required' },
      );
    }

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
      // The reachability gate's automated path is its dedicated command, not
      // `harness verify` — which is blocked for it as an agent-checkable gate.
      const automatedPath = gate === REACHABILITY_GATE
        ? '"cadet-agent harness verify-reachability --story <path>"'
        : `"cadet-agent harness verify --gate ${gate}"`;
      fail(opts, `manual-confirmation is not permitted for gate "${gate}" under strictClosure.disallowManualFor; run ${automatedPath} instead.`, () => 1, { ok: false, gate, code: 'manual-disallowed' });
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

    // Supersede-and-append plus the coverage index live in `recordEvidence`, so
    // this path and `harness verify` cannot disagree about either. Before that
    // helper the two commands built the array separately, which is how an index
    // would have ended up maintained by one of them and not the other.
    const prior = Array.isArray(state.gateEvidence) ? state.gateEvidence : [];
    const superseded = prior.filter((e) => e.gate === gate && (e.status === 'passed' || e.status === 'manual-confirmation')).length;
    const next = recordEvidence(state, evidence);
    writeState(opts.targetDir, next);

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
    // The gate NAME selects the evidence contract, so an unknown name is refused
    // before anything runs. A made-up gate used to be accepted with --command and
    // recorded as an automated pass, which put evidence into state.json for a name
    // no transition can read.
    if (!GATES.includes(gate)) {
      fail(opts, describeGateRefusal(gate), () => 1, { ok: false, gate, code: 'unknown-gate' });
    }
    // A project command may fill only the slots whose evidence IS a project
    // command. Anywhere else it would let an unrelated exit-zero command attest a
    // claim it does not prove — which is how `codeReviewCompleted` could be
    // satisfied by `node -e "process.exit(0)"`.
    if (opts.command && gateBuilder(gate)?.projectCommand !== true) {
      fail(opts, describeGateRefusal(gate), () => 1, { ok: false, gate, code: 'gate-not-overridable' });
    }
    const { state } = readState(opts.targetDir);
    assertExpectedPhase(opts, state);
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
      // The failed attempts from this run are appended first, then the passing
      // record supersedes prior passing evidence for the gate. Red-before-green is
      // why the attempts are not filtered out on success: the red record is the
      // thing that made the green one permissible, and dropping it would leave a
      // green gate whose justification no longer exists.
      const attempts = result.attempts.map((a) => a.evidence);
      let next = state;
      if (result.ok && result.finalEvidence) {
        for (const ev of attempts) {
          if (ev?.evidenceId !== result.finalEvidence.evidenceId) next = appendEvidence(next, ev);
        }
        next = recordEvidence(next, result.finalEvidence);
      } else {
        for (const ev of attempts) next = appendEvidence(next, ev);
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
    refuseCommandOverride('harness verify-acs', 'the acceptance criteria in the story and the test report');
    // Mechanical AC↔test verification (contract v4). Declared tests must appear
    // in the inventory of a run that actually executed them; a name that was
    // never written cannot be asserted into coverage.
    if (!opts.story) fail(opts, 'harness verify-acs requires --story <path>');
    const storyPath = resolve(opts.targetDir, opts.story);
    const { exists, state } = readState(opts.targetDir);
    assertExpectedPhase(opts, state);
    const strict = policy.strictClosure?.enabled === true;
    const workItemId = state ? workItemIdOf(state) : 'unscoped';
    const phase = state?.session?.currentPhase || 'implementation';

    let criteria;
    try {
      // The story is READ from the target repository, exactly as verify-reachability reads it, and
      // not from the process working directory. Reading it from the CWD while the record below
      // binds `<target>/<story>` was two defects in one line: the command was unusable from
      // outside the project (`--target` with a CWD elsewhere), and — worse — when a file of that
      // name happened to exist under the CWD it parsed THAT file's criteria and wrote a record
      // attesting them against the target's path, which is the silently-inert binding the comment
      // below warns about.
      ({ criteria } = parseStoryCriteria(storyPath));
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
        // Resolved against the target, like `--story` above and like every other path flag in this
        // CLI (matrix-check, harness changes). CWD-relative reads made the command unusable from
        // outside the project and could have read a report from a different tree.
        reportText = readFileSync(resolve(opts.targetDir, opts.report), 'utf-8');
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
    // The story is the only INPUT to the AC claim: it carries the declared
    // AC→test mapping, and `criteriaHash` binds those names (C12), so editing the
    // mapping invalidates the record.
    //
    // The test report is an OUTPUT of the run that satisfied `testsPassed`, not an
    // input, and binding it was a defect: a repository whose test script rewrites a
    // fixed report path (e.g. `test-results-junit.xml`) staled this record the
    // moment it re-ran the tests, because the file the record had just read changed
    // underneath it. This is the same class Harness §5 already excludes
    // (`.cadet/state.json`, `.cadet/runs/**`) — "binding evidence to either would
    // make a gate stale the instant it was written" — so a generated report gets
    // the same treatment and is kept as `artifactPath` for audit, where nothing
    // re-hashes it.
    //
    // The story path is made repo-relative (see the read above: it resolves against the target,
    // never the working directory) for the same reason verify-reachability does it: an absolute
    // path never resolves under the root when freshness is re-derived at transition time, so both
    // hashes would be computed over a missing file and match — a binding that is silently inert.
    const storyRel = relative(opts.targetDir, storyPath).replace(/\\/g, '/') || basename(storyPath);
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
      // The revision this coverage claim attests, when the caller names one. AR-1/the
      // citation policy make it required once the gated work is committed: without it the
      // record can name its work item and its files but never the commit, and a reviewer
      // has no structured way to check the claim (Harness.md §1). Validated and normalized
      // by createEvidence, so a branch or tag name is refused rather than stored.
      commit: opts.commit || null,
      // Audit pointer only. Not a relevant file: see above.
      artifactPath: reportPath ? reportPath.replace(/\\/g, '/') : null,
      inputTreeHash: computeInputTreeHash(opts.targetDir, [storyRel]),
      criteriaHash: hashCriteria(criteriaStrings),
      relevantFiles: [storyRel],
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
      const next = recordEvidence(state, evidence);
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

  if (sub === 'verify-reachability') {
    refuseCommandOverride('harness verify-reachability', "the story's reachability declaration and the repository's own probe");
    // Mechanical reachability verification (contract v6 §2). A story declares how
    // its deliverable becomes witnessable, or which work item will make it so;
    // this checks that declaration against the work items that exist, and runs
    // the repository's own probe when one is configured.
    //
    // WHY THE PROBE IS WHAT PROVES IT. Cadet cannot know how a given repository
    // wires its pieces together, so a `witnessed` declaration is a statement and
    // not a proof. The proof is the project's command, whose exit code is the
    // verdict. Without one, the declaration level is all that is enforceable, and
    // the output says so rather than implying more.
    if (!opts.story) fail(opts, 'harness verify-reachability requires --story <path>');
    // The story is resolved against the target repository, and the evidence
    // binds to the REPO-RELATIVE path. An absolute path never resolves under
    // the root when freshness is re-derived at transition time, so both hashes
    // would be computed over a missing file and match — the staleness binding
    // would be silently inert.
    const storyPath = resolve(opts.targetDir, opts.story);
    const storyRel = relative(opts.targetDir, storyPath).replace(/\\/g, '/') || basename(storyPath);
    const { exists, state } = readState(opts.targetDir);
    assertExpectedPhase(opts, state);
    const enabled = policy.reachability?.enabled === true;
    const probeCommand = policy.reachability?.command || null;
    const workItemId = state ? workItemIdOf(state) : 'unscoped';
    const phase = state?.session?.currentPhase || 'implementation';

    let declaration;
    try {
      declaration = parseReachabilityDeclaration(storyPath);
    } catch (err) {
      fail(opts, `cannot read story "${opts.story}": ${err.message}`, () => 1, { ok: false, code: 'story-unreadable', story: opts.story });
    }

    const workItems = exists ? collectWorkItems(state) : null;
    const validation = validateReachabilityDeclaration(declaration, { workItems, self: basename(storyPath) });

    // The deferral graph over this story's own epic. A cycle is the gap no single
    // declaration can reveal: every item in the loop points at another to explain
    // why it is not witnessed. `workItems` supplies the epic-key aliases, so the
    // long `epicKey::story.md` form and the bare file name resolve to one node
    // regardless of where the story file physically sits.
    const siblings = readSiblingDeclarations(storyPath, { workItems });
    const graph = siblings.length > 0
      ? siblings
      : [{ id: basename(storyPath), aliases: [], declaration }];
    const cycles = exists ? findDeferralCycles(graph) : [];

    let probe = null;
    if (enabled && probeCommand) {
      const res = await runCommand(probeCommand, { cwd: opts.targetDir });
      probe = {
        command: probeCommand,
        exitCode: res.exitCode,
        ok: res.exitCode === 0,
        durationMs: res.durationMs,
        preview: String(res.preview || '').trim(),
      };
    }

    const gaps = describeReachabilityGaps({ validation, cycles, story: opts.story });
    const ok = validation.ok && cycles.length === 0 && (probe === null || probe.ok === true);

    // NOT OPTED IN: report and write nothing. This is the compatibility rule that
    // makes adopting the framework version a no-op for a repository that has not
    // enabled the policy, and it mirrors how verify-acs behaves with
    // strictClosure off. The finding still exits nonzero, because a caller who
    // ran the command explicitly asked the question.
    if (!enabled) {
      if (opts.format === 'json') {
        emit(opts, '', { ok, story: opts.story, declaration, reachability: validation, cycles, probe, gateSet: false, enabled: false });
      } else if (ok) {
        console.log(`✅ Reachability declared for ${opts.story}: ${validation.message}`);
        console.log('   reachability.enabled is false — reported only, state.json unchanged.');
      } else {
        console.error(`⚠️  Reachability gaps in ${opts.story} (reachability.enabled is false — reported only):`);
        for (const line of gaps) console.error(line);
      }
      if (!ok) process.exit(1);
      return;
    }

    if (!ok) {
      const detail = {
        ok: false,
        story: opts.story,
        declaration,
        reachability: validation,
        cycles,
        probe,
        gateSet: false,
        code: validation.ok !== true ? validation.code : (cycles.length > 0 ? 'deferral-cycle' : 'probe-failed'),
      };
      if (opts.format === 'json') emit(opts, '', detail);
      else {
        console.error(`❌ Cannot set ${REACHABILITY_GATE} for ${opts.story}:`);
        for (const line of gaps) console.error(line);
        if (probe && probe.ok !== true) {
          console.error(`   the project probe "${probe.command}" exited ${probe.exitCode}: the declared reachability is not what the project can demonstrate.`);
          if (probe.preview) console.error(`   probe output: ${probe.preview}`);
        }
      }
      process.exit(1);
    }

    const at = new Date();
    const evidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId: null,
      phase,
      gate: REACHABILITY_GATE,
      status: 'passed',
      command: `harness verify-reachability --story ${opts.story}`,
      result: probe
        ? `reachability addressed (${validation.code}); project probe exit ${probe.exitCode}`
        : `reachability addressed (${validation.code}); no project probe configured`,
      exitCode: 0,
      // Same citation requirement as verify-acs: the declaration is what is being attested,
      // and it is attested of a revision. Validated and normalized by createEvidence, so a
      // branch or tag name is refused rather than stored.
      commit: opts.commit || null,
      inputTreeHash: computeInputTreeHash(opts.targetDir, [storyRel]),
      criteriaHash: hashCriteria([
        workItemId,
        validation.code,
        declaration.deferTo || declaration.witness || '',
      ]),
      relevantFiles: [storyRel],
      createdAt: at,
      expiresAt: null,
      freshnessPolicy: { scope: 'story' },
      source: 'automated',
    });

    // Ledger first, then state — the v3 ordering: fail toward "less proven".
    const ledger = new RunLedger({ targetDir: opts.targetDir, policy, runId: state?.activeRunId || null, workItemId, phase });
    ledger.addEvidence(evidence);
    ledger.addDecision({ kind: 'stop', reason: `reachability addressed (${validation.code})`, scope: probe ? `probe exit ${probe.exitCode}` : 'declaration only' });
    ledger.finalize({ status: 'ok' });
    const ledgerPath = ledger.persist();

    if (exists) {
      const next = recordEvidence(state, evidence);
      writeState(opts.targetDir, next);
    }

    if (opts.format === 'json') {
      emit(opts, '', { ok: true, story: opts.story, reachability: validation, cycles, probe, evidenceId: evidence.evidenceId, gateSet: exists, runId: ledger.runId, path: ledgerPath });
    } else {
      console.log(`✅ ${REACHABILITY_GATE} for ${opts.story}: ${validation.message}`);
      if (probe) console.log(`   Project probe "${probe.command}" exited 0 (${probe.durationMs} ms).`);
      else console.log('   No reachability.command configured — the declaration is checked, the wiring is not proven.');
      console.log(`   Ledger: ${ledgerPath}`);
    }
    return;
  }

  if (sub === 'verify-play') {
    refuseCommandOverride('harness verify-play', "the story's Play: declaration");
    // Mechanical play-declaration verification (contract v7 §1). A story states whether a
    // person can play its deliverable, or which work item will make it playable; this checks
    // that declaration against the work items that exist.
    //
    // WHY THIS COMMAND CANNOT SET THE GATE FOR A PLAYABLE STORY. The gate asks whether a
    // PERSON played the work. So this records the gate for a `deferred` declaration — the
    // declaration is the answer, exactly as a reachability deferral is — and REFUSES to
    // record it for a `required` one, pointing at the form. An agent that could answer
    // "the user played it" in a sentence would make the gate worthless, which is the whole
    // reason `userPlaythroughConfirmed` is human-owned in the gate registry.
    if (!opts.story) fail(opts, 'harness verify-play requires --story <path>');
    const storyPath = resolve(opts.targetDir, opts.story);
    const storyRel = relative(opts.targetDir, storyPath).replace(/\\/g, '/') || basename(storyPath);
    const { exists, state } = readState(opts.targetDir);
    assertExpectedPhase(opts, state);
    const playEnabled = policy.userPlay?.enabled === true;
    const workItemId = state ? workItemIdOf(state) : 'unscoped';
    const phase = state?.session?.currentPhase || 'implementation';

    let playDeclaration;
    try {
      playDeclaration = parsePlayDeclaration(storyPath);
    } catch (err) {
      fail(opts, `cannot read story "${opts.story}": ${err.message}`, () => 1, { ok: false, code: 'story-unreadable', story: opts.story });
    }

    const playWorkItems = exists ? collectWorkItems(state) : null;
    const playValidation = validatePlayDeclaration(playDeclaration, { workItems: playWorkItems, self: basename(storyPath) });
    const playSiblings = readSiblingPlayDeclarations(storyPath, { workItems: playWorkItems });
    const playGraph = playSiblings.length > 0
      ? playSiblings
      : [{ id: basename(storyPath), aliases: [], declaration: playDeclaration }];
    const playCycles = exists ? findDeferralCycles(playGraph) : [];
    const playGaps = describePlayGaps({ validation: playValidation, cycles: playCycles, story: opts.story });

    // A playable story. The gate is NOT set here; the refusal names the route that can set it —
    // a person plays the work, and the agent records that person's answer with `--reason`.
    if (playValidation.ok && playValidation.code === 'required') {
      fail(
        opts,
        `${USER_PLAY_GATE} is a person's record, and this story declares its deliverable playable: ${playDeclaration.instruction} `
        + `Ask the person to play it, then record their answer: cadet-agent harness confirm --gate ${USER_PLAY_GATE} `
        + `--reason "<what they did and what they saw>" --files <story>.`,
        () => 1,
        { ok: false, gate: USER_PLAY_GATE, code: 'play-required', story: opts.story, declaration: playDeclaration },
      );
    }

    const playOk = playValidation.ok && playCycles.length === 0;

    if (!playEnabled) {
      if (opts.format === 'json') {
        emit(opts, '', { ok: playOk, story: opts.story, declaration: playDeclaration, play: playValidation, cycles: playCycles, gateSet: false, enabled: false });
      } else if (playOk) {
        console.log(`✅ Play declaration for ${opts.story}: ${playValidation.message}`);
        console.log('   userPlay.enabled is false — reported only, state.json unchanged.');
      } else {
        console.error(`⚠️  Play gaps in ${opts.story} (userPlay.enabled is false — reported only):`);
        for (const line of playGaps) console.error(line);
      }
      if (!playOk) process.exit(1);
      return;
    }

    if (!playOk) {
      const detail = {
        ok: false,
        story: opts.story,
        declaration: playDeclaration,
        play: playValidation,
        cycles: playCycles,
        gateSet: false,
        code: playValidation.ok !== true ? playValidation.code : 'deferral-cycle',
      };
      if (opts.format === 'json') emit(opts, '', detail);
      else {
        console.error(`❌ Cannot set ${USER_PLAY_GATE} for ${opts.story}:`);
        for (const line of playGaps) console.error(line);
      }
      process.exit(1);
    }

    const playAt = new Date();
    const playEvidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId: null,
      phase,
      gate: USER_PLAY_GATE,
      status: 'passed',
      command: `harness verify-play --story ${opts.story}`,
      result: `play deferred (${playValidation.code})`,
      exitCode: 0,
      commit: opts.commit || null,
      inputTreeHash: computeInputTreeHash(opts.targetDir, [storyRel]),
      criteriaHash: hashCriteria([
        workItemId,
        playValidation.code,
        playDeclaration.deferTo || playDeclaration.instruction || '',
      ]),
      relevantFiles: [storyRel],
      createdAt: playAt,
      expiresAt: null,
      freshnessPolicy: { scope: 'story' },
      source: 'automated',
    });

    const playLedger = new RunLedger({ targetDir: opts.targetDir, policy, runId: state?.activeRunId || null, workItemId, phase });
    playLedger.addEvidence(playEvidence);
    playLedger.addDecision({ kind: 'stop', reason: `play deferred (${playValidation.code})`, scope: 'declaration only' });
    playLedger.finalize({ status: 'ok' });
    const playLedgerPath = playLedger.persist();

    if (exists) {
      const next = recordEvidence(state, playEvidence);
      writeState(opts.targetDir, next);
    }

    if (opts.format === 'json') {
      emit(opts, '', { ok: true, story: opts.story, play: playValidation, cycles: playCycles, evidenceId: playEvidence.evidenceId, gateSet: exists, runId: playLedger.runId, path: playLedgerPath });
    } else {
      console.log(`✅ ${USER_PLAY_GATE} for ${opts.story}: ${playValidation.message}`);
      console.log('   The story defers the playthrough, so the declaration is the record — no form is needed.');
      console.log(`   Ledger: ${playLedgerPath}`);
    }
    return;
  }

  if (sub === 'context') {
    // The runtime context boundary: plan, record, validate.
    //
    // WHY THIS EXISTS. Cadet does not inject context into a model — hosts own model context — so
    // the honest thing to build is a protocol rather than a claim: say what a phase requires,
    // let the host report what it loaded, and compare the two. Without the record, "the agent
    // read the skill file" is an assertion nothing can check, and a framework whose whole point
    // is that claims carry evidence should not make an exception for its own central act.
    const action = opts.rest[1];
    if (!['plan', 'record', 'validate'].includes(action)) {
      fail(opts, `harness context needs an action: plan, record or validate (got "${action || '(none)'}").`, () => 1, { ok: false, code: 'context-action-required' });
    }
    const { exists, state } = readState(opts.targetDir);

    if (action === 'plan') {
      // THE BRIEF IS WRITTEN BEFORE THE PLAN IS BUILT, so the plan can name it and hash it. A plan
      // that named a file nobody had written would report its own tier-0 reference as MISSING, and
      // the caller would have to run two commands to get one answer.
      writeStateBrief(opts.targetDir, state);
      const plan = buildContextPlan({ targetDir: opts.targetDir, policy, state });
      const planPath = writeContextPlan(opts.targetDir, plan);
      const shown = relative(opts.targetDir, planPath).replace(/\\/g, '/');
      const fit = plan.budget.fits === null ? 'no context budget declared'
        : plan.budget.fits ? `fits the ${plan.budget.hardContextTokens}-token budget`
          : `DOES NOT fit the ${plan.budget.hardContextTokens}-token budget (required ${plan.budget.requiredTokens})`;
      if (opts.format === 'json') {
        emit(opts, '', { ok: true, path: shown, phase: plan.phase, workItemId: plan.workItemId, required: plan.required, advisory: plan.advisory, absent: plan.absent, budget: plan.budget });
      } else {
        console.log(`Context plan for ${plan.phase}${plan.workItemId ? ` (${plan.workItemId})` : ''}: ${plan.required.length} required, ${plan.advisory.length} advisory — ${fit}`);
        for (const item of plan.required) {
          console.log(`  ${item.present ? '📌' : '⚠️ '} ${item.reference} [${item.tier}] ${item.reason}${item.present ? ` — ${item.bytes} B, ~${item.estimatedTokens} tokens` : ' — MISSING'}`);
        }
        for (const item of plan.advisory) {
          console.log(`  ·  ${item.reference} [${item.tier}] ${item.reason}${item.present ? '' : ' (absent)'}`);
        }
        console.log(`   Written: ${shown}`);
      }
      return;
    }

    if (action === 'record') {
      const plan = readContextPlan(opts.targetDir);
      let loaded = opts.contextLoaded || [];
      const notes = [];
      if (opts.transcript) {
        let text;
        try {
          text = readFileSync(opts.transcript, 'utf-8');
        } catch (err) {
          fail(opts, `the transcript could not be read (${err.message}).`, () => 1, { ok: false, code: 'transcript-unreadable' });
        }
        const parsed = parseTranscript(text);
        if (parsed.problems.length > 0) {
          fail(opts, `the transcript has ${parsed.problems.length} unusable line(s): ${parsed.problems.slice(0, 3).join('; ')}. Each line is one JSON object naming a reference.`, () => 1, { ok: false, code: 'transcript-malformed', problems: parsed.problems });
        }
        loaded = parsed.loaded;
        notes.push(`loads taken from the transcript at ${opts.transcript}`);
      }
      let record;
      try {
        record = buildContextRecord({
          targetDir: opts.targetDir, policy, state, plan,
          level: opts.contextLevel || 'recorded',
          loaded, enforcedBy: opts.enforcedBy || null, host: opts.host || null, notes,
        });
      } catch (err) {
        if (err instanceof ContextProtocolError) fail(opts, err.message, () => 1, { ok: false, code: err.code });
        throw err;
      }
      const recordPath = writeContextRecord(opts.targetDir, record);
      const shown = relative(opts.targetDir, recordPath).replace(/\\/g, '/');
      if (opts.format === 'json') {
        emit(opts, '', { ok: true, path: shown, level: record.level, enforcedBy: record.enforcedBy, workItemId: record.workItemId, loaded: record.loaded, notes: record.notes });
      } else {
        console.log(`Context record: level "${record.level}"${record.enforcedBy ? ` (enforced by ${record.enforcedBy})` : ''}, ${record.loaded.length} reference(s) reported`);
        console.log(`   ${describeContextState({ plan, record }).line}`);
        console.log(`   Written: ${shown}`);
        if (record.level === 'estimated' || record.level === 'unavailable') {
          console.log('   This level cannot certify a context-complete checkpoint: nobody observed what was loaded.');
        }
      }
      return;
    }

    // validate — read-only, so it must write nothing.
    const plan = readContextPlan(opts.targetDir);
    const record = readContextRecord(opts.targetDir);
    if (!plan) {
      fail(opts, 'no context plan exists: run "cadet-agent harness context plan" first — a record with nothing to compare against cannot be validated.', () => 1, { ok: false, code: 'no-plan' });
    }
    // Rebuild the plan against the CURRENT phase and work item: a plan written for a phase the
    // session has since left describes context this turn does not need, and validating against it
    // would pass a checkpoint for the wrong turn.
    const current = buildContextPlan({ targetDir: opts.targetDir, policy, state });
    const verdict = validateContextRecord({ targetDir: opts.targetDir, plan: current, record });
    const state_ = describeContextState({ plan: current, record, verdict });

    if (opts.format === 'json') {
      emit(opts, '', {
        ok: verdict.ok, code: verdict.code, level: verdict.level,
        workItemId: current.workItemId, phase: current.phase,
        required: current.required.length, loaded: (record?.loaded || []).length,
        missingRequired: verdict.missingRequired, staleRequired: verdict.staleRequired,
        advisoryMissing: verdict.advisoryMissing, absentRequired: verdict.absentRequired || [],
        reasons: verdict.reasons, plannedFor: record?.phase || null,
      });
    } else {
      console.log(`${verdict.ok ? '✅' : '❌'} ${state_.line}`);
      for (const reason of verdict.reasons) console.log(`   ${reason}`);
      if (verdict.ok) console.log('   Required context is loaded and unchanged: a context-complete checkpoint can be claimed.');
    }
    process.exit(verdict.ok ? 0 : 1);
  }

  /**
   * Refuse `--command` on a command whose evidence comes from somewhere else.
   *
   * The same rule the gate registry states for a gate: a command supplied at the call site proves
   * nothing about the repository, because the caller chooses both the question and the answer. The
   * flag was PARSED globally and then ignored by these commands, so it exited 0 having done
   * nothing with it — the silently swallowed option this CLI's own parser comments warn about.
   * `harness verify --gate <g>` refuses it with `gate-not-overridable` for the gates that take no
   * command; these refuse it with `command-not-accepted`.
   */
  // Declared as a function, not a const arrow: the two `verify-acs`/`verify-reachability` branches
  // run before this point in the dispatch, and a const would leave them in the temporal dead zone.
  function refuseCommandOverride(command, instead) {
    if (opts.command === undefined) return;
    fail(
      opts,
      `${command} takes no --command: it reads its evidence from ${instead}, and a command supplied here would `
      + 'let the caller choose both the question and the answer. Pass the artifact or the declaration instead.',
      () => 1,
      { ok: false, code: 'command-not-accepted', command },
    );
  }

  if (sub === 'verify-architecture') {
    refuseCommandOverride('harness verify-architecture', 'the checks declared under architectureFitness in .cadet/harness.json');
    // The project's declared executable constraints, run and recorded.
    //
    // WHY THE POLICY IS THE ONLY SOURCE OF THE COMMANDS. A gate whose command can be
    // supplied at the call site proves nothing about the repository: the caller chooses
    // both the question and the answer. Here the questions are declared in
    // `.cadet/harness.json` — with ids, scopes and severities — and this command only runs
    // them and writes down what happened. There is deliberately no `--command`.
    //
    // NOT OPTED IN: report and write nothing, the compatibility rule every opt-in gate in
    // this repository follows.
    if (!architectureFitnessActive(policy)) {
      const declared = policy.architectureFitness?.checks?.length ?? 0;
      const detail = {
        ok: true, gateSet: false, enabled: policy.architectureFitness?.enabled === true,
        declared, checks: [], note: declared === 0
          ? 'architectureFitness declares no checks: nothing to verify, nothing recorded.'
          : 'architectureFitness.enabled is false: the checks are declared but nothing runs.',
      };
      if (opts.format === 'json') emit(opts, '', detail);
      else {
        console.log(`ℹ️  ${detail.note}`);
        console.log('   Declare checks under architectureFitness in .cadet/harness.json and set "enabled": true to require them.');
      }
      return;
    }

    const { exists, state } = readState(opts.targetDir);
    assertExpectedPhase(opts, state);

    // Which files do the checks judge? The same answer `harness verify` and `harness
    // confirm` give, for the same reason: a record that does not know what it judged
    // cannot go stale.
    const allowEmpty = policy?.allowEmptyFreshness === true;
    let relevantFiles;
    if (opts.files && opts.files.length) {
      relevantFiles = opts.files.map((f) => String(f).replace(/\\/g, '/'));
    } else {
      const changed = gitChangedFiles(opts.targetDir);
      if (!changed.available) {
        if (!allowEmpty) {
          const scoped = (policy.architectureFitness.checks || []).some((c) => c.files?.length);
          fail(opts, `cannot establish which files the checks should judge: ${changed.reason}.`
            + (scoped
              ? ' Pass --files <paths> — a project that scopes its checks needs to know which files changed, or a scoped check would silently skip.'
              : ' Pass --files <paths>, or enable allowEmptyFreshness in .cadet/harness.json.'), () => 1, { ok: false, code: 'freshness-unavailable' });
        }
        relevantFiles = [];
      } else {
        relevantFiles = changed.files;
      }
    }

    const { results, skipped } = await runArchitectureChecks({
      checks: policy.architectureFitness.checks,
      relevantFiles,
      rootDir: opts.targetDir,
      defaultTimeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
      evidenceDir: join(opts.targetDir, '.cadet', 'runs', 'architecture'),
    });
    const summary = summariseChecks(results, { declared: policy.architectureFitness.checks.length, skipped });

    const workItemId = state ? workItemIdOf(state) : 'unscoped';
    const phase = state?.session?.currentPhase || 'implementation';
    const status = summary.gatePassed ? 'passed' : (summary.blocked.length > 0 && summary.failed.length === 0 ? 'blocked' : 'failed');
    const resultText = results.length === 0
      ? summary.note
      : `${results.filter((r) => r.status === 'passed').length}/${results.length} check(s) passed`
        + (summary.failed.length ? `; failed: ${summary.failed.join(', ')}` : '')
        + (summary.blocked.length ? `; blocked: ${summary.blocked.join(', ')}` : '')
        + (summary.advisoryFailed.length ? `; advisory (not blocking): ${summary.advisoryFailed.join(', ')}` : '');

    // The artifacts a check declared are part of what this record attests, and they are bound
    // per check (`checks[].artifactPath` + `artifactHash`) — NOT folded into `relevantFiles` and
    // NOT hashed into `inputTreeHash`: a check that rewrites its own report would otherwise stale
    // a record that describes an unchanged tree.
    //
    // Folding them into `relevantFiles` was a defect, and a self-inconsistent one: `inputTreeHash`
    // covers `relevantFiles` as it was BEFORE the artifact paths were added, while the record then
    // stored the union. Freshness re-derives the hash from the record's own `relevantFiles`, so
    // every record from a check that declared an artifact read as stale the moment it was written
    // ("input tree hash changed since the evidence was recorded"), and the gate it satisfied could
    // never be used again — which made `implementation -> review` unreachable for any project whose
    // checks write a report. The record now hashes exactly the set it stores, and the artifacts stay
    // bound where they were already recorded: in the check entries.
    const artifactPaths = results.map((r) => r.artifactPath).filter(Boolean);
    const boundFiles = relevantFiles;

    const evidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId: null,
      phase,
      gate: ARCHITECTURE_GATE,
      status,
      command: `harness verify-architecture (${results.map((r) => r.id).join(',') || 'none applicable'})`,
      result: resultText,
      exitCode: 0,
      inputTreeHash: computeInputTreeHash(opts.targetDir, relevantFiles),
      criteriaHash: hashCriteria([]),
      relevantFiles,
      createdAt: new Date(),
    });
    evidence.checks = results.map((r) => ({
      id: r.id, severity: r.severity, status: r.status, exitCode: r.exitCode,
      artifactPath: r.artifactPath, artifactHash: r.artifactHash, refs: r.refs,
    }));

    const ledger = new RunLedger({ targetDir: opts.targetDir, policy, runId: state?.activeRunId || null, workItemId, phase });
    ledger.addEvidence(evidence);
    for (const r of results) {
      ledger.addDecision({ kind: 'check', reason: `architecture check ${r.id}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`, scope: r.cwd });
    }
    ledger.finalize({ status: summary.gatePassed ? 'ok' : 'failed' });
    const ledgerPath = ledger.persist();

    // The gate follows the outcome. `recordEvidence` used to be called unconditionally, so a
    // failed or blocked run wrote `gates.architectureFitnessPassed = true` beside a `failed` record
    // — a document `state validate` then rejects ("gate is true but has no supporting evidence
    // record"), which the shipped pre-commit hook turns into a refused commit. A run that did not
    // pass now clears the gate, so a failure invalidates an earlier pass instead of leaving it
    // standing.
    if (exists) writeState(opts.targetDir, recordEvidence(state, evidence, { setGate: summary.gatePassed }));

    const detail = {
      ok: summary.gatePassed, gateSet: exists && summary.gatePassed, gate: ARCHITECTURE_GATE,
      inputTreeHash: evidence.inputTreeHash,
      status, passed: summary.passed, failed: summary.failed, blocked: summary.blocked,
      advisoryFailed: summary.advisoryFailed, skipped: summary.skipped, note: summary.note,
      checks: results.map((r) => ({ id: r.id, severity: r.severity, status: r.status, exitCode: r.exitCode, artifactPath: r.artifactPath })),
      relevantFiles: boundFiles, evidenceId: evidence.evidenceId, runId: ledger.runId, path: ledgerPath,
    };
    if (opts.format === 'json') {
      emit(opts, '', detail);
    } else {
      const head = summary.gatePassed ? `✅ ${ARCHITECTURE_GATE}` : `❌ ${ARCHITECTURE_GATE}`;
      console.log(`${head}: ${resultText}`);
      for (const line of describeCheckResults(results, summary)) console.log(line);
      if (summary.note) console.log(`   ${summary.note}`);
      console.log(`   Bound to ${boundFiles.length} judged file(s), so a change to one stales this record.`
        + (artifactPaths.length ? ` Plus ${artifactPaths.length} artifact(s), bound per check and deliberately unhashed.` : ''));
      console.log(`   Ledger: ${ledgerPath}`);
      if (!summary.gatePassed) {
        console.log('   Review cannot start until every required check passes. A check that cannot run is a tooling-gap exception, not a manual record.');
      }
    }
    process.exit(summary.gatePassed ? 0 : 1);
  }

  if (sub === 'verify-design-review') {
    refuseCommandOverride('harness verify-design-review', 'the design-review artifact it is handed');
    // The formal design review: checked, then recorded.
    //
    // WHY THE ARTIFACT IS WHAT PROVES IT. Cadet cannot read a design and decide
    // whether it is good, so it does not pretend to. The reviewer's judgement lives
    // in the artifact; this command checks the properties an artifact must have to be
    // readable as a review at all, and blocks the one case the gate exists for — a
    // contested decision with nobody's name against it. The bound inputs give the
    // record its freshness, which is the only honest way to say "this review was of
    // THAT design".
    if (!opts.artifact) fail(opts, 'harness verify-design-review requires --artifact <path>');
    const { exists, state } = readState(opts.targetDir);
    assertExpectedPhase(opts, state);

    const artifactPath = resolve(opts.targetDir, opts.artifact);
    const artifactRel = relative(opts.targetDir, artifactPath).replace(/\\/g, '/') || basename(artifactPath);
    let artifactText;
    try {
      artifactText = readFileSync(artifactPath, 'utf-8');
    } catch (err) {
      fail(opts, `cannot read the design-review artifact "${opts.artifact}": ${err.message}`, () => 1, { ok: false, code: 'artifact-unreadable', artifact: opts.artifact });
    }

    // The review must bind what it reviewed. Without this the record would attest
    // "a review happened" while naming nothing it was a review OF.
    if (!opts.files || opts.files.length === 0) {
      fail(opts, 'the review must bind its inputs: pass --files <technical-design,requirements,ADRs,...> alongside --artifact.', () => 1, { ok: false, code: 'no-inputs-bound' });
    }

    const parsed = parseDesignReviewArtifact(artifactText);
    const enabled = policy.designReview?.enabled === true;

    if (parsed.errors.length > 0) {
      const detail = {
        ok: false,
        artifact: opts.artifact,
        code: parsed.errors[0].code,
        errors: parsed.errors,
        findings: parsed.findings.length,
        contested: parsed.contested,
        gateSet: false,
        enabled,
      };
      if (opts.format === 'json') emit(opts, '', detail);
      else {
        console.error(`❌ Cannot set ${DESIGN_REVIEW_GATE} from ${opts.artifact}:`);
        for (const line of describeDesignReviewGaps(parsed)) console.error(line);
      }
      process.exit(1);
    }

    // NOT OPTED IN: report and write nothing, the same compatibility rule the other
    // opt-in gates follow. A caller who ran the command asked the question, so a
    // failure still exits nonzero.
    if (!enabled) {
      const summary = `design review readable: ${parsed.findings.length} finding(s), reviewer ${parsed.reviewer}`;
      if (opts.format === 'json') emit(opts, '', { ok: true, artifact: opts.artifact, review: { reviewer: parsed.reviewer, inputs: parsed.inputs, findings: parsed.findings.length, contested: parsed.contested }, gateSet: false, enabled: false });
      else {
        console.log(`✅ ${summary}`);
        console.log('   designReview.enabled is false — reported only, state.json unchanged.');
      }
      return;
    }

    const workItemId = state ? workItemIdOf(state) : 'unscoped';
    const phase = state?.session?.currentPhase || 'implementation';
    const inputs = opts.files.map((f) => String(f).replace(/\\/g, '/'));
    const relevantFiles = [artifactRel, ...inputs.filter((f) => f !== artifactRel)];

    const evidence = createEvidence({
      evidenceId: newId(),
      workItemId,
      acceptanceCriterionId: null,
      phase,
      gate: DESIGN_REVIEW_GATE,
      status: 'passed',
      command: `harness verify-design-review --artifact ${artifactRel}`,
      result: `design review complete: ${parsed.findings.length} finding(s), ${parsed.contested.length} contested with a named resolution; reviewer ${parsed.reviewer}`,
      exitCode: 0,
      inputTreeHash: computeInputTreeHash(opts.targetDir, relevantFiles),
      criteriaHash: hashCriteria([]),
      relevantFiles,
      createdAt: new Date(),
    });

    const ledger = new RunLedger({ targetDir: opts.targetDir, policy, runId: state?.activeRunId || null, workItemId, phase });
    ledger.addEvidence(evidence);
    ledger.addDecision({ kind: 'stop', reason: `design review checked (${parsed.findings.length} finding(s))`, scope: artifactRel });
    ledger.finalize({ status: 'ok' });
    const ledgerPath = ledger.persist();

    if (exists) writeState(opts.targetDir, recordEvidence(state, evidence));

    if (opts.format === 'json') {
      emit(opts, '', { ok: true, artifact: opts.artifact, review: { reviewer: parsed.reviewer, inputs: parsed.inputs, findings: parsed.findings.length, contested: parsed.contested }, relevantFiles, evidenceId: evidence.evidenceId, gateSet: exists, runId: ledger.runId, path: ledgerPath });
    } else {
      console.log(`✅ ${DESIGN_REVIEW_GATE} for ${artifactRel}: ${parsed.findings.length} finding(s), reviewer ${parsed.reviewer}`);
      console.log(`   Bound to ${relevantFiles.length} file(s), so a change to the design or the review stales this record.`);
      console.log(`   Ledger: ${ledgerPath}`);
    }
    return;
  }

  // The health line. This command exists so the framework's one line of output is
  // DERIVED rather than asserted: an agent composing its own `ok` is a claim, and
  // this repository's whole complaint about itself is claims that nothing checks.
  //
  // The exit code carries the same verdict as the line, because the CLI's contract
  // is that a command returns nonzero for invalid state. `process.exitCode` is set
  // rather than calling `process.exit()`, so buffered stdout cannot be truncated
  // when the caller is reading the line from a pipe.
  if (sub === 'status') {
    const status = computeStatus(opts.targetDir);
    emit(opts, status.line, { ok: status.ok, status });
    process.exitCode = status.ok ? 0 : 1;
    return;
  }

  if (sub === 'report') {
    const runs = listRuns(opts.targetDir);
    const target = opts.runId || runs[0]?.runId;
    if (!target) fail(opts, 'No run records found in .cadet/runs/.', () => 2);
    const run = loadRun(opts.targetDir, target);
    if (!run) fail(opts, `Run ${target} not found.`, () => 2);
    // The run report carries the context level, because it is the one place a reader looks to
    // ask what happened in a run. The level is reported as recorded — never upgraded: a report
    // that calls advisory loading "enforced" is worse than no report, because the reader stops
    // looking. Reading the plan and record writes nothing, which is what this command promises.
    const contextLine = describeContextState({
      plan: buildContextPlan({ targetDir: opts.targetDir, policy, state: readState(opts.targetDir).state }),
      record: readContextRecord(opts.targetDir),
    });
    if (opts.format === 'json') emit(opts, '', { ok: true, report: { ...buildReport(run), context: contextLine } });
    else console.log(`${formatReport(run)}
${contextLine.line}`);
    return;
  }

  // Read-only. Produces the deterministic half of a Change Report — which files
  // changed, how, and by how much — so the agent never assembles that table from
  // memory. The other half, why each file changed, is not knowable from git and
  // stays the agent's job. See .cadet/agent/core/skills/CodeReview.md.
  //
  // A missing git is NOT a usage error here. This command informs a review that
  // can still be completed, so it reports the limitation and exits 0 rather than
  // blocking the review; the report records it under Limits.
  if (sub === 'changes') {
    const relativeTo = opts.relativeTo || DEFAULT_REPORT_DIR;
    const changes = gitChangeSet(opts.targetDir, {
      range: opts.range || null,
      relativeTo,
      includeCadet: opts.includeCadet === true,
    });

    const { exists, state } = readState(opts.targetDir);
    const item = exists ? state?.activeWorkItem ?? null : null;
    const workItem = item ? { epicId: item.epicId ?? null, storyId: item.storyId ?? null } : null;

    const payload = {
      ok: true,
      available: changes.available,
      workItem,
      range: opts.range || 'working-tree',
      relativeTo,
      files: changes.files,
      counts: changes.counts,
      reason: changes.reason,
    };
    if (opts.format === 'json') {
      emit(opts, '', payload);
      return;
    }

    if (!changes.available) {
      console.log(`\n⚠️  Change inventory unavailable: ${changes.reason}`);
      console.log('   Do not list files from memory — record this as a limit of the report.');
      return;
    }

    const c = changes.counts;
    console.log(`\nChange inventory (${payload.range}) — ${changes.files.length} file(s)`);
    console.log(`  ${c.added} added · ${c.modified} modified · ${c.renamed} renamed · ${c.deleted} deleted`);
    if (changes.files.length === 0) {
      console.log('\n  (no changes)');
    } else {
      console.log('');
      for (const f of changes.files) {
        const lines = f.added === null && f.deleted === null ? 'new' : `+${f.added ?? 0}/-${f.deleted ?? 0}`;
        console.log(`  ${f.status}  ${lines.padEnd(10)} ${f.path}`);
      }
    }
    const label = workItem ? `${workItem.epicId || 'none'}::${workItem.storyId || 'none'}` : 'none';
    console.log(`\n  Links relative to ${relativeTo} · work item: ${label}`);
    return;
  }

  // Read-only. Reconciles the planning chain against state.json: the mechanical
  // half of the Reconciliation skill. It reports the inconsistencies it can prove
  // from the artifacts and never repairs one — the skill proposes repairs for the
  // user to approve. See .cadet/agent/core/skills/Reconciliation.md.
  //
  // Exit 0 whatever the verdict: the verdict is the payload, and a caller reading
  // `--format json` must not have to tolerate a failure exit to get it. A run with
  // no planning artifacts at all is a legitimate state (a framework-source repo, a
  // small change), not an error.
  //
  // A scope that names no epic is the one exception, and it is not a verdict: the
  // request itself was unsatisfiable, so it exits 2 like every other bad argument
  // rather than quietly reconciling a set the caller never asked about.
  if (sub === 'reconcile') {
    const { exists, state } = readState(opts.targetDir);
    const result = reconcileArtifacts(opts.targetDir, {
      state: exists ? state : null,
      plansDir: opts.plansDir || PLANS_DEFAULT_DIR,
      story: opts.story || null,
    });

    if (result.scopeError) fail(opts, result.reason, () => 2);

    if (opts.format === 'json') {
      emit(opts, '', result);
      return;
    }
    if (!result.available) {
      console.log(`\nℹ️  Nothing to reconcile: ${result.reason}`);
      return;
    }

    const s = result.summary;
    console.log(`\nReconcile ${result.plansDir}${result.scopedEpic ? ` (${result.scopedEpic})` : ''} — verdict: ${result.verdict}`);
    console.log(`  ${result.artifacts.epicCount} epic(s), ${result.artifacts.storyCount} story file(s)`);
    console.log(`  ${s.total} finding(s): ${s.blocking} blocking · ${s.warning} warning · ${s.info} info`);
    if (s.total === 0) {
      console.log('\n  ✅ The chain is internally consistent.');
    } else {
      console.log('');
      for (const f of result.findings) {
        console.log(`  [${f.severity}] ${f.id} ${f.code} — ${f.subject}`);
        console.log(`        ${f.detail}${f.evidence ? ` (${f.evidence})` : ''}`);
      }
    }
    if (result.verdict === 'unknown') {
      console.log('\n  ⚠️  At least one artifact could not be read, so consistency cannot be certified.');
    }
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

  fail(opts, `Unknown harness subcommand: ${sub || '(none)'}. Use record|confirm|verify|verify-acs|verify-reachability|verify-design-review|matrix-check|report|status|changes|reconcile|cleanup|capabilities.`);
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

  // A command may not bind its own outputs as the evidence it records.
  //
  // A record's `inputTreeHash` covers the files `--files` names, and `harness verify`,
  // `harness confirm`, `harness verify-acs`, `harness verify-reachability`,
  // `harness verify-design-review` and `harness verify-architecture` then write the ledger
  // and `.cadet/state.json`. Binding one of those makes the record stale at the instant it
  // is created — the write it describes changes a file the hash covers — so the next
  // `state transition --dry-run` refuses the boundary for a record the harness itself just
  // wrote. Refused here, in the dispatcher, rather than at each of the four sites that
  // resolve `--files`: the registry already declares what each command writes, so the check
  // covers a new command and a new flag the moment they are registered, which is the same
  // reason `--dry-run` is driven from here (contract C13).
  if (commandKey && opts.files && opts.files.length) {
    const selfBound = selfBoundFiles(commandKey, opts.files);
    if (selfBound.length > 0) {
      const named = selfBound.join(', ');
      fail(
        opts,
        `--files names ${selfBound.length === 1 ? 'a path' : 'paths'} that "${commandKey}" writes itself: ${named}. `
        + 'Bind the files this gate JUDGES — sources, tests, and the story or epic markdown — never the ledger '
        + `or state document the evidence is recorded in: "${commandKey}" writes ${named} as it records the `
        + 'record, so a binding to it reads as stale the moment it is written ("input tree hash changed since '
        + 'the evidence was recorded"), and the gate can never be fresh.',
        () => 1,
        {
          ok: false,
          command: commandKey,
          code: 'self-bound-files',
          files: selfBound,
          writes: COMMANDS[commandKey].writes || [],
        },
      );
    }
  }

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
