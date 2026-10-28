#!/bin/bash

#================================================================
# Tools/CLI/Deps/download_deps.sh
#================================================================
# Downloads and unpacks external publishing dependencies if missing:
# - SteamCMD (Valve): https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip
# - Epic BuildPatchTool: https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/BuildPatchTool.zip
#
# Installs into user directory (provided as install_dir argument):
#   {install_dir}/steamcmd/
#   {install_dir}/BuildPatchTool/
#
# Usage (from repo root):
#   bash Tools/CLI/Deps/download_deps.sh [dependency] <install_dir>
#
# Arguments:
#   dependency - Optional. Specify which dependency to install:
#                "steamcmd-windows" - Install only SteamCMD for Windows (.exe)
#                "steamcmd-macos" - Install only SteamCMD for macOS (.sh)
#                "steamcmd" - Install both SteamCMD versions
#                "buildpatchtool" - Install only Epic BuildPatchTool
#                "all" or empty - Install all dependencies (default)
#   install_dir - Required. Installation directory path (user directory).
#                Must be an absolute path or relative to project root.
#                Tools will be installed in subdirectories: steamcmd/, BuildPatchTool/
#
# Notes:
# - This script is safe to re-run; it will skip downloads if it detects installed files.
# - On Windows, run this script via Cosmos bash (see Test/TEST_INSTRUCTIONS.md for Start-Process pattern).

set -eu

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

# Parse command line arguments
INSTALL_TARGET="${1:-all}"
INSTALL_DIR="${2:-}"

# Convert to lowercase using sed (available in Cosmos, bundled in Makefile)
INSTALL_TARGET=$(echo "$INSTALL_TARGET" | sed 'y/ABCDEFGHIJKLMNOPQRSTUVWXYZ/abcdefghijklmnopqrstuvwxyz/')

# IMPORTANT (Windows + Cosmos bash):
# Use $0 + pwd -P to ensure we resolve to POSIX-style paths (/f/...) rather than
# Windows-style paths (f:\...) which break Cosmos .ape utilities.
SCRIPT_DIR="$(cd -P "$(dirname "$0")" && pwd -P)"
TOOLS_DIR="$(cd -P "$SCRIPT_DIR/.." && pwd -P)"

# This script should only be run from the deployed Unity location (CLI/Deps/)
# Script is at CLI/Deps/ (deployed) or Tools/CLI/Deps/ (cadet-cli)
# TOOLS_DIR = CLI (deployed) or Tools/CLI (cadet-cli) - parent of Deps
# BINARIES_DIR = CLI (deployed) or Tools/CLI (cadet-cli) - same as TOOLS_DIR
BINARIES_DIR="$TOOLS_DIR"

# Verify we're in the correct location
if [ ! -d "$BINARIES_DIR" ]; then
    echo "[ERR] Script must be run from CLI/Deps/ (deployed) or Tools/CLI/Deps/ (cadet-cli)" >&2
    echo "[ERR] Current location: $SCRIPT_DIR" >&2
    exit 1
fi

# Determine installation directory
# INSTALL_DIR is required (user directory path provided by Unity C# code)
if [ -z "$INSTALL_DIR" ]; then
    echo "[ERR] Installation directory not provided. Install directory is required." >&2
    echo "[ERR] Usage: $0 [dependency] <install_dir>" >&2
    exit 1
fi

# Resolve installation directory path
if is_absolute_path "$INSTALL_DIR"; then
    DEST_DIR="$INSTALL_DIR"
else
    # Relative path - resolve relative to project root
    # Unity project root is 4 levels up from CLI (CLI -> Cadet -> Covyne -> Assets -> project root)
    PROJECT_ROOT="$(cd -P "$BINARIES_DIR/../../../../" && pwd -P)"
    DEST_DIR="$(cd -P "$PROJECT_ROOT/$INSTALL_DIR" && pwd -P)"
fi

BIN_TOOLS_DIR="$BINARIES_DIR"

DL_DIR="$DEST_DIR/_downloads"

STEAMCMD_WINDOWS_URL="https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
STEAMCMD_OSX_URL="https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz"
BPT_URL="https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/BuildPatchTool.zip"

mkdir_p() {
  if command -v mkdir.ape >/dev/null 2>&1; then
    mkdir.ape -p "$1"
  else
    mkdir -p "$1"
  fi
}

rm_rf() {
  if command -v rm.ape >/dev/null 2>&1; then
    rm.ape -rf "$1"
  else
    rm -rf "$1"
  fi
}

find_file() {
  # find_file <dir> <pattern>
  local dir="$1"
  local pat="$2"
  if command -v find >/dev/null 2>&1; then
    find "$dir" -type f -name "$pat" 2>/dev/null | head -n 1
  elif command -v find.ape >/dev/null 2>&1; then
    find.ape "$dir" -type f -name "$pat" 2>/dev/null | head -n 1
  else
    return 1
  fi
}

