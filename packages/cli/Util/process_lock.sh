#!/bin/bash

#================================================================
# Tools/CLI/Util/process_lock.sh (cadet-cli) or CLI/Util/process_lock.sh (deployed)
#================================================================
# Provides process lock/mutex functionality to prevent concurrent
# operations that could conflict (e.g., multiple SteamCMD uploads,
# simultaneous Unity builds).
#
# Usage:
#   source "$PROJECT_ROOT/Tools/CLI/Util/process_lock.sh" (cadet-cli)
#   source "$PROJECT_ROOT/CLI/Util/process_lock.sh" (deployed)
#   
#   # Acquire lock
#   acquire_lock "steamcmd" || exit 1
#   
#   # Set up cleanup on exit
#   trap 'release_lock "steamcmd"' EXIT
#   
#   # Do work...
#   
#   # Lock is automatically released on exit
#================================================================

set -u

# Get project root (two levels up from this script)
LOCK_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_PROJECT_ROOT="$(cd "$LOCK_LIB_DIR/../.." && pwd)"

# Normalize HOME path for Windows compatibility
# Convert MSYS2/Git Bash paths like /c/Users/User to C:/Users/User
normalize_home_path() {
  local home_path="$HOME"
  # Check if path is MSYS2-style (/c/Users/..., /d/Users/..., etc.)
  if [[ "$home_path" =~ ^/([a-zA-Z])/ ]]; then
    # Extract drive letter and convert to Windows style
    local drive="${BASH_REMATCH[1]}"
    home_path="${drive^^}:${home_path:2}"
  fi
  echo "$home_path"
}

# Lock directory in user home
LOCK_DIR="$(normalize_home_path)/CADET/CLI"

# Detect Cosmos bin directory (where bash and utilities are located)
COSMOS_BIN_DIR=""
if [ -n "${BASH:-}" ]; then
  # Get directory where bash executable is located
  COSMOS_BIN_DIR="$(cd "$(dirname "$(command -v bash 2>/dev/null || echo "$BASH")")" && pwd)"
fi

# Ensure lock directory exists
mkdir_p() {
  # Try with full path to mkdir.ape if we know where Cosmos bin is
  if [ -n "$COSMOS_BIN_DIR" ] && [ -f "$COSMOS_BIN_DIR/mkdir.ape" ]; then
    "$COSMOS_BIN_DIR/mkdir.ape" -p "$@"
  # Try mkdir.ape in PATH
  elif command -v mkdir.ape &>/dev/null; then
    mkdir.ape -p "$@"
  # Fall back to regular mkdir if available
  elif command -v mkdir &>/dev/null; then
    mkdir -p "$@"
  else
    echo "[ERR] mkdir command not found (tried: $COSMOS_BIN_DIR/mkdir.ape, mkdir.ape, mkdir)" >&2
    return 1
  fi
}

# Remove files/directories
rm_rf() {
  # Try with full path to rm.ape if we know where Cosmos bin is
  if [ -n "$COSMOS_BIN_DIR" ] && [ -f "$COSMOS_BIN_DIR/rm.ape" ]; then
    "$COSMOS_BIN_DIR/rm.ape" -rf "$@"
  # Try rm.ape in PATH
  elif command -v rm.ape &>/dev/null; then
    rm.ape -rf "$@"
  # Fall back to regular rm if available
  elif command -v rm &>/dev/null; then
    rm -rf "$@"
  else
    echo "[ERR] rm command not found (tried: $COSMOS_BIN_DIR/rm.ape, rm.ape, rm)" >&2
    return 1
  fi
}

# Initialize lock directory
init_lock_dir() {
  if [ ! -d "$LOCK_DIR" ]; then
    mkdir_p "$LOCK_DIR"
    echo "[LOG] Created lock directory: $LOCK_DIR"
  fi
}

