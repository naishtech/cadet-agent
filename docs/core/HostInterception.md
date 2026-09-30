# Host Interception

What each host can actually stop, measured per action.

## Why this page exists

Cadet-Agent's skills are the same everywhere: one canonical file per skill, and thin per-host pointers
that read it. **Enforcement is not the same everywhere**, and claiming that it is would be the most
expensive kind of documentation — the kind a reader trusts. So the framework publishes a measured level
per host **per action**, and never infers enforcement from a file being present.

That was a real defect. `harness capabilities` used to read `Copilot hook: installed` from
`existsSync('.github/hooks/git-guard.json')` — a file the framework itself ships. The claim was therefore
true in every consumer repository, for every host, whether or not the host consulted the hook. A claim
that cannot be false is not a measurement.

## The three levels

| Level | Meaning |
|---|---|
| `native` | The host decides before execution: it blocks, or asks, using a mechanism configured in this repository. Claimed only when the mechanism is present **and its probe answers correctly here**. |
| `external` | A control outside the host decides: a repository Git hook that is installed and verified, or an OS/client approval policy that the framework cannot read from the repository. |
| `advisory` | Instructions ask for compliance and nothing intercepts. This is the floor, and it is the honest level for most host/action pairs. |

Every cell also records **how** the level was established: `probe` (the framework ran the mechanism) or
`declared` (the framework cannot verify it from here). A report that cannot tell those apart is a report
that will be trusted for the wrong reason.

## The actions

`git-write`, `shell-command`, `filesystem-write`, `unity-mutation`, `context-load`, `harness-routing`.

## Measuring it

```
cadet-agent harness capabilities --verify-host
```

Without the flag the declared position is printed and marked `declared`. With it, each mechanism is probed
where it is safe to do so — no network, no editor, and no writes to the repository being measured:

- **The host hook.** Fed two synthetic `PreToolUse` payloads, one git write and one read-only command, and
  required to answer `ask` and *nothing* respectively. **Every variant the config declares is measured**, not
  just the first: the shipped config declares a bash guard and a PowerShell guard, and a Windows host runs the
  PowerShell one — so a probe that ran only bash would credit a level to a script the host may never execute,
  and could not pass at all on a machine without bash. A variant that cannot be launched here is recorded as
  unmeasured and named in the reason. A hook that is configured but silent fails, and the action it was
  supposed to cover drops to `advisory` with the reason attached.
- **The declared levels, without the flag.** Even when the mechanism is not run, the report looks for the
  hook's config file in the repository being measured. A repository with no `.github/hooks/git-guard.json`
  reads `advisory` for Copilot's git writes: reading `native` from the static host table alone was the
  `hook.copilot` defect one level up — true everywhere, measuring nothing.
- **The repository Git hook.** Checked for presence, for `core.hooksPath` actually pointing at it (a hook
  in `.githooks/` protects nothing until git is told to run it), and for correctness: it must accept a valid
  state document and refuse an unreadable one, in a scratch directory of its own.

The level is reported per action, never per repository. A host that can intercept tool calls is not thereby
intercepting anything in particular, and a guard that asks about `git commit` is not a control over
arbitrary shell commands.

## The portable controls

| Control | What it protects | How to install |
|---|---|---|
| Repository Git hook (`.githooks/pre-commit`) | A commit, for every client, including ones with no interception API | `git config core.hooksPath .githooks` |
| The CLI itself (`cadet-agent`) | Every gate check: a client can be configured to require approval for it, and the gate verdict is its exit code | `npx cadet-agent@latest init` |
| OS/client approval policy | Actions the framework cannot see, documented per host below | client settings |

**The framework does not install the Git hook for you.** `git config core.hooksPath` changes your
repository's configuration, and that is the repository owner's decision — the same reason Cadet never
commits on your behalf. One command, and the probe will verify it afterwards.

### What the Git hook checks, and what it deliberately does not

It checks that `.cadet/state.json` is readable and valid (the full `state validate` when the local CLI is
present, a JSON parse when it is not). It does **not** run the test suite — a suite in a commit hook is
slow enough that people disable the hook, and a disabled hook protects nothing. It does **not** refuse a
commit because gates are unmet: work in progress is committed all the time, and the gate system refuses
the *transition*, which is the thing that should be refused.

## The client policies

Where a host has no interception API, the external route is a client or OS setting. The framework cannot
read those settings, so the matrix reports `advisory` and the route is named here instead of assumed.

| Host | Route | Level it can reach |
|---|---|---|
| GitHub Copilot | `PreToolUse` hook (`.github/hooks/git-guard.json` → `git-guard.sh` / `.ps1`) | `native` for git writes when the config is present and a declared variant verifies. Both variants are probed; the PowerShell guard carries a UTF-8 BOM, because Windows PowerShell 5.1 mis-parses a BOM-less UTF-8 file whose strings contain non-ASCII (which is how this guard was failing to run at all on Windows) |
| Claude Code | Hooks and permission modes — **this repository configures neither** | `advisory` until a hook is added and probed; `external` via the repository Git hook |
| Cursor | No `PreToolUse` equivalent; auto-run and approval settings | `external` via the repository Git hook, else `advisory` |
| Continue | No `PreToolUse` equivalent; approval is a client setting | `external` via the repository Git hook, else `advisory` |
| Deep Code | `.deepcode/settings.json` → `permissions.ask` with `mutate-git-log` | `external` (declared: the framework cannot read the file), plus the repository Git hook |
| Hermes | Command approval policies (see `docs/guidance/Hermes.md`) | `external` (declared), plus the repository Git hook |
| Cross-client (`AGENTS.md`) | A pointer file with no execution surface | `advisory` |

## What cannot be intercepted

- **Live Unity mutation.** No host here can stop a tool that touches the running Editor; the gates that
  depend on the Editor (`compileCheckConfirmed`, `unityAnalyzerClean`) therefore fall back to a manual
  record with a bounded validity when the CLI is unavailable, and the framework says so rather than
  implying a guarantee.
- **A push or a commit in a host with no interception API and no repository hook.** This is exactly why
  the repository Git hook exists: it is the one control that does not depend on the host.
- **A model that ignores an instruction.** Instructions reduce the chance; they are not interception. Every
  cell that says `advisory` is that statement, made once and measured.

## Related

- `harness capabilities --verify-host` — the command that produces the matrix.
- [Harness Contract](HarnessContract.md) C19 — the invariant this page documents.
- `.cadet/agent/core/Harness.md` §2d — the context protocol, whose `enforced` level is the context-loading
  cell of this matrix: a record may claim `enforced` only by naming a hook that declares it enforces
  context, and no host ships one today.
