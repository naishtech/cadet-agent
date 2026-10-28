#!/bin/bash

#================================================================
# Tools/Steam/library.sh (refactor - Task 1.6)
#================================================================
# - Loads credentials from user directory only (no project .env fallback)
# - Provides JSON helpers by sourcing Tools/CLI/Util/json_parser.sh
# - Intentionally avoids interactive prompts (non-interactive friendly)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"

# JSON helpers (load_profile_json, validate_json_structure, etc.)
source "$SCRIPT_DIR/../Util/json_parser.sh"

# Function to load KEY=VALUE pairs from a specific env file
load_env_file() {
  local env_file="$1"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  while IFS='=' read -r key value || [ -n "$key" ]; do
    if [[ -n "$key" && "$key" != \#* ]]; then
      value="${value%$'\r'}"
      export "$key=$value"
    fi
  done < "$env_file"
  return 0
}

# Load Steam credentials - check environment variables first, then fall back to file
load_env() {
  local user_steam_env="$HOME/.env_cadet_steam_credentials"

  # Check if credentials already in environment
  if [ -z "${STEAM_USERNAME:-}" ] || [ -z "${STEAM_PASSWORD:-}" ]; then
    # Load from file if not in environment
    if ! load_env_file "$user_steam_env"; then
      echo "[ERR] Steam credentials not found in environment and file not found: $user_steam_env" >&2
      echo "Set environment variables STEAM_USERNAME and STEAM_PASSWORD, or create this file:" >&2
      echo "STEAM_USERNAME=your_username" >&2
      echo "STEAM_PASSWORD=your_password" >&2
      echo "STEAM_GUARD_CODE=your_code" >&2
      return 1
    fi

    echo "Loaded Steam credentials from: $user_steam_env"
  else
    echo "Using Steam credentials from environment variables"
  fi

  # Log credential presence (without printing secrets)
  echo "Checking Steam credentials..."
  if [ -z "${STEAM_USERNAME:-}" ]; then
    echo "  ERROR: STEAM_USERNAME is empty or not set"
  else
    echo "  STEAM_USERNAME: loaded (length: ${#STEAM_USERNAME})"
  fi

  if [ -z "${STEAM_PASSWORD:-}" ]; then
    echo "  ERROR: STEAM_PASSWORD is empty or not set"
  else
    echo "  STEAM_PASSWORD: loaded (length: ${#STEAM_PASSWORD})"
  fi

  if [ -z "${STEAM_GUARD_CODE:-}" ]; then
    echo "  ERROR: STEAM_GUARD_CODE is empty or not set"
  else
    echo "  STEAM_GUARD_CODE: loaded (length: ${#STEAM_GUARD_CODE})"
  fi

  return 0
}


