/**
 * Command registry — the single source of truth for what the CLI's commands do.
 *
 * Why this exists: before it, dispatch was two hand-written `if (sub === …)`
 * chains and nothing declared which commands write. Every safety property was a
 * convention the *caller* had to remember:
 *
 *   - `--dry-run` was parsed globally but honoured by exactly one command, so
 *     `harness record --dry-run` silently wrote a ledger. An opt-in flag only
 *     protects the caller who already knows to pass it.
 *   - Nothing asserted that a command documented as read-only performs no
 *     writes, so a write in `report`/`matrix-check` would go unnoticed.
 *   - `cleanup` deletes run records, and an unattended agent could invoke it
 *     with no bound on what it deletes.
 *
 * The registry inverts that: safety is a property of the command, enforced by
 * the dispatcher and asserted by tests, not a rule the caller must recall. An
 * agent that does not know what a command does still cannot write by accident.
 *
 * Contract: docs/core/HarnessContract.md C13.
 */

/** Every command the CLI exposes, keyed by its invocation path. */
export const COMMANDS = {
  init: {
    mutates: true,
    summary: 'Install Cadet-Agent into the target directory.',
    writes: ['AGENTS.md', '.cadet/**'],
    unattended: true,
  },
  sync: {
    mutates: true,
    summary: 'Update the framework, preserving local policies and plans.',
    writes: ['.cadet/**', 'AGENTS.md'],
    unattended: true,
  },

  'state validate': {
    mutates: false,
    summary: 'Validate .cadet/state.json against the current schema.',
    // `--verify-sealed` reads commit trailers. It is a read: verifying a seal
    // must never repair one, so the flag cannot write.
  },
  'state migrate': {
    mutates: true,
    summary: 'Atomically migrate state to the current version (backup on write).',
    writes: ['.cadet/state.json', '.cadet/state.json.v*.bak', '.cadet/archive/**'],
    unattended: false,
    // A failed migration must leave the tree exactly as it found it: no backup,
    // no partial write. The backup is an artifact of a *successful* migration,
    // so producing one and then failing would be a write the caller did not get.
    // Enforced by `harness-command-registry.test.mjs` ("a failed migrate leaves
    // the tree exactly as it found it"), which fails if the backup is copied
    // before validation — verified by reintroducing the original ordering.
    atomicFailure: true,
  },
  'state seal': {
    mutates: true,
    summary: 'Write a work item\'s evidence as commit trailers, for `git commit -F`.',
    // Cadet does not commit (contract C5). Sealing prepares a message file and
    // archives the records; the commit itself stays a user action.
    writes: ['.cadet/archive/**', '*.commit-msg'],
    unattended: true,
  },
  'state compact': {
    mutates: true,
    summary: 'Move closed work items\' evidence out of state.json into .cadet/archive/.',
    writes: ['.cadet/state.json', '.cadet/archive/**'],
    // Irreversible in the sense that matters: records leave the document that
    // every gate check reads. An unattended agent must say what to keep, so the
    // bound is content-bearing rather than a bare confirmation.
    unattended: false,
    requiresForUnattended: ['--keep'],
  },
  'state begin': {
    mutates: true,
    summary: 'Start a work item: reset gates, archive the previous item\'s evidence, fold it into the coverage index.',
    writes: ['.cadet/state.json', '.cadet/archive/**'],
    // The bound is already content-bearing: `--epic` and `--story` name the work
    // item being started, so an unattended caller cannot begin one without saying
    // which. That is why this needs no separate confirmation flag.
    unattended: true,
  },
  'state transition': {
    mutates: true,
    summary: 'Enforce the transition matrix and evidence; applies the transition.',
    writes: ['.cadet/state.json'],
    unattended: true,
    // `--dry-run` here is not merely "don't write" — it reports the *same
    // verdict* a real transition would (`allowed`, plus every missing or stale
    // gate), which is the entire point of the flag. The handler therefore keeps
    // ownership of the dry-run path and the global interception stands down.
    // Collapsing the two meanings would replace a useful verdict with a bare
    // "nothing was written". Contract C13.
    evaluatesOnDryRun: true,
  },

  'harness record': {
    mutates: true,
    summary: 'Append a sanitized span/evidence/decision event to the run ledger.',
    writes: ['.cadet/runs/**'],
    unattended: true,
  },
  'harness confirm': {
    mutates: true,
    summary: 'Record manual-confirmation evidence (ledger + state).',
    writes: ['.cadet/runs/**', '.cadet/state.json'],
    unattended: true,
  },
  'harness verify': {
    mutates: true,
    summary: 'Run a bounded, classified verification loop.',
    writes: ['.cadet/runs/**', '.cadet/state.json'],
    unattended: true,
  },
  'harness verify-acs': {
    mutates: true,
    summary: 'Verify declared AC↔test coverage; may write coverage + state.',
    writes: ['.cadet/runs/**', '.cadet/state.json', '*.coverage.json'],
    unattended: true,
  },
  'harness verify-reachability': {
    mutates: true,
    summary: 'Verify a story\'s declared reachability, and run the project probe when configured.',
    // Same posture as verify-acs: it records evidence for its gate, so it writes
    // the ledger and state. It writes no artifact of its own — the declaration
    // lives in the story and the project probe owns its own output.
    writes: ['.cadet/runs/**', '.cadet/state.json'],
    unattended: true,
  },
  'harness verify-design-review': {
    mutates: true,
    summary: 'Check the design-review artifact and record designReviewCompleted.',
    // Like verify-acs and verify-reachability: it records evidence for its gate, so it
    // writes the ledger and state. The artifact itself is the reviewer's, and this
    // command never writes it — a check that authored the thing it checks would prove
    // nothing.
    writes: ['.cadet/runs/**', '.cadet/state.json'],
    unattended: true,
  },
  'harness context plan': {
    mutates: true,
    summary: 'Write the context plan for the current phase: what must be loaded, and why.',
    writes: ['.cadet/context/plan.json'],
    unattended: true,
  },
  'harness context record': {
    mutates: true,
    summary: 'Record what the host loaded, and the level it can claim for that record.',
    writes: ['.cadet/context/record.json'],
    unattended: true,
  },
  'harness context validate': {
    mutates: false,
    summary: 'Compare the plan, the record and the files as they are now. Read-only.',
    unattended: true,
  },
  'harness verify-architecture': {
    mutates: true,
    summary: 'Run the project\'s declared architecture checks and record the gate.',
    // Same posture as verify-acs, verify-reachability and verify-design-review: it
    // records evidence for its gate, so it writes the ledger and state. The checks
    // themselves are the project's, declared in the policy — this command never writes
    // them, and it accepts no command-line override of what they run.
    writes: ['.cadet/runs/**', '.cadet/state.json'],
    unattended: true,
  },
  'harness acceptance-form': {
    mutates: true,
    summary: 'Write a human-acceptance form for an epic, pre-filled from state.',
    // It writes exactly one file, and only when that file does not exist: a form is a
    // person's worksheet once they have touched it, and a regeneration would discard
    // what they wrote. It never writes state — recording the gate is `harness confirm`.
    writes: ['.cadet/agent/project-plans/**'],
    unattended: true,
  },
  'harness report': {
    mutates: false,
    summary: 'Summarize budget consumption and failures.',
  },
  // The health line: the framework's entire per-reply output. Read-only, and it
  // writes no ledger, so printing it cannot change the state it reports on.
  'harness status': {
    mutates: false,
    summary: 'Print the one-line framework health line: ok, or the problem.',
  },
  'harness changes': {
    mutates: false,
    summary: 'List the files a story changed, with status, line counts, and links.',
    // Read-only by construction: it runs `git status`/`git diff` and parses the
    // output. It does not author the Change Report — the agent does, from the
    // template — so there is no artifact for it to write and nothing to dry-run.
  },
  'harness reconcile': {
    mutates: false,
    summary: 'Reconcile the planning chain (requirements, design, plan, epics, stories) against state.json.',
    // Read-only, and deliberately so: it reports the provable inconsistencies and
    // never repairs one. An agent that could reconcile artifacts unattended could
    // rewrite the design it is meant to be checking against.
  },
  'harness matrix-check': {
    mutates: false,
    summary: 'Reconcile a TDD matrix against a compiled test inventory.',
  },
  'harness capabilities': {
    mutates: false,
    summary: 'Report available CLI/Unity/MCP/hook/token/cost telemetry.',
  },
  'harness cleanup': {
    mutates: true,
    summary: 'Apply the retention policy to .cadet/runs/, deleting run records.',
    writes: ['.cadet/runs/**'],
    // Destructive and irreversible for the records it removes. An unattended
    // agent may only run it with an explicit, content-bearing bound on what it
    // deletes — see `requiresForUnattended`. A bare "yes" would be a boolean the
    // agent can always supply without knowing what it is approving.
    unattended: false,
    requiresForUnattended: ['--older-than-ms'],
  },
};

