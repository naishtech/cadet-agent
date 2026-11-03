#!/bin/bash

#================================================================
# Unreal Windows Build Adapter
#================================================================
# Builds Unreal projects using RunUAT BuildCookRun.
# Windows-only in v1.
#
# Usage:
#   bash Tools/CLI/Unreal/build.sh --profile-json <path> [--dry-run]

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$CLI_DIR/../.." && pwd)"

source "$CLI_DIR/Util/json_parser.sh"
source "$CLI_DIR/Util/process_lock.sh"
source "$CLI_DIR/Util/logging.sh"

PROFILE_JSON=""
DRY_RUN=false
UNREAL_LOG_WATCHER_PID=""

# Cosmos-aware mkdir wrapper
mkdir_p() {
  if command -v mkdir.ape >/dev/null 2>&1; then
    mkdir.ape -p "$@"
  else
    mkdir -p "$@"
  fi
}

# Cosmos-aware cp wrapper
copy_file() {
  local src="$1"
  local dst="$2"
  if command -v cp.ape >/dev/null 2>&1; then
    cp.ape -f "$src" "$dst"
  else
    cp -f "$src" "$dst"
  fi
}

is_absolute_path() {
  local path="$1"
  if [[ "$path" == /* ]]; then
    return 0
  fi
  if [[ "$path" =~ ^[A-Za-z]:[/\\] ]]; then
    return 0
  fi
  return 1
}

normalize_path() {
  local p="$1"
  if is_absolute_path "$p"; then
    echo "$p"
  else
    echo "$PROJECT_ROOT/$p"
  fi
}

resolve_project_stem() {
  local project_path="$1"
  local project_stem
  project_stem="$(basename "$project_path")"
  project_stem="${project_stem%.uproject}"
  echo "$project_stem"
}

resolve_editor_target_base() {
  local project_name="$1"
  local project_path="$2"
  local project_stem
  project_stem="$(resolve_project_stem "$project_path")"

  if [ -n "$project_name" ]; then
    echo "$project_name"
  else
    echo "$project_stem"
  fi
}

ensure_editor_target_receipt() {
  local synced_project_dir="$1"
  local project_name="$2"
  local project_path="$3"
  local project_stem
  project_stem="$(resolve_project_stem "$project_path")"
  local editor_target_base
  editor_target_base="$(resolve_editor_target_base "$project_name" "$project_path")"

  mkdir_p "$synced_project_dir/Binaries/Win64"

  # The detached runner executes from the host project plugin directory
  # (for example <GameProject>/Plugins/CadetBuild/CLI/Unreal). If the synced
  # workspace is missing the editor receipt, copy it from the host project.
  local host_project_dir
  host_project_dir="$(cd "$SCRIPT_DIR/../../../../" 2>/dev/null && pwd || true)"

  local synced_receipt="$synced_project_dir/Binaries/Win64/${editor_target_base}Editor.target"
  if [ -f "$synced_receipt" ]; then
    log_build "[BUILD] Editor target receipt present: $synced_receipt"
    return 0
  fi

  local host_receipt="$host_project_dir/Binaries/Win64/${editor_target_base}Editor.target"
  if [ -n "$host_project_dir" ] && [ -f "$host_receipt" ] && [ "$host_receipt" != "$synced_receipt" ]; then
    copy_file "$host_receipt" "$synced_receipt"
    log_build "[BUILD] Copied missing editor receipt from host project"
    log_build "[BUILD]  Source: $host_receipt"
    log_build "[BUILD]  Dest:   $synced_receipt"
    return 0
  fi

  if [ "$project_stem" != "$editor_target_base" ]; then
    local legacy_synced_receipt="$synced_project_dir/Binaries/Win64/${project_stem}Editor.target"
    local legacy_host_receipt="$host_project_dir/Binaries/Win64/${project_stem}Editor.target"
    if [ -f "$legacy_synced_receipt" ]; then
      log_build "[BUILD] Found project-stem editor receipt, but expected target receipt is still missing"
      log_build "[BUILD]  Present:  $legacy_synced_receipt"
      log_build "[BUILD]  Missing:  $synced_receipt"
    elif [ -n "$host_project_dir" ] && [ -f "$legacy_host_receipt" ]; then
      log_build "[BUILD] Host project has only the project-stem editor receipt"
      log_build "[BUILD]  Host legacy receipt: $legacy_host_receipt"
      log_build "[BUILD]  Expected receipt:    $host_receipt"
    fi
  fi

  log_build "[BUILD] FAIL: Missing expected editor receipt for target '$editor_target_base'"
  log_build "[BUILD] FAIL: Host project dir checked: $host_project_dir"
  echo "[ERR] Missing editor target receipt for '$editor_target_base' in synced workspace and host project." >&2
  return 1
}

start_log_watcher() {
  local log_file="$1"

  (
    tail -n 0 -f "$log_file" 2>/dev/null | while IFS= read -r line; do
      [ -z "$line" ] && continue
      log_build "UnrealLog: $line"
    done
  ) &

  UNREAL_LOG_WATCHER_PID=$!
}

stop_log_watcher() {
  if [ -n "$UNREAL_LOG_WATCHER_PID" ]; then
    kill "$UNREAL_LOG_WATCHER_PID" >/dev/null 2>&1 || true
    wait "$UNREAL_LOG_WATCHER_PID" 2>/dev/null || true
    UNREAL_LOG_WATCHER_PID=""
  fi
}

run_uat_command() {
  local command_line="$1"
  local log_file="$2"

  log_build "[UAT] Executing RunUAT.bat with BuildCookRun"
  log_build "[UAT] Log file: $log_file"
  
  : > "$log_file"
  start_log_watcher "$log_file"

  # Write the command to a temp .bat file and execute that.
  # Calling cmd.exe /c "$command_line" from MSYS/Git Bash causes MSYS to escape embedded
  # double-quote characters as \" in the Win32 cmdline, making cmd.exe fail to find the
  # executable. Using a .bat file sidesteps all MSYS quoting issues entirely.
  local tmp_bat
  tmp_bat="$(mktemp --suffix=.bat 2>/dev/null || mktemp)"
  printf '@echo off\r\n%s\r\n' "$command_line" > "$tmp_bat"
  local tmp_bat_win
  tmp_bat_win="$(cygpath -w "$tmp_bat" 2>/dev/null || echo "${tmp_bat//\//\\}")"

  set +e
  log_build "[UAT] Running (via temp bat): $command_line"
  log_build "[UAT] Temp bat: $tmp_bat_win"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "$tmp_bat_win" >> "$log_file" 2>&1
  local exit_code=$?
  set -e
  rm -f "$tmp_bat" 2>/dev/null || true

  stop_log_watcher

  if [ $exit_code -eq 0 ]; then
    log_build "[UAT] BuildCookRun succeeded (exit code 0)"
  else
    log_build "[UAT] FAIL: BuildCookRun failed with exit code $exit_code"
    log_build "[UAT] Last 30 lines of output:"
    tail -n 30 "$log_file" 2>/dev/null | while IFS= read -r line; do
      log_build "[UAT]  $line"
    done
  fi

  return $exit_code
}

#----------------------------------------------------------------
# MCP / conflicting plugin management
#----------------------------------------------------------------
# The cooker (UnrealEditor.exe -run=cook) loads all project plugins.
# If a plugin starts an HTTP server on a fixed port (e.g. UnrealMCP on
# 8000), it conflicts with an already-running editor on the same machine.
# Temporarily disable such plugins in the synced .uproject before cooking
# and restore the original after the build finishes.

# Comma-separated list of plugin names to disable before cooking.
# Override via CADET_DISABLE_PLUGINS env var in the Build Profile or
# the caller's environment.
MCP_PLUGIN_LIST="${CADET_DISABLE_PLUGINS:-UnrealMCP}"
UPROJECT_BACKUP=""

disable_conflicting_plugins() {
  local uproject="$1"
  local plugin_list="$2"

  if [ -z "$plugin_list" ]; then
    return 0
  fi

  if [ ! -f "$uproject" ]; then
    log_build "[BUILD] WARNING: Cannot disable plugins - uproject not found: $uproject"
    return 0
  fi

  UPROJECT_BACKUP="${uproject}.cadet-backup"
  cp "$uproject" "$UPROJECT_BACKUP" || {
    log_build "[BUILD] WARNING: Failed to backup uproject, skipping plugin disable"
    UPROJECT_BACKUP=""
    return 0
  }

  local mod_count=0
  IFS=',' read -ra PLUGINS <<< "$plugin_list"
  for plugin_name in "${PLUGINS[@]}"; do
    plugin_name="${plugin_name## }"  # trim leading space
    plugin_name="${plugin_name%% }"  # trim trailing space
    [ -z "$plugin_name" ] && continue

    if "$JQ_CMD" -e ".Plugins[] | select(.Name == \"$plugin_name\")" "$uproject" >/dev/null 2>&1; then
      "$JQ_CMD" "(.Plugins[] | select(.Name == \"$plugin_name\") | .Enabled) = false" "$UPROJECT_BACKUP" > "$uproject"
      log_build "[BUILD] Disabled plugin '$plugin_name' in synced uproject"
    else
      "$JQ_CMD" ".Plugins += [{\"Name\": \"$plugin_name\", \"Enabled\": false}]" "$UPROJECT_BACKUP" > "$uproject"
      log_build "[BUILD] Added '$plugin_name' as disabled in synced uproject"
    fi
    mod_count=$((mod_count + 1))
  done

  if [ "$mod_count" -gt 0 ]; then
    log_build "[BUILD] Disabled $mod_count plugin(s) for cooker isolation"
  fi
}

restore_conflicting_plugins() {
  if [ -n "$UPROJECT_BACKUP" ] && [ -f "$UPROJECT_BACKUP" ]; then
    local target="${UPROJECT_BACKUP%.cadet-backup}"
    mv "$UPROJECT_BACKUP" "$target"
    log_build "[BUILD] Restored original uproject after build"
    UPROJECT_BACKUP=""
  fi
}

#----------------------------------------------------------------
# Packaging INI override management
#----------------------------------------------------------------
# Appends +MapsToCook / +DirectoriesToNeverCook entries from the
# override INI to the workspace's DefaultGame.ini before cooking.
# This restricts which maps are included in the packaged build.
# Restores the original DefaultGame.ini after the build completes.

PACKAGING_INI_BACKUP=""

apply_packaging_override() {
  local uproject="$1"
  local override_ini="$2"

  if [ -z "$override_ini" ]; then
    return 0  # No override = full build, cook everything
  fi

  local override_abs
  override_abs=$(normalize_path "$override_ini")
  if [ ! -f "$override_abs" ]; then
    log_build "[BUILD] WARNING: packagingIniOverride not found: $override_abs"
    return 0
  fi

  local project_dir
  project_dir="$(dirname "$uproject")"
  local target_ini="$project_dir/Config/DefaultGame.ini"

  if [ ! -f "$target_ini" ]; then
    log_build "[BUILD] WARNING: DefaultGame.ini not found: $target_ini"
    return 0
  fi

  PACKAGING_INI_BACKUP="${target_ini}.cadet-packaging-backup"
  cp "$target_ini" "$PACKAGING_INI_BACKUP"

  # Append all packaging lines from the override to the workspace config
  # (includes both +MapsToCook and +DirectoriesToNeverCook entries)
  grep -E '^[+-](MapsToCook|DirectoriesToNeverCook)=' "$override_abs" >> "$target_ini" || true
  log_build "[BUILD] Appended packaging overrides from $override_abs"
}

restore_packaging_override() {
  if [ -n "$PACKAGING_INI_BACKUP" ] && [ -f "$PACKAGING_INI_BACKUP" ]; then
    local target="${PACKAGING_INI_BACKUP%.cadet-packaging-backup}"
    mv "$PACKAGING_INI_BACKUP" "$target"
    log_build "[BUILD] Restored original DefaultGame.ini after build"
    PACKAGING_INI_BACKUP=""
  fi
}

normalize_windows_artifact() {
  local project_name="$1"
  local build_output="$2"
  local archive_output="$3"

  local canonical_dir="$build_output/windows/WindowsNoEditor"
  local canonical_exe="$canonical_dir/$project_name.exe"

  mkdir_p "$canonical_dir"

  if [ -f "$canonical_exe" ]; then
    log_build "Canonical artifact already exists: $canonical_exe"
    return 0
  fi

  local found=""

  if [ -d "$archive_output" ]; then
    found=$(find "$archive_output" -type f -name "$project_name.exe" 2>/dev/null | head -n 1 || true)
  fi

  if [ -z "$found" ] && [ -d "$build_output" ]; then
    found=$(find "$build_output" -type f -name "$project_name.exe" 2>/dev/null | head -n 1 || true)
  fi

  if [ -z "$found" ]; then
    echo "[ERR] Failed to locate built executable for normalization: $project_name.exe" >&2
    return 1
  fi

  copy_file "$found" "$canonical_exe"
  log_build "Normalized artifact to canonical path: $canonical_exe"

  if [ ! -f "$canonical_exe" ]; then
    echo "[ERR] Canonical artifact missing after normalization: $canonical_exe" >&2
    return 1
  fi

  return 0
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile-json)
      if [ $# -lt 2 ]; then
        echo "[ERR] --profile-json requires a value" >&2
        exit 1
      fi
      PROFILE_JSON="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 --profile-json <path> [--dry-run]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Use -h or --help for usage information" >&2
      exit 1
      ;;
  esac
done

if [ -z "$PROFILE_JSON" ]; then
  echo "[ERR] --profile-json is required" >&2
  exit 1
fi

show_cadet_pro_banner

log_build "[BUILD] Input profile JSON: $PROFILE_JSON"
if [ -f "$PROFILE_JSON" ]; then
  log_build "[BUILD] Profile file exists ($(stat -f%z "$PROFILE_JSON" 2>/dev/null || stat -c%s "$PROFILE_JSON" 2>/dev/null || echo "size unknown") bytes)"
else
  echo "[ERR] Profile JSON file not found: $PROFILE_JSON" >&2
  exit 1
fi

log_build "[BUILD] Validating JSON structure..."
if ! validate_json_structure "$PROFILE_JSON"; then
  log_build "[BUILD] FAIL: JSON validation failed"
  exit 1
fi
log_build "[BUILD] JSON structure valid"

log_build "[BUILD] Loading profile JSON..."
if ! load_profile_json "$PROFILE_JSON"; then
  log_build "[BUILD] FAIL: Failed to load profile JSON"
  exit 1
fi
log_build "[BUILD] Profile JSON loaded"

# Required Unreal fields
log_build "[BUILD] Validating required profile fields..."
if [ -z "${UNREAL_ENGINE_ROOT:-}" ]; then
  log_build "[BUILD] FAIL: Missing field: unreal.engineRoot"
  echo "[ERR] Required field missing: unreal.engineRoot" >&2
  exit 1
fi
log_build "[BUILD] unreal.engineRoot = $UNREAL_ENGINE_ROOT"

if [ -z "${UNREAL_PROJECT_PATH:-}" ]; then
  log_build "[BUILD] FAIL: Missing field: unreal.projectPath"
  echo "[ERR] Required field missing: unreal.projectPath" >&2
  exit 1
fi
log_build "[BUILD] unreal.projectPath = $UNREAL_PROJECT_PATH"

if [ -z "${UNREAL_BUILD_OUTPUT_PATH:-}" ]; then
  log_build "[BUILD] FAIL: Missing field: unreal.buildOutputPath"
  echo "[ERR] Required field missing: unreal.buildOutputPath" >&2
  exit 1
fi
log_build "[BUILD] unreal.buildOutputPath = $UNREAL_BUILD_OUTPUT_PATH"

if [ -z "${UNREAL_PROJECT_NAME:-}" ]; then
  log_build "[BUILD] FAIL: Missing field: unreal.projectName"
  echo "[ERR] Required field missing: unreal.projectName" >&2
  exit 1
fi
log_build "[BUILD] unreal.projectName = $UNREAL_PROJECT_NAME"

if [ -z "${UNREAL_BUILD_CONFIGURATION:-}" ]; then
  log_build "[BUILD] FAIL: Missing field: unreal.buildConfiguration"
  echo "[ERR] Required field missing: unreal.buildConfiguration" >&2
  exit 1
fi
log_build "[BUILD] unreal.buildConfiguration = $UNREAL_BUILD_CONFIGURATION"

# Enforce Windows-only in v1
log_build "[BUILD] Checking OS requirement..."
if [ "${PROFILE_OS:-}" != "windows" ]; then
  log_build "[BUILD] FAIL: OS is not 'windows': ${PROFILE_OS:-<not set>}"
  echo "[ERR] Unreal build adapter v1 only supports os='windows'" >&2
  exit 1
fi
log_build "[BUILD] OS is 'windows'"

# Enforce targetPlatforms exactly ["Win64"]
log_build "[BUILD] Checking target platforms..."
if ! "$JQ_CMD" -e '.unreal.targetPlatforms == ["Win64"]' "$PROFILE_JSON" >/dev/null 2>&1; then
  local actual_platforms=$("$JQ_CMD" '.unreal.targetPlatforms' "$PROFILE_JSON" 2>/dev/null || echo "unknown")
  log_build "[BUILD] FAIL: targetPlatforms is not [\"Win64\"]: $actual_platforms"
  echo "[ERR] unreal.targetPlatforms must be exactly [\"Win64\"] in v1" >&2
  exit 1
fi
log_build "[BUILD] targetPlatforms is [\"Win64\"]"

UNREAL_ENGINE_ROOT_ABS="$(normalize_path "$UNREAL_ENGINE_ROOT")"
UNREAL_PROJECT_PATH_ABS="$(normalize_path "$UNREAL_PROJECT_PATH")"
UNREAL_BUILD_OUTPUT_ABS="$(normalize_path "$UNREAL_BUILD_OUTPUT_PATH")"
ARCHIVE_OUTPUT="$UNREAL_BUILD_OUTPUT_ABS/archives/windows"
UAT_PATH="$UNREAL_ENGINE_ROOT_ABS/Engine/Build/BatchFiles/RunUAT.bat"
LOG_DIR="$UNREAL_BUILD_OUTPUT_ABS/logs"
LOG_FILE="$LOG_DIR/unreal_build_windows.log"

log_build "[BUILD] Path normalization complete"
log_build "[BUILD]  Engine root abs: $UNREAL_ENGINE_ROOT_ABS"
log_build "[BUILD]  Project abs: $UNREAL_PROJECT_PATH_ABS"
log_build "[BUILD]  Build output abs: $UNREAL_BUILD_OUTPUT_ABS"
log_build "[BUILD]  Archive output: $ARCHIVE_OUTPUT"
log_build "[BUILD]  UAT path: $UAT_PATH"
log_build "[BUILD]  Log file: $LOG_FILE"

COMMAND_LINE="\"$UAT_PATH\" BuildCookRun -project=\"$UNREAL_PROJECT_PATH_ABS\" -noP4 -unattended -NoSplash -platform=Win64 -clientconfig=$UNREAL_BUILD_CONFIGURATION -clean -build -nocompileeditor -cook -stage -archive -pak -cmdline=\"-log\" -archivedirectory=\"$ARCHIVE_OUTPUT\" -UbtArgs=\"-NoHotReloadFromIDE\""

log_build "Starting Unreal Windows build..."
log_build "Engine root: $UNREAL_ENGINE_ROOT_ABS"
log_build "Project: $UNREAL_PROJECT_PATH_ABS"
log_build "Build output: $UNREAL_BUILD_OUTPUT_ABS"
log_build "Archive output: $ARCHIVE_OUTPUT"
log_build "UAT command: $COMMAND_LINE"

if [ "$DRY_RUN" = true ]; then
  log_build "Dry run enabled; skipping command execution"
  exit 0
fi

mkdir_p "$LOG_DIR"
mkdir_p "$ARCHIVE_OUTPUT"

SYNCED_PROJECT_DIR="$(dirname "$UNREAL_PROJECT_PATH_ABS")"
PROJECT_STEM="$(resolve_project_stem "$UNREAL_PROJECT_PATH_ABS")"
EDITOR_TARGET_BASE="$(resolve_editor_target_base "$UNREAL_PROJECT_NAME" "$UNREAL_PROJECT_PATH_ABS")"
EXPECTED_EDITOR_RECEIPT="$SYNCED_PROJECT_DIR/Binaries/Win64/${EDITOR_TARGET_BASE}Editor.target"

if ! ensure_editor_target_receipt "$SYNCED_PROJECT_DIR" "$UNREAL_PROJECT_NAME" "$UNREAL_PROJECT_PATH_ABS"; then
  log_build "[BUILD] Editor receipt staging did not find '$EXPECTED_EDITOR_RECEIPT'; will attempt an editor prebuild"
fi

EDITOR_MODULE_DLL="$SYNCED_PROJECT_DIR/Binaries/Win64/UnrealEditor-${PROJECT_STEM}.dll"
BUILD_BAT="$UNREAL_ENGINE_ROOT_ABS/Engine/Build/BatchFiles/Build.bat"
EDITOR_LOG_FILE="$LOG_DIR/unreal_editor_build_windows.log"
EDITOR_BUILD_COMMAND="\"$BUILD_BAT\" ${EDITOR_TARGET_BASE}Editor Win64 Development \"$UNREAL_PROJECT_PATH_ABS\" -NoHotReloadFromIDE"

if [ ! -f "$EDITOR_MODULE_DLL" ]; then
  log_build "[BUILD] Editor module missing before prebuild: $EDITOR_MODULE_DLL"
else
  log_build "[BUILD] Editor module present before prebuild: $EDITOR_MODULE_DLL"
fi
if [ ! -f "$EXPECTED_EDITOR_RECEIPT" ]; then
  log_build "[BUILD] Expected editor receipt missing before prebuild: $EXPECTED_EDITOR_RECEIPT"
else
  log_build "[BUILD] Expected editor receipt present before prebuild: $EXPECTED_EDITOR_RECEIPT"
fi

log_build "[BUILD] Prebuilding editor target '$EDITOR_TARGET_BASE' with Live Coding guard disabled"
log_build "[BUILD]  Command: $EDITOR_BUILD_COMMAND"

set +e
run_uat_command "$EDITOR_BUILD_COMMAND" "$EDITOR_LOG_FILE"
editor_exit_code=$?
set -e

if [ $editor_exit_code -ne 0 ]; then
  log_build "[BUILD] FAIL: Editor prebuild failed (exit code $editor_exit_code)"
  echo "[ERR] Editor prebuild failed with exit code $editor_exit_code" >&2
  exit $editor_exit_code
fi

if [ ! -f "$EXPECTED_EDITOR_RECEIPT" ]; then
  log_build "[BUILD] FAIL: Editor prebuild completed but receipt is still missing: $EXPECTED_EDITOR_RECEIPT"
  echo "[ERR] Editor target receipt not found after prebuild: $EXPECTED_EDITOR_RECEIPT" >&2
  exit 1
fi

if [ ! -f "$EDITOR_MODULE_DLL" ]; then
  log_build "[BUILD] FAIL: Editor prebuild completed but module is still missing: $EDITOR_MODULE_DLL"
  echo "[ERR] Editor module not found after prebuild: $EDITOR_MODULE_DLL" >&2
  exit 1
fi

log_build "[BUILD] Editor target receipt prepared: $EXPECTED_EDITOR_RECEIPT"
log_build "[BUILD] Editor module prepared: $EDITOR_MODULE_DLL"

log_build "[BUILD] Pre-flight file checks..."
if [ ! -f "$UNREAL_PROJECT_PATH_ABS" ]; then
  log_build "[BUILD] FAIL: Project file not found: $UNREAL_PROJECT_PATH_ABS"
  echo "[ERR] Unreal project file not found: $UNREAL_PROJECT_PATH_ABS" >&2
  exit 1
fi
log_build "[BUILD] Project file exists: $UNREAL_PROJECT_PATH_ABS"

if [ ! -f "$UAT_PATH" ]; then
  log_build "[BUILD] FAIL: RunUAT not found: $UAT_PATH"
  echo "[ERR] RunUAT not found: $UAT_PATH" >&2
  exit 1
fi
log_build "[BUILD] RunUAT found: $UAT_PATH"

log_build "[BUILD] Build environment ready"
log_build "[BUILD] Command line:"
log_build "[BUILD]  $COMMAND_LINE"

LOCK_NAME="unreal_build_${UNREAL_PROJECT_NAME}"
log_build "[BUILD] Acquiring build lock: $LOCK_NAME"
acquire_lock "$LOCK_NAME" || {
  log_build "[BUILD] FAIL: Build lock acquisition failed - another build for '$UNREAL_PROJECT_NAME' is in progress"
  echo "[ERR] Cannot start Unreal build - another build for '$UNREAL_PROJECT_NAME' is already in progress" >&2
  exit 1
}
log_build "[BUILD] Build lock acquired"
trap 'release_lock "$LOCK_NAME"; stop_log_watcher; restore_conflicting_plugins; restore_packaging_override' EXIT

disable_conflicting_plugins "$UNREAL_PROJECT_PATH_ABS" "$MCP_PLUGIN_LIST"
apply_packaging_override "$UNREAL_PROJECT_PATH_ABS" "$UNREAL_PACKAGING_INI_OVERRIDE"

log_build "[BUILD] Starting UAT execution..."
set +e
run_uat_command "$COMMAND_LINE" "$LOG_FILE"
exit_code=$?
set -e
if [ $exit_code -ne 0 ]; then
  if grep -qi "Live Coding is active" "$LOG_FILE" 2>/dev/null; then
    log_build "[BUILD] FAIL: Build failed: Unreal Live Coding is active"
    echo "[ERR] Unreal build blocked: Live Coding is active in Unreal Editor." >&2
    echo "[ERR] Disable Live Coding (Editor Preferences), or press Ctrl+Alt+F11, then retry Execute." >&2
    exit $exit_code
  fi

  log_build "[BUILD] FAIL: Build failed"
  echo "[ERR] Unreal BuildCookRun failed with exit code $exit_code" >&2
  exit $exit_code
fi
log_build "[BUILD] UAT execution completed successfully"

log_build "[BUILD] Normalizing build artifacts..."
ARTIFACT_TARGET_NAME="$EDITOR_TARGET_BASE"
if ! normalize_windows_artifact "$ARTIFACT_TARGET_NAME" "$UNREAL_BUILD_OUTPUT_ABS" "$ARCHIVE_OUTPUT"; then
  log_build "[BUILD] FAIL: Artifact normalization failed"
  exit 1
fi
log_build "[BUILD] Build artifacts normalized"

log_build "[BUILD] Unreal Windows build completed successfully."
exit 0
