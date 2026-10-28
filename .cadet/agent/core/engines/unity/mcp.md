# MCP — Unity pack

How the agent connects to a live Unity Editor, and what proves the connection works. The core procedure, the approval rule and the evidence standard are in `.cadet/agent/core/skills/MCPSetup.md`; this page supplies the Unity commands it defers to.

## What this page covers

The bridge package, the client configuration command, the round-trip check, and the boundary the live editor exposes.

## Commands

| Task | Command |
|---|---|
| Check the CLI is installed | `unity --version` |
| Install the CLI (Windows) | `$env:UNITY_CLI_CHANNEL='beta'; irm https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.ps1 \| iex` |
| Install the CLI (macOS/Linux) | `brew install --cask unity-cli`, or the vendor install script |
| Install the bridge into the project | `unity pipeline install --project-path <project>` |
| List the clients it can configure | `unity mcp configure --list` |
| Configure a client, project-local | `unity mcp configure <client> --local` |
| Preview a configuration | `unity mcp configure <client> --dry-run` |
| Skip the "already exists, update?" prompt | `unity mcp configure <client> --yes` |
| Read the editor's live state | `unity status` |
| List the commands the editor exposes | `unity command` |
| Evaluate C# live | `unity command eval "<expr>"` |
| Aim at a dev player | `unity command --runtime <player>` |

## Procedure

1. Confirm `unity --version` answers. A missing CLI is the first thing to fix, and the fix is the install line above.
2. Install `com.unity.pipeline` into the project. It is the package that exposes the editor's commands.
3. List the clients, then configure the user's own client. Prefer the project-local form so the setup travels with the repository.
4. Preview with `--dry-run` when the tool offers it, then run it without. **Do not hand-write the client's config JSON**: the command merges and prompts correctly, and a hand-written file loses that.
5. Connect, then ask for the editor's status.

## Verification

- The round trip is two reads: `unity status` shows a connected editor with its project path and version, and one trivial read through `unity command` returns a value. Keep both outputs and a hash of the second. A configured client is not a working connection.
- `unity command` lists what the connected editor exposes. Record that list, because it is what the agent may call and nothing more.
- If `unity status` shows no connected editor, say so. Do not report a connection you did not observe.

## The boundary

- `unity command eval` is token-gated, and the token is the editor's, not the agent's. Never persist it, log it, or paste it into a prompt.
- Pipeline listens on localhost and is off by default. It belongs in dev and QA builds, never in a production build.
- A live mutation — scene generation, a component change, an eval that writes — needs the user's explicit confirmation, recorded before the action.

## When MCP is the wrong tool

A deterministic check does not need the live editor. Use `unity test` and `unity build` for the gates, and the repository for static context. MCP is for what only a running editor can answer: the scene as it is loaded, the console as it filled, the component as the prefab resolved it. If a task can be settled from the files, settle it there.
