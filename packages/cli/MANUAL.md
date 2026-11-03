# CADET CLI Manual

## Table of Contents

1. [Introduction](#introduction)
2. [Installation and Setup](#installation-and-setup)
3. [Build Profile Configuration](#build-profile-configuration)
4. [Command Reference](#command-reference)
5. [Platform-Specific Guides](#platform-specific-guides)
6. [macOS Signing and Notarization](#macos-signing-and-notarization)
7. [Git Integration](#git-integration)
8. [Process Locks](#process-locks)
9. [Troubleshooting](#troubleshooting)
10. [Advanced Usage](#advanced-usage)

---

## Introduction

CADET CLI is a command-line tool for building and publishing games to Steam and Epic Game Store. It provides a unified interface for:

- **Building** projects for Windows and macOS
- **Publishing** to Steam via SteamCMD
- **Publishing** to Epic Game Store via BuildPatchTool
- **Signing and notarizing** macOS builds
- **Managing** build configurations through JSON profiles

### Key Features

- ✅ Cross-platform support (Windows, macOS, Linux)
- ✅ Steam and Epic Game Store publishing
- ✅ macOS code signing and notarization
- ✅ Git integration for reproducible builds

### Architecture

The CLI consists of several bash scripts organized by functionality:

```
Tools/CLI/
├── build.sh                    # Build orchestrator
├── dist.sh                     # Main entry point (build + publish)
├── cadet-profile.schema.json    # JSON schema for profiles
├── Deps/
│   └── download_deps.sh       # Download external dependencies
├── Steam/
│   ├── auth.sh                 # Steam authentication setup
│   ├── build_and_publish.sh    # Steam build + publish
│   ├── publish.sh              # Steam publishing only
│   └── library.sh              # Steam library management
├── Epic/
│   └── publish.sh              # Epic Game Store publishing
├── MacOS/
│   └── sign_and_upload.sh      # macOS signing and notarization
└── Util/
    ├── json_parser.sh          # JSON parsing utilities
    ├── logging.sh              # Logging functions
    ├── process_lock.sh         # Process lock management
    └── manage_locks.sh         # Lock management CLI
```

---

## Build Tools Installation Locations

CADET CLI installs build tools to platform-specific user directories:

- **Windows**: `%APPDATA%/CADET/Tools/`
- **macOS**: `~/Library/Application Support/CADET/Tools/`
- **Linux**: `~/.local/bin/CADET/Tools/` (XDG-compliant for user executables)

This ensures:
- Tools are not checked into version control
- Each user has their own installation
- No permission issues when syncing between platforms
- Clean repository (no binary files in git)

**Tools installed:**
- `BuildPatchTool/` - Epic Games BuildPatchTool
- `steamcmd/` - SteamCMD (Windows and macOS)
- `cosmos-4.0.2~/` - Cosmos binaries (Windows only)

**Note:** The `download_deps.sh` script automatically installs to these locations. You can also specify a custom installation directory by passing it as the second argument to the script.

---

## Installation and Setup

CADET CLI supports two environment setups: **Desktop** (local development) and **Cloud** (CI/CD). Choose the setup that matches your use case.

### Prerequisites

Both environments require:
- **Bash shell** (Git Bash on Windows, native on macOS/Linux)
- **jq** (JSON processor) - included in Cosmos bundle or system installation
- **Steam account** with Steamworks access (for Steam publishing)
- **Epic Games account** with developer access (for Epic publishing)

---

## Desktop Environment Setup

Desktop setup uses **credential files** stored in your home directory. This is for local development and testing.

### Step 1: Download Dependencies

Download required external tools (SteamCMD, BuildPatchTool):

```bash
bash Tools/CLI/Deps/download_deps.sh
```

This downloads and installs to user directories:
- **SteamCMD** - Steam content management tool
- **Epic BuildPatchTool** - Epic Game Store publishing tool

**Installation Locations:**
- **Windows**: `%APPDATA%/CADET/Tools/`
- **macOS**: `~/Library/Application Support/CADET/Tools/`
- **Linux**: `~/.local/bin/CADET/Tools/` (XDG-compliant)

Tools are installed to user directories to avoid git permission issues and keep the repository clean. Each user has their own installation.

### Step 2: Steam Authentication Setup (One-Time)

SteamCMD uses sentry files for persistent authentication. After the first successful login, you won't need Steam Guard codes.

#### a. Create Credentials File

Create `~/.env_cadet_steam_credentials`:

```bash
STEAM_USERNAME=your_username
STEAM_PASSWORD=your_password
STEAM_GUARD_CODE=ABC12  # Fresh code from email (valid for ~5 minutes)
```

#### b. Run Authentication

```bash
bash Tools/CLI/Steam/auth.sh --profile-json path/to/profile.json
```

This will:
1. Log into SteamCMD with your credentials
2. Create a sentry file (`ssfn*`) in the SteamCMD directory
3. Enable future builds without Steam Guard codes

#### c. Remove Steam Guard Code

After successful authentication, edit `~/.env_cadet_steam_credentials` and remove the guard code:

```bash
STEAM_USERNAME=your_username
STEAM_PASSWORD=your_password
# STEAM_GUARD_CODE=  # Not needed anymore - uses sentry file
```

✅ **Future builds will use the sentry file automatically!**

### Step 3: Epic Games Setup (Optional)

Create `~/.env_cadet_epic_credentials`:

```bash
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
```

These credentials are obtained from your Epic Games Developer Portal.

### Step 4: macOS Signing Setup (Optional)

If you plan to sign and notarize macOS builds, create `~/.env_cadet_mac_creds`:

```bash
APPLE_ID=your_apple_id@example.com
GEN_PW=your_app_specific_password
TEAM_ID=your_team_id
DEV_ID=Developer ID Application: Your Name (TEAM_ID)
```

**Note:** `GEN_PW` is an app-specific password generated in your Apple ID account settings.

---

## Cloud Environment Setup

Cloud setup uses **environment variables** provided by your CI/CD platform. Credential files are **not used** in cloud environments.

### Step 1: Download Dependencies

In your CI/CD pipeline, download required external tools:

```bash
bash Tools/CLI/Deps/download_deps.sh
```

This downloads and installs to user directories:
- **SteamCMD** - Steam content management tool
- **Epic BuildPatchTool** - Epic Game Store publishing tool

**Installation Locations:**
- **Windows**: `%APPDATA%/CADET/Tools/`
- **macOS**: `~/Library/Application Support/CADET/Tools/`
- **Linux**: `~/.local/bin/CADET/Tools/` (XDG-compliant)

See [Build Tools Installation Locations](#build-tools-installation-locations) for more details.

### Step 2: Configure Environment Variables

Set the following environment variables in your CI/CD platform's secret management system:

#### Steam Credentials

- `STEAM_USERNAME` - Your Steam username
- `STEAM_PASSWORD` - Your Steam password
- `STEAM_GUARD_CODE` - Optional (only needed if sentry file doesn't exist)

#### Epic Credentials

- `CLIENT_ID` - Epic client ID
- `CLIENT_SECRET` - Epic client secret

#### macOS Signing Credentials (if needed)

- `APPLE_ID` - Apple ID email
- `GEN_PW` - App-specific password
- `TEAM_ID` - Apple Developer Team ID
- `DEV_ID` - Developer ID certificate name

### Step 3: Platform-Specific Setup

See the [CI/CD Integration](#cicd-integration) section for detailed setup instructions for:
- GitHub Actions
- GitLab CI
- Jenkins
- Azure DevOps

### Important Notes for Cloud Environments

- **Environment variables take precedence** - If environment variables are set, credential files are ignored
- **Never commit credentials** - Always use your CI/CD platform's secret management
- **Sentry files** - For Steam, you may need to provide `STEAM_GUARD_CODE` on first run, or ensure sentry file is available in your build environment
- **Credential files are not used** - The CLI will not read `~/.env_cadet_*` files when environment variables are present

---

## Build Profile Configuration

CADET CLI uses **JSON Build Profiles** for configuration. All settings are stored in a single JSON file, making it easy to version control and share configurations.

> **Recommended:** Use the CADET Unity plugin to author and export JSON Build Profile files. The plugin provides a user-friendly interface for creating and managing build profiles, ensuring proper validation and schema compliance.

### Profile Structure

A Build Profile is a JSON file with the following structure:

```json
{
  "profileName": "MyGame-Steam-Windows",
  "platform": "steam",
  "os": "windows",
  "build": {
    "editorPath": "/path/to/editor.exe",
    "projectPath": "/path/to/project",
    "buildOutputPath": "/path/to/builds",
    "projectName": "MyGame"
  },
  "steam": {
    "appId": "1234567",
    "steamcmdExe": "C:/Users/Username/AppData/Roaming/CADET/Tools/steamcmd/steamcmd.exe",
    "steamcmdSh": "/Users/username/Library/Application Support/CADET/Tools/steamcmd/steamcmd.sh",
    "setLive": "default",
    "contentRoot": "../../Bin",
    "buildOutput": "../../Bin/build",
    "depots": [
      {
        "depotId": "1234568",
        "os": "windows",
        "localPath": "windows\\\\*",
        "depotPath": ".",
        "recursive": "1"
      }
    ]
  }
}
```

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profileName` | string | ✅ Yes | Human-readable profile name |
| `platform` | enum | ✅ Yes | `"steam"`, `"epic"`, or `"both"` |
| `os` | enum | ✅ Yes | `"windows"`, `"mac"`, or `"both"` |
| `useGit` | boolean | No | Enable git operations (requires `gitRepository` and `gitBranch`) |
| `gitRepository` | string | No | Git repository URL for cloning |
| `gitBranch` | string | No | Git branch name |
| `gitBashPath` | string | No | Path to Git Bash executable (Windows only) |
| `build` | object | ✅ Yes | Build configuration |
| `steam` | object | Conditional | Required when `platform` is `"steam"` or `"both"` |
| `epic` | object | Conditional | Required when `platform` is `"epic"` or `"both"` |
| `macos` | object | No | macOS-specific settings |

### Build Configuration

```json
{
  "build": {
    "editorPath": "/path/to/editor.exe",
    "projectPath": "/path/to/project",
    "buildOutputPath": "/path/to/builds",
    "projectName": "MyGame"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `editorPath` | string | ✅ Yes | Path to build editor/executable (supports `.app` bundles on macOS) |
| `projectPath` | string | ✅ Yes | Path to project directory |
| `buildOutputPath` | string | ✅ Yes | Path where builds will be output |
| `projectName` | string | ✅ Yes | Project name (used as executable name) |

**Note:** On macOS, `editorPath` can point to a `.app` bundle. The CLI automatically extracts the executable from `.app/Contents/MacOS/`.

### Steam Configuration

Required when `platform` is `"steam"` or `"both"`.

```json
{
  "steam": {
    "appId": "1234567",
    "steamcmdExe": "C:/Users/Username/AppData/Roaming/CADET/Tools/steamcmd/steamcmd.exe",
    "steamcmdSh": "/Users/username/Library/Application Support/CADET/Tools/steamcmd/steamcmd.sh",
    "description": "Build description",
    "setLive": "default",
    "contentRoot": "../../Bin",
    "buildOutput": "../../Bin/build",
    "depots": [
      {
        "depotId": "1234568",
        "os": "windows",
        "localPath": "windows\\\\*",
        "depotPath": ".",
        "recursive": "1"
      }
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appId` | string | ✅ Yes | Steam App ID |
| `steamcmdExe` | string | ✅ Yes | Path to `steamcmd.exe` (Windows). Default installation: `%APPDATA%/CADET/Tools/steamcmd/steamcmd.exe` |
| `steamcmdSh` | string | ✅ Yes | Path to `steamcmd.sh` (macOS/Linux). Default installation: `~/Library/Application Support/CADET/Tools/steamcmd/steamcmd.sh` (macOS) or `~/.local/bin/CADET/Tools/steamcmd/steamcmd.sh` (Linux) |
| `description` | string | No | Build description (appears in Steam) |
| `setLive` | string | No | Steam branch to set live (`"default"`, `"beta"`, etc.) |
| `contentRoot` | string | ✅ Yes | Content root path (relative to SteamCMD) |
| `buildOutput` | string | ✅ Yes | Build output path (relative to SteamCMD) |
| `depots` | array | ✅ Yes | List of depot configurations |

#### Steam Depots

Each depot configuration maps local files to Steam depot paths:

```json
{
  "depots": [
    {
      "depotId": "1234568",
      "os": "windows",
      "localPath": "windows\\\\*",
      "depotPath": ".",
      "recursive": "1"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `depotId` | string | ✅ Yes | Steam Depot ID |
| `os` | enum | ✅ Yes | `"windows"` or `"mac"` |
| `localPath` | string | ✅ Yes | Local file pattern (supports wildcards, use `\\\\` for backslashes) |
| `depotPath` | string | ✅ Yes | Depot destination path |
| `recursive` | string | ✅ Yes | `"0"` or `"1"` |

**Note:** VDF files are generated automatically from depot configuration at runtime.

### Epic Configuration

Required when `platform` is `"epic"` or `"both"`.

```json
{
  "epic": {
    "productId": "abc123def456",
    "organizationId": "org123",
    "artifactId": "artifact123",
    "sandboxId": "sandbox123",
    "buildPatchToolPath": "C:/Users/Username/AppData/Roaming/CADET/Tools/BuildPatchTool/Engine/Binaries/Win64/BuildPatchTool.exe",
    "buildVersion": "1.0.0",
    "useGitTagForVersion": false,
    "label": "Live"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `productId` | string | ✅ Yes | Epic Product ID |
| `organizationId` | string | ✅ Yes | Epic Organization ID |
| `artifactId` | string | ✅ Yes | Epic Artifact ID |
| `sandboxId` | string | ✅ Yes | Epic Sandbox ID |
| `buildPatchToolPath` | string | ✅ Yes | Path to BuildPatchTool binary (OS-specific). Default installation: `%APPDATA%/CADET/Tools/BuildPatchTool/Engine/Binaries/Win64/BuildPatchTool.exe` (Windows) or `~/Library/Application Support/CADET/Tools/BuildPatchTool/Engine/Binaries/Mac/BuildPatchTool` (macOS) |
| `buildVersion` | string | No | Manual build version (ignored if `useGitTagForVersion` is true) |
| `useGitTagForVersion` | boolean | No | Use git tag for versioning (default: `false`) |
| `label` | string | No | Label to apply after upload (optional) |

**Version Resolution:**
- If `useGitTagForVersion` is `true`: Uses latest git tag + timestamp (e.g., `1.1.0.20251225140351`)
- If `useGitTagForVersion` is `false`: Uses `buildVersion` from profile
- If neither is set: Falls back to `0.0.0`

### macOS Configuration

Optional macOS-specific settings:

```json
{
  "macos": {
    "enableSigning": true,
    "entitlementsPath": "Tools/MacOS/MyGame.entitlements"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enableSigning` | boolean | No | Enable macOS code signing and notarization |
| `entitlementsPath` | string | No | Path to `.entitlements` file |

### Schema Validation

The CLI includes a JSON schema for validation. Add this to your profile for VS Code IntelliSense:

```json
{
  "$schema": "../CLI/cadet-profile.schema.json",
  "profileName": "MyGame-Steam-Windows",
  ...
}
```

### Example Profiles

See `Test/test_data/` for complete example profiles:
- `valid_complete.json` - Full profile with all fields
- `valid_steam_only.json` - Steam-only profile
- `valid_epic_only.json` - Epic-only profile
- `examples/mygame_profile.json` - Real-world profile

---

## Command Reference

### Main Entry Point: `dist.sh`

The `dist.sh` script is the primary entry point for all build and publish operations.

#### Basic Usage

```bash
bash Tools/CLI/dist.sh --profile-json <path> --generated-vdfs-directory <path>
```

#### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--profile-json <path>` | ✅ Yes | Path to Build Profile JSON file |
| `--generated-vdfs-directory <path>` | ✅ Yes | Directory where VDF files should be generated |
| `--build-only` | No | Build only, skip publishing and notarization (notarization will NOT run, even if `enableSigning` is true in profile) |
| `--publish-only` | No | Publish only, skip building (requires existing build) |
| `--notarize-only` | No | Notarize only, skip building and publishing (requires existing macOS build and `enableSigning` to be true in profile) |
| `--git-sync` | No | Sync project with git (clone if new, reset if existing) |
| `--mode=plugin\|enterprise` | No | License mode (default: `enterprise`) |

#### Examples

**Build and publish to Steam:**
```bash
bash Tools/CLI/dist.sh --profile-json profiles/steam-windows.json --generated-vdfs-directory generated
```

**Build only (no publishing or notarization):**
```bash
bash Tools/CLI/dist.sh --profile-json profiles/steam-windows.json --generated-vdfs-directory generated --build-only
```
> **Note:** When using `--build-only`, notarization will NOT run, even if `macos.enableSigning` is `true` in your profile. Use `--notarize-only` separately if you need to notarize after building.

**Publish only (skip building):**
```bash
bash Tools/CLI/dist.sh --profile-json profiles/steam-windows.json --generated-vdfs-directory generated --publish-only
```

**With git sync:**
```bash
bash Tools/CLI/dist.sh --profile-json profiles/steam-windows.json --generated-vdfs-directory generated --git-sync
```

**Notarize macOS build only:**
```bash
bash Tools/CLI/dist.sh --profile-json profiles/epic-macos.json --generated-vdfs-directory generated --notarize-only
```

### Build Script: `build.sh`

Builds projects for Windows and macOS.

```bash
bash Tools/CLI/build.sh --profile-json <path>
```

**Arguments:**
- `--profile-json <path>` - Path to Build Profile JSON (required)

**What it does:**
1. Validates Build Profile JSON
2. Acquires process lock (prevents concurrent builds)
3. Builds for target platform(s) and OS(es)
4. Removes debug information folders
5. Releases process lock

**Output:**
- Windows: `{buildOutputPath}/windows/{projectName}.exe`
- macOS: `{buildOutputPath}/macos/{projectName}.app`

### Steam Publishing: `Steam/publish.sh`

Publishes builds to Steam via SteamCMD.

```bash
bash Tools/CLI/Steam/publish.sh --profile-json <path> --os <windows|mac> [--generated-vdfs-directory <path>]
```

**Arguments:**
- `--profile-json <path>` - Path to Build Profile JSON (required)
- `--os <windows|mac>` - Target OS (required)
- `--generated-vdfs-directory <path>` - Directory for generated VDF files (optional)
- `--dry-run` - Print VDF files without uploading
- `--print-vdf` - Print VDF content to stdout
- `--generate-vdfs` - Generate VDF files without uploading

**What it does:**
1. Loads Steam credentials from `~/.env_cadet_steam_credentials`
2. Generates depot VDF files from profile configuration
3. Generates app build VDF file
4. Uploads to Steam via SteamCMD
5. Sets build live (if `setLive` is configured)

### Epic Publishing: `Epic/publish.sh`

Publishes builds to Epic Game Store via BuildPatchTool.

```bash
bash Tools/CLI/Epic/publish.sh --profile-json <path> --os <windows|mac>
```

**Arguments:**
- `--profile-json <path>` - Path to Build Profile JSON (required)
- `--os <windows|mac>` - Target OS (required)

**What it does:**
1. Loads Epic credentials from `~/.env_cadet_epic_credentials`
2. Resolves build version (git tag or manual)
3. Deletes existing build version (if present)
4. Uploads binary to Epic
5. Applies label (if configured)

### Steam Authentication: `Steam/auth.sh`

One-time Steam authentication setup.

```bash
bash Tools/CLI/Steam/auth.sh --profile-json <path>
```

**What it does:**
1. Loads Steam credentials from `~/.env_cadet_steam_credentials`
2. Logs into SteamCMD with Steam Guard code
3. Creates sentry file for future authentication
4. Exits

**Note:** After successful authentication, remove `STEAM_GUARD_CODE` from credentials file.

### macOS Signing: `MacOS/sign_and_upload.sh`

Signs and notarizes macOS builds.

```bash
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json <path>
```

**Options:**
- `--codesign` - Run only code signing
- `--zip` - Run only zip creation
- `--upload` - Run only upload to Apple
- `--staple` - Run only stapling
- `--check` - Run only signature verification
- `--dry-run` - Print commands without executing

**What it does:**
1. Signs all binaries and frameworks
2. Signs main app bundle
3. Creates zip file for notarization
4. Uploads to Apple notarization service
5. Staples notarization ticket
6. Verifies signature

---

## Platform-Specific Guides

### Steam Publishing

#### Prerequisites

1. **Steam App ID** - Your game's Steam App ID
2. **Steam Depot IDs** - One or more depot IDs for your game
3. **SteamCMD** - Downloaded via `Tools/CLI/Deps/download_deps.sh`
4. **Steam Credentials** - Configured in `~/.env_cadet_steam_credentials`
5. **Steam Authentication** - Run `Steam/auth.sh` once to create sentry file

#### Workflow

1. **Create Build Profile** with Steam configuration
2. **Build** project: `bash Tools/CLI/build.sh --profile-json profile.json`
3. **Publish** to Steam: `bash Tools/CLI/dist.sh --profile-json profile.json --generated-vdfs-directory generated`

#### VDF Generation

VDF (Valve Data Format) files are generated automatically from your depot configuration:

- **Depot VDFs**: `depot_build_{depotId}.vdf` - One per depot
- **App Build VDF**: `app_build_{appId}_{os}.vdf` - References all depot VDFs

#### Steam Publishing Limitations

- **OS Parameter**: Steam publishing requires explicit OS (`windows` or `mac`), not `both`
- **Multiple Platforms**: To publish both Windows and macOS, create separate profiles or run twice

#### Troubleshooting

**"Steam Guard code was invalid"**
- Run `bash Tools/CLI/Steam/auth.sh --profile-json profile.json` to create sentry file
- Remove `STEAM_GUARD_CODE` from credentials file after success

**"Another upload is already in progress"**
- Check for stale lock files: `bash Tools/CLI/Util/manage_locks.sh list`
- Clean locks: `bash Tools/CLI/Util/manage_locks.sh clean`

### Epic Game Store Publishing

#### Prerequisites

1. **Epic Product ID** - Your product's ID in Epic Developer Portal
2. **Epic Organization ID** - Your organization ID
3. **Epic Artifact ID** - Your artifact ID
4. **Epic Sandbox ID** - Your sandbox ID
5. **BuildPatchTool** - Downloaded via `Tools/CLI/Deps/download_deps.sh`
6. **Epic Credentials** - Configured in `~/.env_cadet_epic_credentials`

#### Workflow

1. **Create Build Profile** with Epic configuration
2. **Build** project: `bash Tools/CLI/build.sh --profile-json profile.json`
3. **Publish** to Epic: `bash Tools/CLI/dist.sh --profile-json profile.json --generated-vdfs-directory generated`

#### Version Management

Epic builds require a unique version string. The CLI supports two methods:

**Method 1: Git Tag (Recommended)**
```json
{
  "epic": {
    "useGitTagForVersion": true
  }
}
```

This uses the latest git tag + timestamp (e.g., `1.1.0.20251225140351`).

**Method 2: Manual Version**
```json
{
  "epic": {
    "buildVersion": "1.0.0",
    "useGitTagForVersion": false
  }
}
```

#### Labeling

After upload, you can optionally apply a label:

```json
{
  "epic": {
    "label": "Live"
  }
}
```

If `label` is empty or omitted, labeling is skipped (you can label manually in the Epic dashboard).

#### Troubleshooting

**"Build already exists"**
- The CLI automatically deletes existing builds before uploading
- If this fails, delete the build manually in the Epic dashboard

**"Labeling failed"**
- This is non-fatal - the upload succeeded, you can label manually
- Check your Epic credentials and organization permissions

---

## macOS Signing and Notarization

### Overview

macOS code signing and notarization ensures your app runs on macOS without security warnings. The process involves:

1. **Code Signing** - Sign all binaries and frameworks
2. **Notarization** - Upload to Apple for notarization
3. **Stapling** - Attach notarization ticket to app
4. **Verification** - Verify signature is valid

### Prerequisites

1. **Apple Developer Account** - Active Apple Developer Program membership
2. **Code Signing Certificate** - "Developer ID Application" certificate
3. **App-Specific Password** - Generated in Apple ID account settings
4. **Team ID** - Your Apple Developer Team ID
5. **Entitlements File** - `.entitlements` file for your app

### Configuration

Enable signing in your Build Profile:

```json
{
  "os": "mac",
  "macos": {
    "enableSigning": true,
    "entitlementsPath": "Tools/MacOS/MyGame.entitlements"
  }
}
```

### Credentials

Create `~/.env_cadet_mac_creds`:

```bash
APPLE_ID=your_apple_id@example.com
GEN_PW=your_app_specific_password
TEAM_ID=your_team_id
DEV_ID=Developer ID Application: Your Name (TEAM_ID)
BUNDLE_ID=com.yourcompany.yourapp
```

### Workflow

**Important:** Signing and notarization are NOT automatically performed during `--build-only` operations, even if `macos.enableSigning` is `true` in your profile. The `enableSigning` setting is a configuration flag only.

Signing and notarization are performed:
- During normal build-and-publish flow (when neither `--build-only` nor `--publish-only` is specified) if:
  - `os` is `"mac"` or `"both"`
  - `macos.enableSigning` is `true`
- When explicitly requested via `--notarize-only` flag

You can also run signing separately:

```bash
# Sign only
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json profile.json --codesign

# Full signing and notarization
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json profile.json

# Notarize only (after signing)
bash Tools/CLI/dist.sh --profile-json profile.json --notarize-only
```

### Manual Steps

If you need to run steps manually:

```bash
cd {buildOutputPath}/macos

# 1. Code sign
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json profile.json --codesign

# 2. Create zip
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json profile.json --zip

# 3. Upload for notarization
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json profile.json --upload

# 4. Staple
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json profile.json --staple

# 5. Verify
bash Tools/CLI/MacOS/sign_and_upload.sh --profile-json profile.json --check
```

### Troubleshooting

**"codesign failed"**
- Verify certificate is installed: `security find-identity -v -p codesigning`
- Check certificate matches `DEV_ID` in credentials file
- Ensure entitlements file exists and is valid

**"Notarization failed"**
- Check app-specific password is correct
- Verify Team ID matches your Apple Developer account
- Check notarization logs in Apple Developer Portal

**"Stapling failed"**
- Wait for notarization to complete (can take 5-30 minutes)
- Check notarization status in Apple Developer Portal

---

## Git Integration

### Overview

CADET CLI supports git integration for reproducible builds. When enabled, the CLI can:

- **Clone** repositories if they don't exist
- **Sync** existing repositories to match remote exactly
- **Reset** to specific branches
- **Clean** untracked files

### Configuration

Enable git integration in your Build Profile:

```json
{
  "useGit": true,
  "gitRepository": "https://github.com/org/repo.git",
  "gitBranch": "main",
  "build": {
    "projectPath": "/path/to/project"
  }
}
```

### Usage

Enable git sync with the `--git-sync` flag:

```bash
bash Tools/CLI/dist.sh --profile-json profile.json --generated-vdfs-directory generated --git-sync
```

### Behavior

**If `.git` folder doesn't exist:**
1. Creates project directory (if needed)
2. Clones repository from `gitRepository` to `build.projectPath`
3. Checks out `gitBranch`

**If `.git` folder exists:**
1. Fetches latest from `origin`
2. Checks out `gitBranch` (creates if doesn't exist locally)
3. Hard resets to `origin/gitBranch`
4. Cleans untracked files (preserves build-required directories)

**Important Notes:**
- Git operations run in **project directory** (`build.projectPath`), NOT in CADET CLI directory
- Uses **hard reset** - ALL local changes will be discarded
- Removes untracked files with `git clean -ffd`
- Preserves build-required directories (`Library/`, `Temp/`, `UserSettings/`)

### Git Sync Auto-Enable

If `useGit` is `true` in your profile, git sync is automatically enabled unless:
- `--publish-only` is used (git sync only needed for builds)
- `--notarize-only` is used (git sync only needed for builds)

### Windows Git Configuration

On Windows, the CLI uses Git Bash's `git.exe` (not Cosmos git) for proper credential manager support. The profile can specify a custom path:

```json
{
  "gitBashPath": "C:/Program Files/Git/bin/git.exe"
}
```

If not specified, defaults to `C:/Program Files/Git/bin/git.exe`.

---

## Process Locks

### Overview

CADET CLI uses process locks to prevent concurrent operations that could cause conflicts:

- **Build Locks** - Prevents multiple builds of the same project
- **SteamCMD Locks** - Prevents multiple Steam uploads to the same app

### Lock Files

Locks are stored in `Tools/.locks/` (or `CLI/.locks/` when deployed):

- `build_{projectName}.lock` - Build lock
- `steamcmd_{appId}.lock` - Steam upload lock

### Managing Locks

**List all locks:**
```bash
bash Tools/CLI/Util/manage_locks.sh list
```

**Clean stale locks:**
```bash
bash Tools/CLI/Util/manage_locks.sh clean
```

**Remove specific lock:**
```bash
rm Tools/.locks/build_MyGame.lock
rm Tools/.locks/steamcmd_3155820.lock
```

### Lock Behavior

- **Automatic Acquisition**: Locks are acquired automatically at the start of operations
- **Automatic Release**: Locks are released on exit (success or failure)
- **Signal Handling**: Locks are released on SIGTERM/SIGINT (Ctrl+C)
- **Stale Lock Detection**: Locks contain process IDs - stale locks are detected automatically

### Troubleshooting

**"Another build/upload is already in progress"**

This error means a lock file exists. Possible causes:

1. **Legitimate**: Another build/upload is actually running
2. **Stale Lock**: Previous build crashed and didn't release lock

**Solution:**
```bash
# Check if process is actually running
bash Tools/CLI/Util/manage_locks.sh list

# If lock is stale, clean it
bash Tools/CLI/Util/manage_locks.sh clean
```

---

## Troubleshooting

### Common Issues

#### "JSON file not found"

**Problem:** Profile JSON path is incorrect or file doesn't exist.

**Solution:**
- Use absolute paths if relative paths don't work
- Verify file exists: `ls -la path/to/profile.json`
- Check path in command: `--profile-json path/to/profile.json`

#### "Required field missing"

**Problem:** Build Profile JSON is missing required fields.

**Solution:**
- Check JSON schema: `Tools/CLI/cadet-profile.schema.json`
- Validate JSON: `jq empty profile.json`
- Review example profiles: `Test/test_data/valid_complete.json`

#### "SteamCMD not found"

**Problem:** SteamCMD is not installed or path is incorrect.

**Solution:**
```bash
# Download dependencies (installs to user directory)
bash Tools/CLI/Deps/download_deps.sh

# Verify SteamCMD exists
# Windows
ls "%APPDATA%/CADET/Tools/steamcmd/steamcmd.exe"
# macOS
ls ~/Library/Application\ Support/CADET/Tools/steamcmd/steamcmd.sh
# Linux
ls ~/.local/bin/CADET/Tools/steamcmd/steamcmd.sh
```

#### "Steam Guard code was invalid"

**Problem:** Steam Guard code expired or sentry file is missing.

**Solution:**
```bash
# Re-authenticate
bash Tools/CLI/Steam/auth.sh --profile-json profile.json

# Remove STEAM_GUARD_CODE from credentials file after success
```

#### "Another build/upload is already in progress"

**Problem:** Process lock exists (stale or legitimate).

**Solution:**
```bash
# Check locks
bash Tools/CLI/Util/manage_locks.sh list

# Clean stale locks
bash Tools/CLI/Util/manage_locks.sh clean
```

#### "Build failed"

**Problem:** Build exited with non-zero code.

**Solution:**
- Check build log: `{buildOutputPath}/{os}/build.log`
- Verify editor path is correct
- Check project path exists
- Ensure project is valid

#### "Epic build version is empty"

**Problem:** Version resolution failed.

**Solution:**
- If using git tags: Ensure repository has tags and `build.projectPath` is correct
- If using manual version: Set `epic.buildVersion` in profile
- Check git is accessible: `cd {build.projectPath} && git describe --tags`

#### "macOS signing failed"

**Problem:** Code signing or notarization failed.

**Solution:**
- Verify certificate: `security find-identity -v -p codesigning`
- Check credentials file: `~/.env_cadet_mac_creds`
- Verify entitlements file exists
- Check notarization logs in Apple Developer Portal

### Debug Mode

Enable verbose logging by setting environment variables:

```bash
# Enable debug logging
export CADET_DEBUG=1

# Run command
bash Tools/CLI/dist.sh --profile-json profile.json --generated-vdfs-directory generated
```

### Log Files

Log files are created in build output directories:

- **Build Log**: `{buildOutputPath}/{os}/build.log`
- **Steam Upload Log**: Checked via SteamCMD output
- **Epic Upload Log**: Checked via BuildPatchTool output

---

## Advanced Usage

### Custom Build Profiles

Create multiple profiles for different scenarios:

```bash
profiles/
├── steam-public.json      # Public Steam release
├── steam-beta.json        # Steam beta branch
├── epic-main.json         # Epic main release
└── both-windows.json      # Both platforms, Windows only
```

### CI/CD Integration

> **Note:** This section provides detailed CI/CD examples. For the initial cloud environment setup overview, see [Cloud Environment Setup](#cloud-environment-setup).

The CLI is designed for CI/CD environments. **In CI/CD, credentials are provided via environment variables, NOT credential files.**

#### Credential Sources

The CLI checks for credentials in this order:
1. **Environment variables** (used in CI/CD)
2. **Credential files** (used for local development)

If environment variables are set, credential files are ignored.

#### Required Environment Variables

**For Steam:**
- `STEAM_USERNAME` - Your Steam username
- `STEAM_PASSWORD` - Your Steam password
- `STEAM_GUARD_CODE` - Optional (only needed if sentry file doesn't exist)

**For Epic:**
- `CLIENT_ID` - Epic client ID
- `CLIENT_SECRET` - Epic client secret

**For macOS Signing:**
- `APPLE_ID` - Apple ID email
- `GEN_PW` - App-specific password
- `TEAM_ID` - Apple Developer Team ID
- `DEV_ID` - Developer ID certificate name

#### GitHub Actions Example

```yaml
- name: Build and Publish
  run: |
    bash Tools/CLI/dist.sh \
      --profile-json profiles/steam-windows.json \
      --generated-vdfs-directory generated \
      --git-sync
  env:
    # Steam credentials (set in GitHub Secrets)
    STEAM_USERNAME: ${{ secrets.STEAM_USERNAME }}
    STEAM_PASSWORD: ${{ secrets.STEAM_PASSWORD }}
    # Epic credentials (set in GitHub Secrets)
    CLIENT_ID: ${{ secrets.EPIC_CLIENT_ID }}
    CLIENT_SECRET: ${{ secrets.EPIC_CLIENT_SECRET }}
```

**Setup:**
1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets:
   - `STEAM_USERNAME`
   - `STEAM_PASSWORD`
   - `EPIC_CLIENT_ID`
   - `EPIC_CLIENT_SECRET`

#### GitLab CI Example

```yaml
build_and_publish:
  script:
    - bash Tools/CLI/dist.sh
        --profile-json profiles/steam-windows.json
        --generated-vdfs-directory generated
        --git-sync
  variables:
    STEAM_USERNAME: $STEAM_USERNAME
    STEAM_PASSWORD: $STEAM_PASSWORD
    CLIENT_ID: $CLIENT_ID
    CLIENT_SECRET: $CLIENT_SECRET
```

**Setup:**
1. Go to your GitLab project → Settings → CI/CD → Variables
2. Add the following variables (mark as "Masked" and "Protected"):
   - `STEAM_USERNAME`
   - `STEAM_PASSWORD`
   - `CLIENT_ID`
   - `CLIENT_SECRET`

#### Jenkins Example

```groovy
pipeline {
    agent any
    environment {
        STEAM_USERNAME = credentials('steam-username')
        STEAM_PASSWORD = credentials('steam-password')
        CLIENT_ID = credentials('epic-client-id')
        CLIENT_SECRET = credentials('epic-client-secret')
    }
    stages {
        stage('Build and Publish') {
            steps {
                sh '''
                    bash Tools/CLI/dist.sh \
                        --profile-json profiles/steam-windows.json \
                        --generated-vdfs-directory generated \
                        --git-sync
                '''
            }
        }
    }
}
```

**Setup:**
1. Go to Jenkins → Manage Jenkins → Credentials
2. Add credentials with IDs: `steam-username`, `steam-password`, `epic-client-id`, `epic-client-secret`

#### Azure DevOps Example

```yaml
- task: Bash@3
  displayName: 'Build and Publish'
  inputs:
    targetType: 'inline'
    script: |
      bash Tools/CLI/dist.sh \
        --profile-json profiles/steam-windows.json \
        --generated-vdfs-directory generated \
        --git-sync
  env:
    STEAM_USERNAME: $(STEAM_USERNAME)
    STEAM_PASSWORD: $(STEAM_PASSWORD)
    CLIENT_ID: $(CLIENT_ID)
    CLIENT_SECRET: $(CLIENT_SECRET)
```

**Setup:**
1. Go to your Pipeline → Edit → Variables
2. Add the following variables (mark as "Keep this value secret"):
   - `STEAM_USERNAME`
   - `STEAM_PASSWORD`
   - `CLIENT_ID`
   - `CLIENT_SECRET`

#### Important Notes

- **Never commit credentials** to version control
- **Use secret management** features of your CI/CD platform
- **Environment variables take precedence** over credential files
- **Credential files are ignored** when environment variables are present
- For **Steam**, ensure sentry file is created first (run `auth.sh` locally or provide `STEAM_GUARD_CODE` on first run)

### Dry Run Mode

Test VDF generation without uploading:

```bash
# Steam: Generate VDF files only
bash Tools/CLI/Steam/publish.sh \
  --profile-json profile.json \
  --os windows \
  --generated-vdfs-directory generated \
  --generate-vdfs

# Print VDF content
bash Tools/CLI/Steam/publish.sh \
  --profile-json profile.json \
  --os windows \
  --print-vdf
```

### Version Management

Use git tags for automatic versioning:

```bash
# Tag your release
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0

# Build will use tag + timestamp
bash Tools/CLI/dist.sh --profile-json profile.json --generated-vdfs-directory generated
```

### Multi-Platform Builds

Build for multiple platforms:

```json
{
  "platform": "both",
  "os": "both"
}
```

This will:
1. Build Windows and macOS
2. Publish to Steam (Windows and macOS)
3. Publish to Epic (Windows and macOS)

**Note:** Steam publishing requires separate runs for Windows and macOS (Steam doesn't support `os: "both"` in publishing).

### Environment Variables

Override profile settings with environment variables:

```bash
# Override editor path
export EDITOR_PATH="/custom/path/to/editor.exe"

# Override Steam App ID
export STEAM_APP_ID="9999999"

# Run build
bash Tools/CLI/dist.sh --profile-json profile.json --generated-vdfs-directory generated
```

### License Modes

The CLI supports two license modes:

- **Enterprise** (default): Full feature set, no restrictions
- **Plugin**: Limited features, requires Enterprise License in CI/CD

```bash
# Use plugin mode
bash Tools/CLI/dist.sh \
  --profile-json profile.json \
  --generated-vdfs-directory generated \
  --mode=plugin
```

---

## Support

For issues, questions, or contributions, please refer to the project repository.

**Last Updated:** 2026
