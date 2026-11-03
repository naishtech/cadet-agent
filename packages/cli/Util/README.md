# CADET CLI Library

Shared utilities and schemas for CADET CLI scripts.

---

## Environment Requirements

### Git Configuration (for `--git-pull`)
Cosmos git requires `GIT_EXEC_PATH` to find helper commands:
- **Automatically set** in `dist.sh` from Cosmos binaries location (user directory or deployed location)
- **Manual setup** (if running scripts outside `dist.sh`):
  ```bash
  export GIT_EXEC_PATH="/path/to/cosmos-4.0.2~/libexec/git-core"
  ```
  Note: Cosmos binaries are typically installed to user directory (Windows: `%APPDATA%/CADET/Tools/cosmos-4.0.2~/`, macOS: `~/Library/Application Support/CADET/Tools/cosmos-4.0.2~/`, Linux: `~/.local/bin/CADET/Tools/cosmos-4.0.2~/`)

### Steam Authentication (First-Time Setup)

**SteamCMD uses sentry files** for persistent authentication. After the first successful login with Steam Guard, you won't need the code again.

**One-Time Setup (Recommended Method):**

1. Download dependencies:
   ```bash
   bash Tools/CLI/Deps/download_deps.sh
   ```

2. Get a fresh Steam Guard code from your email

3. Create `~/.env_dolven_build_steam`:
   ```bash
   STEAM_USERNAME="your_username"
   STEAM_PASSWORD="your_password"
   STEAM_GUARD_CODE="ABC12"  # Fresh code from email (use within 5 min)
   ```

4. Run the authentication setup script:
   ```bash
   bash Tools/Steam/auth.sh --profile-json profile.json
   ```

5. After successful authentication, edit `~/.env_dolven_build_steam` and remove the Steam Guard code:
   ```bash
   STEAM_USERNAME="your_username"
   STEAM_PASSWORD="your_password"
   # STEAM_GUARD_CODE=  # Not needed - uses sentry file
   ```

**What Happens:**
- ✅ Sentry file created in SteamCMD directory (from build profile JSON, typically user directory)
- ✅ Future builds automatically use the sentry file
- ✅ No more Steam Guard codes required!

**Subsequent Builds:**

All builds will use the cached sentry file for authentication:
```bash
bash dist.sh --profile-json profile.json          # Build + Publish
bash dist.sh --profile-json profile.json --build-only     # Build only
bash dist.sh --profile-json profile.json --publish-only   # Publish only
```

---

## Files

### `json_parser.sh`
Bash utilities for parsing and validating CADET Build Profile JSON files.

**Functions:**
- `get_json_value(json_file, json_path)` - Extract value from JSON
- `validate_json_structure(json_file)` - Validate profile structure
- `load_profile_json(json_file)` - Load profile into environment variables

**Usage:**
```bash
source "$PROJECT_ROOT/Tools/CLI/Util/json_parser.sh"

if load_profile_json "$PROFILE_JSON"; then
    echo "Platform: $PROFILE_PLATFORM"
    echo "OS: $PROFILE_OS"
fi
```

---

### `cadet-profile.schema.json`
JSON Schema definition for CADET Build Profile files.

**Schema URL:** `https://cadet-cli.local/schemas/profile.json`

**Usage with VS Code:**
Add to your profile JSON:
```json
{
  "$schema": "../CLI/cadet-profile.schema.json",
  "profileName": "My Profile",
  ...
}
```

---

## Build Profile JSON Reference

