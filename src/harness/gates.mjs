/**
 * Gate builder registry — the single source of truth for what may produce each
 * gate's evidence.
 *
 * Why this exists: `GATES` declares the gate *names* and `TRANSITIONS` declares
 * where each name is required, but nothing declared which command is allowed to
 * produce the evidence. So `harness verify` treated any caller-supplied
 * `--command` as an automated pass, and the gate name implied an evidence
 * meaning that nothing checked. Reproduced against 0.55.0 on 2026-09-30:
 *
 *   node bin/cli.mjs harness verify --gate codeReviewCompleted \
 *     --command "node -e \"process.exit(0)\"" --files src/a.mjs
 *
 * exited 0, wrote `source: "automated"` evidence, and flipped an agent-owned
 * gate to true. An unrelated exit-zero command satisfied a semantic claim, and a
 * made-up gate name was accepted the same way.
 *
 * This registry inverts that: the contract is a property of the gate, resolved
 * before anything runs, and `harness verify` refuses a project command for every
 * gate that does not declare one.
 *
 * Field notes — what is deliberately NOT declared here:
 *
 *   - `phase` is not declared. `TRANSITIONS` already states where a gate is
 *     required, and a second copy would be free to drift from it. The registry
 *     test asserts instead that every registered gate is required somewhere, so
 *     a new name cannot arrive with no transition to use it.
 *   - `exceptionEligible` is not declared. `EXCEPTION_CATEGORIES` in policy.mjs
 *     owns that taxonomy, including per-category expiry.
 *
 * `manual` records whether a human assertion is a meaningful record for the gate
 * — the fact the owner needs in order to tighten §5.5 of the product plan. PR 1
 * does not enforce it: `harness confirm` behaves exactly as it did, because a
 * consumer already holds manual records for `codeReviewCompleted` and
 * `securityReviewPassed`, and refusing them here would break a closure that is
 * otherwise valid. Enforcement belongs with the manual-evidence policy in the
 * next change, and the registry is where that change reads the intent from.
 * Note that `MANUAL_ONLY_GATES` in policy.mjs comments that an agent-owned gate
 * "can never be satisfied by a human assertion" — that is asserted nowhere in
 * the code, `harness confirm` accepts `codeReviewCompleted`, and the registry
 * records the enforced behaviour, not the comment.
 *
 * Contract: docs/core/HarnessContract.md C14.
 */

import { GATES, REACHABILITY_GATE, MANUAL_ONLY_GATES, USER_PLAY_GATE } from './policy.mjs';

/**
 * Who owns the evidence for a gate.
 *
 * `automated` — a command produces it.
 * `agent`     — a reviewer records a judgement (a review, a reconciliation). No
 *               command can produce it, and either an agent or a human may make
 *               the record: the framework does not force a judgement onto an
 *               agent. This is the class `MANUAL_ONLY_GATES` lists in policy.mjs.
 * `human`     — a person accepts the work, and no reviewer's record can stand in
 *               for them. No gate is human-owned yet; the class exists because
 *               `humanAcceptanceConfirmed` is planned as its first member.
 */
export const GATE_OWNERS = Object.freeze(['automated', 'agent', 'human']);

/**
 * Every gate's evidence contract, keyed by gate name.
 *
 * `contract` is a version for the gate's evidence RULES, not for the gate's
 * meaning. Bump it when what the builder accepts or binds changes, so evidence
 * recorded against the earlier rules is refused as stale rather than silently
 * re-read as if it still meant the same thing (see `evidenceFreshness`).
 *
 * `projectCommand` is the load-bearing field: it decides whether a caller may
 * supply `--command` at all. It is true only for the gates whose evidence IS a
 * project command run — the repository owns its test, compile, analyzer and
 * tracking scripts, so Cadet cannot know the right command and the project must
 * be able to name it.
 */
