#!/bin/bash

#================================================================
# Tools/Steam/publish.sh (JSON refactor - Task 1.4)
#================================================================
# - Reads Steam config from Build Profile JSON (no Tools/Steam/.env)
# - Loads credentials from user directory only: $HOME/.env_cadet_steam_credentials
# - Accepts:
#     --profile-json <path>   (required)
#     --os windows|mac        (required target OS for selecting VDF)
#     --generated-vdfs-directory <path> (optional, defaults to Tools/CLI/Steam/generated)

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"

# Save SCRIPT_DIR before sourcing other scripts (they may set their own SCRIPT_DIR)
PUBLISH_SCRIPT_DIR="$SCRIPT_DIR"

source "$SCRIPT_DIR/../Util/json_parser.sh"
source "$SCRIPT_DIR/../Util/process_lock.sh"
source "$SCRIPT_DIR/../Util/logging.sh"

# Restore SCRIPT_DIR after sourcing (json_parser.sh sets its own SCRIPT_DIR)
SCRIPT_DIR="$PUBLISH_SCRIPT_DIR"

# Helper function to check if a path is absolute
# Returns 0 (true) if absolute, 1 (false) if relative
# Handles both Unix-style (/path) and Windows-style (C:/path or C:\path) absolute paths
is_absolute_path() {
  local path="$1"
  # Check for Unix-style absolute path (starts with /)
  if [[ "$path" == /* ]]; then
    return 0
  fi
  # Check for Windows-style absolute path (starts with drive letter: C:/ or C:\)
  if [[ "$path" =~ ^[A-Za-z]:[/\\] ]]; then
    return 0
  fi
  # Path is relative
  return 1
}

resolve_steamcmd_path() {
  local candidate="$1"
  local host_os="$2"

  if [ -z "$candidate" ]; then
    return 1
  fi

  if [ -d "$candidate" ]; then
    local names=()
    case "$host_os" in
      MINGW*|MSYS*|CYGWIN*|Windows*)
        names=("steamcmd.exe" "steamcmd")
        ;;
      *)
        names=("steamcmd.sh" "steamcmd")
        ;;
    esac

    local name
    for name in "${names[@]}"; do
      if [ -f "$candidate/$name" ]; then
        echo "$candidate/$name"
        return 0
      fi
    done
  fi

  echo "$candidate"
  return 0
}

run_steamcmd_with_live_output() {
  if [[ "$STEAMCMD" == *.sh ]]; then
    if has_stdbuf; then
      stdbuf -oL -eL bash "./$STEAMCMD_BASENAME" "${LOGIN_ARGS[@]}" +run_app_build_http "$TMP_VDF" +quit 2>&1 | while IFS= read -r line; do
        [ -z "$line" ] && continue
        log_publish "SteamCMD(out): $line"
      done
      return ${PIPESTATUS[0]}
    fi

    bash "./$STEAMCMD_BASENAME" "${LOGIN_ARGS[@]}" +run_app_build_http "$TMP_VDF" +quit 2>&1 | while IFS= read -r line; do
      [ -z "$line" ] && continue
      log_publish "SteamCMD(out): $line"
    done
    return ${PIPESTATUS[0]}
  fi

  "./$STEAMCMD_BASENAME" "${LOGIN_ARGS[@]}" +run_app_build_http "$TMP_VDF" +quit 2>&1 | while IFS= read -r line; do
    [ -z "$line" ] && continue
    log_publish "SteamCMD(out): $line"
  done
  return ${PIPESTATUS[0]}
}

PROFILE_JSON=""
OS_PARAM=""
GENERATED_VDFS_DIRECTORY=""
DRY_RUN=false
PRINT_VDF=false
GENERATE_VDFS=false

STEAM_PUBLISH_EXIT_AUTH_FAILURE=21
STEAM_CONSOLE_EMITTED_LINES=0
STEAM_CONSOLE_WATCHER_PID=""
STEAM_AUTH_FAILURE_MARKER=""

get_file_line_count() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo 0
    return 0
  fi

  wc -l < "$path" | tr -d '[:space:]'
}

emit_console_log_updates_since() {
  local log_file="$1"
  local start_line="$2"

  if [ ! -f "$log_file" ]; then
    return 0
  fi

  local total_lines
  total_lines="$(get_file_line_count "$log_file")"
  if [ -z "$total_lines" ]; then
    total_lines=0
  fi

  if [ "$total_lines" -lt "$start_line" ]; then
    start_line=0
  fi

  local first_line=$((start_line + STEAM_CONSOLE_EMITTED_LINES + 1))
  if [ "$first_line" -gt "$total_lines" ]; then
    return 0
  fi

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    log_publish "SteamCMD: $line"
  done < <(sed -n "${first_line},${total_lines}p" "$log_file" 2>/dev/null)

  STEAM_CONSOLE_EMITTED_LINES=$((total_lines - start_line))
}

console_log_has_auth_failure_since() {
  local log_file="$1"
  local start_line="$2"

  if [ ! -f "$log_file" ]; then
    return 1
  fi

  local excerpt
  excerpt="$(sed -n "$((start_line + 1)),\$p" "$log_file" 2>/dev/null || true)"
  if [ -z "$excerpt" ]; then
    return 1
  fi

  local lower
  lower="$(printf '%s' "$excerpt" | tr '[:upper:]' '[:lower:]')"

  case "$lower" in
    *"that steam guard code was invalid."*|*"error (account logon denied)"*|*"this computer has not been authenticated for your account using steam guard."*)
      return 0
      ;;
  esac

  return 1
}

terminate_steamcmd_process() {
  local pid="$1"

  if [ -z "$pid" ]; then
    return 0
  fi

  if command -v taskkill.exe >/dev/null 2>&1; then
    taskkill.exe //PID "$pid" //T //F >/dev/null 2>&1 || true
  fi

  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" 2>/dev/null || true
}

touch_file() {
  local path="$1"
  : > "$path"
}

start_console_log_watcher() {
  local log_file="$1"
  local start_line="$2"
  local auth_marker="$3"

  (
    local auth_reported=0
    while true; do
      emit_console_log_updates_since "$log_file" "$start_line"

      if [ "$auth_reported" -eq 0 ] && console_log_has_auth_failure_since "$log_file" "$start_line"; then
        log_error "Steam authentication failed. Re-enter Steam credentials in Publishing Tools and try again."
        if [ -n "$auth_marker" ]; then
          touch_file "$auth_marker"
        fi
        auth_reported=1
      fi

      sleep 1
    done
  ) &

  STEAM_CONSOLE_WATCHER_PID=$!
}

stop_console_log_watcher() {
  if [ -n "$STEAM_CONSOLE_WATCHER_PID" ]; then
    kill "$STEAM_CONSOLE_WATCHER_PID" >/dev/null 2>&1 || true
    wait "$STEAM_CONSOLE_WATCHER_PID" 2>/dev/null || true
    STEAM_CONSOLE_WATCHER_PID=""
  fi
}

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
    --os)
      if [ $# -lt 2 ]; then
        echo "[ERR] --os requires a value (windows or mac)" >&2
        exit 1
      fi
      OS_PARAM="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --print-vdf)
      PRINT_VDF=true
      shift
      ;;
    --generate-vdfs)
      GENERATE_VDFS=true
      shift
      ;;
    --generated-vdfs-directory)
      if [ $# -lt 2 ]; then
        echo "[ERR] --generated-vdfs-directory requires a value" >&2
        exit 1
      fi
      GENERATED_VDFS_DIRECTORY="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --profile-json <path> --os <windows|mac> [--generated-vdfs-directory <path>] [--dry-run] [--print-vdf] [--generate-vdfs]"
      echo ""
      echo "Options:"
      echo "  --generated-vdfs-directory  Directory for generated VDF files (default: Tools/CLI/Steam/generated)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Use -h or --help for usage information"
      exit 1
      ;;
  esac
done

if [ -z "$PROFILE_JSON" ]; then
  echo "[ERR] --profile-json is required" >&2
  exit 1
fi

if [ -z "$OS_PARAM" ]; then
  echo "[ERR] --os is required (windows or mac)" >&2
  exit 1
fi

if [[ "$OS_PARAM" != "windows" && "$OS_PARAM" != "mac" ]]; then
  echo "[ERR] Invalid --os value: $OS_PARAM (must be 'windows' or 'mac')" >&2
  exit 1
fi

show_cadet_pro_banner

# Validate JSON file exists and structure before checking other parameters
if ! validate_json_structure "$PROFILE_JSON"; then
  exit 1
fi

if ! load_profile_json "$PROFILE_JSON"; then
  exit 1
fi

# Set default for GENERATED_VDFS_DIRECTORY if not provided
# PROJECT_ROOT is already Tools/, so use path relative to that
if [ -z "$GENERATED_VDFS_DIRECTORY" ]; then
  GENERATED_VDFS_DIRECTORY="CLI/Steam/generated"
fi

# If printing VDF, always operate in dry-run mode (no credentials/steamcmd needed).
if [ "$PRINT_VDF" = true ]; then
  DRY_RUN=true
fi

# If generating VDF files explicitly, always operate in dry-run mode (no credentials/steamcmd needed).
if [ "$GENERATE_VDFS" = true ]; then
  DRY_RUN=true
fi

if [ "${PROFILE_PLATFORM:-}" != "steam" ] && [ "${PROFILE_PLATFORM:-}" != "both" ]; then
  echo "[ERR] Profile platform must be 'steam' or 'both' for Steam publish (got: ${PROFILE_PLATFORM:-})" >&2
  exit 1
fi

# Required Steam fields
if [ -z "${STEAM_APP_ID:-}" ]; then
  echo "[ERR] Required field missing: steam.appId" >&2
  exit 1
fi

# Check for required steamcmd path only if not in dry-run mode
# (dry-run mode doesn't need steamcmd, only VDF generation)
if [ "$DRY_RUN" != true ]; then
  # Host OS detection (Cosmos: prefer uname.ape if uname missing)
  UNAME_CMD="uname"
  if ! command -v uname >/dev/null 2>&1; then
    if command -v uname.ape >/dev/null 2>&1; then
      UNAME_CMD="uname.ape"
    fi
  fi

  # Check for required steamcmd path based on detected OS
  case "$("$UNAME_CMD" -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*|Windows*)
      if [ -z "${STEAMCMD_EXE:-}" ]; then
        echo "[ERR] Required field missing: steam.steamcmdExe (required for Windows)" >&2
        exit 1
      fi
      ;;
    *)
      if [ -z "${STEAMCMD_SH:-}" ]; then
        echo "[ERR] Required field missing: steam.steamcmdSh (required for macOS/Linux)" >&2
        exit 1
      fi
      ;;
  esac
fi

# New: VDF generation fields (required for publishing)
STEAM_DESCRIPTION="$(get_json_value "$PROFILE_JSON" "steam.description")"
STEAM_SET_LIVE="$(get_json_value "$PROFILE_JSON" "steam.setLive")"
STEAM_CONTENT_ROOT="$(get_json_value "$PROFILE_JSON" "steam.contentRoot")"
STEAM_BUILD_OUTPUT="$(get_json_value "$PROFILE_JSON" "steam.buildOutput")"

has_depots="$("$JQ_CMD" -r '.steam.depots // empty | (type=="array" and length>0)' "$PROFILE_JSON" 2>/dev/null || echo "false")"

# Set TMP_VDF_DIR from parameter and convert to absolute if needed
TMP_VDF_DIR="$GENERATED_VDFS_DIRECTORY"
if ! is_absolute_path "$TMP_VDF_DIR"; then
  TMP_VDF_DIR="$PROJECT_ROOT/$TMP_VDF_DIR"
fi

ensure_generated_dir() {
  if command -v mkdir.ape >/dev/null 2>&1; then
    mkdir.ape -p "$TMP_VDF_DIR"
  else
    mkdir -p "$TMP_VDF_DIR"
  fi
}

generate_depot_vdfs() {
  local target_os="$1" # windows|mac
  ensure_generated_dir

  # Verify directory was created
  if [ ! -d "$TMP_VDF_DIR" ]; then
    echo "[ERR] Failed to create VDF directory: $TMP_VDF_DIR" >&2
    return 1
  fi

  local depots_lines
  depots_lines="$("$JQ_CMD" -r --arg os "$target_os" '.steam.depots[]? | select(.os==$os) | "\(.depotId)|\(.localPath)|\(.depotPath)|\(.recursive)"' "$PROFILE_JSON" 2>/dev/null || true)"
  if [ -z "$depots_lines" ]; then
    echo "[ERR] No Steam depots configured for os=$target_os (steam.depots[])" >&2
    return 1
  fi

  while IFS='|' read -r depot_id local_path depot_path recursive; do
    [ -z "$depot_id" ] && continue
    if [ -z "$local_path" ] || [ -z "$depot_path" ] || [ -z "$recursive" ]; then
      echo "[ERR] Depot entry missing required fields for depotId=$depot_id (need localPath/depotPath/recursive)" >&2
      return 1
    fi

    local out_file="$TMP_VDF_DIR/depot_build_${depot_id}.vdf"
    {
      echo "\"DepotBuild\""
      echo "{"
      echo "  \"DepotID\" \"$depot_id\""
      echo "  \"FileMapping\""
      echo "  {"
      echo "    \"LocalPath\" \"$local_path\""
      echo "    \"DepotPath\" \"$depot_path\""
      echo "    \"Recursive\" \"$recursive\""
      echo "  }"
      echo "}"
    } > "$out_file"
    
    # Verify file was created
    if [ ! -f "$out_file" ]; then
      echo "[ERR] Failed to create depot VDF file: $out_file" >&2
      return 1
    fi
  done <<< "$depots_lines"

  return 0
}

generate_app_build_vdf() {
  local target_os="$1" # windows|mac

  if [ -z "$STEAM_CONTENT_ROOT" ] || [ -z "$STEAM_BUILD_OUTPUT" ] || [ "$has_depots" != "true" ]; then
    return 1
  fi

  local depots_lines
  ensure_generated_dir
  depots_lines="$("$JQ_CMD" -r --arg os "$target_os" '.steam.depots[]? | select(.os==$os) | "\(.depotId)|\(.depotId)"' "$PROFILE_JSON" 2>/dev/null || true)"
  if [ -z "$depots_lines" ]; then
    echo "[ERR] No Steam depots configured for os=$target_os (steam.depots[])" >&2
    return 1
  fi

  echo "\"AppBuild\""
  echo "{"
  echo "  \"AppID\" \"$STEAM_APP_ID\""
  if [ -n "$STEAM_DESCRIPTION" ]; then
    echo "  \"Desc\" \"$STEAM_DESCRIPTION\""
  fi
  if [ -n "$STEAM_SET_LIVE" ]; then
    echo "  \"SetLive\" \"$STEAM_SET_LIVE\""
  fi
  echo "  \"ContentRoot\" \"$STEAM_CONTENT_ROOT\""
  echo "  \"BuildOutput\" \"$STEAM_BUILD_OUTPUT\""
  echo "  \"Depots\""
  echo "  {"
  while IFS='|' read -r depot_id depot_id_2; do
    [ -z "$depot_id" ] && continue
    echo "    \"$depot_id\" \"depot_build_${depot_id}.vdf\""
  done <<< "$depots_lines"
  echo "  }"
  echo "}"
  return 0
}

# VDF generation path (preferred)
if [ "$PRINT_VDF" = true ]; then
  # Ensure depot VDFs exist so the printed AppBuild references real files.
  generate_depot_vdfs "$OS_PARAM" >/dev/null 2>&1 || exit 1
  generate_app_build_vdf "$OS_PARAM"
  exit $?
fi

if [ "$DRY_RUN" = true ]; then
  log_publish "DRY_RUN enabled (no SteamCMD execution)"
  if [ "$GENERATE_VDFS" = true ]; then
    if ! generate_depot_vdfs "$OS_PARAM"; then
      exit 1
    fi
    ensure_generated_dir
    TMP_VDF="$TMP_VDF_DIR/app_build_${STEAM_APP_ID}_${OS_PARAM}.vdf"
    if ! generate_app_build_vdf "$OS_PARAM" > "$TMP_VDF"; then
      echo "[ERR] VDF generation not configured in JSON (missing steam.contentRoot/buildOutput/depots[])" >&2
      exit 1
    fi
    log_publish "Generated VDFs:"
    log_publish " - $TMP_VDF"
    # List generated depot VDFs
    if [ -d "$TMP_VDF_DIR" ]; then
      for depot_file in "$TMP_VDF_DIR"/depot_build_*.vdf; do
        if [ -f "$depot_file" ]; then
          log_publish " - $depot_file"
        fi
      done
    fi
    exit 0
  fi

  generate_depot_vdfs "$OS_PARAM" >/dev/null 2>&1 || exit 1
  generate_app_build_vdf "$OS_PARAM" || {
    echo "[ERR] VDF generation not configured in JSON (missing steam.contentRoot/buildOutput/depots[])" >&2
    exit 1
  }
  exit 0
fi

# Credentials - check environment variables first, then fall back to file
if [ -z "${STEAM_USERNAME:-}" ] || [ -z "${STEAM_PASSWORD:-}" ]; then
  # Load from file if not in environment
  STEAM_CREDS_FILE="$HOME/.env_cadet_steam_credentials"
  if [ ! -f "$STEAM_CREDS_FILE" ]; then
    echo "[ERR] Steam credentials not found in environment and file not found: $STEAM_CREDS_FILE" >&2
    exit 1
  fi
  log_publish "Loading Steam credentials from file: $STEAM_CREDS_FILE"
  # Load credentials file using source (like auth.sh does)
  # This automatically exports the variables
  source "$STEAM_CREDS_FILE"
else
  log_publish "Using Steam credentials from environment variables"
fi

# Enable extended globbing for trimming (like auth.sh does)
shopt -s extglob 2>/dev/null || true

# Trim whitespace/newlines from credentials using bash parameter expansion (same as auth.sh)
STEAM_USERNAME="${STEAM_USERNAME%%*( )}"
STEAM_USERNAME="${STEAM_USERNAME##*( )}"
STEAM_USERNAME="${STEAM_USERNAME//$'\r'/}"
STEAM_USERNAME="${STEAM_USERNAME//$'\n'/}"

if [ -n "${STEAM_PASSWORD:-}" ]; then
  STEAM_PASSWORD="${STEAM_PASSWORD%%*( )}"
  STEAM_PASSWORD="${STEAM_PASSWORD##*( )}"
  STEAM_PASSWORD="${STEAM_PASSWORD//$'\r'/}"
  STEAM_PASSWORD="${STEAM_PASSWORD//$'\n'/}"
fi

if [ -n "${STEAM_GUARD_CODE:-}" ]; then
  STEAM_GUARD_CODE="${STEAM_GUARD_CODE%%*( )}"
  STEAM_GUARD_CODE="${STEAM_GUARD_CODE##*( )}"
  STEAM_GUARD_CODE="${STEAM_GUARD_CODE//$'\r'/}"
  STEAM_GUARD_CODE="${STEAM_GUARD_CODE//$'\n'/}"
fi

if [ -z "${STEAM_USERNAME:-}" ] || [ -z "${STEAM_PASSWORD:-}" ]; then
  echo "[ERR] Missing Steam credentials (need STEAM_USERNAME/STEAM_PASSWORD in environment variables or credentials file)" >&2
  echo "[ERR] Note: STEAM_GUARD_CODE is optional after first successful authentication (sentry file will be used)" >&2
  exit 1
fi

# Host OS detection (Cosmos: prefer uname.ape if uname missing)
UNAME_CMD="uname"
if ! command -v uname >/dev/null 2>&1; then
  if command -v uname.ape >/dev/null 2>&1; then
    UNAME_CMD="uname.ape"
  fi
fi

HOST_OS="$("$UNAME_CMD" -s 2>/dev/null)"

case "$HOST_OS" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    STEAMCMD="$STEAMCMD_EXE"
    ;;
  *)
    STEAMCMD="$STEAMCMD_SH"
    ;;
esac

# Generate depot + app VDF files (always; legacy VDF paths removed)
if ! generate_depot_vdfs "$OS_PARAM"; then
  exit 1
fi
ensure_generated_dir
TMP_VDF="$TMP_VDF_DIR/app_build_${STEAM_APP_ID}_${OS_PARAM}.vdf"
if ! generate_app_build_vdf "$OS_PARAM" > "$TMP_VDF"; then
  echo "[ERR] VDF generation not configured in JSON (missing steam.contentRoot/buildOutput/depots[])" >&2
  exit 1
fi

log_publish "Starting upload to Steam..."
log_publish "Target OS: $OS_PARAM"
log_publish "SteamCMD: $STEAMCMD"
log_publish "VDF: $TMP_VDF"

# Convert relative paths to absolute for Cosmos bash compatibility
if ! is_absolute_path "$STEAMCMD"; then
  STEAMCMD="$PROJECT_ROOT/$STEAMCMD"
fi

STEAMCMD="$(resolve_steamcmd_path "$STEAMCMD" "$HOST_OS")"

if [ ! -f "$STEAMCMD" ]; then
  echo "[ERR] SteamCMD executable not found at: $STEAMCMD" >&2
  exit 1
fi

if ! is_absolute_path "$TMP_VDF"; then
  TMP_VDF="$PROJECT_ROOT/$TMP_VDF"
fi

log_publish "Absolute SteamCMD path: $STEAMCMD"
log_publish "Absolute VDF path: $TMP_VDF"

# Acquire lock to prevent concurrent SteamCMD operations
acquire_lock "steamcmd_${STEAM_APP_ID}" || {
  echo "[ERR] Cannot start Steam upload - another upload is already in progress" >&2
  exit 1
}

# Set up cleanup trap to release lock on exit (success or failure)
trap 'release_lock "steamcmd_${STEAM_APP_ID}"' EXIT

# Build login command using credentials from file
# Always use credentials from file if available (non-interactive)
# Only include Steam Guard code if provided (non-empty)
# After first successful login, SteamCMD creates a sentry file and won't need the guard code
log_publish "Auth mode: Using credentials from ~/.env_cadet_steam_credentials"
if [ -n "${STEAM_GUARD_CODE:-}" ]; then
  log_publish "Steam Guard code provided - will use for authentication"
  # Build login arguments as separate elements to avoid quote issues
  LOGIN_ARGS=(+login "$STEAM_USERNAME" "$STEAM_PASSWORD" "$STEAM_GUARD_CODE")
else
  log_publish "No Steam Guard code - using password from credentials file"
  # Build login arguments as separate elements to avoid quote issues
  LOGIN_ARGS=(+login "$STEAM_USERNAME" "$STEAM_PASSWORD")
fi

# Change to SteamCMD directory so it can find the public/ folder with localization files
ORIGINAL_DIR="$(pwd)"
STEAMCMD_DIR="$(dirname "$STEAMCMD")"
# Use parameter expansion instead of basename for better compatibility
STEAMCMD_BASENAME="${STEAMCMD##*/}"
STEAM_CONSOLE_LOG="$STEAMCMD_DIR/logs/console_log.txt"
STEAM_CONSOLE_LOG_START_LINE="$(get_file_line_count "$STEAM_CONSOLE_LOG")"
STEAM_AUTH_FAILURE_MARKER="$TMP_VDF_DIR/.steam_auth_failed_$$.marker"
rm -f "$STEAM_AUTH_FAILURE_MARKER" >/dev/null 2>&1 || true
cd "$STEAMCMD_DIR" || {
  echo "[ERR] Cannot change to SteamCMD directory: $STEAMCMD_DIR" >&2
  exit 1
}

# Function to check if stdbuf is available (for unbuffered output)
has_stdbuf() {
  command -v stdbuf >/dev/null 2>&1
}

start_console_log_watcher "$STEAM_CONSOLE_LOG" "$STEAM_CONSOLE_LOG_START_LINE" "$STEAM_AUTH_FAILURE_MARKER"

run_steamcmd_with_live_output
STEAMCMD_EXIT_CODE=$?

stop_console_log_watcher

emit_console_log_updates_since "$STEAM_CONSOLE_LOG" "$STEAM_CONSOLE_LOG_START_LINE"

# Capture exit code before changing directories

# Return to original directory
cd "$ORIGINAL_DIR" || {
  echo "[ERR] Cannot return to original directory: $ORIGINAL_DIR" >&2
  exit 1
}

if [ -f "$STEAM_AUTH_FAILURE_MARKER" ]; then
  STEAMCMD_EXIT_CODE=$STEAM_PUBLISH_EXIT_AUTH_FAILURE
fi

rm -f "$STEAM_AUTH_FAILURE_MARKER" >/dev/null 2>&1 || true

if [ $STEAMCMD_EXIT_CODE -ne 0 ]; then
  if [ $STEAMCMD_EXIT_CODE -eq $STEAM_PUBLISH_EXIT_AUTH_FAILURE ]; then
    echo "[ERR] Steam authentication failed. Re-enter Steam credentials in Publishing Tools and try again." >&2
    exit $STEAM_PUBLISH_EXIT_AUTH_FAILURE
  fi

  echo "[ERR] Steam upload failed." >&2
  exit 1
fi

log_publish "Steam upload completed successfully."
exit 0


