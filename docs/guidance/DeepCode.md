# Deep Code Integration

How to use the Cadet-Agent framework with the [Deep Code](https://deepcode.vegamo.cn/) CLI (`deepcode`).

## How Cadet is discovered

Deep Code is a **skills-based** agent. It scans for Agent Skills in this priority order:

| Scope   | Path                             |
| ------- | -------------------------------- |
| Project | `./.deepcode/skills/`            |
| Project | `./.agents/skills/`              |
| User    | `~/.deepcode/skills/`            |
| User    | `~/.agents/skills/`              |
| Bundled | `bundled:<skill>/SKILL.md`       |

Cadet registers its adapters under **`.agents/skills/`** — the cross-client interop root, so the same pointer files work for any agent that reads the `.agents/` convention. Each adapter is a thin `SKILL.md` with `name`/`description` frontmatter that points at the canonical instructions in `.cadet/agent/core/`.

To verify discovery, run `deepcode` in the project and use `/skills` (or `/`) — the `cadet-*` skills should be listed. Registration metadata is the frontmatter `name`; the folder name is only a fallback.

Cadet ships a repository-root `AGENTS.md` that points at the canonical instructions. Because a project may already own an `AGENTS.md`, Cadet treats it as **create-only**: `init`/`sync` create it when absent and never overwrite an existing one. When it already exists, `init` asks what to do (in a terminal) and defaults to **keep**; non-interactive installs always keep. If kept, Cadet prints a tag-pinned link to its version:

```
   Kept:     AGENTS.md (existing file left untouched)
             Cadet's version: https://github.com/naishtech/cadet-agent/blob/vX.Y.Z/AGENTS.md
```

Choose the behavior non-interactively with `--agents-md keep|overwrite|merge` (or `--yes` to never prompt). `merge` inserts Cadet's text between `<!-- cadet-agent:begin -->` / `<!-- cadet-agent:end -->` markers, leaving everything outside them untouched.

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

## Invoking a skill

Unlike Copilot or Continue, Deep Code has no injected `/cadet-<skill>` slash commands. Open the `/` menu (or run `/skills`) and select the skill by name, or ask for the phase in plain language ("run the TDD skill").

## Git Guard (approval before commit/push)

Deep Code has **no PreToolUse hook**, so Cadet's `.github/hooks/` git-guard scripts cannot run automatically. Enforce the same approval gate through Deep Code's permission system instead. Add to `.deepcode/settings.json` (project) or `~/.deepcode/settings.json` (user):

```json
{
  "permissions": {
    "ask": ["mutate-git-log", "network", "write-out-cwd"],
    "defaultMode": "askAll"
  }
}
```

- `mutate-git-log` covers `git commit`, `git rebase`, `git tag`, and `git push` — this is the scope that replaces the hook.
- `defaultMode: "askAll"` prompts for every operation not explicitly listed; `"allowAll"` (the default) auto-allows everything.
- Selecting "Yes, and always allow" persists a scope to the project `.deepcode/settings.json`.

See `permission.md` in the Deep Code docs for the full scope list.

## MCP

Deep Code supports MCP servers via `mcpServers` in `.deepcode/settings.json`, with tools named `mcp__<service>__<tool>`. The `cadet-mcp-setup` skill installs the Unity Pipeline package and registers Unity's built-in MCP server; point the same server config at Deep Code's `settings.json` and verify with `/mcp`.

## Configuration reference

Deep Code reads `settings.json` from `~/.deepcode/` (user) and `<project>/.deepcode/` (project), the latter overriding the former. Relevant fields for Cadet:

| Field | Use |
| ----- | --- |
| `model` | Active model (defaults to `deepseek-v4-flash`) |
| `thinkingEnabled` / `reasoningEffort` | Thinking mode and depth |
| `permissions` | Approval policy — the Git Guard replacement |
| `mcpServers` | Unity and other MCP servers |
| `enabledSkills` | Per-skill enable/disable, keyed by skill `name` |

## Notes

- Keep the adapter files thin. The `test/adapters.test.mjs` guards (Shape A, Shape B, size budget, discovery) fail if an adapter restates canonical content — including the Deep Code ones.
- `.deepcode/settings.json` is machine/user configuration; it is not managed by Cadet sync.
