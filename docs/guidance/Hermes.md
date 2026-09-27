# Hermes Integration

How to use the Cadet-Agent framework with [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) (`hermes`), the open-source agent CLI by Nous Research.

## How Cadet is discovered

Hermes discovers **project-local skills** when launched inside a git checkout. It scans, with project skills at the highest-precedence tier:

| Scope | Path |
| ----- | ---- |
| Project | `<project-root>/.hermes/skills/` (Hermes-native) |
| Project | `<project-root>/.agents/skills/` (cross-tool convention) |
| User | `~/.hermes/skills/` |

Cadet registers its adapters under **`.agents/skills/`** — the same cross-client interop root used by Deep Code, so both clients share one set of pointer files. Each adapter is a thin `SKILL.md` with `name`/`description` frontmatter (the agentskills.io convention) that points at the canonical instructions in `.cadet/agent/core/`. Cadet ships **no** `.hermes/` directory; the project-skill location is enough.

Project skills are not auto-loaded from arbitrary clones. The first time you run Hermes in the repo, trust it:

```
hermes skills trust
```

Trusted roots are stored in `skills.trusted_project_dirs` in `~/.hermes/config.yaml`; `hermes skills untrust` revokes. Every project skill is security-scanned before it enters the index, and project skills are tagged `[project]` in the skill list.

Hermes also auto-loads the repository-root `AGENTS.md` (priority: `.hermes.md` → `AGENTS.override.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`), which points at the canonical instructions. Cadet treats `AGENTS.md` as **create-only**: `init`/`sync` create it when absent and never overwrite an existing one.

### Skills registered

| Skill | Purpose |
| ----- | ------- |
| `cadet-agent` | Base entry point — read `.cadet/agent/core/cadet-agent.md` first; dispatch to phase skills |
| `cadet-requirements` | Capture Given/When/Then acceptance criteria |
| `cadet-architecture` | Technical design and ADRs |
| `cadet-spike` | Bounded feasibility investigation |
| `cadet-breakdown` | Epic/story decomposition |
| `cadet-tdd` | Red/green test-first implementation |
| `cadet-debug` | Reproduce, isolate, fix |
| `cadet-review` | Non-skippable review |
| `cadet-resume` | Resume from `.cadet/state.json` |
| `cadet-mcp-setup` | Register Unity's MCP server |
| `cadet-agent-reviewer` | Framework-compliance audit |

## Install and verify

Native Windows is fully supported by Hermes (a PowerShell one-liner installs everything to `%LOCALAPPDATA%\hermes`); WSL2 works equally well:

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Then pick a model and check health (`hermes` walks through provider setup on first run):

```
hermes model
hermes doctor
```

To verify discovery, run `hermes` inside the project, trust it, and use `/skills` — the `cadet-*` skills should be listed with the `[project]` tag.

## Invoking a skill

Every installed skill is a slash command, so the Cadet skills work directly:

```
/cadet-tdd implement the ghost-replay story
/cadet-agent-reviewer
```

You can also stack up to five skill invocations in one message (`/cadet-planning-review /cadet-requirements …`) or ask for the phase in plain language. `/skills` lists everything.

## Git Guard (approval before commit/push)

Hermes has **no PreToolUse hook**, so Cadet's `.github/hooks/` git-guard scripts cannot run automatically. Enforce the same gate through Hermes' **command approval policies** so destructive commands require confirmation, and keep the Cadet rule: before any commit or push, present a summary of changes and wait for explicit approval. See the [Hermes security docs](https://hermes-agent.nousresearch.com/docs/user-guide/security) for the approval configuration.

## MCP

Hermes supports MCP servers for extended capabilities. The `cadet-mcp-setup` skill installs Unity's Pipeline package and registers Unity's built-in MCP server; point your Hermes MCP configuration at the same server and verify the connection from a session.

## Configuration reference

Hermes reads `~/.hermes/config.yaml` (per-profile). Relevant areas for Cadet:

| Area | Use |
| ---- | --- |
| Model/provider config (`hermes model`) | Active model — Cadet assumes a capable tool-calling model |
| Command approval policies | The Git Guard replacement |
| MCP configuration | Unity and other MCP servers |
| `skills.trusted_project_dirs` | Trusted repos whose project skills load |
| `skills.project_discovery` | Set `false` to disable project-skill scanning entirely |
| `skills.external_dirs` | Additional skill directories scanned alongside `~/.hermes/skills/` |

## Notes

- Keep the adapter files thin. The `test/adapters.test.mjs` guards (Shape A, Shape B, size budget, discovery) fail if an adapter restates canonical content — including the shared Deep Code/Hermes ones.
- Hermes' self-learning loop writes agent-created skills to `~/.hermes/skills/` (user level). It never modifies project skill directories, so it cannot drift the repo's `.agents/skills/` adapters.
- Do **not** use `/learn` to distill `.cadet/agent/core/` into a Hermes skill — that would duplicate canonical content and violate the adapter contract. The core files are the single source of truth; the adapters point at them.
- `~/.hermes/` is machine/user configuration; it is not managed by Cadet sync.
