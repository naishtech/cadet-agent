#!/bin/bash

#================================================================
# Source JSON parser utilities
#================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# dist.sh is always at Tools/CLI/dist.sh (cadet-cli) or CLI/dist.sh (deployed)
# Note: When deployed, Tools/CLI/ becomes CLI/
# Simple path logic - no context detection needed
# Save SCRIPT_DIR before sourcing (json_parser.sh will change it)
DIST_SCRIPT_DIR="$SCRIPT_DIR"
TOOLS_DIR="$SCRIPT_DIR"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/Util/json_parser.sh"
source "$DIST_SCRIPT_DIR/Util/logging.sh"
source "$DIST_SCRIPT_DIR/Util/build_status.sh"

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

#================================================================
# Ensure Cosmos git can find its helper commands (Windows only)
#================================================================
# Cosmos git has a hardcoded exec path from build time.
# We need to set GIT_EXEC_PATH to the correct location for git subcommands to work.
# IMPORTANT: Only set this on Windows - on macOS/Linux, use system git
UNAME_CMD="uname"
if ! command -v uname >/dev/null 2>&1; then
    if command -v uname.ape >/dev/null 2>&1; then
        UNAME_CMD="uname.ape"
    fi
fi

# Determine git command based on platform
# Windows: use Git Bash's git (has proper credential manager integration)
# macOS/Linux: use system git
# Detection methods: uname -s, or Windows environment variables (for Cosmos which may not report MINGW/MSYS)
UNAME_OUTPUT="$("$UNAME_CMD" -s 2>/dev/null)"
IS_WINDOWS=false

case "$UNAME_OUTPUT" in
    MINGW*|MSYS*|CYGWIN*)
        IS_WINDOWS=true
        ;;
    *)
        # Fallback: check Windows environment variables (Cosmos bash may not report as MINGW/MSYS)
        if [ -n "${WINDIR:-}" ] || [ "${OS:-}" = "Windows_NT" ]; then
            IS_WINDOWS=true
        fi
        ;;
esac

if [ "$IS_WINDOWS" = true ]; then
    # Windows - use Git Bash's git (not Cosmos git) for proper credential manager support
    # The profile can specify a custom gitBashPath, otherwise use standard location
    GIT_BASH_DEFAULT="C:/Program Files/Git/bin/git.exe"
    if [ -n "${PROFILE_GIT_BASH_PATH:-}" ] && [ "${PROFILE_GIT_BASH_PATH:-}" != "null" ] && [ -f "${PROFILE_GIT_BASH_PATH:-}" ]; then
        GIT_CMD="$PROFILE_GIT_BASH_PATH"
    elif [ -f "$GIT_BASH_DEFAULT" ]; then
        GIT_CMD="$GIT_BASH_DEFAULT"
    else
        echo "[ERR] Git for Windows not found at default location: $GIT_BASH_DEFAULT" >&2
        echo "[ERR] Please install Git for Windows or specify gitBashPath in your Build Profile" >&2
        exit 1
    fi
else
    # macOS/Linux - use system git
    GIT_CMD="git"
fi

#================================================================
# CI Environment Detection
#================================================================

# Function to detect if we're running in a CI environment
# Returns 0 (true) if CI is detected, 1 (false) otherwise
detect_ci_environment() {
    # Check for common CI environment variables
    if [ -n "${CI:-}" ] && [ "${CI}" != "false" ]; then
        return 0
    fi
    
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        return 0
    fi
    
    if [ -n "${BUILD_BUILDID:-}" ]; then
        return 0
    fi
    
    if [ -n "${TRAVIS:-}" ]; then
        return 0
    fi
    
    if [ -n "${CIRCLECI:-}" ]; then
        return 0
    fi
    
    if [ -n "${JENKINS_URL:-}" ]; then
        return 0
    fi
    
    if [ -n "${GITLAB_CI:-}" ]; then
        return 0
    fi
    
    if [ -n "${TEAMCITY_VERSION:-}" ]; then
        return 0
    fi
    
    if [ -n "${APPVEYOR:-}" ]; then
        return 0
    fi
    
    if [ -n "${BITBUCKET_BUILD_NUMBER:-}" ]; then
        return 0
    fi
    
    # Not in CI
    return 1
}

#================================================================
# Parse command line arguments
#================================================================

