# CADET for Unity

Editor tooling for CADET: build profiles, a build queue, and build, publish and
notarize operations that run through the Cadet CLI.

## Requirements

- **Unity 2022.3** (proven on 2022.3.62f3; Unity 6 is not tested).
- **The Cadet CLI** at `CLI/` inside this folder. The installer places it there; a
  folder without `CLI/` can open the window but cannot build.
- **No extra Unity packages.** `com.unity.addressables` is not required. The editor
  assembly used to reference `Unity.ResourceManager` and no code used it, so the
  reference was removed and a project needs nothing added to `Packages/manifest.json`.

## Install

This is not a Unity package and it is not on the Asset Store. The Cadet installer
copies this folder into `Assets/Covyne/Cadet/` of the consumer project, and `uninstall`
removes it again. Do not import it as a `.unitypackage` and do not add it as a UPM
dependency: either one bypasses the install record and the removal path.

Profiles live outside this folder, in `Assets/Config/Covyne/Cadet/Profiles/`. The
installer never writes them, so an uninstall keeps them.

## Quick start

1. Open **Tools > Covyne > C.A.D.E.T.**
2. Click **New** to create a build profile.
3. Fill in the profile details and the Unity paths.
4. Click **Save**, then select the profile in the main CADET window.
5. Enable the build steps and click **Execute** to queue the job.

## Documentation

The user manual is the primary reference for setup, workflows and feature guidance:

- https://naishtech.github.io/cadet-doc/UserManual/
