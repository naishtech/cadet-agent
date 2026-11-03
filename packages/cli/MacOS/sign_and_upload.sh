#!/bin/bash

#================================================================
# Tools/MacOS/sign_and_upload.sh (Task 1.8)
#================================================================
# macOS signing + notarization helper.
#
# Notes for this repo:
# - Credentials remain in user directory: $HOME/.env_cadet_mac_creds
# - For Windows/Cosmos testability, this script supports:
#     --dry-run       Print intended commands and exit 0 without executing macOS tools
#     --profile-json  Accepted for consistency (ignored)
# - Avoids `set -o pipefail` for Cosmos compatibility.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source JSON utilities
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

DRY_RUN=false
PROFILE_JSON=""

show_help() {
  echo "Usage: $0 [OPTION]"
  echo ""
  echo "Options:"
  echo "  --codesign     Run only the code signing process"
  echo "  --zip          Run only the zip creation for notarization"
  echo "  --upload       Run only the upload to Apple notarization service"
  echo "  --ping         Check notarization status (requires REQUEST_UUID)"
  echo "  --staple       Run only the notarization stapling"
  echo "  --check        Run only the signature verification"
  echo "  --dry-run      Print intended commands only (no macOS tool execution)"
  echo "  --profile-json Accepted for consistency (ignored)"
  echo "  --help, -h     Show this help message"
  echo ""
  echo "If no option is provided, all steps will be executed in sequence."
}

# Load credentials - check environment variables first, then fall back to file
load_creds() {
  # Check if credentials already in environment
  if [ -n "${APPLE_ID:-}" ] && [ -n "${GEN_PW:-}" ] && [ -n "${TEAM_ID:-}" ] && [ -n "${DEV_ID:-}" ]; then
    log_sign "Using macOS credentials from environment variables"
  else
    # Load from file if not all env vars are set
    ENV_FILE="${HOME}/.env_cadet_mac_creds"
    if [ -f "${ENV_FILE}" ]; then
      log_sign "Loading macOS credentials from file: ${ENV_FILE}"
      # shellcheck disable=SC1090
      set -a
      source "${ENV_FILE}"
      set +a
    fi
    # Note: macOS script uses defaults if credentials are missing, so no error/warning here
  fi
}

run_cmd() {
  if $DRY_RUN; then
    echo "DRY_RUN: $*"
    return 0
  fi
  "$@"
}

# Configurable Variables (defaults retained)
WORKING_DIR=${WORKING_DIR:-"../../Bin/macos"}
APP=${APP:-"Dolven"}
ENTITLEMENTS=${ENTITLEMENTS:-"../../Tools/macos/Dolven.entitlements"}
DEV_ID=${DEV_ID:-"Developer ID Application: Andrew Naish (K2J6AHHBA2)"}
APPLE_ID=${APPLE_ID:-"andrewgnaish@gmail.com"}
GEN_PW=${GEN_PW:-""}
TEAM_ID=${TEAM_ID:-"K2J6AHHBA2"}
UNITY_BUNDLE_ID="${UNITY_BUNDLE_ID}"
REQUEST_UUID=${REQUEST_UUID:-""}

# Validate UNITY_BUNDLE_ID is provided
if [ -z "${UNITY_BUNDLE_ID:-}" ]; then
    echo "[ERR] UNITY_BUNDLE_ID environment variable is required" >&2
    echo "[ERR] This should be set by dist.sh from the Build Profile bundleId field" >&2
    exit 1
fi