CMD_PROFILE_NAME=""
PROFILE_JSON=""
BUILD_ONLY=false
PUBLISH_ONLY=false
NOTARIZE_ONLY=false
GIT_SYNC=false
GENERATED_VDFS_DIRECTORY=""
MODE=""
JOB_GUID=""
LAUNCH_TOKEN=""
STATUS_FILE_ARG=""
ENGINE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile-json)
            if [ $# -lt 2 ]; then
                echo "[ERR] --profile-json requires a file path" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            PROFILE_JSON="$2"
            shift 2
            ;;
        --build-only)
            BUILD_ONLY=true
            shift
            ;;
        --publish-only)
            PUBLISH_ONLY=true
            shift
            ;;
        --notarize-only)
            NOTARIZE_ONLY=true
            shift
            ;;
        --git-sync)
            GIT_SYNC=true
            shift
            ;;
        --generated-vdfs-directory)
            if [ $# -lt 2 ]; then
                echo "[ERR] --generated-vdfs-directory requires a file path" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            GENERATED_VDFS_DIRECTORY="$2"
            shift 2
            ;;
        --job-guid)
            if [ $# -lt 2 ]; then
                echo "[ERR] --job-guid requires a value" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            JOB_GUID="$2"
            shift 2
            ;;
        --launch-token)
            if [ $# -lt 2 ]; then
                echo "[ERR] --launch-token requires a value" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            LAUNCH_TOKEN="$2"
            shift 2
            ;;
        --status-file)
            if [ $# -lt 2 ]; then
                echo "[ERR] --status-file requires a path" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            STATUS_FILE_ARG="$2"
            shift 2
            ;;
        --mode)
            if [ $# -lt 2 ]; then
                echo "[ERR] --mode requires a value (plugin or enterprise)" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            MODE="$2"
            shift 2
            ;;
        --mode=*)
            MODE="${1#*=}"
            shift
            ;;
        --engine)
            if [ $# -lt 2 ]; then
                echo "[ERR] --engine requires a value (unity or unreal)" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            ENGINE="$2"
            shift 2
            ;;
        --engine=*)
            ENGINE="${1#*=}"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [profile-name] --profile-json <path> --generated-vdfs-directory <path> [--build-only|--publish-only|--notarize-only] [--git-sync] [--job-guid <guid> --launch-token <token>] [--mode=plugin|enterprise] [--engine=unity|unreal]"
            echo ""
            echo "Arguments:"
            echo "  profile-name                  Optional profile name for logging (e.g., 'Steam-Public')"
            echo "  --profile-json <path>         Path to Build Profile JSON file (required)"
            echo "  --generated-vdfs-directory <path>  Directory where VDF files should be generated (required)"
            echo "  --build-only                  Build only, skip publishing"
            echo "  --publish-only                Publish only, skip building (requires existing build)"
            echo "  --notarize-only               Notarize only, skip building and publishing (requires existing macOS build)"
            echo "  --git-sync                    Sync project with git (clone if new, reset if existing)"
            echo "  --mode=plugin|enterprise      License mode (plugin or enterprise). Default: enterprise"
            echo "  --engine=unity|unreal         Build engine mode. Default: unity (backwards compatible)"
            echo ""
            echo "Git Sync Behavior:"
            echo "  - If no .git folder exists: performs fresh clone from gitRepository"
            echo "  - If .git folder exists: fetch origin and hard reset to gitBranch"
            echo "  - Requires gitRepository and gitBranch in Build Profile JSON"
            echo ""
            echo "Examples:"
            echo "  $0 \"Steam-Public\" --profile-json profile.json"
            echo "  $0 --profile-json profile.json --build-only"
            echo "  $0 --profile-json profile.json --publish-only"
            echo "  $0 --profile-json profile.json --notarize-only"
            echo "  $0 \"Epic-Main\" --profile-json profile.json --git-sync"
            echo "  $0 --profile-json profile.json --build-only --git-sync"
            exit 0
            ;;
        --mac-sign|--platform|--os)
            echo "[ERR] Flag '$1' is no longer supported. Configuration comes from Build Profile JSON." >&2
            echo "Use -h or --help for usage information" >&2
            exit 1
            ;;
        demo|main)
            echo "[ERR] Version parameter '$1' is no longer supported. Use --profile-json instead." >&2
            echo "Use -h or --help for usage information" >&2
            exit 1
            ;;
        *)
            # If CMD_PROFILE_NAME is empty and this isn't a flag, treat it as profile name
            if [ -z "$CMD_PROFILE_NAME" ] && [[ "$1" != --* ]]; then
                CMD_PROFILE_NAME="$1"
                shift
            else
                echo "[ERR] Unknown argument: $1" >&2
                echo "Use -h or --help for usage information" >&2
                exit 1
            fi
            ;;
    esac
done

# Validate --profile-json parameter
if [ -z "$PROFILE_JSON" ]; then
    echo "[ERR] --profile-json parameter is required" >&2
    echo "Use -h or --help for usage information" >&2
    exit 1
fi

# Validate --generated-vdfs-directory parameter
if [ -z "$GENERATED_VDFS_DIRECTORY" ]; then
    echo "[ERR] --generated-vdfs-directory parameter is required" >&2
    echo "Use -h or --help for usage information" >&2
    exit 1
fi

# Validate --mode parameter (if provided)
if [ -n "$MODE" ] && [ "$MODE" != "plugin" ] && [ "$MODE" != "enterprise" ]; then
    echo "[ERR] --mode must be either 'plugin' or 'enterprise'" >&2
    echo "Use -h or --help for usage information" >&2
    exit 1
fi

# Validate --engine parameter (if provided)
if [ -n "$ENGINE" ] && [ "$ENGINE" != "unity" ] && [ "$ENGINE" != "unreal" ]; then
    echo "[ERR] --engine must be either 'unity' or 'unreal'" >&2
    echo "Use -h or --help for usage information" >&2
    exit 1
fi

# Default mode to enterprise if not specified
if [ -z "$MODE" ]; then
    MODE="enterprise"
fi

# Default engine to unity for backward compatibility
if [ -z "$ENGINE" ]; then
    ENGINE="unity"
fi

# Check for CI environment when in plugin mode
if [ "$MODE" = "plugin" ]; then
    if detect_ci_environment; then
        echo "[WARN] CLI is running in Plugin mode inside a CI environment. This requires an Enterprise License." >&2
        echo "[WARN] Consider using --mode=enterprise for CI/CD workflows." >&2
    fi