download() {
  # download <url> <out_file>
  local url="$1"
  local out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -O "$out" "$url"
    return 0
  fi
  if command -v curl.ape >/dev/null 2>&1; then
    curl.ape -fsSL "$url" -o "$out"
    return 0
  fi
  if command -v wget.ape >/dev/null 2>&1; then
    wget.ape -q -O "$out" "$url"
    return 0
  fi
  echo "[ERR] Neither curl nor wget is available to download: $url" >&2
  return 1
}

unzip_to() {
  # unzip_to <zip_file> <dest_dir>
  local zip="$1"
  local dest="$2"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$zip" -d "$dest"
    return 0
  fi
  if command -v unzip.ape >/dev/null 2>&1; then
    unzip.ape -q -o "$zip" -d "$dest"
    return 0
  fi
  echo "[ERR] unzip not found (need unzip or unzip.ape) to extract: $zip" >&2
  return 1
}

tar_extract() {
  # tar_extract <tar.gz_file> <dest_dir>
  local tarfile="$1"
  local dest="$2"
  
  # Try standard tar with built-in gzip support first
  if command -v tar >/dev/null 2>&1; then
    if tar -xzf "$tarfile" -C "$dest" 2>/dev/null; then
      return 0
    fi
  fi
  
  # Two-step extraction (works when tar can't spawn gzip as child process)
  # Prefer gzip.ape (Cosmos) if available, otherwise use standard gzip
  local gzip_cmd=""
  if command -v gzip.ape >/dev/null 2>&1; then
    gzip_cmd="gzip.ape"
  elif command -v gzip >/dev/null 2>&1; then
    gzip_cmd="gzip"
  fi
  
  if [ -n "$gzip_cmd" ] && command -v tar >/dev/null 2>&1; then
    local tmpfile="${tarfile%.gz}"
    echo "[LOG] Using $gzip_cmd + tar (two-step) to extract $tarfile..."
    
    # Step 1: Decompress .tar.gz to .tar
    if "$gzip_cmd" -d -c "$tarfile" > "$tmpfile" 2>/dev/null; then
      # Step 2: Extract .tar file (may report errors on symlinks for Windows, but files are extracted)
      tar -xf "$tmpfile" -C "$dest" 2>/dev/null || true
      rm_rf "$tmpfile"
      # Verify extraction succeeded by checking if dest has content
      if [ "$(ls -A "$dest" 2>/dev/null | wc -l)" -gt 0 ]; then
        return 0
      fi
    fi
  fi
  
  echo "[ERR] Cannot extract tar.gz: $tarfile" >&2
  echo "[ERR] Requires tar and gzip (or gzip.ape)" >&2
  return 1
}

echo "[LOG] Dependency download/install"
echo "[LOG] Install target: $INSTALL_TARGET"
echo "[LOG] Destination:  $DEST_DIR"

# Create directory structure (ensure Tools directory exists first)
echo "[LOG] Creating directory structure: $BIN_TOOLS_DIR"
mkdir_p "$BIN_TOOLS_DIR"
echo "[LOG] Creating destination: $DEST_DIR"
mkdir_p "$DEST_DIR"
echo "[LOG] Creating downloads directory: $DL_DIR"
mkdir_p "$DL_DIR"
echo "[LOG] Directory structure created successfully"

#------------------------------------------------------------
# SteamCMD (Windows .exe version)
#------------------------------------------------------------
STEAMCMD_DIR="$DEST_DIR/steamcmd"
STEAMCMD_WIN_ZIP="$DL_DIR/steamcmd.zip"

if [ "$INSTALL_TARGET" = "all" ] || [ "$INSTALL_TARGET" = "steamcmd" ] || [ "$INSTALL_TARGET" = "steamcmd-windows" ]; then
  echo "[LOG] Installing SteamCMD (Windows)..."
  
  if [ -f "$STEAMCMD_DIR/steamcmd.exe" ]; then
    echo "[LOG] SteamCMD (Windows) already present: $STEAMCMD_DIR/steamcmd.exe"
  else
    echo "[LOG] Downloading SteamCMD (Windows)..."
    mkdir_p "$STEAMCMD_DIR"
    download "$STEAMCMD_WINDOWS_URL" "$STEAMCMD_WIN_ZIP"
    echo "[LOG] Extracting SteamCMD (Windows)..."
    unzip_to "$STEAMCMD_WIN_ZIP" "$STEAMCMD_DIR"
  fi
  STEAMCMD_EXE="$(find_file "$STEAMCMD_DIR" "steamcmd.exe" || true)"
else
  echo "[LOG] Skipping SteamCMD (Windows) installation (target: $INSTALL_TARGET)"
  STEAMCMD_EXE=""
fi

#------------------------------------------------------------
# SteamCMD (macOS .sh version)
#------------------------------------------------------------
STEAMCMD_OSX_TAR="$DL_DIR/steamcmd_osx.tar.gz"