### Minimal Profile (Steam Windows)
```json
{
  "profileName": "Steam-Windows",
  "platform": "steam",
  "os": "windows",
  "unity": {
    "editorPath": "/path/to/Unity.exe",
    "projectPath": "/path/to/project",
    "buildOutputPath": "/path/to/builds",
    "projectName": "MyGame"
  },
  "steam": {
    "appId": "1234567",
    "steamcmdExe": "steamcmd/steamcmd.exe",
    "steamcmdSh": "steamcmd/steamcmd.sh",
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

---

## Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `profileName` | string | ✅ Yes | - | Human-readable profile name |
| `platform` | enum | ✅ Yes | - | `"steam"`, `"epic"`, or `"both"` |
| `os` | enum | ✅ Yes | - | `"windows"`, `"mac"`, or `"both"` |
| `buildOnly` | boolean | No | `false` | Build without publishing |
| `gitBranch` | string | No | - | Git branch for `--git-pull` operations |

### Git Operations

The `gitBranch` field enables version control integration **on the Unity project directory**:

```json
{
  "gitBranch": "main",
  "unity": {
    "projectPath": "/path/to/unity/project"
  }
}
```

**Usage:**
```bash
# With --git-pull flag, performs git operations in Unity project directory:
# 1. cd <unity.projectPath>
# 2. git fetch origin
# 3. git checkout <gitBranch>
# 4. git reset --hard origin/<gitBranch>
# 5. git clean -fd (remove untracked files)
# 6. cd back to CADET directory
bash dist.sh --profile-json profile.json --git-pull
```

**⚠️ Important:** 
- Git operations run in the **Unity project directory** (`unity.projectPath`), NOT in the CADET CLI directory
- Uses **hard reset** to ensure clean state - ALL local changes will be discarded
- Removes untracked files with `git clean -fd`
- This ensures reproducible builds from a known git state

**Behavior:**
- If `gitBranch` is **specified** and `--git-pull` flag is used → performs git operations on Unity project
- If `gitBranch` is **omitted** and `--git-pull` flag is used → skips git operations with warning
- If `--git-pull` flag is **not used** → skips git operations (uses local changes)

---

## Unity Configuration

```json
{
  "unity": {
    "editorPath": "/Applications/Unity/Hub/Editor/2022.3.0f1/Unity.app",
    "projectPath": "/path/to/project",
    "buildOutputPath": "/path/to/builds",
    "projectName": "MyGame"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `editorPath` | string | ✅ Yes | Absolute path to Unity Editor |
| `projectPath` | string | ✅ Yes | Absolute path to Unity project |
| `buildOutputPath` | string | ✅ Yes | Absolute path to build output |
| `projectName` | string | ✅ Yes | Project name (used as executable name) |

---

## Steam Configuration

Required when `platform` is `"steam"` or `"both"`.

```json
{
  "steam": {
    "appId": "1234567",
    "steamcmdExe": "steamcmd/steamcmd.exe",
    "steamcmdSh": "steamcmd/steamcmd.sh",
    "setLive": "beta",
    "contentRoot": "../../Bin",
    "buildOutput": "../../Bin/build",
    "depots": [...]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appId` | string | ✅ Yes | Steam App ID |
| `steamcmdExe` | string | ✅ Yes | Path to `steamcmd.exe` (Windows) |
| `steamcmdSh` | string | ✅ Yes | Path to `steamcmd.sh` (macOS/Linux) |
| `setLive` | string | No | - | Steam branch to set live |
| `contentRoot` | string | ✅ Yes | Content root path (relative to SteamCMD) |
| `buildOutput` | string | ✅ Yes | Build output path (relative to SteamCMD) |
| `depots` | array | ✅ Yes | List of depot configurations |

### Steam Depots

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
| `localPath` | string | ✅ Yes | Local file pattern (supports wildcards) |
| `depotPath` | string | ✅ Yes | Depot destination path |
| `recursive` | string | ✅ Yes | `"0"` or `"1"` |

**Note:** VDF files are generated automatically from depot configuration at runtime.

---

## Epic Configuration

Required when `platform` is `"epic"` or `"both"`.

```json
{
  "epic": {
    "productId": "abc123def456",
    "organizationId": "org123",
    "artifactId": "artifact123",
    "sandboxId": "sandbox123",
    "buildPatchToolPath": "BuildPatchTool"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `productId` | string | ✅ Yes | Epic Product ID |
| `organizationId` | string | ✅ Yes | Epic Organization ID |
| `artifactId` | string | ✅ Yes | Epic Artifact ID |
| `sandboxId` | string | ✅ Yes | Epic Sandbox ID |
| `buildPatchToolPath` | string | ✅ Yes | Path to BuildPatchTool directory |

---

## macOS Configuration

Optional macOS-specific settings.

```json
{
  "macos": {
    "enableSigning": true,
    "entitlementsPath": "Tools/MacOS/Dolven.entitlements"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enableSigning` | boolean | No | Enable macOS code signing and notarization (requires `os: "mac"` and credentials) |
| `entitlementsPath` | string | No | Path to .entitlements file |

---

## Credentials (Separate Files)

Credentials are **never** stored in Build Profile JSON. They are stored in user-specific files:

- **Steam**: `$HOME/.env_dolven_build_steam`
  ```bash
  STEAM_USERNAME=your_username
  STEAM_PASSWORD=your_password
  STEAM_GUARD_CODE=your_code
  ```

- **Epic**: `$HOME/.env_cadet_epic_credentials`
  ```bash
  CLIENT_ID=your_client_id
  CLIENT_SECRET=your_client_secret
  ```

---

## Validation

The `json_parser.sh` validates:
- ✅ JSON syntax
- ✅ Required fields present
- ✅ Valid enum values
- ✅ Platform-specific requirements (e.g., `steam` object when `platform: "steam"`)

---

## Examples

See complete examples in:
- `Test/test_data/valid_complete.json` - Full profile with all fields
- `Test/test_data/dolven/dolven_3155821_profile.json` - Real-world profile
- `Test/test_data/valid_steam_only.json` - Steam-only profile

---

## Schema Validation Tools

### VS Code
Install JSON Schema extension and add `$schema` field to your profile:
```json
{
  "$schema": "../CLI/cadet-profile.schema.json"
}
```

### Command Line (with `jq`)
```bash
# Validate JSON syntax
jq empty profile.json

# Check required fields
bash -c 'source Tools/CLI/Util/json_parser.sh; validate_json_structure profile.json'
```

---

## Migration from Legacy .env Files

CADET CLI no longer supports `.env` files for configuration. Migrate using:

**Old (.env):**
```bash
PLATFORM=steam
OS=windows
```

**New (JSON):**
```json
{
  "platform": "steam",
  "os": "windows"
}
```

See `Doc/Refactor/CadetCLI.md` for complete migration guide.

