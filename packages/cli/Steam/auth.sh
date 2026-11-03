#!/bin/bash

#================================================================
# Tools/Steam/auth.sh
#================================================================
# One-time Steam authentication setup script.
# Generates a persistent sentry file for SteamCMD authentication.
#
# Usage:
#   bash Tools/Steam/auth.sh --profile-json <path>
#
# Prerequisites:
#   - SteamCMD installed (run Tools/CLI/Deps/download_deps.sh first)
#   - User credentials file with Steam Guard code: ~/.env_cadet_steam_credentials
#
# What it does:
#   1. Reads Steam credentials from ~/.env_cadet_steam_credentials
#   2. Logs into SteamCMD with Steam Guard code
#   3. Creates a sentry file (ssfn*) in the SteamCMD directory (from build profile JSON)
#   4. Future builds won't need Steam Guard codes!
#================================================================

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"

source "$SCRIPT_DIR/../Util/json_parser.sh"

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

# Parse arguments
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
      echo "One-time Steam authentication setup."
      echo ""
      echo "Prerequisites:"
      echo "  1. Run: bash Tools/CLI/Deps/download_deps.sh"
      echo "  2. Create ~/.env_cadet_steam_credentials with:"
      echo "     STEAM_USERNAME=your_username"
      echo "     (Password and Steam Guard code will be prompted interactively)"
      echo ""
      echo "After successful authentication:"
      echo "  - Sentry file created in SteamCMD directory (from build profile JSON)"
      echo "  - Remove STEAM_GUARD_CODE from .env file"
      echo "  - Future builds won't need Steam Guard codes!"
      exit 0
      ;;
    *)
      echo "[ERR] Unknown argument: $1" >&2
      echo "Use -h or --help for usage information" >&2
      exit 1
      ;;
  esac
done

# Validate profile JSON
if [ -z "$PROFILE_JSON" ]; then
  echo "[ERR] --profile-json parameter is required" >&2
  echo "Use -h or --help for usage information" >&2
  exit 1
fi

if [ ! -f "$PROFILE_JSON" ]; then
  echo "[ERR] JSON file not found: $PROFILE_JSON" >&2
  exit 1
fi

echo "[LOG] =============================================="
echo "[LOG] Steam Authentication Setup"
echo "[LOG] =============================================="
echo "[LOG] Loading configuration from: $PROFILE_JSON"

# Load profile JSON
if ! load_profile_json "$PROFILE_JSON"; then
  echo "[ERR] Failed to load Build Profile JSON" >&2
  exit 1
fi

echo "[LOG] Profile: $PROFILE_NAME"
echo "[LOG] Platform: $PROFILE_PLATFORM"

# Validate platform
if [ "$PROFILE_PLATFORM" != "steam" ] && [ "$PROFILE_PLATFORM" != "both" ]; then
  echo "[ERR] This profile is not configured for Steam (platform: $PROFILE_PLATFORM)" >&2
  exit 1
fi

# Detect host OS to select appropriate SteamCMD
UNAME_CMD="uname"
if ! command -v uname >/dev/null 2>&1; then
  if command -v uname.ape >/dev/null 2>&1; then
    UNAME_CMD="uname.ape"
  fi
fi

DETECTED_OS="$("$UNAME_CMD" -s 2>/dev/null)"
echo "[LOG] Detected platform: $DETECTED_OS"

# Get SteamCMD path from JSON based on detected OS
case "$DETECTED_OS" in
  MINGW*|MSYS*|CYGWIN*|Windows*)
    echo "[LOG] Using Windows SteamCMD"
    STEAMCMD=$(get_json_value "$PROFILE_JSON" ".steam.steamcmdExe")
    if [ -z "$STEAMCMD" ]; then
      echo "[ERR] SteamCMD path not found in Build Profile JSON: steam.steamcmdExe (required for Windows)" >&2
      exit 1
    fi
    ;;
  *)
    echo "[LOG] Using Unix SteamCMD"
    STEAMCMD=$(get_json_value "$PROFILE_JSON" ".steam.steamcmdSh")
    if [ -z "$STEAMCMD" ]; then
      echo "[ERR] SteamCMD path not found in Build Profile JSON: steam.steamcmdSh (required for macOS/Linux)" >&2
      exit 1
    fi
    ;;
esac