# Acquire a lock for the given process name
# Args:
#   $1 - process name (e.g., "steamcmd", "unity_build")
# Returns:
#   0 if lock acquired successfully
#   1 if lock already exists (process running)
acquire_lock() {
  local process_name="$1"
  local lock_file="$LOCK_DIR/${process_name}.lock"
  
  init_lock_dir
  
  # Check if lock file exists
  if [ -f "$lock_file" ]; then
    # Read lock info
    local lock_info
    lock_info=$(<"$lock_file")
    local lock_pid=$(echo "$lock_info" | grep "PID:" | cut -d: -f2 | tr -d ' ')
    local lock_time=$(echo "$lock_info" | grep "TIME:" | cut -d: -f2-)
    
    # Check if the process is still running (cross-platform)
    if ps -p "$lock_pid" &>/dev/null 2>&1 || (command -v tasklist &>/dev/null && tasklist /FI "PID eq $lock_pid" 2>NUL | grep -q "$lock_pid"); then
      echo "[ERR] Process '$process_name' is already running (PID: $lock_pid, Started: $lock_time)" >&2
      echo "[ERR] If this is incorrect, remove the lock file: $lock_file" >&2
      return 1
    else
      # Process not running - stale lock file
      echo "[WARN] Removing stale lock file for '$process_name' (PID $lock_pid no longer exists)"
      rm_rf "$lock_file"
    fi
  fi
  
  # Create lock file
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  cat > "$lock_file" <<EOF
PROCESS: $process_name
PID: $$
TIME: $timestamp
HOST: $(hostname 2>/dev/null || echo "unknown")
EOF
  
  echo "[LOG] Acquired lock for process '$process_name' (PID: $$)"
  return 0
}

# Release a lock for the given process name
# Args:
#   $1 - process name (e.g., "steamcmd", "unity_build")
release_lock() {
  local process_name="$1"
  local lock_file="$LOCK_DIR/${process_name}.lock"
  
  if [ -f "$lock_file" ]; then
    # Verify this process owns the lock
    local lock_pid=$(grep "PID:" "$lock_file" | cut -d: -f2 | tr -d ' ')
    if [ "$lock_pid" = "$$" ]; then
      rm_rf "$lock_file"
      echo "[LOG] Released lock for process '$process_name'"
    else
      echo "[WARN] Cannot release lock for '$process_name' - owned by PID $lock_pid (current: $$)"
    fi
  fi
}

# Check if a lock exists for the given process
# Args:
#   $1 - process name
# Returns:
#   0 if lock exists and process is running
#   1 if no lock or stale lock
is_locked() {
  local process_name="$1"
  local lock_file="$LOCK_DIR/${process_name}.lock"
  
  if [ ! -f "$lock_file" ]; then
    return 1
  fi
  
  # Check if process is still running
  local lock_pid=$(grep "PID:" "$lock_file" | cut -d: -f2 | tr -d ' ')
  if ps -p "$lock_pid" &>/dev/null 2>&1 || (command -v tasklist &>/dev/null && tasklist /FI "PID eq $lock_pid" 2>NUL | grep -q "$lock_pid"); then
    return 0
  else
    # Stale lock
    return 1
  fi
}

# Clean up all stale locks
cleanup_stale_locks() {
  init_lock_dir
  
  local cleaned=0
  for lock_file in "$LOCK_DIR"/*.lock; do
    [ -f "$lock_file" ] || continue
    
    local lock_pid=$(grep "PID:" "$lock_file" | cut -d: -f2 | tr -d ' ')
    if ! ps -p "$lock_pid" &>/dev/null 2>&1 && ! (command -v tasklist &>/dev/null && tasklist /FI "PID eq $lock_pid" 2>NUL | grep -q "$lock_pid"); then
      local process_name=$(basename "$lock_file" .lock)
      echo "[LOG] Cleaning up stale lock: $process_name (PID $lock_pid)"
      rm_rf "$lock_file"
      ((cleaned++))
    fi
  done
  
  if [ $cleaned -gt 0 ]; then
    echo "[LOG] Cleaned up $cleaned stale lock(s)"
  fi
}