fi

# Validate mutually exclusive flags
if [ "$BUILD_ONLY" = true ] && [ "$PUBLISH_ONLY" = true ]; then
    echo "[ERR] --build-only and --publish-only are mutually exclusive" >&2
    echo "Use -h or --help for usage information" >&2
    exit 1
fi

if [ "$BUILD_ONLY" = true ] && [ "$NOTARIZE_ONLY" = true ]; then
    echo "[ERR] --build-only and --notarize-only are mutually exclusive" >&2
    echo "Use -h or --help for usage information" >&2
    exit 1
fi

if [ "$PUBLISH_ONLY" = true ] && [ "$NOTARIZE_ONLY" = true ]; then
    echo "[ERR] --publish-only and --notarize-only are mutually exclusive" >&2
    echo "Use -h or --help for usage information" >&2
    exit 1
fi

# Convert relative path to absolute (needed when child scripts change directories)
if ! is_absolute_path "$PROFILE_JSON"; then
    # Relative path - make it absolute relative to current working directory
    PROFILE_JSON="$(cd "$(dirname "$PROFILE_JSON")" && pwd)/$(basename "$PROFILE_JSON")"
fi

# Validate JSON file exists and is readable
if [ ! -f "$PROFILE_JSON" ]; then
    echo "[ERR] JSON file not found: $PROFILE_JSON" >&2
    exit 1
fi

if [ ! -r "$PROFILE_JSON" ]; then
    echo "[ERR] JSON file is not readable: $PROFILE_JSON" >&2
    exit 1
fi

show_cadet_pro_banner

# Validate JSON structure
if ! validate_json_structure "$PROFILE_JSON"; then
    echo "[ERR] Invalid Build Profile JSON structure: $PROFILE_JSON" >&2
    exit 1
fi

# Load JSON profile (extracts values into environment variables)
if ! load_profile_json "$PROFILE_JSON"; then
    echo "[ERR] Failed to load Build Profile JSON: $PROFILE_JSON" >&2
    exit 1
fi

# Use profile name from command line if provided, otherwise use JSON profileName
if [ -n "$CMD_PROFILE_NAME" ]; then
    DISPLAY_PROFILE_NAME="$CMD_PROFILE_NAME"
else
    DISPLAY_PROFILE_NAME="$PROFILE_NAME"
fi

# Extract configuration from JSON (already loaded by load_profile_json)
PLATFORM="$PROFILE_PLATFORM"
OS="$PROFILE_OS"
BUNDLE_ID="$PROFILE_BUNDLE_ID"
MAC_SIGN_ENABLED="$MACOS_ENABLE_SIGNING"

# Enforce engine/profile matrix
if [ "$ENGINE" = "unity" ]; then
    if [ -z "${UNITY_EDITOR_PATH:-}" ] || [ -z "${UNITY_PROJECT_PATH:-}" ] || [ -z "${UNITY_BUILD_OUTPUT_PATH:-}" ] || [ -z "${UNITY_PROJECT_NAME:-}" ]; then
        echo "[ERR] --engine=unity requires a valid unity section (editorPath, projectPath, buildOutputPath, projectName)" >&2
        exit 1
    fi
elif [ "$ENGINE" = "unreal" ]; then
    if [ -z "${UNREAL_ENGINE_ROOT:-}" ] || [ -z "${UNREAL_PROJECT_PATH:-}" ] || [ -z "${UNREAL_BUILD_OUTPUT_PATH:-}" ] || [ -z "${UNREAL_PROJECT_NAME:-}" ] || [ -z "${UNREAL_BUILD_CONFIGURATION:-}" ]; then
        echo "[ERR] --engine=unreal requires a valid unreal section (engineRoot, projectPath, buildOutputPath, projectName, buildConfiguration)" >&2
        exit 1
    fi
fi

# Validate bundleId is provided
if [ -z "${BUNDLE_ID:-}" ]; then
    echo "[ERR] bundleId is required in Build Profile" >&2
    echo "[ERR] Add \"bundleId\": \"com.yourcompany.appname\" to your profile JSON" >&2
    exit 1
fi

# Check if git sync should be enabled from profile (unless explicitly set via command line)
# Only auto-enable if --git-sync wasn't explicitly passed and profile has useGit enabled
# IMPORTANT: Git sync should only run during builds, not during publish-only or notarize-only operations
if [ "$GIT_SYNC" != true ] && [ "${PROFILE_USE_GIT:-}" = "true" ] && [ "$PUBLISH_ONLY" != true ] && [ "$NOTARIZE_ONLY" != true ]; then
    GIT_SYNC=true
fi

# Disable git sync if we're only publishing or notarizing (git sync is only needed for builds)
if [ "$PUBLISH_ONLY" = true ] || [ "$NOTARIZE_ONLY" = true ]; then
    GIT_SYNC=false
fi

# BUILD_ONLY is now controlled solely by --build-only command line flag
# Profiles no longer have a buildOnly field

CLEANUP_JSON=""
if [[ "$PROFILE_JSON" == *"/Temp/"* ]] || [[ "$PROFILE_JSON" == *"/temp/"* ]]; then
    CLEANUP_JSON="$PROFILE_JSON"
