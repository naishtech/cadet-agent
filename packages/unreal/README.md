# CADET for Unreal

Editor tooling for CADET: build profiles, a build and publish launcher, and
publishing dependency setup, all running through the Cadet CLI.

The plugin opens a **Cadet** tab that starts `dist.sh` from the CLI folder. It
does not build Unreal content itself.

## Requirements

- **Unreal Engine 5.8** (proven on 5.8.0; other versions are untested).
- **The Cadet CLI** at `CLI/` inside this folder. The installer places it there.
  A plugin folder without `CLI/` opens but cannot build, and the tab says so in a
  banner at the top.
- **Windows.** The launcher starts Git Bash (`C:/Program Files/Git/bin/bash.exe`)
  and uses Windows process calls. macOS is not proven.

## Install

This is a source plugin, not a Fab listing. The Cadet installer copies this
folder into `Plugins/CadetBuild/` of the project, and `uninstall` removes it
again. Do not copy it by hand: a hand copy has no install record, so drift and
removal both break.

```
npx cadet-agent init --engine unreal
```

The installer writes two facts into the project:

- `.cadet/agent/install.json` — a hash for every installed file.
- `.cadet/engine.json` — `pluginRoot`, `cliRoot` and `editorVersion`.

## Quick start

1. Close the editor. A build of the CLI cannot start while an editor holds the
   module loaded.
2. Install into the project, then open the project.
3. Open **Tools > Cadet**.
4. Click **New** to create a profile, fill in the Unreal paths, and click **Save**.
5. Select the profile, choose Build and/or Publish Steam, then click **Execute**.

The console in the tab shows the job output. Build jobs also write a status file
under `Saved/Config/CadetBuild/Jobs/`.

## When the CLI is missing

The tab shows:

```
Cadet CLI missing: run `npx cadet-agent init` in this project.
```

Run that command at the project root and restart the editor. The list of missing
files is in the banner.

## Uninstall

```
npx cadet-agent uninstall
```

The command removes the files its record names, plus `Binaries/` and
`Intermediate/`, and then asks for a project restart. It leaves downloaded tools
in `CLI/` alone, because they are large, reusable, and not part of the install.
It also names the `Saved/Logs/` files the plugin wrote.

## Profiles

Profiles are JSON files under `Saved/Config/CadetBuild/Profiles/`. The structure
is `cadet-profile.schema.json` in the CLI folder. The plugin validates a profile
against the required fields of that schema before it launches a job.

## Tests

The plugin's automation tests are named `Cadet.CadetBuild.*`:

```
UnrealEditor-Cmd.exe "<project>.uproject" -ExecCmds="Automation RunTests Cadet" \
  -unattended -nullrhi -nosplash -testexit="Automation Test Queue Empty"
```

The fixture tests read `CLI/fixtures/profiles/*.json`, so they need an installed
CLI rather than a source checkout.
