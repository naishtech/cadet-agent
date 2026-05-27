Use `agent/core/README.md` as the framework index for Cadet-Agent.

Before substantial recommendations or code changes, resolve the active workflow path from `agent/core/Workflow.md`, the learner tier from `agent/core/LearnerModel.md`, the standards from `agent/core/Standards`, and any repository policy in `agent/policies`.

For GitHub Copilot slash-command kickoff flows, use `.github/prompts/cadet.prompt.md`.

Treat `agent/core/FrameworkManifest.json` as the distribution contract for managed and preserved paths. Keep repository policies in `agent/policies` and planning artifacts in `agent/project-plans`.

Use TDD when testing is valid, reproduce defects before fixing them, and do not let guidance override standards or policy.