export const GATE_BUILDERS = Object.freeze({
  testsPassed: {
    owner: 'automated',
    contract: 1,
    automatedPath: 'harness verify --gate testsPassed',
    command: { policyKey: 'testCommand', fallback: 'npm test', tool: 'test' },
    projectCommand: true,
    manual: false,
    binds: 'files',
    attests: 'the project test suite ran on the bound files and passed',
  },
  compileCheckConfirmed: {
    owner: 'automated',
    contract: 1,
    automatedPath: 'harness verify --gate compileCheckConfirmed',
    command: { policyKey: 'compileCommand', fallback: null, tool: 'unity-build', unityBuild: true },
    projectCommand: true,
    manual: true,
    binds: 'files',
    attests: 'the project compiled from the bound files',
  },
  unityAnalyzerClean: {
    owner: 'automated',
    contract: 1,
    automatedPath: 'harness verify --gate unityAnalyzerClean',
    command: { policyKey: 'analyzerCommand', fallback: null, tool: 'unity-analyzer' },
    projectCommand: true,
    manual: true,
    binds: 'files',
    attests: 'the declared analyzer ran over the bound files and reported no finding',
  },
  storyTrackingUpdated: {
    owner: 'automated',
    contract: 1,
    automatedPath: 'harness verify --gate storyTrackingUpdated',
    // No default command: the tracking check reads the repository's own story
    // and epic markdown, so only the repository can name it. `--command` is the
    // documented path, which is why this gate accepts a project command while
    // having no fallback of its own.
    command: { policyKey: null, fallback: null, tool: 'tracking' },
    projectCommand: true,
    manual: true,
    binds: 'files',
    attests: 'the story and epic markdown agree with the work item state',
  },
  acceptanceCriteriaValidated: {
    owner: 'automated',
    contract: 1,
    automatedPath: 'harness verify-acs --story <path>',
    command: null,
    projectCommand: false,
    manual: false,
    binds: 'story',
    attests: 'every declared acceptance criterion names a test that ran in the passing inventory',
  },
  reachabilityAddressed: {
    owner: 'automated',
    contract: 1,
    automatedPath: `harness verify-reachability --story <path>`,
    command: null,
    projectCommand: false,
    manual: false,
    binds: 'story',
    attests: 'the story declares how its deliverable is reached, and the declaration holds',
  },
  architectureFitnessPassed: {
    owner: 'automated',
    contract: 1,
    // The command is the project's own declared check, read out of `architectureFitness`
    // in the policy — never `--command`. That is the difference between this gate and
    // `testsPassed`: a project may substitute its test runner, but it may not substitute
    // the *shape* of an architecture constraint with an unrelated exit-zero command.
    automatedPath: 'cadet-agent harness verify-architecture',
    command: null,
    projectCommand: false,
    manual: false,
    binds: 'files',
    attests: 'every required architecture check that governs the changed files ran, and none of them reported a violation',
  },
  designReviewCompleted: {
    owner: 'automated',
    contract: 1,
    automatedPath: 'harness verify-design-review --artifact <path> --files <inputs>',
    // No default command and no project override: the check reads the review
    // artifact against the design inputs, which an arbitrary exit-zero command
    // cannot attest. Like the AC gate, its evidence is an artifact plus the
    // structure the artifact must have.
    command: null,
    projectCommand: false,
    // A review is a judgement, and a judgement belongs to whoever made it — an
    // agent or a person. The command is the stronger route (it checks the artifact
    // and binds the inputs it names), and it is not the only one: a human who read
    // the design records it with `harness confirm`, which still requires a reason,
    // a scope, an environment and a short expiry under strict closure.
    manual: true,
    binds: 'files',
    attests: 'a reviewer challenged the design, recorded findings with dispositions, and left no contested finding unresolved',
  },
  humanAcceptanceConfirmed: {
    owner: 'human',
    contract: 1,
    // No automated path at all, and no project override: the gate asks whether a
    // PERSON accepted the work. A command cannot answer it, and neither can a
    // reviewer's record — that is the difference between this gate and
    // `codeReviewCompleted`, which is why the registry distinguishes `agent` from
    // `human` rather than lumping both under "manual".
    automatedPath: null,
    command: null,
    projectCommand: false,
    manual: true,
    binds: 'files',
    attests: 'a named person accepted the delivered work against a stated witness, with the limitations they accepted',
  },
  userPlaythroughConfirmed: {
    owner: 'human',
    contract: 1,
    // No automated path and no project override, for the same reason
    // humanAcceptanceConfirmed has neither: the gate asks whether a PERSON played the
    // delivered work. A command cannot answer it, and neither can a reviewer's record —
    // the record's substance is the person's own account of what they played and what
    // they saw, which is why the route is a form they fill in and `verify-play` refuses
    // to record a `required` declaration on their behalf.
    automatedPath: null,
    command: null,
    projectCommand: false,
    manual: true,
    // `files`, where its sibling `reachabilityAddressed` binds `story`. The difference is
    // the subject: reachability's evidence is a declaration about a work item, while this
    // gate's evidence is an account of a build the person actually ran, so a later edit to
    // the sources that produced it must invalidate the record. The deferral route
    // (`Play: deferred to <work item>`) binds the story, which is where the declaration is.
    binds: 'files',
    attests: 'a named person played the delivered work and recorded what they did and what they saw',
  },
  codeReviewCompleted: {
    owner: 'agent',
    contract: 1,
    automatedPath: null,
    command: null,
    projectCommand: false,
    manual: true,
    binds: 'files',
    attests: 'a reviewer read the change and recorded findings and dispositions',
  },
  securityReviewPassed: {
    owner: 'agent',
    contract: 1,
    automatedPath: null,
    command: null,
    projectCommand: false,
    manual: true,
    binds: 'files',
    attests: 'the security review ran and its findings were dispositioned',
  },
  designArtifactSyncConfirmed: {
    owner: 'agent',
    contract: 1,
    automatedPath: null,
    // Read-only, and it records no gate: `harness reconcile` reports the
    // mechanical findings, and the reconciliation skill makes the semantic pass
    // and records the result. Named here so the refusal can point at it.
    supportingCommand: 'harness reconcile --format json',
    command: null,
    projectCommand: false,
    manual: true,
    binds: 'files',
    attests: 'the planning artifacts still agree with each other and with the work item state',
  },
});