fi

cleanup_json_file() {
    if [ -z "$CLEANUP_JSON" ] || [ ! -f "$CLEANUP_JSON" ]; then
        return 0
    fi

    if command -v rm.ape >/dev/null 2>&1; then
        rm.ape -f "$CLEANUP_JSON"
    else
        rm -f "$CLEANUP_JSON"
    fi
}

STATUS_FINALIZED=0
STATUS_ACTIVE_PHASE=""
STATUS_LAST_MESSAGE=""

set_status_phase() {
    STATUS_ACTIVE_PHASE="$1"
    STATUS_LAST_MESSAGE="$2"
}

clear_status_phase() {
    STATUS_ACTIVE_PHASE=""
}

update_status_message_from_exit_code() {
    local operation="$1"
    local exit_code="$2"

    if [ "$operation" = "steam_publish" ] && [ "$exit_code" -eq 21 ]; then
        STATUS_LAST_MESSAGE="Steam authentication failed. Re-enter Steam credentials in Publishing Tools and try again."
    fi
}

handle_status_interrupt() {
    STATUS_LAST_MESSAGE="Detached dist operation was cancelled."
    if [ -n "$STATUS_ACTIVE_PHASE" ]; then
        cadet_status_mark_cancelled "$STATUS_ACTIVE_PHASE" "$STATUS_LAST_MESSAGE"
    fi
    cadet_status_finalize "cancelled" "$STATUS_LAST_MESSAGE" 130
    STATUS_FINALIZED=1
    exit 130
}

handle_status_exit() {
    local exit_code="$1"

    if [ "$exit_code" -ne 0 ] && [ "$STATUS_FINALIZED" -ne 1 ]; then
        if [ -n "$STATUS_ACTIVE_PHASE" ]; then
            cadet_status_mark_failed "$STATUS_ACTIVE_PHASE" "$STATUS_LAST_MESSAGE"
        fi

        local final_message="$STATUS_LAST_MESSAGE"
        if [ -z "$final_message" ]; then
            final_message="Detached dist operation failed."
        fi

        cadet_status_finalize "failed" "$final_message" "$exit_code"
        STATUS_FINALIZED=1
    fi

    cleanup_json_file
}

log_dist "Build Profile: $DISPLAY_PROFILE_NAME"
log_dist "Engine: $ENGINE"
log_dist "Platform: $PLATFORM"
log_dist "Operating System: $OS"
if [ "$BUILD_ONLY" = true ]; then
    log_dist "Mode: Build only (no publishing)"
elif [ "$PUBLISH_ONLY" = true ]; then
    log_dist "Mode: Publish only (skip building)"
elif [ "$NOTARIZE_ONLY" = true ]; then
    log_dist "Mode: Notarize only (skip building and publishing)"
else
    case "$PLATFORM" in
        "epic")
            log_dist "Mode: Build and publish to Epic Game Store"
            ;;
        "steam")
            log_dist "Mode: Build and publish to Steam"
            ;;
        "both")
            log_dist "Mode: Build and publish to both Steam and Epic Game Store"
            ;;
        "none")
            log_dist "Mode: Build only (no publishing)"
            ;;
    esac
fi

if [ "$GIT_SYNC" = true ]; then
    log_dist "Git sync: Enabled (will clone or reset to origin)"
else
    log_dist "Git sync: Skipped (using local state)"
fi

if [ "$MAC_SIGN_ENABLED" = "true" ]; then
    log_dist "macOS signing: Enabled (will sign and notarize before publishing)"
else
    log_dist "macOS signing: Skipped"
fi

STATUS_FILE=""
if [ -n "$JOB_GUID" ] && [ -n "$LAUNCH_TOKEN" ] && [ -n "${STATUS_FILE_ARG:-}" ]; then
    STATUS_FILE="$STATUS_FILE_ARG"
fi

cadet_status_init "$STATUS_FILE" "$JOB_GUID" "$LAUNCH_TOKEN" "$DISPLAY_PROFILE_NAME"
trap 'handle_status_interrupt' INT TERM
trap 'handle_status_exit $?' EXIT

if [ "$GIT_SYNC" = true ]; then
    cadet_status_mark_running "git_sync" "Synchronizing repository"
    set_status_phase "git_sync" "Git sync failed."
else
    cadet_status_mark_skipped "git_sync" "Git sync skipped"
fi

if [ "$PUBLISH_ONLY" = true ] || [ "$NOTARIZE_ONLY" = true ]; then
    cadet_status_mark_skipped "unity_build" "Unity build skipped"
fi

if [ "$BUILD_ONLY" = true ] || [ "$PUBLISH_ONLY" = true ] || [ "$MAC_SIGN_ENABLED" != "true" ] || { [ "$OS" != "mac" ] && [ "$OS" != "both" ]; }; then
    cadet_status_mark_skipped "mac_sign_notarize" "macOS signing skipped"
fi

case "$PLATFORM" in
    "steam")
        cadet_status_mark_skipped "epic_publish" "Epic publish skipped"
        ;;
    "epic")
        cadet_status_mark_skipped "steam_publish" "Steam publish skipped"
        ;;
    "none")
        cadet_status_mark_skipped "steam_publish" "Steam publish skipped"
        cadet_status_mark_skipped "epic_publish" "Epic publish skipped"
        ;;