echo "[LOG] SteamCMD: $STEAMCMD"

# Convert to absolute path if relative
if ! is_absolute_path "$STEAMCMD"; then
  STEAMCMD="$PROJECT_ROOT/$STEAMCMD"
  echo "[LOG] Absolute path: $STEAMCMD"
fi

# Check if SteamCMD exists
if [ ! -f "$STEAMCMD" ]; then
  echo "[ERR] SteamCMD not found at: $STEAMCMD" >&2
  echo "[ERR] Run: bash Tools/CLI/Deps/download_deps.sh" >&2
  exit 1
fi

# Load Steam credentials - check environment variables first, then fall back to file
if [ -z "${STEAM_USERNAME:-}" ] || [ -z "${STEAM_PASSWORD:-}" ]; then
  # Load from file if not in environment
  STEAM_ENV="$HOME/.env_cadet_steam_credentials"
  if [ ! -f "$STEAM_ENV" ]; then
    echo "[ERR] Steam credentials not found in environment and file not found: $STEAM_ENV" >&2
    echo ""
    echo "Set environment variables STEAM_USERNAME and STEAM_PASSWORD, or create this file:"
    echo "  STEAM_USERNAME=your_username"
    echo "  STEAM_PASSWORD=your_password"
    echo "  STEAM_GUARD_CODE=ABC12  # Fresh code from email"
    exit 1
  fi
  echo "[LOG] Loading Steam credentials from file: $STEAM_ENV"
  source "$STEAM_ENV"
else
  echo "[LOG] Using Steam credentials from environment variables"
fi

# Trim whitespace/newlines from credentials using bash parameter expansion
STEAM_USERNAME="${STEAM_USERNAME%%*( )}"  # Remove trailing whitespace
STEAM_USERNAME="${STEAM_USERNAME##*( )}"  # Remove leading whitespace  
STEAM_USERNAME="${STEAM_USERNAME//$'\r'/}"  # Remove carriage returns
STEAM_USERNAME="${STEAM_USERNAME//$'\n'/}"  # Remove newlines

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

# Validate credentials
if [ -z "${STEAM_USERNAME:-}" ]; then
  echo "[ERR] STEAM_USERNAME not set (check environment variables or credentials file)" >&2
  exit 1
fi

# Password and Steam Guard code are optional - will be prompted interactively
echo "[LOG] Username: $STEAM_USERNAME"
if [ -n "${STEAM_PASSWORD:-}" ]; then
  echo "[LOG] Password found in credentials file (length: ${#STEAM_PASSWORD} chars)"
fi
if [ -n "${STEAM_GUARD_CODE:-}" ]; then
  echo "[LOG] Steam Guard code found in credentials file: ${STEAM_GUARD_CODE:0:3}**"
fi

# Check for existing sentry file
STEAMCMD_DIR=$(dirname "$STEAMCMD")
SENTRY_FILES=$(find "$STEAMCMD_DIR" -name "ssfn*" 2>/dev/null || true)

if [ -n "$SENTRY_FILES" ]; then
  echo "[LOG] =============================================="
  echo "[LOG] Existing sentry file(s) found:"
  echo "$SENTRY_FILES"
  echo "[LOG] =============================================="
  echo "[LOG] You may already be authenticated."
  echo "[LOG] If you want to re-authenticate, delete these files first."
  echo ""
  
  # Skip prompt in CI/CD environments
  if [ -n "${CI:-}" ] || [ "${NONINTERACTIVE:-}" = "1" ]; then
    echo "[LOG] CI/CD environment detected - continuing automatically"
  else
    read -p "Continue with authentication anyway? [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "[LOG] Authentication cancelled."
      exit 0
    fi
  fi
fi

echo "[LOG] =============================================="
echo "[LOG] Authenticating with Steam..."
echo "[LOG] =============================================="
echo "[LOG] This will:"
echo "[LOG]  1. Log into SteamCMD with your credentials"
echo "[LOG]  2. Use the Steam Guard code for authentication"
echo "[LOG]  3. Create a sentry file for future logins"
echo "[LOG]  4. Exit"
echo ""
if [ -n "${STEAM_PASSWORD:-}" ] && [ -n "${STEAM_GUARD_CODE:-}" ]; then
  echo "[LOG] Login will use credentials from file (non-interactive)"
  echo "[LOG]  Username: '$STEAM_USERNAME'"
  echo "[LOG]  Password: From credentials file"
  echo "[LOG]  Steam Guard Code: From credentials file"
