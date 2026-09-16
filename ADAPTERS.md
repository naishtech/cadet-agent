# Cadet-Agent Adapter Inventory

> Generated: 2026-08-14 | Updated: 2026-09-16 | Framework version: 0.40.0

This document tracks every IDE adapter file, its purpose, and its canonical dependency. The adapter contract is: **no IDE-specific file may duplicate canonical content from `.cadet/agent/core/`.** Each adapter must only contain frontmatter, file-reference instructions, and IDE-specific mechanics.

## Adapter Contract

An adapter file is a **pointer and a registration**. It names the core file and defers to it.

1. **Frontmatter** required by the target IDE.
2. **A pointer** to specific `.cadet/agent/core/` files, treated as authoritative.
3. **IDE-specific mechanics** that cannot live in core: literal slash-command names for this IDE, git-guard hook wiring, and IDE-specific tool notes (e.g. Copilot's `read_file` `startLine`/`endLine` requirement).
4. **References to preserved user paths** (`.cadet/agent/policies/`, `.cadet/agent/project-plans/`, `.cadet/state.json`).

### What counts as canonical content (must NOT appear in an adapter)

- **Inventories** — skill/command lists, dispatch tables, "available skills" enumerations.
- **File and path lists** — operational-file lists, important-path lists, "read these too" blocks.
- **Identity, persona, and role statements** — `You are …`, `You are executing the Cadet **X** skill.`, or any paraphrase of a core `<role>` block or `<instructions>` opening sentence.
- **Guardrails and constraints** — restatements of rules that live in core (e.g. TDD, commit approval).
- **Any sentence that also appears in a `.cadet/agent/core/` file.**

The permitted prose in an adapter is *connective pointer text* ("Read X, then follow every step in it"). Explanatory prose that conveys a fact belongs in core.

> **Enforcement:** `test/adapters.test.mjs` contains Shape A, Shape B, size-budget, and discovery guards. If a change makes them fail, the change is wrong, not the test. The discovery guard mechanically compares adapter sentences against core sentences; its known limit is that it catches verbatim duplication, not paraphrase — a human re-read is still required.

## Inventory

| IDE | File | Type | Canonical Dependency |
|---|---|---|---|
| GitHub Copilot | `.github/agents/cadet.agent.md` | Agent definition | `.cadet/agent/core/cadet-agent.md` |
| GitHub Copilot | `.github/agents/cadet-agent-reviewer.agent.md` | Reviewer agent | `.cadet/agent/core/cadet-agent.md` + `.cadet/agent/core/skills/AgentReviewer.md` |
| GitHub Copilot | `.github/prompts/cadet-requirements.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Requirements.md` |
| GitHub Copilot | `.github/prompts/cadet-planning-review.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/PlanningReview.md` |
| GitHub Copilot | `.github/prompts/cadet-architecture.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Architecture.md` |
| GitHub Copilot | `.github/prompts/cadet-spike.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Spike.md` |
| GitHub Copilot | `.github/prompts/cadet-breakdown.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/StoryBreakdown.md` |
| GitHub Copilot | `.github/prompts/cadet-tdd.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/TDD.md` |
| GitHub Copilot | `.github/prompts/cadet-debug.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Debugging.md` |
| GitHub Copilot | `.github/prompts/cadet-review.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/CodeReview.md` |
| GitHub Copilot | `.github/prompts/cadet-resume.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/Resume.md` |
| GitHub Copilot | `.github/prompts/cadet-mcp-setup.prompt.md` | Slash-command prompt | `.cadet/agent/core/skills/MCPSetup.md` |
| GitHub Copilot | `.github/hooks/git-guard.json` | PreToolUse hook config | n/a (infrastructure) |
| Cursor | `.cursor/rules/cadet-agent.md` | Always-apply rule | `.cadet/agent/core/cadet-agent.md` |
| Cursor | `.cursor/rules/cadet-agent-reviewer.md` | Reviewer rule | `.cadet/agent/core/cadet-agent.md` + `.cadet/agent/core/skills/AgentReviewer.md` |
| Cursor | `.cursor/rules/cadet-planning-review.md` | Phase rule | `.cadet/agent/core/skills/PlanningReview.md` |
| Continue | `.continue/rules/cadet-agent.md` | System rule | `.cadet/agent/core/cadet-agent.md` |
| Continue | `.continue/rules/cadet-agent-reviewer.md` | Reviewer rule | `.cadet/agent/core/cadet-agent.md` + `.cadet/agent/core/skills/AgentReviewer.md` |
| Continue | `.continue/rules/cadet-planning-review.md` | Phase rule | `.cadet/agent/core/skills/PlanningReview.md` |
| Continue | `.continue/config.yaml` | Custom commands | `.cadet/agent/core/skills/*.md` |
| Claude Code | `.claude/skills/cadet-agent/SKILL.md` | Base/global skill | `.cadet/agent/core/cadet-agent.md` |
| Claude Code | `.claude/skills/cadet-agent-reviewer/SKILL.md` | Reviewer skill | `.cadet/agent/core/cadet-agent.md` + `.cadet/agent/core/skills/AgentReviewer.md` |
| Claude Code | `.claude/skills/cadet-requirements/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Requirements.md` |
| Claude Code | `.claude/skills/cadet-planning-review/SKILL.md` | Phase skill | `.cadet/agent/core/skills/PlanningReview.md` |
| Claude Code | `.claude/skills/cadet-architecture/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Architecture.md` |
| Claude Code | `.claude/skills/cadet-spike/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Spike.md` |
| Claude Code | `.claude/skills/cadet-breakdown/SKILL.md` | Phase skill | `.cadet/agent/core/skills/StoryBreakdown.md` |
| Claude Code | `.claude/skills/cadet-tdd/SKILL.md` | Phase skill | `.cadet/agent/core/skills/TDD.md` |
| Claude Code | `.claude/skills/cadet-debug/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Debugging.md` |
| Claude Code | `.claude/skills/cadet-review/SKILL.md` | Phase skill | `.cadet/agent/core/skills/CodeReview.md` |
| Claude Code | `.claude/skills/cadet-resume/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Resume.md` |
| Claude Code | `.claude/skills/cadet-mcp-setup/SKILL.md` | Phase skill | `.cadet/agent/core/skills/MCPSetup.md` |
| Deep Code | `.agents/skills/cadet-agent/SKILL.md` | Base/global skill | `.cadet/agent/core/cadet-agent.md` |
| Deep Code | `.agents/skills/cadet-agent-reviewer/SKILL.md` | Reviewer skill | `.cadet/agent/core/cadet-agent.md` + `.cadet/agent/core/skills/AgentReviewer.md` |
| Deep Code | `.agents/skills/cadet-requirements/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Requirements.md` |
| Deep Code | `.agents/skills/cadet-planning-review/SKILL.md` | Phase skill | `.cadet/agent/core/skills/PlanningReview.md` |
| Deep Code | `.agents/skills/cadet-architecture/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Architecture.md` |
| Deep Code | `.agents/skills/cadet-spike/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Spike.md` |
| Deep Code | `.agents/skills/cadet-breakdown/SKILL.md` | Phase skill | `.cadet/agent/core/skills/StoryBreakdown.md` |
| Deep Code | `.agents/skills/cadet-tdd/SKILL.md` | Phase skill | `.cadet/agent/core/skills/TDD.md` |
| Deep Code | `.agents/skills/cadet-debug/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Debugging.md` |
| Deep Code | `.agents/skills/cadet-review/SKILL.md` | Phase skill | `.cadet/agent/core/skills/CodeReview.md` |
| Deep Code | `.agents/skills/cadet-resume/SKILL.md` | Phase skill | `.cadet/agent/core/skills/Resume.md` |
| Deep Code | `.agents/skills/cadet-mcp-setup/SKILL.md` | Phase skill | `.cadet/agent/core/skills/MCPSetup.md` |
| Cross-client | `AGENTS.md` | Root agent-instruction pointer (create-only) | `.cadet/agent/core/cadet-agent.md` |

> Deep Code adapters live under `.agents/skills/` (the cross-client Agent Skills root) rather than a Deep-Code-only `.deepcode/skills/` directory, so the same pointers are discoverable by any client that reads the `.agents/` convention. Deep Code scans `.deepcode/skills/` first, then `.agents/skills/`. See `docs/guidance/DeepCode.md`.

> `AGENTS.md` is a repository-root pointer recognized by multiple agent clients. It is listed in the manifest as a **create-only path** (`createOnlyPaths`): `init`/`sync` create it when absent but never overwrite an existing file, because a consumer repo may already own one. See the "AGENTS.md is create-only" section in `README.md`.

## Verification

Run `npm test` to validate:
- Every skill has an adapter in each IDE that can invoke it.
- Every adapter references `.cadet/agent/core/cadet-agent.md`.
- No adapter duplicates canonical skill process content.
- `FrameworkManifest.json` lists every adapter in `managedPaths`.
- `package-agent.ps1` stages every adapter path.

## Harness pointers

Adapters do not restate harness rules. Each adapter's `Read First` pointer to `.cadet/agent/core/cadet-agent.md` leads to the Harness rules; the canonical harness contract is `.cadet/agent/core/Harness.md`. Capability-limited IDEs (Cursor, Continue, Claude Code) have no native PreToolUse hook — their adapters must state that limitation, and the harness reports it (`cadet-agent harness capabilities`). Deep Code also has no hook; its adapter directs users to `.deepcode/settings.json` `permissions.ask` (`mutate-git-log`) instead. Copilot hooks (`git-guard.sh` / `git-guard.ps1`) fail closed on malformed input by default; `fail-open` is opt-in only.