esac

#================================================================
# Cleanup and Git operations
#================================================================

# Delete the two specified files
rm_rf() {
  if command -v rm.ape >/dev/null 2>&1; then
    rm.ape -rf "$1"
  else
    rm -rf "$1"
  fi
}

# Remove a single file (uses Cosmos binaries on Windows)
rm_f() {
  if command -v rm.ape >/dev/null 2>&1; then
    rm.ape -f "$1"
  else
    rm -f "$1"
  fi
}

# Create directory (uses Cosmos binaries on Windows)
mkdir_p() {
  if command -v mkdir.ape >/dev/null 2>&1; then
    mkdir.ape -p "$1"
  else
    mkdir -p "$1"
  fi
}
rm_rf "Assets/AddressableAssetsData/link.xml"
rm_rf "Assets/AddressableAssetsData/link.xml.meta"
rm_rf "SerializedBuildInfo/"

# Git sync operations (only if requested)
# IMPORTANT: Operations run in Unity project directory, not CADET CLI directory
if [ "$GIT_SYNC" = true ]; then
    # Validate required fields
    if [ -z "$PROFILE_GIT_REPOSITORY" ]; then
        echo "[ERR] Git sync requested but no gitRepository specified in Build Profile" >&2
        exit 1
    fi
    
    if [ -z "$PROFILE_GIT_BRANCH" ]; then
        echo "[ERR] Git sync requested but no gitBranch specified in Build Profile" >&2
        exit 1
    fi
    
    if [ "$ENGINE" = "unreal" ]; then
        PROJECT_PATH_FOR_GIT="$UNREAL_PROJECT_PATH"
    else
        PROJECT_PATH_FOR_GIT="$UNITY_PROJECT_PATH"
    fi

    if [ -z "$PROJECT_PATH_FOR_GIT" ]; then
        echo "[ERR] Cannot perform git sync: projectPath not specified for engine '$ENGINE' in Build Profile" >&2
        exit 1
    fi
    
    log_dist "Performing git sync on Unity project..."
    log_dist "Project directory: $PROJECT_PATH_FOR_GIT"
    log_dist "Repository: $PROFILE_GIT_REPOSITORY"
    log_dist "Target branch: $PROFILE_GIT_BRANCH"
    
    # Save current directory
    CADET_DIR="$(pwd)"

    INSTALL_GIT_LFS_IF_MISSING="${PROFILE_INSTALL_GIT_LFS_IF_MISSING:-false}"

    ensure_git_lfs_available() {
        if [ "$INSTALL_GIT_LFS_IF_MISSING" != "true" ]; then
            return 0
        fi

        log_dist "Git LFS preflight enabled: checking git-lfs availability..."

        if ! "$GIT_CMD" lfs version >/dev/null 2>&1; then
            echo "[ERR] Git LFS preflight is enabled, but git-lfs is not installed or not available in PATH." >&2
            echo "[ERR] Install Git LFS and retry. See: https://git-lfs.com/" >&2
            if [ "$IS_WINDOWS" = true ]; then
                echo "[ERR] Windows hint: install Git LFS and ensure 'git lfs version' works from the configured git executable." >&2
            else
                echo "[ERR] macOS/Linux hint: install git-lfs via your package manager, then run 'git lfs install'." >&2
            fi
            return 1
        fi

        # Install LFS hooks for the current context.
        if "$GIT_CMD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
            log_dist "Running 'git lfs install --local'..."
            "$GIT_CMD" lfs install --local >/dev/null 2>&1 || {
                echo "[ERR] Failed to run 'git lfs install --local'. Ensure repository permissions are valid." >&2
                return 1
            }
        else
            log_dist "Running 'git lfs install --skip-repo'..."
            "$GIT_CMD" lfs install --skip-repo >/dev/null 2>&1 || {
                echo "[ERR] Failed to run 'git lfs install --skip-repo'." >&2
                return 1
            }
        fi

        log_dist "Git LFS preflight complete."
        return 0
    }
    
    # Check if project directory exists
    if [ ! -d "$PROJECT_PATH_FOR_GIT" ]; then
        log_dist "Project directory does not exist, creating it..."
        mkdir_p "$PROJECT_PATH_FOR_GIT" || {
            echo "[ERR] Failed to create project directory: $PROJECT_PATH_FOR_GIT" >&2
            exit 1
        }
    fi
    
    # Change to Unity project directory
    cd "$PROJECT_PATH_FOR_GIT" || {
        echo "[ERR] Failed to change to project directory: $PROJECT_PATH_FOR_GIT" >&2
        exit 1
    }

    ensure_git_lfs_available || {
        cd "$CADET_DIR"
        exit 1
    }
    
    # Clean up any stale git lock files from previous interrupted operations
    if [ -f ".git/index.lock" ]; then
        log_dist "Removing stale git lock file (.git/index.lock)..."
        rm_f ".git/index.lock" || {
            echo "[WARN] Failed to remove .git/index.lock - this may cause issues" >&2
        }
    fi
    
    # Detect whether the target directory is already a git worktree.
    # Do not rely on ".git" being a directory because worktrees use a file.
    IS_GIT_WORKTREE=false
    if "$GIT_CMD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        IS_GIT_WORKTREE=true
    fi

    if [ "$IS_GIT_WORKTREE" != true ]; then
        # Not a git worktree - perform a fresh clone
        if [ -e ".git" ]; then
            log_dist "Found .git entry that is not a valid worktree in this context; re-cloning."
        else
            log_dist "No valid git worktree found, performing fresh clone..."
        fi
        
        # Clone into current directory (which should be empty or we'll clone into it)
        # First go up one level, remove the dir, and clone fresh
        PARENT_DIR="$(dirname "$PROJECT_PATH_FOR_GIT")"
        PROJECT_FOLDER="$(basename "$PROJECT_PATH_FOR_GIT")"
        
        cd "$PARENT_DIR" || {
            echo "[ERR] Failed to change to parent directory: $PARENT_DIR" >&2
            exit 1
        }
        
        # Remove the empty/partial directory
        rm_rf "$PROJECT_FOLDER"
        
        # Clone the repository
        log_dist "Cloning repository..."
        "$GIT_CMD" clone --progress --branch "$PROFILE_GIT_BRANCH" "$PROFILE_GIT_REPOSITORY" "$PROJECT_FOLDER" 2>&1 || {
            echo "[ERR] Failed to clone repository: $PROFILE_GIT_REPOSITORY" >&2
            cd "$CADET_DIR"
            exit 1
        }
        log_dist "Clone completed"
        
        # Change back into the project directory
        cd "$PROJECT_PATH_FOR_GIT" || {
            echo "[ERR] Failed to change to cloned project directory: $PROJECT_PATH_FOR_GIT" >&2
            exit 1
        }

        # Apply local LFS hooks in the cloned repo when preflight is enabled.
        if [ "$INSTALL_GIT_LFS_IF_MISSING" = "true" ]; then
            "$GIT_CMD" lfs install --local >/dev/null 2>&1 || {
                echo "[ERR] Failed to run 'git lfs install --local' in cloned repository." >&2
                cd "$CADET_DIR"
                exit 1
            }
        fi
        
        log_dist "Repository cloned successfully"
    else
        # Existing git worktree found - force reset to match origin exactly
        log_dist "Git repository found, syncing with origin..."
        
        # Fetch latest from remote
        log_dist "Fetching from origin..."
        "$GIT_CMD" fetch --progress origin 2>&1 || {
            echo "[ERR] Failed to fetch from origin" >&2
            cd "$CADET_DIR"
            exit 1
        }
        log_dist "Fetch completed"
        
        # Discard all local changes before switching branches so checkout cannot fail
        # with "would be overwritten" errors from a dirty worktree.
        log_dist "Discarding local tracked changes before branch switch..."
        "$GIT_CMD" reset --hard HEAD 2>&1 || {
            echo "[ERR] Failed to discard tracked local changes before checkout" >&2
            cd "$CADET_DIR"
            exit 1
        }
        log_dist "Tracked changes discarded"

        # Remove untracked files/directories before checkout as well; this preserves ignored
        # Unity directories while preventing untracked path conflicts during branch switches.
        log_dist "Cleaning untracked files before branch switch..."
        "$GIT_CMD" clean -ffd 2>&1 || {
            echo "[ERR] Failed to clean untracked files before checkout" >&2
            cd "$CADET_DIR"
            exit 1
        }
        log_dist "Pre-checkout clean completed"

        # Force the local branch to match the fetched remote tip exactly.
        log_dist "Checking out branch: $PROFILE_GIT_BRANCH"
        "$GIT_CMD" checkout -B "$PROFILE_GIT_BRANCH" "origin/$PROFILE_GIT_BRANCH" 2>&1 || {
            echo "[ERR] Failed to checkout origin branch: $PROFILE_GIT_BRANCH" >&2
            cd "$CADET_DIR"
            exit 1
        }
        log_dist "Checkout completed"
        
        # Hard reset to match origin exactly
        log_dist "Resetting to origin/$PROFILE_GIT_BRANCH..."
        "$GIT_CMD" reset --hard "origin/$PROFILE_GIT_BRANCH" 2>&1 || {
            echo "[ERR] Failed to reset to origin/$PROFILE_GIT_BRANCH" >&2
            cd "$CADET_DIR"
            exit 1
        }
        log_dist "Reset completed"
        
        # Clean untracked files thoroughly, but preserve Unity-required directories
        # Unity needs Library/, Temp/, UserSettings/, etc. to function properly
        # We only clean untracked files (not ignored ones) to preserve Unity's working directories
        # Build artifacts in Bin/ will be cleaned, but Unity's internal directories are preserved
        log_dist "Cleaning untracked files and build artifacts..."
        # Use -ffd (without -x) to clean untracked files/directories but preserve ignored ones
        # This keeps Library/, Temp/, UserSettings/ intact while removing untracked build artifacts
        "$GIT_CMD" clean -ffd 2>&1 || {
            echo "[ERR] Failed to clean untracked files" >&2
            cd "$CADET_DIR"
            exit 1
        }
        log_dist "Clean completed"
        
        log_dist "Repository synced successfully"
    fi
    
    # Return to CADET directory
    cd "$CADET_DIR" || {
        echo "[ERR] Failed to return to CADET directory: $CADET_DIR" >&2
        exit 1
    }
    
    log_dist "Git sync completed successfully"
    cadet_status_mark_completed "git_sync" "Git sync completed"
    clear_status_phase
