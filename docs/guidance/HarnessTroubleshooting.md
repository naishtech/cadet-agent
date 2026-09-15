# Harness Troubleshooting

Practical recovery steps for the failures the harness surfaces. All commands accept `--format json` for machine-readable output.

## Stale evidence

**Symptom:** `cadet-agent state transition --to <phase>` rejects a transition with `input tree hash changed since the evidence was recorded`, `evidence belongs to work item …`, `acceptance criteria changed`, or `evidence expired` — or `cadet-agent state validate` reports `stale evidence`, `not the active work item`, `expired evidence`, or `has no supporting evidence record`.

**Cause:** a relevant file, acceptance criterion, active work item, or verification command changed after the evidence was recorded. Evidence is bound to the work item and input tree. `state validate` checks the same binding and freshness (using the target directory), so the problem surfaces before a transition is attempted.

**Fix:**

1. Re-run the verification for the affected gate, binding it to the changed files: `cadet-agent harness verify --gate <gate> --files path/to/a.mjs,path/to/b.cs` (or omit `--files` to use the working tree's changed files).
2. Confirm the new evidence is for the current work item and phase.
3. Re-check validation and the transition: `cadet-agent state validate` then `cadet-agent state transition --to <phase>`.

Do **not** hand-edit `gateEvidence` or flip a gate to `true`. The CLI rejects a claimed-true gate whose evidence is missing, stale, expired, or bound to another work item.

## Freshness cannot be established

**Symptom:** `harness verify` exits nonzero with `code: freshness-unavailable` and a reason like `not a git repository`.

**Cause:** Git could not be queried and no `--files` were given, so the evidence could not be bound to a concrete input tree. The harness fails safe rather than recording evidence against an empty tree.

**Fix:**

1. Pass the relevant files explicitly: `cadet-agent harness verify --gate <gate> --files src/a.cs,src/b.cs`.
2. Or run verification from a Git working tree so the changed files can be discovered automatically.
3. Only if unscoped evidence is genuinely intended, set `allowEmptyFreshness: true` in `.cadet/harness.json`. This is visible and recorded in the ledger.

## Red-before-green required

**Symptom:** `harness verify --gate testsPassed` exits nonzero with `stopReason: red-required`.

**Cause:** a green `testsPassed` result needs a prior failed (red) record for the same work item and gate.

**Fix:**

1. Run the test against the unimplemented behavior first so it fails: `cadet-agent harness verify --gate testsPassed --files <changed files>` — this records the red evidence.
2. Then implement and re-run; the green result is now accepted.
3. If the work item is genuinely not testable, set `session.workflowPath` to `no_test_required`; that exempts the work item.

## Budget exhaustion

**Symptom:** a command exits with `code: budget-exhausted` / `status: exhausted`, or the report shows a budget at 100%.

**Cause:** a hard limit was reached (context tokens, output tokens, tool calls, retries, wall-clock time, estimated cost, or archive bytes/files). Hard limits are enforced: a context load or a verification pass that would exceed one is refused rather than recorded as success.

**Fix:**

1. Inspect consumption: `cadet-agent harness report`.
2. Choose one:
   - Start a **new run** (fresh budget) for the remaining work.
   - Apply an **explicit, recorded** budget override in `.cadet/harness.json` **and** record a user-approved `budget-override` decision in the ledger. A repository may not lower a hard safety ceiling, and may exceed one only with `allowBudgetCeilingOverride: true` plus user approval.
3. Clean up old ledgers if disk retention is the concern: `cadet-agent harness cleanup --older-than-ms <n>`. The bound is required because the command deletes irreversibly; `--dry-run` reports what it would delete without deleting.

Hard stops are never silent: the run is marked `exhausted` and the ledger is persisted before returning.

## Cost budget cannot be confirmed

**Symptom:** a run stops with `stopReason: budget-blocked` and a reason like `provider cost is unmeasurable (no rate card)`.

**Cause:** `maxEstimatedCostUsd` is configured, but no model rate card resolves the cost, so the envelope cannot be verified. Unknown cost is never treated as within budget.

**Fix:**

1. Add a rate card for the active model under `.cadet/harness.json → estimation.rateCards` with `id`, `inputRate`, `outputRate`, and `effectiveDate`, and set `model`.
2. Or disable the cost budget by setting `maxEstimatedCostUsd` to a value you can measure another way, with the user's explicit approval recorded.

## Unavailable Unity CLI

**Symptom:** `cadet-agent harness verify --gate compileCheckConfirmed` or `--gate unityAnalyzerClean` reports `blocked: true`.

**Cause:** the `unity` CLI is not installed, or a project-specific analyzer command is not declared.

**Fix:**

1. Check the capability report: `cadet-agent harness capabilities`.
2. Either install the Unity CLI and re-run, or:
   - declare the project analyzer command in `.cadet/harness.json → analyzerCommand` so `unityAnalyzerClean` can be automated;
   - for `compileCheckConfirmed`, record a **user manual confirmation** with project path, editor version, timestamp, and scope. The harness stores it as `manual-confirmation` — it is a human-owned decision, never imitated as automated evidence.

## Live MCP connection failures

**Symptom:** routing falls back to static context, or a live-editor mutation is refused.

**Cause:** MCP is not configured, the Editor is not connected, or a mutation was requested without user confirmation.

**Fix:**

1. Run `cadet-agent harness capabilities` — MCP availability is reported explicitly.
2. Re-run MCP setup per `.cadet/agent/core/skills/MCPSetup.md` (`unity mcp configure`, then `unity status`).
3. If MCP stays unavailable, continue with static context plus CLI verification. The harness **never pretends** live inspection occurred; the run report labels MCP as unavailable.
4. For any live-editor mutation, obtain explicit user confirmation and record it. The harness blocks an unconfirmed mutation.

## Invalid or unmigrated state

**Symptom:** `cadet-agent state validate` reports schema errors, or the state is v1.

**Fix:**

1. `cadet-agent state migrate` — atomically upgrades v1 → v2, writes a `.v1.bak` backup, and leaves the original untouched if migration fails.
2. `cadet-agent state validate --format json` — inspect any remaining errors.
3. If a state file is malformed beyond migration, restore from git history or the `.v1.bak` backup.

## Malformed hook input

**Symptom:** the git guard returns `permissionDecision: "deny"` with a structured `hook-error`, and logs a diagnostic to stderr.

**Cause:** the host sent malformed JSON, or a recognized shell tool with uninterpretable input.

**Fix:**

1. This is the intended fail-closed behavior — it is not a bug.
2. If the host is known to emit a payload shape the guard does not understand, capture the payload and update `src/harness/hook.mjs` plus the shell/PowerShell mirrors.
3. `fail-open` is available only as an explicit, visible compatibility mode: set `.cadet/harness.json → { "hook": { "mode": "fail-open" } }` or `CADET_GIT_GUARD_MODE=fail-open`. It logs a diagnostic every time it allows a call.

## Secrets in a ledger or report

**Symptom:** you suspect a secret was persisted.

**Fix:**

1. Redaction runs before persistence and before display. Check `cadet-agent harness report` — it never prints secrets.
2. If a real leak is found, delete the affected run record (`.cadet/runs/<runId>.json`) and its artifacts, rotate the secret, and add a fixture to `test/harness-redaction.test.mjs`.
3. Raw prompts are never retained by default (`retention.retainRawPrompt: false`).