# Determine version (best-effort; legacy Steam app_build.vdf extraction removed)
get_version() {
  # First priority: Check if VERSION is explicitly set in environment
  if [ -n "${VERSION:-}" ]; then
    echo "Using VERSION from environment: ${VERSION}"
    export VERSION
    return 0
  fi

  # Second priority: Try to get version from git tags if git is enabled
  if [ "${PROFILE_USE_GIT:-}" = "true" ] && [ -n "${UNITY_PROJECT_PATH:-}" ]; then
    if [ -d "${UNITY_PROJECT_PATH}/.git" ]; then
      # Use subshell to run git commands in the Unity project directory
      # This avoids needing to save/restore the current directory
      local git_version=""
      if (cd "${UNITY_PROJECT_PATH}" && git describe --tags --abbrev=0 >/dev/null 2>&1); then
        git_version="$(cd "${UNITY_PROJECT_PATH}" && git describe --tags --abbrev=0)"
        # Remove 'v' prefix if present (e.g., "v1.2.3" -> "1.2.3")
        git_version="${git_version#v}"
      elif (cd "${UNITY_PROJECT_PATH}" && git describe --tags >/dev/null 2>&1); then
        git_version="$(cd "${UNITY_PROJECT_PATH}" && git describe --tags)"
        # Remove 'v' prefix if present
        git_version="${git_version#v}"
        # Remove commit hash and dash (e.g., "1.2.3-abc123" -> "1.2.3")
        git_version="${git_version%-*}"
      fi
      
      if [ -n "$git_version" ]; then
        echo "Using VERSION from git tag: ${git_version}"
        VERSION="$git_version"
        export VERSION
        return 0
      else
        echo "Warning: Git is enabled but no git tags found in ${UNITY_PROJECT_PATH}"
      fi
    else
      echo "Warning: Git is enabled but .git directory not found in ${UNITY_PROJECT_PATH}"
    fi
  fi

  # Fallback: Use default version
  echo "VERSION not provided; using default version"
  VERSION="1.0.0.0"
  export VERSION
}

codesign_app() {
  echo "Making build executable..."
  if command -v chmod.ape >/dev/null 2>&1; then
    run_cmd chmod.ape -R a+xr "${APP}.app"
  else
    run_cmd chmod -R a+xr "${APP}.app"
  fi
  echo "Signing internal binaries and frameworks..."
  if command -v find.ape >/dev/null 2>&1; then
    run_cmd find.ape "./${APP}.app" -type f -exec \
      codesign --timestamp -s "${DEV_ID}" -f --verbose=9 \
      --options runtime --entitlements "${ENTITLEMENTS}" {} +
  else
    run_cmd find "./${APP}.app" -type f -exec \
      codesign --timestamp -s "${DEV_ID}" -f --verbose=9 \
      --options runtime --entitlements "${ENTITLEMENTS}" {} +
  fi
  echo "Signing main app bundle..."
  run_cmd codesign --deep --force --verify --verbose --timestamp --options runtime \
    --entitlements "${ENTITLEMENTS}" --sign "${DEV_ID}" "${APP}.app"
}

zip_app() {
  ZIP_FILE="${WORKING_DIR}/${VERSION}-${APP}.zip"
  echo "Zipping app for notarization: ${ZIP_FILE}" >&2
  run_cmd ditto -c -k --sequesterRsrc --keepParent "${APP}.app" "${ZIP_FILE}"
  echo "${ZIP_FILE}"
}