else
    log_dist "Git sync skipped - using local project state"
fi

#================================================================
# Build and publish logic
#================================================================

run_engine_build() {
    local return_dir
    return_dir="$(pwd)"

    local build_script="build.sh"
    local build_label="Unity"

    if [ "$ENGINE" = "unreal" ]; then
        build_script="Unreal/build.sh"
        build_label="Unreal"
    fi

    log_dist "Running $build_label build..."
    cadet_status_mark_running "unity_build" "Running $build_label build"
    set_status_phase "unity_build" "$build_label build failed."

    cd "$TOOLS_DIR" || return 1
    bash "$build_script" --profile-json "$PROFILE_JSON"
    local build_exit=$?

    cd "$return_dir" >/dev/null 2>&1 || true

    if [ $build_exit -ne 0 ]; then
        echo "[ERR] $build_label build failed with exit code $build_exit" >&2
        return $build_exit
    fi

    cadet_status_mark_completed "unity_build" "$build_label build completed"
    clear_status_phase
    return 0
}

# Function to run macOS signing (if enabled)
run_macos_signing() {
    # Only sign if enabled and OS is mac or both
    if [ "$MAC_SIGN_ENABLED" != "true" ]; then
        cadet_status_mark_skipped "mac_sign_notarize" "macOS signing skipped"
        return 0
    fi
    
    if [ "$OS" != "mac" ] && [ "$OS" != "both" ]; then
        cadet_status_mark_skipped "mac_sign_notarize" "macOS signing skipped"
        return 0
    fi
    
    log_dist "Running macOS signing and notarization..."
    cadet_status_mark_running "mac_sign_notarize" "Running macOS signing and notarization"
    set_status_phase "mac_sign_notarize" "macOS signing failed."
    (cd "$TOOLS_DIR/MacOS" && UNITY_BUNDLE_ID="$BUNDLE_ID" bash "./sign_and_upload.sh" --profile-json "$PROFILE_JSON")
    local sign_status=$?
    
    if [ $sign_status -ne 0 ]; then
        echo "[ERR] macOS signing failed with exit code $sign_status" >&2
        return $sign_status
    fi
    
    log_dist "macOS signing completed successfully."
    cadet_status_mark_completed "mac_sign_notarize" "macOS signing completed"
    clear_status_phase
    return 0
}

