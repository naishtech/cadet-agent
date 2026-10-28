#!/usr/bin/env bash

#================================================================
# Tools/Epic/publish.sh (JSON refactor - Task 1.7)
#================================================================
# - Reads Epic IDs + BuildPatchTool path from Build Profile JSON
# - Loads credentials from user directory only: $HOME/.env_cadet_epic_credentials
#   (expects CLIENT_ID and CLIENT_SECRET)
# - Accepts:
#     --profile-json <path>   (required)
#     --os windows|mac        (required target OS)
#
# Notes:
# - Avoids bash "pipefail" option for Cosmos compatibility.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"

source "$SCRIPT_DIR/../Util/json_parser.sh"
source "$SCRIPT_DIR/../Util/logging.sh"

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

PROFILE_JSON=""
OS_PARAM=""

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
    -h|--help)
      echo "Usage: $0 --profile-json <path> --os <windows|mac>"
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

if ! validate_json_structure "$PROFILE_JSON"; then
  exit 1
fi

if ! load_profile_json "$PROFILE_JSON"; then
  exit 1
fi

# EPIC_LABEL is optional - if empty, labeling will be skipped
# Remove any default fallback to allow users to disable labeling by clearing the field

if [ "${PROFILE_PLATFORM:-}" != "epic" ] && [ "${PROFILE_PLATFORM:-}" != "both" ]; then
  echo "[ERR] Profile platform must be 'epic' or 'both' for Epic publish (got: ${PROFILE_PLATFORM:-})" >&2
  exit 1
fi

# Required Epic fields
if [ -z "${EPIC_PRODUCT_ID:-}" ]; then
  echo "[ERR] Required field missing: epic.productId" >&2
  exit 1
fi
if [ -z "${EPIC_ORGANIZATION_ID:-}" ]; then
  echo "[ERR] Required field missing: epic.organizationId" >&2
  exit 1
fi
if [ -z "${EPIC_ARTIFACT_ID:-}" ]; then
  echo "[ERR] Required field missing: epic.artifactId" >&2
  exit 1
fi
if [ -z "${EPIC_SANDBOX_ID:-}" ]; then
  echo "[ERR] Required field missing: epic.sandboxId" >&2
  exit 1
fi
if [ -z "${EPIC_BUILDPATCHTOOL_PATH:-}" ]; then
  echo "[ERR] Required field missing: epic.buildPatchToolPath" >&2
  exit 1
fi

# Validate Unity project name is set
if [ -z "${UNITY_PROJECT_NAME:-}" ]; then
  echo "[ERR] Required field missing: unity.projectName" >&2
  exit 1
fi

