#!/bin/bash

# Smoke test: verify SteamCMD logs stream to terminal in real time.
# Default mode uses anonymous login to avoid credential prompts.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STEAMCMD_PATH="${1:-}"
USE_CREDENTIALS="${USE_CREDENTIALS:-0}"
STEAM_USERNAME="${STEAM_USERNAME:-}"
STEAM_PASSWORD="${STEAM_PASSWORD:-}"
STEAM_GUARD_CODE="${STEAM_GUARD_CODE:-}"

resolve_steamcmd() {
  local candidate="$1"

  if [ -n "$candidate" ]; then
    if [ -d "$candidate" ]; then
      if [ -f "$candidate/steamcmd.exe" ]; then
        echo "$candidate/steamcmd.exe"
        return 0
      fi
      if [ -f "$candidate/steamcmd.sh" ]; then
        echo "$candidate/steamcmd.sh"
        return 0
      fi
    fi

    echo "$candidate"
    return 0
  fi

  if [ -n "${APPDATA:-}" ] && [ -f "$APPDATA/CADET/Tools/steamcmd/steamcmd.exe" ]; then
    echo "$APPDATA/CADET/Tools/steamcmd/steamcmd.exe"
    return 0
  fi

  if [ -n "${HOME:-}" ] && [ -f "$HOME/Library/Application Support/CADET/Tools/steamcmd/steamcmd.sh" ]; then
    echo "$HOME/Library/Application Support/CADET/Tools/steamcmd/steamcmd.sh"
    return 0
  fi

  if [ -n "${HOME:-}" ] && [ -f "$HOME/.local/share/CADET/Tools/steamcmd/steamcmd.sh" ]; then
    echo "$HOME/.local/share/CADET/Tools/steamcmd/steamcmd.sh"
    return 0
  fi

  return 1
}

STEAMCMD="$(resolve_steamcmd "$STEAMCMD_PATH")" || {
  echo "[TEST][ERR] Could not resolve SteamCMD path. Pass it as first argument." >&2
  exit 1
}

if [ ! -f "$STEAMCMD" ]; then
  echo "[TEST][ERR] SteamCMD executable not found: $STEAMCMD" >&2
  exit 1
fi

STEAMCMD_DIR="$(cd "$(dirname "$STEAMCMD")" && pwd)"
STEAMCMD_BASENAME="${STEAMCMD##*/}"
CONSOLE_LOG="$STEAMCMD_DIR/logs/console_log.txt"

get_line_count() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo 0
    return 0
  fi
  wc -l < "$path" | tr -d '[:space:]'
}

START_LINE="$(get_line_count "$CONSOLE_LOG")"

echo "[TEST] SteamCMD path: $STEAMCMD"
echo "[TEST] Console log: $CONSOLE_LOG"
echo "[TEST] Starting line: $START_LINE"

if [ "$USE_CREDENTIALS" = "1" ]; then
  if [ -z "$STEAM_USERNAME" ] || [ -z "$STEAM_PASSWORD" ]; then
    echo "[TEST][ERR] USE_CREDENTIALS=1 requires STEAM_USERNAME and STEAM_PASSWORD" >&2
    exit 1
  fi

  if [ -n "$STEAM_GUARD_CODE" ]; then
    LOGIN_ARGS=(+login "$STEAM_USERNAME" "$STEAM_PASSWORD" "$STEAM_GUARD_CODE")
  else
    LOGIN_ARGS=(+login "$STEAM_USERNAME" "$STEAM_PASSWORD")
  fi
  echo "[TEST] Login mode: credentials"
else
  LOGIN_ARGS=(+login anonymous)
  echo "[TEST] Login mode: anonymous"
fi

ORIGINAL_DIR="$(pwd)"
cd "$STEAMCMD_DIR" || {
  echo "[TEST][ERR] Failed to cd to $STEAMCMD_DIR" >&2
  exit 1
}

if [[ "$STEAMCMD_BASENAME" == *.sh ]]; then
  bash "./$STEAMCMD_BASENAME" "${LOGIN_ARGS[@]}" +quit 2>&1 | while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "[TEST][SteamCMD(out)] $line"
  done
  EXIT_CODE=${PIPESTATUS[0]}
else
  "./$STEAMCMD_BASENAME" "${LOGIN_ARGS[@]}" +quit 2>&1 | while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "[TEST][SteamCMD(out)] $line"
  done
  EXIT_CODE=${PIPESTATUS[0]}
fi

END_LINE="$(get_line_count "$CONSOLE_LOG")"
if [ "$END_LINE" -gt "$START_LINE" ]; then
  echo "[TEST] New lines from console_log.txt:"
  sed -n "$((START_LINE + 1)),${END_LINE}p" "$CONSOLE_LOG" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "[TEST][SteamCMD(file)] $line"
  done
else
  echo "[TEST] No new lines detected in console_log.txt"
fi

cd "$ORIGINAL_DIR" || true

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[TEST][ERR] SteamCMD exited with code $EXIT_CODE" >&2
  exit "$EXIT_CODE"
fi

echo "[TEST] SteamCMD log streaming smoke test completed successfully."