# Function to run Steam build and publish
run_steam() {
    local exit_code=0
    log_dist "Setting up Steam environment..."
    cd "$TOOLS_DIR/Steam" || return 1
    
    if [ "$BUILD_ONLY" = true ]; then
        log_dist "Running Steam build only..."
        run_engine_build
        exit_code=$?
        cd "$TOOLS_DIR/Steam" || return 1
        if [ $exit_code -ne 0 ]; then
            cd "$PROJECT_ROOT"
            return $exit_code
        fi
        cadet_status_mark_skipped "steam_publish" "Steam publish skipped"
        # NOTE: macOS signing/notarization is NOT run during build-only operations.
        # It should only run when explicitly requested via --notarize-only or during normal build-and-publish flow.
    elif [ "$PUBLISH_ONLY" = true ]; then
        # For Steam publishing, OS must be explicitly windows or mac (not "both")
        if [ "$OS" == "both" ]; then
            echo "[ERR] Steam publishing requires explicit OS parameter (windows or mac, not both)" >&2
            echo "[ERR] To publish both platforms, create separate Build Profiles or run twice" >&2
            cd "$PROJECT_ROOT"
            return 1
        fi
        log_dist "Running Steam publish only (skipping build)..."
        cadet_status_mark_skipped "unity_build" "Unity build skipped"

        if ! run_macos_signing; then
            cd "$PROJECT_ROOT"
            return 1
        fi

        cadet_status_mark_running "steam_publish" "Publishing Steam build"
        set_status_phase "steam_publish" "Steam publish failed."
        bash publish.sh --os "$OS" --profile-json "$PROFILE_JSON" --generated-vdfs-directory "$GENERATED_VDFS_DIRECTORY"
        exit_code=$?
        if [ $exit_code -ne 0 ]; then
            update_status_message_from_exit_code "steam_publish" "$exit_code"
            echo "[ERR] Steam publish failed with exit code $exit_code" >&2
            cd "$PROJECT_ROOT"
            return $exit_code
        fi
        cadet_status_mark_completed "steam_publish" "Steam publish completed"
        clear_status_phase
    else
        # For Steam publishing, OS must be explicitly windows or mac (not "both")
        if [ "$OS" == "both" ]; then
            echo "[ERR] Steam publishing requires explicit OS parameter (windows or mac, not both)" >&2
            echo "[ERR] To publish both platforms, create separate Build Profiles or run twice" >&2
            cd "$PROJECT_ROOT"
            return 1
        fi
        log_dist "Running Steam build and publish..."
        run_engine_build
        exit_code=$?
        cd "$TOOLS_DIR/Steam" || return 1
        if [ $exit_code -ne 0 ]; then
            cd "$PROJECT_ROOT"
            return $exit_code
        fi

        if ! run_macos_signing; then
            cd "$PROJECT_ROOT"
            return 1
        fi

        cadet_status_mark_running "steam_publish" "Publishing Steam build"
        set_status_phase "steam_publish" "Steam publish failed."
        bash publish.sh --os "$OS" --profile-json "$PROFILE_JSON" --generated-vdfs-directory "$GENERATED_VDFS_DIRECTORY"
        exit_code=$?
        if [ $exit_code -ne 0 ]; then
            update_status_message_from_exit_code "steam_publish" "$exit_code"
            echo "[ERR] Steam publish failed with exit code $exit_code" >&2
            cd "$PROJECT_ROOT"
            return $exit_code
        fi
        cadet_status_mark_completed "steam_publish" "Steam publish completed"
        clear_status_phase
    fi
    
    cd "$PROJECT_ROOT" || return 1
    return 0
}

