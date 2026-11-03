#!/bin/bash

#================================================================
# Tools/CLI/Util/manage_locks.sh
#================================================================
# Utility script to manage process locks for CADET CLI operations.
#
# Usage:
#   bash Tools/CLI/Util/manage_locks.sh [command]
#
# Commands:
#   list    - List all active locks
#   clean   - Remove all stale locks (processes no longer running)
#   clear   - Remove ALL locks (use with caution!)
#   help    - Show this help message
#================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$SCRIPT_DIR/process_lock.sh"

# Parse command
COMMAND="${1:-help}"

case "$COMMAND" in
  list)
    echo "[LOG] Listing all locks in: $LOCK_DIR"
    echo ""
    
    if [ ! -d "$LOCK_DIR" ] || [ -z "$(ls -A "$LOCK_DIR" 2>/dev/null)" ]; then
      echo "No locks found."
      exit 0
    fi
    
    for lock_file in "$LOCK_DIR"/*.lock; do
      [ -f "$lock_file" ] || continue
      
      local process_name=$(basename "$lock_file" .lock)
      echo "Lock: $process_name"
      echo "  File: $lock_file"
      
      # Read lock info
      while IFS=: read -r key value; do
        echo "  $key:$value"
      done < "$lock_file"
      
      # Check if process is still running
      local lock_pid=$(grep "PID:" "$lock_file" | cut -d: -f2 | tr -d ' ')
      if ps -p "$lock_pid" &>/dev/null 2>&1 || (command -v tasklist &>/dev/null && tasklist /FI "PID eq $lock_pid" 2>NUL | grep -q "$lock_pid"); then
        echo "  Status: ACTIVE (process is running)"
      else
        echo "  Status: STALE (process not found)"
      fi
      echo ""
    done
    ;;
    
  clean)
    echo "[LOG] Cleaning up stale locks..."
    cleanup_stale_locks
    echo "[LOG] Done."
    ;;
    
  clear)
    echo "[WARN] This will remove ALL locks, even for running processes!"
    echo "[WARN] Only use this if you're certain no builds or uploads are in progress."
    echo ""
    read -p "Are you sure? (yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
      if [ -d "$LOCK_DIR" ]; then
        rm_rf "$LOCK_DIR"/*.lock 2>/dev/null || true
        echo "[LOG] All locks cleared."
      else
        echo "[LOG] No locks directory found."
      fi
    else
      echo "[LOG] Aborted."
    fi
    ;;
    
  help|--help|-h)
    cat << 'EOF'
CADET CLI - Lock Management Utility

Usage:
  bash Tools/manage_locks.sh [command]

Commands:
  list    List all active locks with their status
  clean   Remove stale locks (processes no longer running)
  clear   Remove ALL locks (use with caution!)
  help    Show this help message

Examples:
  # View all current locks
  bash Tools/manage_locks.sh list
  
  # Clean up stale locks automatically
  bash Tools/manage_locks.sh clean
  
  # Force remove all locks (be careful!)
  bash Tools/manage_locks.sh clear

Locks are used to prevent concurrent operations:
  - unity_build_<PROJECT> - Prevents simultaneous Unity builds
  - steamcmd_<APP_ID>     - Prevents simultaneous Steam uploads
EOF
    ;;
    
  *)
    echo "[ERR] Unknown command: $COMMAND" >&2
    echo "Use 'bash Tools/manage_locks.sh help' for usage information" >&2
    exit 1
    ;;
esac

