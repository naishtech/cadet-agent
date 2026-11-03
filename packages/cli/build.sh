#!/bin/bash

#================================================================
# Setup
#================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Save original SCRIPT_DIR before sourcing (json_parser.sh will change it)
BUILD_SCRIPT_DIR="$SCRIPT_DIR"

# Source JSON utilities
source "$BUILD_SCRIPT_DIR/Util/json_parser.sh"
source "$BUILD_SCRIPT_DIR/Util/process_lock.sh"
source "$BUILD_SCRIPT_DIR/Util/logging.sh"

# Cosmos-aware rm wrapper
rm_rf() {
  if command -v rm.ape >/dev/null 2>&1; then
    rm.ape -rf "$1"
  else
    rm -rf "$1"
  fi
}

# Cosmos-aware mkdir wrapper
mkdir_p() {
  if command -v mkdir.ape >/dev/null 2>&1; then
    mkdir.ape -p "$@"
  else
    mkdir -p "$@"
  fi
}

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

# Convert Windows absolute paths to MSYS/Cygwin-style paths for bash file operations.
to_bash_path() {
    local path="$1"

    if [[ -z "$path" ]]; then
        echo "$path"
        return 0
    fi

    if [[ "$path" =~ ^([A-Za-z]):[/\\](.*)$ ]]; then
        local drive_letter="${BASH_REMATCH[1],,}"
        local remaining_path="${BASH_REMATCH[2]}"
        remaining_path="${remaining_path//\\//}"
        echo "/${drive_letter}/${remaining_path}"
        return 0
    fi

    echo "$path"
}

run_unity_command() {
    if [[ "$UNITY_PATH" == *.sh ]]; then
        bash "$UNITY_PATH" "$@" &
    else
        if [ -n "${WINDIR:-}" ] || [ "${OS:-}" = "Windows_NT" ]; then
            MSYS2_ARG_CONV_EXCL='*' MSYS_NO_PATHCONV=1 "$UNITY_PATH" "$@" &
        else
            "$UNITY_PATH" "$@" &
        fi
    fi

    UNITY_PID=$!
}

UNITY_LOG_WATCHER_PID=""
UNITY_LOG_EMITTED_LINES=0

get_file_line_count() {
    local path="$1"
    if [ ! -f "$path" ]; then
        echo 0
        return 0
    fi

    wc -l < "$path" | tr -d '[:space:]'
}

emit_unity_log_updates_since() {
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

    local first_line=$((start_line + UNITY_LOG_EMITTED_LINES + 1))
    if [ "$first_line" -gt "$total_lines" ]; then
        return 0
    fi

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        log_build "UnityLog: $line"
    done < <(sed -n "${first_line},${total_lines}p" "$log_file" 2>/dev/null)

    UNITY_LOG_EMITTED_LINES=$((total_lines - start_line))
}

start_unity_log_watcher() {
    local log_file="$1"
    local start_line="$2"

    (
        while true; do
            emit_unity_log_updates_since "$log_file" "$start_line"
            sleep 1
        done
    ) &

    UNITY_LOG_WATCHER_PID=$!
}

stop_unity_log_watcher() {
    if [ -n "$UNITY_LOG_WATCHER_PID" ]; then
        kill "$UNITY_LOG_WATCHER_PID" >/dev/null 2>&1 || true
        wait "$UNITY_LOG_WATCHER_PID" 2>/dev/null || true
        UNITY_LOG_WATCHER_PID=""
    fi
}

#================================================================
# Parse command line arguments (new contract)
#================================================================

PROFILE_JSON=""

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
        -h|--help)
            echo "Usage: $0 --profile-json <path>"
            echo ""
            echo "Arguments:"
            echo "  --profile-json  Path to Build Profile JSON (required)"
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

show_cadet_pro_banner

#================================================================
# Load configuration from JSON (no .env dependencies)
#================================================================

# Validate overall JSON schema first (syntax + required top-level + platform/os values)
if ! validate_json_structure "$PROFILE_JSON"; then
    exit 1
fi

# Load profile values into exported variables
if ! load_profile_json "$PROFILE_JSON"; then
    exit 1
fi