# Credentials - check environment variables first, then fall back to file
if [ -z "${CLIENT_ID:-}" ] || [ -z "${CLIENT_SECRET:-}" ]; then
  # Load from file if not in environment
  EPIC_CREDS_FILE="$HOME/.env_cadet_epic_credentials"
  if [ ! -f "$EPIC_CREDS_FILE" ]; then
    echo "[ERR] Epic credentials not found in environment and file not found: $EPIC_CREDS_FILE" >&2
    exit 1
  fi
  log_publish "Loading Epic credentials from file: $EPIC_CREDS_FILE"
  while IFS='=' read -r key value || [ -n "$key" ]; do
    if [[ -n "$key" && "$key" != \#* ]]; then
      value="${value%$'\r'}"
      export "$key=$value"
    fi
  done < "$EPIC_CREDS_FILE"
else
  log_publish "Using Epic credentials from environment variables"
fi

if [ -z "${CLIENT_ID:-}" ] || [ -z "${CLIENT_SECRET:-}" ]; then
  echo "[ERR] Missing Epic credentials (need CLIENT_ID/CLIENT_SECRET in environment variables or credentials file)" >&2
  exit 1
fi

# Paths used by BuildPatchTool. Keep these stable and non-destructive in tests.
# Use unity.buildOutputPath from the profile (loaded as UNITY_BUILD_OUTPUT_PATH)
if [ -z "${UNITY_BUILD_OUTPUT_PATH:-}" ]; then
  echo "[ERR] Required field missing: unity.buildOutputPath" >&2
  exit 1
fi
BUILD_ROOT_BASE="$UNITY_BUILD_OUTPUT_PATH"

# Map OS_PARAM to directory name (windows -> windows, mac -> macos)
if [ "$OS_PARAM" = "windows" ]; then
  OS_DIR="windows"
else
  OS_DIR="macos"
fi

CLOUD_DIR="$BUILD_ROOT_BASE/epic/$OS_DIR/CloudDir"
if command -v mkdir.ape >/dev/null 2>&1; then
  mkdir.ape -p "$CLOUD_DIR"
else
  mkdir -p "$CLOUD_DIR"
fi

# EPIC_BUILDPATCHTOOL_PATH should contain the full path to the OS-specific binary
# (populated by Unity based on the profile's OS setting, similar to steamcmdExe/steamcmdSh)
BPT_BINARY="$EPIC_BUILDPATCHTOOL_PATH"

# Convert relative path to absolute for consistency
# If path is relative, resolve it relative to project root
if ! is_absolute_path "$BPT_BINARY"; then
  # Check if file exists relative to project root
  if [ -f "$PROJECT_ROOT/$BPT_BINARY" ]; then
    BPT_BINARY="$PROJECT_ROOT/$BPT_BINARY"
  # Check if file exists relative to current directory
  elif [ -f "$BPT_BINARY" ]; then
    # Convert to absolute path
    BPT_BINARY="$(cd "$(dirname "$BPT_BINARY")" && pwd)/$(basename "$BPT_BINARY")"
  else
    # Try project root as fallback
    BPT_BINARY="$PROJECT_ROOT/$BPT_BINARY"
  fi
fi

# Check if BuildPatchTool binary exists
# For .sh scripts, we only need to check if file exists (bash can run scripts even if not marked executable)
if [ ! -f "$BPT_BINARY" ]; then
  echo "[ERR] BuildPatchTool binary not found: $BPT_BINARY" >&2
  exit 1
fi

# Change to BuildPatchTool directory so it can find Engine/Content/Internationalization/ folder
ORIGINAL_DIR="$(pwd)"
BPT_DIR="$(dirname "$BPT_BINARY")"
cd "$BPT_DIR" || {
  echo "[ERR] Cannot change to BuildPatchTool directory: $BPT_DIR" >&2
  exit 1
}

log_publish "Epic publish started (os=$OS_PARAM)"
log_publish "Using BuildPatchTool: $BPT_BINARY"
log_publish "Running from BuildPatchTool directory: $BPT_DIR"

# Function to resolve build version
# NOTE: This function must ONLY output the version to stdout (for capture)
# All log messages must go to stderr (>&2)
resolve_build_version() {
  log_publish "Checking version resolution settings..." >&2
  log_publish "EPIC_USE_GIT_TAG_FOR_VERSION=${EPIC_USE_GIT_TAG_FOR_VERSION:-not set}" >&2
  log_publish "EPIC_BUILD_VERSION=${EPIC_BUILD_VERSION:-not set}" >&2
  
  if [ "${EPIC_USE_GIT_TAG_FOR_VERSION:-}" = "true" ]; then
    # Use git tag for versioning
    log_publish "Resolving version from latest git tag..." >&2
    
    # Change to Unity project directory to get git tags
    if [ -z "${UNITY_PROJECT_PATH:-}" ]; then
      echo "[ERR] UNITY_PROJECT_PATH is not set. Cannot resolve git tag." >&2
      return 1
    fi
    
    cd "$UNITY_PROJECT_PATH" || {
      echo "[ERR] Failed to change to Unity project directory: $UNITY_PROJECT_PATH" >&2
      return 1
    }
    
    # Get latest tag, removing 'v' prefix if present
    local git_tag
    git_tag=$(git describe --tags --abbrev=0 2>/dev/null)
    
    if [ -z "$git_tag" ]; then
      echo "[WARN] No git tags found. Falling back to timestamp-based version." >&2
      # Generate timestamp-based version as fallback (YYYYMMDD.HHMMSS)
      local timestamp_version
      timestamp_version=$(date +"%Y%m%d.%H%M%S")
      cd "$PROJECT_ROOT"
      # Only output the version to stdout
      echo "$timestamp_version"
      return 0
    fi
    
    # Remove 'v' prefix if present
    if [[ "$git_tag" == v* ]]; then
      git_tag="${git_tag#v}"
    fi
    
    cd "$PROJECT_ROOT"
    
    # Append timestamp to make version unique for each upload
    # Format: <git_tag>.<timestamp> (e.g., 1.1.0.20251225140351)
    local timestamp
    timestamp=$(date +"%Y%m%d%H%M%S")
    local unique_version="${git_tag}.${timestamp}"
    
    log_publish "Git tag version: $git_tag" >&2
    log_publish "Appending timestamp for uniqueness: $unique_version" >&2
    
    # Only output the version to stdout
    echo "$unique_version"
    return 0
  else
    # Use manual version from profile
    if [ -n "${EPIC_BUILD_VERSION:-}" ]; then
      log_publish "Using manual build version from profile: ${EPIC_BUILD_VERSION}" >&2
      # Only output the version to stdout
      echo "${EPIC_BUILD_VERSION}"
    else
      echo "[WARN] No build version specified and git tag not enabled. Using default version 0.0.0" >&2
      echo "[WARN] Please set epic.buildVersion in your profile or enable epic.useGitTagForVersion" >&2
      # Only output the version to stdout
      echo "0.0.0"
    fi
    return 0
  fi
}

BUILD_VERSION=$(resolve_build_version)
if [ $? -ne 0 ]; then
  echo "[ERR] Failed to resolve build version" >&2
  exit 1
fi

# Validate and print the resolved version
if [ -z "$BUILD_VERSION" ]; then
  echo "[ERR] Build version is empty!" >&2
  exit 1
fi

if [ ${#BUILD_VERSION} -gt 100 ]; then
  echo "[ERR] Build version exceeds 100 characters: ${#BUILD_VERSION} chars" >&2
  echo "[ERR] Version value: $BUILD_VERSION" >&2
  exit 1
fi

log_publish "========================================"
log_publish "Resolved build version: '$BUILD_VERSION'"
log_publish "Version length: ${#BUILD_VERSION} characters"
log_publish "========================================"

# Function to delete an existing build version (if it exists)
delete_build_version() {
  local platform="$1"      # Windows | Mac
  local build_version="$2"
  
  log_publish "Attempting to delete existing build version '$build_version' for platform $platform..."
  log_publish "Delete command will use: -BuildVersion=\"$build_version\""
  
  # Run command with stderr fully suppressed to avoid bash's SIGTRAP reporting on Windows/Cosmos
  # Use command grouping { } to ensure stderr redirection applies to bash's signal reporting
  set +e  # Temporarily disable exit on error
  {
    "./$(basename "$BPT_BINARY")" \
      -OrganizationId="$EPIC_ORGANIZATION_ID" \
      -ProductId="$EPIC_PRODUCT_ID" \
      -ArtifactId="$EPIC_ARTIFACT_ID" \
      -SandboxId="$EPIC_SANDBOX_ID" \
      -ClientId="$CLIENT_ID" \
      -ClientSecret="$CLIENT_SECRET" \
      -mode=DeleteBinary \
      -BuildVersion="$build_version" \
      -Platform="$platform" >/dev/null 2>&1
  } 2>/dev/null
  local delete_exit_code=$?
  set -e  # Re-enable exit on error
  
  # Exit code 133 = 128 + 5 (SIGTRAP) - common on Windows/Cosmos, treat as acceptable
  # Exit code 0 = success (build was deleted)
  # Any other exit code = build didn't exist or other error (both are acceptable for DeleteBinary)
  if [ $delete_exit_code -eq 0 ]; then
    log_publish "Successfully deleted build version '$build_version'"
  elif [ $delete_exit_code -eq 133 ]; then
    # SIGTRAP on Windows/Cosmos - this is a known issue and can be ignored
    log_publish "Build version '$build_version' deletion attempted (SIGTRAP on Windows/Cosmos, treating as OK)"
  else
    # DeleteBinary may fail if the build doesn't exist, which is fine
    log_publish "Build version '$build_version' does not exist or could not be deleted (this is OK if it's a new version)"
  fi
}

# Function to check if stdbuf is available (for unbuffered output)
has_stdbuf() {
  command -v stdbuf >/dev/null 2>&1
}

run_upload_and_label() {
  local platform="$1"      # Windows | Mac
  local build_root="$2"    # path to build root
  
  # Determine the executable name based on platform
  # Windows: projectName.exe, Mac: projectName.app/Contents/MacOS/projectName
  local app_launch
  if [ "$platform" = "Windows" ]; then
    app_launch="${UNITY_PROJECT_NAME}.exe"
  else
    # macOS .app bundles contain the executable at Contents/MacOS/<executable>
    app_launch="${UNITY_PROJECT_NAME}.app/Contents/MacOS/${UNITY_PROJECT_NAME}"
  fi

  # Validate that the launch executable exists
  # Note: For tests, this check may fail if build output doesn't exist - allow it to proceed with a warning
  local launch_path="${build_root}/${app_launch}"
  if [ ! -f "$launch_path" ]; then
    echo "[WARN] Launch executable not found: $launch_path" >&2
    echo "[WARN] Build root: $build_root" >&2
    echo "[WARN] Expected executable: $app_launch" >&2
    if [ "$platform" = "Mac" ]; then
      echo "[WARN] For macOS builds, ensure the .app bundle exists at: ${build_root}/${UNITY_PROJECT_NAME}.app" >&2
      echo "[WARN] And that the executable exists at: ${build_root}/${UNITY_PROJECT_NAME}.app/Contents/MacOS/${UNITY_PROJECT_NAME}" >&2
    fi
    echo "[WARN] Continuing anyway (this may be a test scenario)" >&2
    # Don't return error - allow tests to proceed without actual build output
  fi

  # Delete existing build version before uploading (to avoid "Build already exists" error)
  # Note: BuildPatchTool doesn't have a query/list mode to check if build exists first
  # So we attempt deletion and handle errors gracefully (including SIGTRAP on Windows/Cosmos)
  delete_build_version "$platform" "$BUILD_VERSION"

  local upload_exit_code=0
  local label_exit_code=0

  # Run UploadBinary operation
  log_publish "Uploading binary to Epic..."
  log_publish "BuildVersion being used: '$BUILD_VERSION'"
  log_publish "BuildRoot: $build_root"
  log_publish "AppLaunch: $app_launch"
  log_publish "Platform: $platform"
  
  # Build UploadBinary command arguments
  local upload_args=(
    -OrganizationId="$EPIC_ORGANIZATION_ID"
    -ProductId="$EPIC_PRODUCT_ID"
    -ArtifactId="$EPIC_ARTIFACT_ID"
    -SandboxId="$EPIC_SANDBOX_ID"
    -ClientId="$CLIENT_ID"
    -ClientSecret="$CLIENT_SECRET"
    -mode=UploadBinary
    -BuildRoot="$build_root"
    -CloudDir="$CLOUD_DIR"
    -BuildVersion="$BUILD_VERSION"
    -AppLaunch="$app_launch"
    -AppArgs=""
    -Platform="$platform"
  )
  
  if [[ "$BPT_BINARY" == *.sh ]]; then
    log_publish "Executing BuildPatchTool (bash script)..."
    if has_stdbuf; then
      stdbuf -oL -eL bash "./$(basename "$BPT_BINARY")" "${upload_args[@]}" || upload_exit_code=$?
    else
      bash "./$(basename "$BPT_BINARY")" "${upload_args[@]}" || upload_exit_code=$?
    fi
  else
    # Temporarily disable error exit to capture exit code
    set +e
    log_publish "Executing BuildPatchTool (binary)..."
    log_publish "Command: ./$(basename "$BPT_BINARY") -mode=UploadBinary -BuildVersion=\"$BUILD_VERSION\" ..."
    if has_stdbuf; then
      stdbuf -oL -eL "./$(basename "$BPT_BINARY")" "${upload_args[@]}"
      upload_exit_code=$?
    else
      "./$(basename "$BPT_BINARY")" "${upload_args[@]}"
      upload_exit_code=$?
    fi
    set -e
    log_publish "BuildPatchTool UploadBinary exited with code: $upload_exit_code"
  fi

  if [ $upload_exit_code -ne 0 ]; then
    echo "[ERR] UploadBinary failed with exit code $upload_exit_code" >&2
    return $upload_exit_code
  fi

  log_publish "Binary uploaded successfully."
  
  # Run LabelBinary operation only if EPIC_LABEL is set and not empty
  # NOTE: Labeling is optional - if label is empty, skip labeling entirely
  if [ -z "${EPIC_LABEL:-}" ]; then
    log_publish "Label field is empty - skipping labeling step."
    log_publish "Binary can be labeled manually in the Epic dashboard if needed."
    return 0
  fi
  
  log_publish "Applying label '$EPIC_LABEL'..."
  log_publish "Labeling binary with version: '$BUILD_VERSION', label: '$EPIC_LABEL'"
  
  # Build LabelBinary command arguments
  local label_args=(
    -OrganizationId="$EPIC_ORGANIZATION_ID"
    -ProductId="$EPIC_PRODUCT_ID"
    -ArtifactId="$EPIC_ARTIFACT_ID"
    -SandboxId="$EPIC_SANDBOX_ID"
    -ClientId="$CLIENT_ID"
    -ClientSecret="$CLIENT_SECRET"
    -mode=LabelBinary
    -BuildVersion="$BUILD_VERSION"
    -Label="$EPIC_LABEL"
    -Platform="$platform"
  )
  
  if [[ "$BPT_BINARY" == *.sh ]]; then
    set +e  # Temporarily disable exit on error
    if has_stdbuf; then
      stdbuf -oL -eL bash "./$(basename "$BPT_BINARY")" "${label_args[@]}" 2>&1
      label_exit_code=$?
    else
      bash "./$(basename "$BPT_BINARY")" "${label_args[@]}" 2>&1
      label_exit_code=$?
    fi
    set -e  # Re-enable exit on error
  else
    # Temporarily disable error exit to capture exit code
    set +e
    if has_stdbuf; then
      stdbuf -oL -eL "./$(basename "$BPT_BINARY")" "${label_args[@]}" 2>&1
      label_exit_code=$?
    else
      "./$(basename "$BPT_BINARY")" "${label_args[@]}" 2>&1
      label_exit_code=$?
    fi
    set -e  # Re-enable exit on error
    log_publish "BuildPatchTool LabelBinary exited with code: $label_exit_code"
  fi

  if [ $label_exit_code -ne 0 ]; then
    echo "[WARN] LabelBinary failed with exit code $label_exit_code" >&2
    echo "[WARN] Binary was uploaded successfully but labeling failed." >&2
    echo "[WARN] This may be a permissions issue or the label may already exist." >&2
    echo "[WARN] Please verify your Epic credentials and organization permissions." >&2
    echo "[WARN] The upload completed successfully - you can label it manually in the Epic dashboard if needed." >&2
    log_publish "Epic publish completed successfully (upload succeeded, labeling failed - this is non-fatal)" >&2
    # Don't fail the entire publish if only labeling failed - upload succeeded
    # Return 0 to indicate overall success (upload worked, label is optional)
    return 0
  fi

  log_publish "Binary labeled successfully with label '$EPIC_LABEL'."
  return 0
}

if [ "$OS_PARAM" = "windows" ]; then
  if ! run_upload_and_label "Windows" "$BUILD_ROOT_BASE/windows"; then
    exit_code=$?
    echo "[ERR] Epic publish failed with exit code $exit_code" >&2
    exit $exit_code
  fi
else
  if ! run_upload_and_label "Mac" "$BUILD_ROOT_BASE/macos"; then
    exit_code=$?
    echo "[ERR] Epic publish failed with exit code $exit_code" >&2
    exit $exit_code
  fi
fi

# Return to original directory
cd "$ORIGINAL_DIR" || {
  echo "[ERR] Cannot return to original directory: $ORIGINAL_DIR" >&2
  exit 1
}

log_publish "Epic publish complete."
exit 0