/** The contract entry for a gate, or undefined when the gate is not registered. */
export function gateBuilder(gate) {
  return Object.prototype.hasOwnProperty.call(GATE_BUILDERS, gate) ? GATE_BUILDERS[gate] : undefined;
}

/**
 * The identity of a gate's current evidence contract, e.g. `testsPassed@1`.
 *
 * Stamped into automated evidence and compared at transition time, so a change
 * to the builder's rules refuses the records written under the old rules instead
 * of reading them as if nothing had changed.
 */
export function gateContractId(gate) {
  const builder = gateBuilder(gate);
  return builder ? `${gate}@${builder.contract}` : null;
}

/** Gates a caller may satisfy with its own `--command`. */
export function gatesAcceptingProjectCommand() {
  return GATES.filter((gate) => gateBuilder(gate)?.projectCommand === true);
}

/**
 * Gates whose evidence is a record instead of a command — a reviewer's judgement or
 * a person's acceptance. Named for that fact, because the two are different gates
 * with the same route: see `MANUAL_ONLY_GATES` in policy.mjs.
 */
export function manualOnlyGateNames() {
  return GATES.filter((gate) => gateBuilder(gate)?.owner !== 'automated');
}

/** @deprecated Use `manualOnlyGateNames`; kept only long enough to notice a straggler. */
export const agentOwnedGateNames = manualOnlyGateNames;

/**
 * One sentence explaining why a gate refuses a caller-supplied command, naming
 * the path that does work. Shared by `harness verify` (which refuses) and the
 * registry test (which asserts the sentence matches the contract), so the two
 * cannot disagree about what a gate will accept.
 */
export function describeGateRefusal(gate) {
  const builder = gateBuilder(gate);
  if (!builder) {
    return `unknown gate "${gate}". Valid gates: ${GATES.join(', ')}`;
  }
  if (!GATE_OWNERS.includes(builder.owner)) {
    return `gate "${gate}" declares an invalid owner "${builder.owner}".`;
  }
  if (builder.owner === 'human') {
    return `gate "${gate}" is human-owned: a person accepts this work, and no command can do it in their place.`;
  }
  const head = builder.owner === 'agent'
    ? `gate "${gate}" is agent-owned: an arbitrary command cannot attest ${builder.attests}`
    : `gate "${gate}" has a fixed evidence contract: an arbitrary command cannot attest ${builder.attests}`;
  const path = builder.automatedPath
    ? ` Run "${builder.automatedPath}" instead.`
    : (builder.supportingCommand ? ` Its mechanical backing is "${builder.supportingCommand}".` : '');
  return `${head}.${path}`;
}

