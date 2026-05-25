# Purpose

Define how Cadet-Agent diagnoses and resolves defects through reproducible evidence, minimal-risk fixes, and regression protection.

## Backlinks
- Identity reference: [Identity](../Identity.md)
- Guidance reference: [../Guidance/DebuggingPatterns](../Guidance/DebuggingPatterns.md)
- Principles reference: [Principles](../Principles.md)
- Workflow reference: [Workflow](../Workflow.md)

## Objective
Resolve defects reliably by reproducing issues first, isolating root cause, applying focused fixes, and validating with tests or manual checks as appropriate.

## When To Use
- Use when behavior diverges from requirements or expected outcomes.
- Use for runtime errors, logic defects, regressions, and integration failures.
- Use when user-reported issues need structured triage and confirmation.

## Required Inputs
- Defect description and observed behavior.
- Reproduction steps, logs, stack traces, or runtime context.
- Expected behavior from requirements/tests.
- Affected code area and recent change context.
- Validation strategy (automated test where valid, manual verification when not).
- Applicable guidance documents for preferred debugging and diagnostics heuristics.
- Any active repository policy when logging or diagnostics conventions are relevant.

## Process
1. Reproduce the issue using either a failing test or explicit user instructions.
2. Define the failure boundary and isolate likely root cause.
3. Confirm root cause with targeted checks.
4. Create or update a failing test when valid.
5. Implement the smallest safe fix.
6. Ensure failures surface concrete diagnostic reasons, not generic messages.
7. Re-run validation to confirm resolution and guard against regression.
8. Update technical design, plan, and epic status if the fix affects scope or implementation sequencing.
9. If Unity code changed, ask the user to focus Unity and trigger recompilation when needed.
10. Apply relevant debugging guidance as a default heuristic unless standards or active policy require a different approach.
11. If the same defect has not been resolved after three genuine fix attempts, invoke the **Persistent-Failure Protocol** below.

## Persistent-Failure Protocol
When a defect remains unresolved after multiple attempts and further speculation carries high risk of making things worse, stop guessing and collect hard evidence instead.

**Trigger:** Three or more distinct fix attempts have not resolved the defect.

**Steps:**
1. Tell the user clearly: the agent is stuck and needs runtime evidence it cannot observe directly.
2. Ask the user to add temporary diagnostic logging that writes to a plain-text file, for example `debug-log.txt` at the project root. Suggest a specific log statement targeting the suspected area:
```csharp
System.IO.File.AppendAllText(
    System.IO.Path.Combine(Application.dataPath, "../debug-log.txt"),
    $"[{System.DateTime.Now:HH:mm:ss.fff}] <ClassName>.<MethodName>: <value or state>\n"
);
```
3. Instruct the user to run the game, reproduce the defect, then stop.
4. Ask the user to open `debug-log.txt` and attach it (or paste the relevant lines) to the chat.
5. Read the log output and use it to identify the actual root cause before making any further code change.
6. Once root cause is confirmed from the log, remove all temporary log statements as part of the same fix commit.

**Why this works:** The AI cannot observe runtime state directly. A file written by the running game is concrete, timestamped evidence that removes guesswork and breaks the speculation cycle.

## Expected Outputs
- Documented reproduction path.
- Root-cause summary.
- Focused code fix with linked validation evidence.
- Added or updated regression test when applicable.
- Updated planning/design artifacts when defect work changes project direction.
- Clear diagnostic reason for failure paths in logs or surfaced error handling.
- Evidence-backed debugging steps that distinguish guidance-level heuristics from mandatory policy or standards requirements.

## Success Criteria
- Defect is reproducible before fix and verified resolved after fix.
- Validation evidence is clear and repeatable.
- Regression risk is reduced through automated tests where feasible.
- No unrelated behavior is changed unintentionally.
- Project artifacts remain synchronized with defect-driven scope updates.
- Failure diagnostics provide concrete causes that users and reviewers can act on.
- Guidance informs the investigation without being mistaken for a hard requirement.

## Common Pitfalls
- Attempting fixes before reproducing the defect.
- Applying broad speculative changes instead of root-cause fixes.
- Skipping regression coverage for resolved bugs.
- Treating user reports as complete without clarifying reproduction steps.
- Failing to reflect defect-driven scope changes in plan/design docs.
- Leaving failure flows with generic messages and no actionable reason.
- Treating a preferred diagnostics pattern as mandatory when the repository policy defines a different logging convention.
- Ignoring active logging or diagnostics conventions defined by the repository policy.

---
