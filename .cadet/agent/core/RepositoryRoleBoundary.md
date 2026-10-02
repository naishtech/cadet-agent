# Repository Role Boundary

Use this check before story, gate, or phase work.

1. Read `.cadet/state.json`.
2. Check whether `.cadet/agent/project-plans/` exists.
3. If `.cadet/state.json` is absent and no project plans exist, treat the repository as the framework source.
4. In the framework source, do not run consumer story or gate workflow.
5. Use `CONTRIBUTING.md` and the framework contribution workflow instead.
6. Otherwise, continue with the consumer-project workflow.