/** The set of commands that write to the filesystem. */
export function mutatingCommands() {
  return Object.entries(COMMANDS).filter(([, c]) => c.mutates).map(([k]) => k);
}

/** The set of commands that are guaranteed not to write. */
export function readOnlyCommands() {
  return Object.entries(COMMANDS).filter(([, c]) => !c.mutates).map(([k]) => k);
}

/** Repository-relative form of a path: forward slashes, no leading `./`. */
function normaliseRepoPath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Does one of a command's `writes` patterns cover a path?
 *
 * The shipped table uses exactly three shapes, and the matcher supports those and no more:
 * an exact path (`AGENTS.md`), a directory subtree (`<dir>/**`), and a root-level suffix
 * wildcard (`*.coverage.json`). `**` crosses directory boundaries and `*` does not — the
 * distinction a shell makes, and the reason a `*` that crossed directories would refuse a
 * file the command never touches.
 *
 * Wildcards are replaced FIRST, with placeholders that survive the escape pass. Doing it the
 * other way round turns `**` into a literal `\*\*` and every declaration stops matching — the
 * defect this function shipped with for one run, caught by the generated test below it.
 *
 * Absolute paths are deliberately not translated: `--files` carries repository-relative paths
 * by contract, so an absolute path is a different mistake and not this function's to guess at.
 */