# Validate required Unity fields for building
if [ -z "$UNITY_EDITOR_PATH" ]; then
    echo "[ERR] Required field missing: unity.editorPath" >&2
    exit 1
fi
if [ -z "$UNITY_PROJECT_PATH" ]; then
    echo "[ERR] Required field missing: unity.projectPath" >&2
    exit 1
fi
if [ -z "$UNITY_BUILD_OUTPUT_PATH" ]; then
    echo "[ERR] Required field missing: unity.buildOutputPath" >&2
    exit 1
fi
if [ -z "$UNITY_PROJECT_NAME" ]; then
    echo "[ERR] Required field missing: unity.projectName" >&2
    exit 1
fi

# Map JSON-derived names to legacy variable names used below
PLATFORM="$PROFILE_PLATFORM"
OS="$PROFILE_OS"
UNITY_PATH="$UNITY_EDITOR_PATH"
PROJECT_PATH="$UNITY_PROJECT_PATH"
BUILD_OUTPUT_PATH="$UNITY_BUILD_OUTPUT_PATH"
PROJECT_NAME="$UNITY_PROJECT_NAME"

# Convert relative Unity path to absolute for consistency
# Only convert if path is relative (handles both Unix and Windows absolute paths)
if ! is_absolute_path "$UNITY_PATH"; then
    # Remove leading ./ if present
    UNITY_PATH="${UNITY_PATH#./}"
    # Prepend project root
    UNITY_PATH="$PROJECT_ROOT/$UNITY_PATH"
fi

# Handle macOS .app bundles - extract the actual Unity executable
if [[ "$UNITY_PATH" == *.app ]]; then
    # If the path ends with .app, extract the executable inside the bundle
    UNITY_EXECUTABLE="$UNITY_PATH/Contents/MacOS/Unity"
    if [ ! -f "$UNITY_EXECUTABLE" ]; then
        echo "[ERR] Unity executable not found at: $UNITY_EXECUTABLE" >&2
        echo "[ERR] The .app bundle may be invalid or corrupted" >&2
        exit 1
    fi
    UNITY_PATH="$UNITY_EXECUTABLE"
fi

#================================================================
# Process lock to prevent concurrent Unity builds
#================================================================

# Acquire lock to prevent concurrent Unity builds for this project
acquire_lock "unity_build_${PROJECT_NAME}" || {
  echo "[ERR] Cannot start Unity build - another build for '$PROJECT_NAME' is already in progress" >&2
  echo "[ERR] If this is incorrect, run: rm -f \"$HOME/CADET/CLI/unity_build_${PROJECT_NAME}.lock\"" >&2
  exit 1
}

# Global variable to track Unity process ID for cancellation
UNITY_PID=""

# Function to kill Unity process and cleanup
kill_unity_and_exit() {
    echo "[WARN] Build cancelled - terminating Unity process..." >&2
    if [ -n "$UNITY_PID" ] && kill -0 "$UNITY_PID" 2>/dev/null; then
        echo "[WARN] Killing Unity process (PID: $UNITY_PID)..." >&2
        # Try graceful termination first
        kill -TERM "$UNITY_PID" 2>/dev/null || true
        # Wait up to 5 seconds for graceful shutdown
        local count=0
        while [ $count -lt 5 ] && kill -0 "$UNITY_PID" 2>/dev/null; do
            sleep 1
            ((count++))
        done
        # Force kill if still running
        if kill -0 "$UNITY_PID" 2>/dev/null; then
            echo "[WARN] Force killing Unity process..." >&2
            kill -KILL "$UNITY_PID" 2>/dev/null || true
        fi
    fi
    # Release lock and exit
    release_lock "unity_build_${PROJECT_NAME}"
    exit 130  # 130 = 128 + 2 (SIGINT)
}

# Set up signal traps for cancellation (SIGTERM and SIGINT)
trap 'kill_unity_and_exit' TERM INT

# Set up cleanup trap to release lock on exit (success or failure)
trap 'release_lock "unity_build_${PROJECT_NAME}"' EXIT

#================================================================
# Unity build functions
#================================================================
# Note: Platform detection is now done at runtime, no JSON config needed

