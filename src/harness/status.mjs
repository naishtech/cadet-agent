/**
 * The health line — the framework's entire per-reply output.
 *
 * WHY THIS EXISTS. The Response Contract shipped in 0.52.0 as a six-field status
 * table (`Item`, `Phase`, `Gates open`, `Blocking`, `You owe`, `Next`). Its own
 * rule was "no line that cannot change a decision the reader is making", and
 * four of those fields broke it on a normal turn: `Item` and `Phase` change about
 * once per story, `Gates open` is a progress bar for the framework rather than
 * for the work, and `Next` restates the prose that follows it. So the contract
 * paid six lines on every reply to fund the rare turn where one of them mattered.
 *
 * The line this command prints replaces all six. It says `ok` when the tracking
 * record is sound, and otherwise it says what is wrong. Nothing else about the
 * framework is printed, ever.
 *
 * WHAT `ok` MEANS, and this is the whole design. The workflow record is readable,
 * valid and FRESH, and no recorded run stopped on a budget or failed to run.
 *
 * WHAT `ok` DOES NOT MEAN. It does not mean every gate for the next phase is
 * satisfied. Gates unmet because the work is not finished yet are NORMAL: the
 * four implementation gates are unmet for most of every story. Reporting them
 * would print a problem on nearly every reply, which is precisely the defect this
 * replaces. Only things that are WRONG are reported:
 *
 *   - the state file is missing in a consumer repository, or unreadable;
 *   - `validateState` raises an ERROR (schema, a foreign or stale record, an
 *     expired one, an unbacked `true` gate). WARNINGS are advisory here on
 *     purpose: this repository's own `harness.json` records nineteen permanently
 *     expected reconciliation warnings, and treating those as problems would
 *     reproduce the "permanently blocking finding" defect one directory up;
 *   - the last run's status is `exhausted` or `blocked`. That is the difference
 *     between the framework stopping and the framework reporting: a `failed` run
 *     is a RED, which is how TDD is supposed to work, and is never a problem.
 *
 * NOTHING HERE IS ASSERTED. Every problem is derived from a check that already
 * exists — `validateState` and the run ledger — so the line cannot claim a health
 * the framework has not verified. That is why the framework prints the line from
 * this command rather than letting the agent compose an `ok` of its own.
 *
 * READ-ONLY. Declared `mutates: false` in the registry, so the test suite sweeps
 * it under every write-shaped flag and asserts it writes nothing.
 */
import { readState, validateState, workItemIdOf } from './state.mjs';
import { REPO_ROLES, detectRepoRole } from './repo-role.mjs';
import { loadPolicy } from './policy.mjs';
import { listRuns, loadRun } from './ledger.mjs';

/** The prefix every health line carries, so the reader knows which system spoke. */
export const STATUS_PREFIX = 'cadet-agent:';

/** The healthy line. One line, no fields, no version, no work item. */
export const STATUS_OK_LINE = `${STATUS_PREFIX} ok`;

/** Run statuses that mean the framework stopped rather than reported an outcome. */
const STOPPED_RUN_STATUSES = Object.freeze(['exhausted', 'blocked']);

/**
 * Compute the health line for `targetDir`.
 *
 * Returns `{ ok, line, problems, role, workItemId, stateExists, checkedAt }`.
 * `ok` is true when there are no problems; the line is always exactly one line.
 */
export function computeStatus(targetDir, { now = new Date() } = {}) {
  const problems = [];
  const { exists, state } = readState(targetDir);
  const role = detectRepoRole(targetDir);
  const workItemId = exists && state ? workItemIdOf(state) || null : null;

  if (!exists) {
    // A framework-source repository has no workflow state by design, and saying so
    // is the whole line. Anywhere else, a missing record is a real problem: the
    // gates, the transitions and the archive all read from it.
    if (role.role !== REPO_ROLES.FRAMEWORK) {
      problems.push({
        code: 'no-state',
        message: 'no .cadet/state.json, so the workflow has no record',
        blocks: 'every state command and every gate',
        remedy: 'restore state.json, or install into a new project with cadet-agent init',
      });
    }
  } else {
    const policy = loadPolicy(targetDir);
    const validation = validateState(state, { rootDir: targetDir, strictClosure: policy.strictClosure });
    for (const error of validation.errors) {
      problems.push({
        code: 'state-invalid',
        message: `${error.path} ${error.message}`,
        blocks: 'the gate or transition that depends on this record',
        remedy: 'cadet-agent state validate',
      });
    }
  }

  // The last run, not the active run: `activeRunId` is null between commands, and
  // a stop that was never resolved is still the last thing that happened.
  const runs = listRuns(targetDir);
  const lastRun = runs.length > 0 ? loadRun(targetDir, runs[0].runId) : null;
  if (lastRun && STOPPED_RUN_STATUSES.includes(lastRun.status)) {
    const exhausted = lastRun.status === 'exhausted';
    problems.push({
      code: exhausted ? 'budget-exhausted' : 'run-blocked',
      message: `the last harness run (${String(lastRun.runId).slice(0, 8)}) ${exhausted ? 'stopped on a hard budget' : 'could not run'}`,
      blocks: 'the verification it was performing, so no gate was satisfied by it',
      remedy: 'cadet-agent harness report',
    });
  }

  return {
    ok: problems.length === 0,
    line: buildLine({ problems, exists, role }),
    problems,
    role: role.role,
    workItemId,
    stateExists: exists,
    checkedAt: now.toISOString(),
  };
}

/** One line, always. The healthy form carries nothing that cannot change a decision. */
function buildLine({ problems, exists, role }) {
  if (problems.length === 0) {
    if (!exists && role.role === REPO_ROLES.FRAMEWORK) {
      return `${STATUS_OK_LINE} — framework-source repository, no workflow state`;
    }
    return STATUS_OK_LINE;
  }

  const first = problems[0];
  const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : '';
  const remedy = first.remedy ? ` — ${first.remedy}` : '';
  return `${STATUS_PREFIX} ${first.message}${more}${remedy}`;
}
