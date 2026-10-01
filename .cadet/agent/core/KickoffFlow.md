# Kickoff Flow

1. Detect the repository role.
   - Read `.cadet/state.json`.
   - Check whether `.cadet/agent/project-plans/` exists.
   - If both are absent, this is the framework source repo.
   - Use `CONTRIBUTING.md` and stop the consumer workflow.
2. Plan and record context.
   - Run `cadet-agent harness context plan`.
   - Load the required references that the plan lists.
   - Run `cadet-agent harness context record` at the level the host can honestly claim.
   - Run `cadet-agent harness context validate` before any context-complete claim.
3. Load persisted local configuration when it exists.
   - Read `.cadet/cadet-local-config.md`.
   - Use stored learner tier, game type, and operating mode when valid.
4. Resolve only missing inputs.
   - Ask for learner tier or game type only when the file and request do not answer it.
   - Ask for tracking mode once when `.cadet/state.json` must be initialized.
5. Check the Git-first bootstrap gate.
   - If bootstrap is incomplete, collect only the inputs needed to finish it.
   - Defer detailed planning until bootstrap is complete.
6. Classify the work.
   - `large`: multi-system feature, refactor, architecture, or cross-component change.
   - `small`: single-component feature or bug fix.
   - `no_test_required`: documentation, config, comments, or other non-testable change.
7. Resolve reachability policy once per project.
   - Ask only when `.cadet/harness.json` has no project decision.
   - Record the durable answer there.
8. Dispatch the next skill from `cadet-agent.md`.
9. Keep requirements, design, plan, epics, and stories synchronized as work proceeds.
10. Ask the user to focus Unity before recompilation after Unity code changes.
11. Recommend a fresh chat when the run nears its context budget.

## Backlinks

- Framework index: [README](README.md)
