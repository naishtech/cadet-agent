#!/bin/bash

#================================================================
# Tools/Steam/build_and_publish.sh (JSON refactor - Task 1.5)
#================================================================
# - Reads configuration from Build Profile JSON (no Tools/Steam/.env)
# - Extracts os + macSign from JSON
# - Calls:
#     Tools/build.sh --profile-json <path>
#     Tools/Steam/publish.sh --profile-json <path> --os <windows|mac>
#
# Usage:
#   bash Tools/Steam/build_and_publish.sh --profile-json <path>

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"

# Save SCRIPT_DIR before sourcing other scripts (they may set their own SCRIPT_DIR)
BUILD_AND_PUBLISH_SCRIPT_DIR="$SCRIPT_DIR"

source "$SCRIPT_DIR/../Util/json_parser.sh"
source "$SCRIPT_DIR/../Util/logging.sh"

# Restore SCRIPT_DIR after sourcing (json_parser.sh sets its own SCRIPT_DIR)
SCRIPT_DIR="$BUILD_AND_PUBLISH_SCRIPT_DIR"

PROFILE_JSON=""
GENERATED_VDFS_DIRECTORY=""

# Allow tests to inject mocks without rewriting repo files.
BUILD_SCRIPT="${BUILD_SCRIPT:-$TOOLS_DIR/build.sh}"
STEAM_PUBLISH_SCRIPT="${STEAM_PUBLISH_SCRIPT:-$SCRIPT_DIR/publish.sh}"

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
    --generated-vdfs-directory)
      if [ $# -lt 2 ]; then
        echo "[ERR] --generated-vdfs-directory requires a value" >&2
        exit 1
      fi
      GENERATED_VDFS_DIRECTORY="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --profile-json <path> [--generated-vdfs-directory <path>]"
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

if ! validate_json_structure "$PROFILE_JSON"; then
    exit 1
fi

if ! load_profile_json "$PROFILE_JSON"; then
  exit 1
fi

OS="${PROFILE_OS:-}"
MACOS_ENABLE_SIGNING="${MACOS_ENABLE_SIGNING:-false}"

if [ -z "$OS" ]; then
  echo "[ERR] Profile OS is required (field: os)" >&2
            exit 1
        fi

if [[ "$OS" != "windows" && "$OS" != "mac" ]]; then
  echo "[ERR] Invalid profile os: $OS (expected windows|mac)" >&2
  exit 1
fi

log_dist "Starting Steam build + publish..."

# Build
log_build "Running build..."
bash "$BUILD_SCRIPT" --profile-json "$PROFILE_JSON"
BUILD_STATUS=$?
if [ $BUILD_STATUS -ne 0 ]; then
  echo "[ERR] Build failed. Cannot proceed to publish." >&2
  exit $BUILD_STATUS
fi
log_build "Build successful."

# macOS signing (only if enabled and OS is mac)
if [ "$MACOS_ENABLE_SIGNING" = "true" ] && [ "$OS" = "mac" ]; then
  log_dist "macos.enableSigning=true and os=mac: running macOS signing..."
  (cd "$TOOLS_DIR/MacOS" && bash "./sign_and_upload.sh")
  SIGN_STATUS=$?
  if [ $SIGN_STATUS -ne 0 ]; then
    echo "[ERR] macOS signing failed" >&2
    exit $SIGN_STATUS
  fi
  log_dist "macOS signing completed successfully."
fi

# Publish
log_publish "Running Steam publish..."
bash "$STEAM_PUBLISH_SCRIPT" --profile-json "$PROFILE_JSON" --os "$OS" --generated-vdfs-directory "$GENERATED_VDFS_DIRECTORY"
PUBLISH_STATUS=$?
if [ $PUBLISH_STATUS -ne 0 ]; then
  echo "[ERR] Publish failed." >&2
  exit $PUBLISH_STATUS
fi

log_publish "Publish successful."
exit 0