if [ "$INSTALL_TARGET" = "all" ] || [ "$INSTALL_TARGET" = "steamcmd" ] || [ "$INSTALL_TARGET" = "steamcmd-macos" ]; then
  echo "[LOG] Installing SteamCMD (macOS)..."
  
  if [ -f "$STEAMCMD_DIR/steamcmd.sh" ]; then
    echo "[LOG] SteamCMD (macOS) already present: $STEAMCMD_DIR/steamcmd.sh"
  else
    echo "[LOG] Downloading SteamCMD (macOS)..."
    mkdir_p "$STEAMCMD_DIR"
    download "$STEAMCMD_OSX_URL" "$STEAMCMD_OSX_TAR"
    echo "[LOG] Extracting SteamCMD (macOS)..."
    tar_extract "$STEAMCMD_OSX_TAR" "$STEAMCMD_DIR"
    # Make steamcmd.sh executable
    if [ -f "$STEAMCMD_DIR/steamcmd.sh" ]; then
      if command -v chmod.ape >/dev/null 2>&1; then
        chmod.ape +x "$STEAMCMD_DIR/steamcmd.sh" 2>/dev/null || true
      else
        chmod +x "$STEAMCMD_DIR/steamcmd.sh" 2>/dev/null || true
      fi
    fi
  fi
  STEAMCMD_SH="$(find_file "$STEAMCMD_DIR" "steamcmd.sh" || true)"
else
  echo "[LOG] Skipping SteamCMD (macOS) installation (target: $INSTALL_TARGET)"
  STEAMCMD_SH=""
fi

STEAMCMD_BIN="$(find_file "$STEAMCMD_DIR" "steamcmd" || true)"

#------------------------------------------------------------
# Epic BuildPatchTool
#------------------------------------------------------------
if [ "$INSTALL_TARGET" = "all" ] || [ "$INSTALL_TARGET" = "buildpatchtool" ]; then
  echo "[LOG] Installing Epic BuildPatchTool..."
  
  BPT_DIR="$DEST_DIR/BuildPatchTool"
  BPT_ZIP="$DL_DIR/BuildPatchTool.zip"

  # Check if BuildPatchTool is already installed (files are in nested subdirectories)
  if [ -d "$BPT_DIR" ]; then
    BPT_CHECK_EXE="$(find_file "$BPT_DIR" "BuildPatchTool.exe" 2>/dev/null || true)"
    BPT_CHECK_BIN="$(find_file "$BPT_DIR" "BuildPatchTool" 2>/dev/null || true)"
    
    if [ -n "$BPT_CHECK_EXE" ] || [ -n "$BPT_CHECK_BIN" ]; then
      echo "[LOG] BuildPatchTool already present: $BPT_DIR"
    else
      echo "[LOG] Downloading Epic BuildPatchTool..."
      rm_rf "$BPT_DIR"
      mkdir_p "$BPT_DIR"
      download "$BPT_URL" "$BPT_ZIP"
      echo "[LOG] Extracting BuildPatchTool..."
      unzip_to "$BPT_ZIP" "$BPT_DIR"
      
      # Set execute permissions for Mac/Linux binaries
      if [ -n "$BPT_BIN" ]; then
        if command -v chmod.ape >/dev/null 2>&1; then
          chmod.ape +x "$BPT_BIN" 2>/dev/null || true
        else
          chmod +x "$BPT_BIN" 2>/dev/null || true
        fi
      fi
    fi
  else
    echo "[LOG] Downloading Epic BuildPatchTool..."
    rm_rf "$BPT_DIR"
    mkdir_p "$BPT_DIR"
    download "$BPT_URL" "$BPT_ZIP"
    echo "[LOG] Extracting BuildPatchTool..."
    unzip_to "$BPT_ZIP" "$BPT_DIR"
    
    # Set execute permissions for Mac/Linux binaries after extraction
    BPT_BIN_TEMP="$(find_file "$BPT_DIR" "BuildPatchTool" || true)"
    if [ -n "$BPT_BIN_TEMP" ]; then
      if command -v chmod.ape >/dev/null 2>&1; then
        chmod.ape +x "$BPT_BIN_TEMP" 2>/dev/null || true
      else
        chmod +x "$BPT_BIN_TEMP" 2>/dev/null || true
      fi
    fi
  fi

  BPT_EXE="$(find_file "$BPT_DIR" "BuildPatchTool.exe" || true)"
  BPT_BIN="$(find_file "$BPT_DIR" "BuildPatchTool" || true)"
else
  echo "[LOG] Skipping BuildPatchTool installation (target: $INSTALL_TARGET)"
  BPT_DIR="$DEST_DIR/BuildPatchTool"
  BPT_EXE=""
  BPT_BIN=""
fi

echo ""
echo "[LOG] Installed artifacts (best-effort detection):"
echo "[LOG] SteamCMD dir: $STEAMCMD_DIR"
echo "[LOG]  steamcmd.exe: ${STEAMCMD_EXE:-<not found>}"
echo "[LOG]  steamcmd.sh:  ${STEAMCMD_SH:-<not found>}"
echo "[LOG]  steamcmd:     ${STEAMCMD_BIN:-<not found>}"
echo "[LOG] BuildPatchTool dir: $BPT_DIR"
echo "[LOG]  BuildPatchTool.exe: ${BPT_EXE:-<not found>}"
echo "[LOG]  BuildPatchTool:     ${BPT_BIN:-<not found>}"

echo ""
echo "[LOG] Installation directory: $DEST_DIR"
echo "[LOG] Tools installed to user directory (not in project)"
echo "[LOG] Done."



