#!/bin/bash

#================================================================
# Logging Utility
#================================================================
# Provides operation-aware logging functions for CADET CLI scripts
#
# Usage:
#   source "$SCRIPT_DIR/Util/logging.sh"
#   log_build "Starting build..."
#   log_publish "Starting publish..."
#   log_dist "General message..."

# Default operation context (can be overridden)
CADET_LOG_OPERATION="${CADET_LOG_OPERATION:-LOG}"

# Log with BUILD operation context
log_build() {
  echo "[DIST][BUILD] $*"
}

# Log with PUBLISH operation context
log_publish() {
  echo "[DIST][PUBLISH] $*"
}

# Log with SIGN operation context (for macOS signing)
log_sign() {
  echo "[DIST][SIGN] $*"
}

# Log with general DIST context (for dist.sh itself)
log_dist() {
  echo "[DIST] $*"
}

show_cadet_pro_banner() {
  if [ "${CADET_PRO_BANNER_SHOWN:-0}" = "1" ]; then
    return 0
  fi

  export CADET_PRO_BANNER_SHOWN=1

  cat <<'EOF'

  ____    _    ____  _____ _____   ____  ____   ___
 / ___|  / \  |  _ \| ____|_   _| |  _ \|  _ \ / _ \
| |     / _ \ | | | |  _|   | |   | |_) | |_) | | | |
| |___ / ___ \| |_| | |___  | |   |  __/|  _ <| |_| |
 \____/_/   \_\____/|_____| |_|   |_|   |_| \_\\___/

                    CADET PRO
      Copyright Covyne Entertainment 2026.
               All rights reserved.

EOF
}

# Log with error context
log_error() {
  echo "[ERR] $*" >&2
}

# Log with warning context
log_warn() {
  echo "[WARN] $*" >&2
}

# Log with success context
log_success() {
  echo "[SUCCESS] $*"
}

# Legacy log function (for backward compatibility, but prefer specific functions)
# This will use the current operation context if set
log() {
  local operation="${CADET_LOG_OPERATION:-LOG}"
  case "$operation" in
    BUILD)
      log_build "$*"
      ;;
    PUBLISH)
      log_publish "$*"
      ;;
    *)
      echo "[LOG] $*"
      ;;
  esac
}