/**
 * Explain why a gate that DOES accept a project command has none to run yet.
 * Separate from `describeGateRefusal`, which forbids a command: this one asks for
 * the missing input. A gate with no default (the tracking check) needs it, and
 * the old message called that gate "agent-owned", which said the opposite of the
 * truth and pointed at no remedy.
 */
export function describeMissingCommand(gate) {
  const builder = gateBuilder(gate);
  if (!builder) return `unknown gate "${gate}". Valid gates: ${GATES.join(', ')}`;
  const path = builder.automatedPath ? ` Example: "${builder.automatedPath} --command <your command>".` : '';
  return `gate "${gate}" has no default command — its evidence is the repository's own command — so pass --command <command>.${path}`;
}

/**
 * Assert the registry against the frozen gate list and the policy constants.
 * Returns a list of problems (empty when the registry is coherent).
 *
 * Called by the registry test, and by nothing else in production: a check that
 * runs at import time would turn a bad edit into a CLI that cannot start its own
 * diagnostics.
 */
export function auditGateRegistry() {
  const problems = [];
  for (const gate of GATES) {
    const builder = gateBuilder(gate);
    if (!builder) {
      problems.push(`gate "${gate}" has no builder contract`);
      continue;
    }
    if (!GATE_OWNERS.includes(builder.owner)) {
      problems.push(`gate "${gate}" declares unknown owner "${builder.owner}"`);
    }
    if (!Number.isInteger(builder.contract) || builder.contract < 1) {
      problems.push(`gate "${gate}" declares contract "${builder.contract}"; expected a positive integer`);
    }
    if (typeof builder.projectCommand !== 'boolean') {
      problems.push(`gate "${gate}" must declare projectCommand as a boolean`);
    }
    if (builder.projectCommand && !builder.command) {
      problems.push(`gate "${gate}" accepts a project command but declares no command contract`);
    }
    if (typeof builder.manual !== 'boolean') {
      problems.push(`gate "${gate}" must declare manual as a boolean`);
    }
    if (!['files', 'story'].includes(builder.binds)) {
      problems.push(`gate "${gate}" declares binds "${builder.binds}"; expected "files" or "story"`);
    }
    if (typeof builder.attests !== 'string' || builder.attests.trim() === '') {
      problems.push(`gate "${gate}" declares no attests sentence`);
    }
    if (builder.owner === 'agent' && builder.projectCommand) {
      problems.push(`gate "${gate}" is agent-owned and must not accept a project command`);
    }
    if (builder.owner === 'human' && (builder.projectCommand || builder.automatedPath)) {
      problems.push(`gate "${gate}" is human-owned and must not declare an automated path`);
    }
  }
  for (const name of Object.keys(GATE_BUILDERS)) {
    if (!GATES.includes(name)) problems.push(`registry declares "${name}", which is not a known gate`);
  }
  // Both directions, because the two declarations must be one fact written twice:
  // policy.mjs owns the `disallowManualFor` refusal, the registry owns the owner,
  // and a drift would let one of them forbid a route the other needs.
  for (const gate of GATES) {
    const builder = gateBuilder(gate);
    if (!builder) continue;
    const listed = MANUAL_ONLY_GATES.includes(gate);
    if (listed !== (builder.owner !== 'automated')) {
      problems.push(
        `gate "${gate}" is${listed ? '' : ' not'} listed in MANUAL_ONLY_GATES, but the registry declares owner "${builder.owner}"; `
        + 'the two must agree',
      );
    }
  }
  if (gateBuilder(REACHABILITY_GATE)?.projectCommand !== false) {
    problems.push(`gate "${REACHABILITY_GATE}" must not accept a project command`);
  }
  if (gateBuilder(USER_PLAY_GATE)?.projectCommand !== false) {
    problems.push(`gate "${USER_PLAY_GATE}" must not accept a project command`);
  }
  if (gateBuilder(USER_PLAY_GATE)?.owner !== 'human') {
    problems.push(`gate "${USER_PLAY_GATE}" must stay human-owned: a person plays the work`);
  }
  return problems;
}