function writePatternMatches(pattern, path) {
  const escaped = normaliseRepoPath(pattern)
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '\u0001')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\u0000/g, '.*')
    .replace(/\u0001/g, '[^/]*');

  return new RegExp(`^${escaped}$`).test(normaliseRepoPath(path));
}

/**
 * The `--files` entries a command declares it WRITES, and which must therefore never be
 * bound as its evidence.
 *
 * Why this exists: a record's `inputTreeHash` covers the files it binds, and the command
 * then writes its own outputs — the run ledger and `.cadet/state.json`. Binding one of those
 * makes the record stale at the instant it is created, because the write it records changes
 * a file the hash covers. Measured on a consumer on 2026-10-01: a `storyTrackingUpdated`
 * record that bound the story, the epic and `.cadet/state.json` was refused by the very next
 * `state transition --dry-run` with "input tree hash changed since the evidence was
 * recorded", and the gate had to be re-recorded twice before the boundary was allowed.
 *
 * The answer is a refusal rather than a filter. Filtering would leave the record claiming a
 * coverage it does not have, and the caller asked for a binding that provably cannot hold —
 * the same choice `AGENT_OWNED_GATES` and the swallowed `--command` flag both resolved the
 * loud way. It is derived from the registry rather than hardcoded, so a new command's
 * outputs are covered the moment it is registered.
 */
export function selfBoundFiles(commandKey, files = []) {
  const writes = COMMANDS[commandKey]?.writes || [];
  if (writes.length === 0 || !Array.isArray(files) || files.length === 0) return [];

  return files.filter((file) => writes.some((pattern) => writePatternMatches(pattern, file)));
}

/**
 * Resolve the command key for a parsed invocation.
 *
 * Top-level commands (`init`, `sync`) are keyed by name; `state`/`harness`
 * subcommands are keyed by `<group> <sub>`. Returns null when the invocation
 * does not name a known command — an unknown command is a usage error, and the
 * caller reports it rather than guessing a safety posture.
 */
export function resolveCommand(argv) {
  const top = argv[2];
  if (!top) return null;
  if (top === 'state' || top === 'harness') {
    const sub = argv[3];
    if (!sub || sub.startsWith('-')) return null;
    // Longest key first: `harness context validate` must resolve to its own entry — a read —
    // rather than to the group entry that also covers the two commands that write. Otherwise a
    // read-only command would inherit the group's write declaration and lose its guard.
    const action = argv[4] && !argv[4].startsWith('-') ? argv[4] : null;
    if (action) {
      const nested = `${top} ${sub} ${action}`;
      if (Object.hasOwn(COMMANDS, nested)) return nested;
    }
    const key = `${top} ${sub}`;
    return Object.hasOwn(COMMANDS, key) ? key : null;
  }
  return Object.hasOwn(COMMANDS, top) ? top : null;
}

/** Describe a command for machine consumption. */
export function describeCommand(key) {
  const c = COMMANDS[key];
  if (!c) return null;
  return {
    command: key,
    mutates: c.mutates === true,
    summary: c.summary,
    writes: c.mutates ? c.writes ?? [] : [],
    unattended: c.unattended !== false,
    requiresForUnattended: c.requiresForUnattended ?? [],
    // True when `--dry-run` yields a verdict from the command's own evaluator
    // rather than a generic no-op acknowledgement.
    evaluatesOnDryRun: c.evaluatesOnDryRun === true,
  };
}

/** The full registry as a machine-readable list, sorted by command path. */
export function describeAllCommands() {
  return Object.keys(COMMANDS).sort().map(describeCommand);
}

/**
 * Check that an invocation carries the flags a command requires when it may run
 * unattended. Returns `{ ok: true }` or `{ ok: false, missing, reason }`.
 *
 * `--dry-run` satisfies nothing here on purpose: a dry run does not perform the
 * action, so it is never a substitute for the bound the action requires.
 */
export function checkUnattendedRequirements(key, opts) {
  const c = COMMANDS[key];
  if (!c || c.mutates !== true) return { ok: true };
  const required = c.requiresForUnattended ?? [];
  if (required.length === 0) return { ok: true };

  const missing = required.filter((flag) => {
    if (flag === '--older-than-ms') {
      return !Number.isFinite(opts.olderThanMs);
    }
    if (flag === '--keep') {
      // `always`, `active`, or a comma-separated work-item list. An empty value
      // is not a bound, so it must fail the same way a missing flag does.
      return !(typeof opts.keep === 'string' && opts.keep.trim() !== '');
    }
    return true;
  });
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    missing,
    reason: `"${key}" removes records that gate checks read, so it requires ${missing.join(', ')} when run unattended.`,
  };
}