# Function to run Epic build and publish
run_epic() {
    local exit_code=0
    log_dist "Setting up Epic environment..."
    cd "$TOOLS_DIR/Epic" || return 1
    
    if [ "$BUILD_ONLY" = true ]; then
        log_dist "Running Epic build only..."
        run_engine_build
        exit_code=$?
        cd "$TOOLS_DIR/Epic" || return 1
        if [ $exit_code -ne 0 ]; then
            cd "$PROJECT_ROOT"
            return $exit_code
        fi
        cadet_status_mark_skipped "epic_publish" "Epic publish skipped"
        # NOTE: macOS signing/notarization is NOT run during build-only operations.
        # It should only run when explicitly requested via --notarize-only or during normal build-and-publish flow.
    elif [ "$PUBLISH_ONLY" = true ]; then
        log_dist "Running Epic publish only (skipping build)..."
        cadet_status_mark_skipped "unity_build" "Unity build skipped"

        if ! run_macos_signing; then
            cd "$PROJECT_ROOT"
            return 1
        fi

        cadet_status_mark_running "epic_publish" "Publishing Epic build"
        set_status_phase "epic_publish" "Epic publish failed."
        bash publish.sh --os "$OS" --profile-json "$PROFILE_JSON"
        exit_code=$?
        if [ $exit_code -ne 0 ]; then
            echo "[ERR] Epic publish failed with exit code $exit_code" >&2
            cd "$PROJECT_ROOT"
            return $exit_code
        fi
        cadet_status_mark_completed "epic_publish" "Epic publish completed"
        clear_status_phase
    else
        log_dist "Running Epic build and publish..."
        run_engine_build
        exit_code=$?
        cd "$TOOLS_DIR/Epic" || return 1
        if [ $exit_code -ne 0 ]; then
            cd "$PROJECT_ROOT"
            return $exit_code
        fi
        # Run macOS signing if enabled (Epic doesn't have signing in its scripts)
        if ! run_macos_signing; then
            cd "$PROJECT_ROOT"
            return 1
        fi
        cadet_status_mark_running "epic_publish" "Publishing Epic build"
        set_status_phase "epic_publish" "Epic publish failed."
        bash publish.sh --os "$OS" --profile-json "$PROFILE_JSON"
        exit_code=$?
        if [ $exit_code -ne 0 ]; then
            echo "[ERR] Epic publish failed with exit code $exit_code" >&2
            cd "$PROJECT_ROOT"
            return $exit_code
        fi
        cadet_status_mark_completed "epic_publish" "Epic publish completed"
        clear_status_phase
    fi
    
    cd "$PROJECT_ROOT" || return 1
    return 0
}

# Execute the appropriate build and publish functions based on platform
# If --notarize-only is set, skip build and publish, only run macOS signing
if [ "$NOTARIZE_ONLY" = true ]; then
    # Validate that macOS signing is enabled in profile
    if [ "$MAC_SIGN_ENABLED" != "true" ]; then
        echo "[ERR] --notarize-only requires enableSigning to be true in Build Profile" >&2
        exit 1
    fi
    
    # Validate that OS is mac or both
    if [ "$OS" != "mac" ] && [ "$OS" != "both" ]; then
        echo "[ERR] --notarize-only requires OS to be 'mac' or 'both' in Build Profile" >&2
        exit 1
    fi

    cadet_status_mark_skipped "steam_publish" "Steam publish skipped"
    cadet_status_mark_skipped "epic_publish" "Epic publish skipped"
    
    log_dist "Running macOS signing and notarization only..."
    if ! run_macos_signing; then
        echo "[ERR] macOS signing and notarization failed" >&2
        exit 1
    fi
else
    # Normal build/publish flow
    case "$PLATFORM" in
        "steam")
            if ! run_steam; then
                echo "[ERR] Steam build/publish failed" >&2
                exit 1
            fi
            ;;
        "epic")
            if ! run_epic; then
                echo "[ERR] Epic build/publish failed" >&2
                exit 1
            fi
            ;;
        "both")
            if ! run_steam; then
                echo "[ERR] Steam build/publish failed" >&2
                exit 1
            fi
            if ! run_epic; then
                echo "[ERR] Epic build/publish failed" >&2
                exit 1
            fi
            ;;
        "none")
            log_dist "Building project only (no publishing)..."
            run_engine_build
            build_exit=$?
            if [ $build_exit -ne 0 ]; then
                exit 1
            fi
            cadet_status_mark_skipped "steam_publish" "Steam publish skipped"
            cadet_status_mark_skipped "epic_publish" "Epic publish skipped"
            ;;
    esac
fi

log_dist "All operations completed successfully"
cadet_status_finalize "completed" "All operations completed successfully" 0
STATUS_FINALIZED=1
exit 0