# Function to build Windows
build_windows() {
    log_build "Starting Unity Windows Build..."
        PROJECT_PATH_BASH="$(to_bash_path "$PROJECT_PATH")"
        BUILD_OUTPUT_PATH_BASH="$(to_bash_path "$BUILD_OUTPUT_PATH")"
        LOG_FILE="$PROJECT_PATH/Logs/unity_build_windows.log"
        LOG_FILE_BASH="$(to_bash_path "$LOG_FILE")"
        BUILD_OUTPUT_NATIVE="$BUILD_OUTPUT_PATH/windows/$PROJECT_NAME.exe"
        BUILD_OUTPUT_BASH="$(to_bash_path "$BUILD_OUTPUT_NATIVE")"
    # Ensure the directory exists
        mkdir_p "$PROJECT_PATH_BASH/Logs" || true
        mkdir_p "$BUILD_OUTPUT_PATH_BASH" || true
        mkdir_p "$BUILD_OUTPUT_PATH_BASH/windows" || true

    # Diagnostics: Log paths before execution
    log_build "[DIAG] PROJECT_PATH: $PROJECT_PATH"
        log_build "[DIAG] PROJECT_PATH_BASH: $PROJECT_PATH_BASH"
    log_build "[DIAG] BUILD_OUTPUT_PATH: $BUILD_OUTPUT_PATH"
        log_build "[DIAG] BUILD_OUTPUT_PATH_BASH: $BUILD_OUTPUT_PATH_BASH"
    log_build "[DIAG] LOG_FILE: $LOG_FILE"
        log_build "[DIAG] LOG_FILE_BASH: $LOG_FILE_BASH"
    log_build "[DIAG] UNITY_PATH: $UNITY_PATH"
        log_build "[DIAG] BUILD_OUTPUT_NATIVE: $BUILD_OUTPUT_NATIVE"
        log_build "[DIAG] BUILD_OUTPUT_BASH: $BUILD_OUTPUT_BASH"
        log_build "[DIAG] PROJECT_PATH exists: $([ -d "$PROJECT_PATH_BASH" ] && echo 'YES' || echo 'NO')"
        log_build "[DIAG] LOG_FILE directory exists: $([ -d "$(dirname "$LOG_FILE_BASH")" ] && echo 'YES' || echo 'NO')"
        log_build "[DIAG] BUILD_OUTPUT_PATH exists: $([ -d "$BUILD_OUTPUT_PATH_BASH" ] && echo 'YES' || echo 'NO')"

        log_build "[DIAG] UNITY_CWD_BASH: $PROJECT_PATH_BASH"
        log_build "[DIAG] UNITY_ARGS: -batchmode -nographics -silent-crashes -logFile \"$LOG_FILE\" -projectPath \"$PROJECT_PATH\" -buildTarget \"Win64\" -buildWindows64Player \"$BUILD_OUTPUT_NATIVE\" -quit"

        local unity_log_start_line
        unity_log_start_line="$(get_file_line_count "$LOG_FILE_BASH")"

        run_unity_command \
            -batchmode \
            -nographics \
            -silent-crashes \
            -logFile "$LOG_FILE" \
            -projectPath "$PROJECT_PATH" \
            -buildTarget "Win64" \
            -buildWindows64Player "$BUILD_OUTPUT_NATIVE" \
            -quit

            start_unity_log_watcher "$LOG_FILE_BASH" "$unity_log_start_line"

    # Wait for Unity process to complete
    wait $UNITY_PID
    local exit_code=$?
            stop_unity_log_watcher
            emit_unity_log_updates_since "$LOG_FILE_BASH" "$unity_log_start_line"
    log_build "[DIAG] UNITY_EXIT_CODE: $exit_code"

    # Check if Unity Windows build was successful
    if [ $exit_code -eq 0 ]; then
        log_build "Unity Windows build completed successfully."
        # Remove the Unity-Burst debug folder, which Unity names after the project
        TARGET_FOLDER="$BUILD_OUTPUT_PATH/windows/${PROJECT_NAME}_BurstDebugInformation_DoNotShip"
        TARGET_FOLDER_BASH="$(to_bash_path "$TARGET_FOLDER")"
        if [ -d "$TARGET_FOLDER_BASH" ]; then
            log_build "Removing $TARGET_FOLDER ..."
            rm_rf "$TARGET_FOLDER_BASH"
        fi
        return 0
    else
        log_error "Unity Windows build failed."
        return 1
    fi
}