elif [ -n "${STEAM_PASSWORD:-}" ]; then
  echo "[LOG] Login will use password from file, SteamCMD may prompt for guard code"
  echo "[LOG]  Username: '$STEAM_USERNAME'"
  echo "[LOG]  Password: From credentials file"
  echo "[LOG]  Steam Guard Code: You will be prompted if needed"
else
  echo "[LOG] Login will be INTERACTIVE"
  echo "[LOG]  Username: '$STEAM_USERNAME' (pre-filled)"
  echo "[LOG]  Password: You will be prompted"
  echo "[LOG]  Steam Guard Code: You will be prompted"
  echo ""
  echo "[LOG] When SteamCMD prompts you:"
  echo "[LOG]  1. Enter your password when asked"
  echo "[LOG]  2. Enter your Steam Guard code when asked"
  echo "[LOG]  3. Wait for authentication to complete"
  echo ""
fi

# Perform authentication using credentials from file
# If password and guard code are available, use them directly
# Otherwise, SteamCMD will prompt interactively
if [ -n "${STEAM_PASSWORD:-}" ] && [ -n "${STEAM_GUARD_CODE:-}" ]; then
  echo "[LOG] Using credentials from file (non-interactive)"
  if [[ "$STEAMCMD" == *.sh ]]; then
    bash "$STEAMCMD" +login "$STEAM_USERNAME" "$STEAM_PASSWORD" "$STEAM_GUARD_CODE" +quit
  else
    "$STEAMCMD" +login "$STEAM_USERNAME" "$STEAM_PASSWORD" "$STEAM_GUARD_CODE" +quit
  fi
elif [ -n "${STEAM_PASSWORD:-}" ]; then
  echo "[LOG] Using password from file, SteamCMD will prompt for guard code if needed"
  if [[ "$STEAMCMD" == *.sh ]]; then
    bash "$STEAMCMD" +login "$STEAM_USERNAME" "$STEAM_PASSWORD" +quit
  else
    "$STEAMCMD" +login "$STEAM_USERNAME" "$STEAM_PASSWORD" +quit
  fi
else
  echo "[LOG] Using interactive authentication (only username provided)"
  if [[ "$STEAMCMD" == *.sh ]]; then
    bash "$STEAMCMD" +login "$STEAM_USERNAME" +quit
  else
    "$STEAMCMD" +login "$STEAM_USERNAME" +quit
  fi
fi

AUTH_EXIT_CODE=$?

if [ $AUTH_EXIT_CODE -ne 0 ]; then
  echo ""
  echo "[ERR] =============================================="
  echo "[ERR] Authentication failed!"
  echo "[ERR] =============================================="
  echo "[ERR] Possible reasons:"
  echo "[ERR]   - Invalid Steam Guard code (expired or incorrect)"
  echo "[ERR]   - Invalid username or password"
  echo "[ERR]   - Network connectivity issues"
  echo ""
  echo "Check the SteamCMD output above for details."
  exit 1
fi

# Verify sentry file was created
SENTRY_FILES=$(find "$STEAMCMD_DIR" -name "ssfn*" 2>/dev/null || true)

if [ -z "$SENTRY_FILES" ]; then
  echo ""
  echo "[WARN] =============================================="
  echo "[WARN] Authentication appeared successful, but no sentry file found"
  echo "[WARN] =============================================="
  echo "[WARN] This is unusual. You may need to authenticate again on next publish."
  exit 1
fi

echo ""
echo "[LOG] =============================================="
echo "[LOG] Authentication successful!"
echo "[LOG] =============================================="
echo "[LOG] Sentry file(s) created:"
echo "$SENTRY_FILES"
echo ""
echo "[LOG] Next steps:"
echo "[LOG]  1. Your sentry file is now active"
echo "[LOG]  2. Future builds won't need Steam Guard codes!"
echo ""
echo "[LOG] Your credentials file only needs:"
echo "[LOG]  STEAM_USERNAME=$STEAM_USERNAME"
echo "[LOG]  STEAM_PASSWORD=********  # For automated builds"
echo ""
echo "[LOG] =============================================="

exit 0

