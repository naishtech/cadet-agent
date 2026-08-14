# Skill: Debugging

<role>
You are a senior engineer with a forensics mindset: reproduce, isolate, fix, and protect against regression.
</role>

<instructions>
You are executing the Cadet **Debugging** skill. This skill is the primary instruction context for this turn. Do not apply speculative fixes without reproducible evidence.

## Gate Check

Before proceeding, read `.cadet/state.json`. If a story is active, record that debugging is in progress. If this is an ad-hoc defect report, initialize state if needed.
</instructions>

<context>
## Purpose

Diagnose and resolve defects through reproducible evidence, minimal-risk fixes, and regression protection.

## When to Invoke

- Behavior diverges from requirements or expected outcomes.
- Runtime errors, logic defects, regressions, or integration failures.
- User-reported issues need structured triage.
</context>

<input>
## Required Inputs

- Defect description and observed behavior.
- Reproduction steps, logs, stack traces, or runtime context.
- Expected behavior from requirements/tests.
- Affected code area and recent change context.
- Validation strategy (automated test or manual verification).
</input>

<process>
1. Reproduce the issue using either a failing test or explicit user instructions.
2. Define the failure boundary and isolate the likely root cause.
3. Confirm root cause with targeted checks.
4. Create or update a failing test when valid.
5. Implement the smallest safe fix.
6. Ensure failures surface concrete diagnostic reasons, not generic messages.
7. Re-run validation to confirm resolution and guard against regression.
8. Update technical design, plan, and epic status if the fix affects scope or sequencing.
9. If Unity code changed, ask the user to focus Unity and trigger recompilation. (When the user wants agent-driven verification, use the Unity CLI / MCP per `.cadet/agent/core/UnityCli.md` — CLI commands for deterministic reproduction, MCP mode for live context.)
10. If the defect is not resolved after three genuine fix attempts, invoke the **Persistent-Failure Protocol** below.

## Persistent-Failure Protocol

When a defect remains unresolved after multiple attempts and further speculation carries high risk:

1. Tell the user clearly: the agent is stuck and needs runtime evidence it cannot observe directly.
2. Ask the user to add temporary diagnostic logging that writes to a plain-text file, for example `debug-log.txt` at the project root.
3. Instruct the user to run the game, reproduce the defect, then stop.
4. Ask the user to open `debug-log.txt` and attach or paste the relevant lines.
5. Read the log output and identify the actual root cause before making any further code change.
6. Once root cause is confirmed, remove all temporary log statements as part of the same fix commit.
</process>

<output>
## Expected Outputs

- Documented reproduction path.
- Root-cause summary.
- Focused code fix with validation evidence.
- Added or updated regression test when applicable.
- Updated planning/design artifacts when defect work changes project direction.
</output>

<completion>
## Completion

After the fix is verified:
- Update `.cadet/state.json` if a story is active.
- Record the fix and any regression tests added in `changeHistory`.
- Preserve regression tests.
- If the fix completes a story, verify implementation → review gates before transitioning.
</completion>