# Function to build macOS
build_macos() {
    log_build "Starting Unity MacOS Build..."
        PROJECT_PATH_BASH="$(to_bash_path "$PROJECT_PATH")"
        BUILD_OUTPUT_PATH_BASH="$(to_bash_path "$BUILD_OUTPUT_PATH")"
        LOG_FILE="$PROJECT_PATH/Logs/unity_build_macos.log"
        LOG_FILE_BASH="$(to_bash_path "$LOG_FILE")"
        BUILD_OUTPUT_NATIVE="$BUILD_OUTPUT_PATH/macos/$PROJECT_NAME.app"
        BUILD_OUTPUT_BASH="$(to_bash_path "$BUILD_OUTPUT_NATIVE")"
    # Ensure the directory exists
        mkdir_p "$PROJECT_PATH_BASH/Logs" || true
        mkdir_p "$BUILD_OUTPUT_PATH_BASH" || true
        mkdir_p "$BUILD_OUTPUT_PATH_BASH/macos" || true

    # Diagnostics: Log paths before execution
    log_build "[DIAG] PROJECT_PATH: $PROJECT_PATH"
        log_build "[DIAG] PROJECT_PATH_BASH: $PROJECT_PATH_BASH"
    log_build "[DIAG] BUILD_OUTPUT_PATH: $BUILD_OUTPUT_PATH"
        log_build "[DIAG] BUILD_OUTPUT_PATH_BASH: $BUILD_OUTPUT_PATH_BASH"
    log_build "[DIAG] LOG_FILE: $LOG_FILE"
        log_build "[DIAG] LOG_FILE_BASH: $LOG_FILE_BASH"
    log_build "[DIAG] UNITY_PATH: $UNITY_PATH"
        log_build "[DIAG] BUILD_OUTPUT_NATIVE: $BUILD_OUTPUT_NATIVE"
        log_build "[DIAG] BUILD_OUTPUT_BASH: $BUILD_OUTPUT_BASH"
        log_build "[DIAG] PROJECT_PATH exists: $([ -d "$PROJECT_PATH_BASH" ] && echo 'YES' || echo 'NO')"
        log_build "[DIAG] LOG_FILE directory exists: $([ -d "$(dirname "$LOG_FILE_BASH")" ] && echo 'YES' || echo 'NO')"
        log_build "[DIAG] BUILD_OUTPUT_PATH exists: $([ -d "$BUILD_OUTPUT_PATH_BASH" ] && echo 'YES' || echo 'NO')"

        log_build "[DIAG] UNITY_CWD_BASH: $PROJECT_PATH_BASH"
        log_build "[DIAG] UNITY_ARGS: -batchmode -nographics -silent-crashes -logFile \"$LOG_FILE\" -projectPath \"$PROJECT_PATH\" -buildTarget \"OSXUniversal\" -buildOSXUniversalPlayer \"$BUILD_OUTPUT_NATIVE\" -quit"

        local unity_log_start_line
        unity_log_start_line="$(get_file_line_count "$LOG_FILE_BASH")"

        run_unity_command \
            -batchmode \
            -nographics \
            -silent-crashes \
            -logFile "$LOG_FILE" \
            -projectPath "$PROJECT_PATH" \
            -buildTarget "OSXUniversal" \
            -buildOSXUniversalPlayer "$BUILD_OUTPUT_NATIVE" \
            -quit

            start_unity_log_watcher "$LOG_FILE_BASH" "$unity_log_start_line"

    # Wait for Unity process to complete
    wait $UNITY_PID
    local exit_code=$?
            stop_unity_log_watcher
            emit_unity_log_updates_since "$LOG_FILE_BASH" "$unity_log_start_line"
    log_build "[DIAG] UNITY_EXIT_CODE: $exit_code"

    # Check if Unity MacOS build was successful
    if [ $exit_code -eq 0 ]; then
        log_build "Unity MacOS build completed successfully."
        # Remove the Unity-Burst debug folder, which Unity names after the project
        TARGET_FOLDER="$BUILD_OUTPUT_PATH/macos/${PROJECT_NAME}_BurstDebugInformation_DoNotShip"
        TARGET_FOLDER_BASH="$(to_bash_path "$TARGET_FOLDER")"
        if [ -d "$TARGET_FOLDER_BASH" ]; then
            log_build "Removing $TARGET_FOLDER ..."
            rm_rf "$TARGET_FOLDER_BASH"
        fi
        return 0
    else
        log_error "Unity MacOS build failed."
        return 1
    fi
}