upload() {
  local zip_file="${1:-${VERSION}-${APP}.zip}"
  if [[ "${zip_file}" != */* ]]; then
    zip_file="${WORKING_DIR}/${zip_file}"
  fi
  echo "Submitting to Apple notarization service..."
  echo "Using zip file: ${zip_file}"
  if [ -n "${GEN_PW}" ]; then
    # Use stdbuf to disable output buffering for real-time progress logs
    if command -v stdbuf >/dev/null 2>&1; then
      run_cmd stdbuf -oL -eL xcrun notarytool submit --apple-id "${APPLE_ID}" --team-id "${TEAM_ID}" \
        --password "${GEN_PW}" "${zip_file}" --wait
    else
      # Fallback if stdbuf is not available (shouldn't happen on macOS)
      run_cmd xcrun notarytool submit --apple-id "${APPLE_ID}" --team-id "${TEAM_ID}" \
        --password "${GEN_PW}" "${zip_file}" --wait
    fi
  else
    echo "Error: GEN_PW not set. Please set the app-specific password."
    return 1
  fi
}

ping() {
  if [ -z "${REQUEST_UUID}" ]; then
    echo "Error: REQUEST_UUID not set. Please pass the submission UUID."
    return 1
  fi
  run_cmd xcrun notarytool info --apple-id "${APPLE_ID}" --team-id "${TEAM_ID}" \
    --password "${GEN_PW}" "${REQUEST_UUID}"
}

cleanup_notarization_zip() {
  echo "Cleaning up notarization zip file..."
  NOTARIZATION_ZIP="${VERSION}-${APP}.zip"
  if [ -f "${NOTARIZATION_ZIP}" ]; then
    echo "Removing notarization zip file: ${NOTARIZATION_ZIP}"
    if command -v rm.ape >/dev/null 2>&1; then
      run_cmd rm.ape -f "${NOTARIZATION_ZIP}"
    else
      run_cmd rm -f "${NOTARIZATION_ZIP}"
    fi
    echo "Notarization zip removed successfully"
  else
    echo "Note: Notarization zip file not found (${NOTARIZATION_ZIP}), continuing..."
  fi
}

cleanup_burst_debug() {
  echo "Cleaning up Burst debug information folder..."
  BURST_DEBUG_FOLDER="${APP}_BurstDebugInformation_DoNotShip"
  if [ -d "${BURST_DEBUG_FOLDER}" ]; then
    echo "Removing Burst debug folder: ${BURST_DEBUG_FOLDER}"
    if command -v rm.ape >/dev/null 2>&1; then
      run_cmd rm.ape -rf "${BURST_DEBUG_FOLDER}"
    else
      run_cmd rm -rf "${BURST_DEBUG_FOLDER}"
    fi
    echo "Burst debug folder removed successfully"
  else
    echo "Note: Burst debug folder not found (${BURST_DEBUG_FOLDER}), continuing..."
  fi
}

staple() {
  echo "Stapling notarization ticket..."
  cleanup_notarization_zip
  cleanup_burst_debug
  run_cmd xcrun stapler staple "${APP}.app"
  echo "Stapling completed successfully"
}

check() {
  echo "Checking app signature..."
  run_cmd spctl -a -v "${APP}.app"
}

# Parse flags. Only one "step" flag is supported at a time (matches old behavior).
STEP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --profile-json)
      if [ $# -lt 2 ]; then
        echo "Error: --profile-json requires a value"
        exit 1
      fi
      PROFILE_JSON="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    --codesign|--zip|--upload|--ping|--staple|--check)
      STEP="$1"
      shift
      ;;
    *)
      echo "Error: Unknown option '$1'"
      echo ""
      show_help
      exit 1
      ;;
  esac
done

show_cadet_pro_banner

# Load profile JSON if provided
if [ -n "$PROFILE_JSON" ]; then
  # Convert relative path to absolute if needed
  if ! is_absolute_path "$PROFILE_JSON"; then
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
  
  # Extract values from loaded profile
  if [ -n "${UNITY_BUILD_OUTPUT_PATH:-}" ]; then
    WORKING_DIR="${UNITY_BUILD_OUTPUT_PATH}/macos"
  fi
  
  if [ -n "${UNITY_PROJECT_NAME:-}" ]; then
    APP="${UNITY_PROJECT_NAME}"
  fi
  
  if [ -n "${MACOS_ENTITLEMENTS_PATH:-}" ]; then
    ENTITLEMENTS="${MACOS_ENTITLEMENTS_PATH}"
  fi
fi

load_creds
get_version

if $DRY_RUN; then
  echo "DRY_RUN enabled (no macOS tool execution)"
else
  cd "${WORKING_DIR}" || {
    echo "Error: WORKING_DIR not found: ${WORKING_DIR}"
    exit 1
  }
fi

if [ -z "$STEP" ]; then
  echo "Running all signing and notarization steps..."
  codesign_app
  ZIP_FILE="$(zip_app)"
  upload "${ZIP_FILE}"
  staple
  check
  echo "All steps completed successfully!"
  exit 0
fi

case "$STEP" in
  --codesign) echo "Running code signing only..."; codesign_app ;;
  --zip) echo "Creating zip for notarization only..."; zip_app ;;
  --upload) echo "Uploading for notarization only..."; upload ;;
  --ping) echo "Checking notarization status..."; ping ;;
  --staple) echo "Stapling notarization only..."; staple ;;
  --check) echo "Checking signature only..."; check ;;
esac