#================================================================
# Execute builds based on platform
#================================================================

log_build "Building for platform: $PLATFORM"

case "$PLATFORM" in
    "epic")
        case "$OS" in
            "windows")
                log_build "Building for Epic Game Store (Windows only)..."
            if ! build_windows; then
                log_error "Epic build failed. Exiting script."
                exit 1
            fi
                ;;
            "mac")
                log_build "Building for Epic Game Store (macOS only)..."
                if ! build_macos; then
                    log_error "Epic build failed. Exiting script."
                    exit 1
                fi
                ;;
            "both")
                log_build "Building for Epic Game Store (Windows + macOS)..."
                if ! build_windows; then
                    log_error "Epic build failed. Exiting script."
                    exit 1
                fi
                if ! build_macos; then
                    log_error "Epic build failed. Exiting script."
                    exit 1
                fi
                ;;
        esac
        ;;
    "steam")
        case "$OS" in
            "windows")
                log_build "Building for Steam (Windows only)..."
                if ! build_windows; then
                    log_error "Steam build failed. Exiting script."
                    exit 1
                fi
                ;;
            "mac")
                log_build "Building for Steam (macOS only)..."
                if ! build_macos; then
                    log_error "Steam build failed. Exiting script."
                    exit 1
                fi
                ;;
            "both")
                log_build "Building for Steam (Windows + macOS)..."
                if ! build_windows; then
                    log_error "Steam build failed. Exiting script."
                    exit 1
                fi
                if ! build_macos; then
                    log_error "Steam build failed. Exiting script."
                    exit 1
                fi
                ;;
        esac
        ;;
    "both")
        case "$OS" in
            "windows")
                log_build "Building for both Steam and Epic (Windows only)..."
                log_build "Note: Launcher type will be auto-detected at runtime."
                if ! build_windows; then
                    log_error "Build failed. Exiting script."
                    exit 1
                fi
                ;;
            "mac")
                log_build "Building for both Steam and Epic (macOS only)..."
                log_build "Note: Launcher type will be auto-detected at runtime."
                if ! build_macos; then
                    log_error "Build failed. Exiting script."
                    exit 1
                fi
                ;;
            "both")
                log_build "Building for both Steam and Epic (Windows + macOS)..."
                log_build "Note: Launcher type will be auto-detected at runtime."
                if ! build_windows; then
                    log_error "Build failed. Exiting script."
                    exit 1
                fi
                if ! build_macos; then
                    log_error "Build failed. Exiting script."
                    exit 1
                fi
                ;;
        esac
        ;;
    "none")
        case "$OS" in
            "windows")
                log_build "Building unpublished Windows build..."
                if ! build_windows; then
                    log_error "Windows build failed. Exiting script."
                    exit 1
                fi
                ;;
            "mac"|"macos")
                log_build "Building unpublished macOS build..."
                if ! build_macos; then
                    log_error "macOS build failed. Exiting script."
                    exit 1
                fi
                ;;
            "both")
                log_build "Building unpublished Windows + macOS build..."
                if ! build_windows; then
                    log_error "Windows build failed. Exiting script."
                    exit 1
                fi
                if ! build_macos; then
                    log_error "macOS build failed. Exiting script."
                    exit 1
                fi
                ;;
            *)
                log_error "Unsupported OS '$OS' for platform '$PLATFORM'."
                exit 1
                ;;
        esac
        ;;
    *)
        log_error "Unsupported platform '$PLATFORM'."
        exit 1
        ;;
esac

log_build "Unity builds completed successfully."
exit 0

