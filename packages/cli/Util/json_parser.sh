#!/bin/bash

#================================================================
# JSON Parser Utilities
#================================================================
# Provides JSON parsing functions for Build Profile configuration
# Requires jq (packaged in CLI or available in system PATH)

# Find jq executable
# Priority:
#   1. COSMOS_BIN_DIR/jq (from COSMOS_BIN_DIR environment variable, set by ProcessExecutor on Windows)
#   2. System PATH (Mac/Linux, Windows if jq is installed globally)
#   3. Local Cosmos bundle fallback
JQ_CMD=""

# Script is always in CLI/Util/ (relative to CLI directory)
# Only set TOOLS_DIR if not already set (allows callers to set it first)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "${TOOLS_DIR:-}" ]; then
    TOOLS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
# BINARIES_DIR is always CLI (or Tools/CLI in cadet-cli, but we treat it as CLI)
# Script is at CLI/Util/, TOOLS_DIR = CLI, so BINARIES_DIR = CLI
BINARIES_DIR="$TOOLS_DIR"

# Use COSMOS_BIN_DIR environment variable if set (set by ProcessExecutor on Windows)
# Otherwise, COSMOS_BIN_DIR will be empty and script will use system jq (Mac/Linux) or fail (Windows)
COSMOS_BIN_DIR="${COSMOS_BIN_DIR:-}"
if [ -n "$COSMOS_BIN_DIR" ] && [ -d "$COSMOS_BIN_DIR" ]; then
    COSMOS_JQ="$COSMOS_BIN_DIR/jq"
else
    COSMOS_BIN_DIR=""
    COSMOS_JQ=""
fi

# Detect OS for platform-specific behavior
OS_TYPE=""
UNAME_CMD="uname"
if ! command -v uname >/dev/null 2>&1; then
    if command -v uname.ape >/dev/null 2>&1; then
        UNAME_CMD="uname.ape"
    fi
fi

case "$("$UNAME_CMD" -s)" in
    Darwin*)
        OS_TYPE="macos"
        ;;
    Linux*)
        OS_TYPE="linux"
        ;;
    MINGW*|MSYS*|CYGWIN*|Windows*)
        OS_TYPE="windows"
        ;;
    *)
        OS_TYPE="unknown"
        ;;
esac

# Windows: REQUIRE Cosmos jq OR fallback to system jq (no fallbacks)
if [ "$OS_TYPE" = "windows" ]; then
    if [ -f "$COSMOS_JQ" ]; then
        JQ_CMD="$COSMOS_JQ"
    elif command -v jq &> /dev/null; then
        # Fallback to system jq if available
        JQ_CMD="jq"
    fi
fi

# macOS/Linux: Prefer system jq, fallback to Cosmos
if [ "$OS_TYPE" != "windows" ]; then
    # Try system jq first
    if command -v jq &> /dev/null; then
        JQ_CMD="jq"
    # Fallback to Cosmos jq
    elif [ -f "$COSMOS_JQ" ]; then
        JQ_CMD="$COSMOS_JQ"
    fi
fi

# Error if jq still not found
if [ -z "$JQ_CMD" ]; then
    if [ "$OS_TYPE" = "windows" ]; then
        echo "[ERR] jq not found on Windows. Windows requires jq in Cosmos bundle or in system PATH." >&2
        if [ -n "$COSMOS_BIN_DIR" ]; then
            echo "[ERR]   - Expected COSMOS location: $COSMOS_JQ" >&2
            echo "[ERR]   - COSMOS_BIN_DIR is set: $COSMOS_BIN_DIR" >&2
        else
            echo "[ERR]   - COSMOS_BIN_DIR environment variable not set" >&2
            echo "[ERR]   - Cosmos binaries should be installed in: Plugins/CadetBuild/Binaries" >&2
            echo "[ERR]   - Or install jq in system PATH" >&2
        fi
    else
        echo "[ERR] jq not found. Please ensure jq is available:" >&2
        echo "[ERR]   - Install jq in system PATH (preferred)" >&2
        echo "[ERR]   - Download: https://stedolan.github.io/jq/download/" >&2
    fi
    exit 1
fi

#================================================================
# Helper Functions
#================================================================

_normalize_windows_file_path() {
    local input_path="$1"

    if [[ "$input_path" =~ ^/([A-Za-z])/(.*)$ ]]; then
        local drive_letter
        drive_letter=$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:lower:]' '[:upper:]')
        printf '%s:/%s\n' "$drive_letter" "${BASH_REMATCH[2]}"
        return 0
    fi

    if [[ "$input_path" =~ ^/([A-Za-z])$ ]]; then
        local drive_letter
        drive_letter=$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:lower:]' '[:upper:]')
        printf '%s:/\n' "$drive_letter"
        return 0
    fi

    printf '%s\n' "$input_path"
}

_resolve_json_file_for_jq() {
    local json_file="$1"

    if [ "$OS_TYPE" = "windows" ]; then
        local normalized_path
        normalized_path=$(_normalize_windows_file_path "$json_file")
        if [ "$normalized_path" != "$json_file" ] && [ -f "$normalized_path" ]; then
            printf '%s\n' "$normalized_path"
            return 0
        fi
    fi

    printf '%s\n' "$json_file"
}

_export_json_value() {
    local variable_name="$1"
    local json_file="$2"
    local json_path="$3"
    local allow_missing="${4:-false}"
    local value

    if [ "$allow_missing" = "true" ]; then
        value=$(get_json_value "$json_file" "$json_path" 2>/dev/null || true)
        export "$variable_name=$value"
        return 0
    fi

    if ! value=$(get_json_value "$json_file" "$json_path"); then
        return 1
    fi

    export "$variable_name=$value"
    return 0
}

# Function to check if a file exists and is readable
_check_json_file() {
    local json_file="$1"
    
    if [ -z "$json_file" ]; then
        echo "[ERR] JSON file path is empty" >&2
        return 1
    fi
    
    if [ ! -f "$json_file" ]; then
        echo "[ERR] JSON file not found: $json_file" >&2
        return 1
    fi
    
    if [ ! -r "$json_file" ]; then
        echo "[ERR] JSON file is not readable: $json_file" >&2
        return 1
    fi
    
    return 0
}

# Function to validate JSON syntax using jq
_validate_json_syntax() {
    local json_file="$1"
    local resolved_json_file
    resolved_json_file=$(_resolve_json_file_for_jq "$json_file")
    
    # Use jq to validate JSON syntax
    if "$JQ_CMD" empty "$resolved_json_file" 2>/dev/null; then
        return 0
    else
        echo "[ERR] Invalid JSON syntax in file: $json_file" >&2
        return 1
    fi
}

# Function to get JSON value using jq
_get_json_value() {
    local json_file="$1"
    local json_path="$2"
    local resolved_json_file
    resolved_json_file=$(_resolve_json_file_for_jq "$json_file")
    
    local value
    value=$("$JQ_CMD" -r "$json_path" "$resolved_json_file" 2>&1)
    
    if [ $? -ne 0 ]; then
        echo "[ERR] Failed to extract JSON value at path '$json_path' from file: $json_file" >&2
        if [ "$resolved_json_file" != "$json_file" ]; then
            echo "[ERR] Resolved jq input path: $resolved_json_file" >&2
        fi
        if [ -n "$value" ]; then
            echo "[ERR] jq output: $value" >&2
        fi
        return 1
    fi
    
    # jq returns "null" as string for null values
    if [ "$value" = "null" ]; then
        return 1
    fi
    
    echo "$value"
    return 0
}

#================================================================
# Public Functions
#================================================================

# Function to get a value from JSON file using dot notation
# Usage: get_json_value <json_file> <json_path>
# Example: get_json_value "profile.json" "unity.editorPath"
# Example: get_json_value "profile.json" "platform"
get_json_value() {
    local json_file="$1"
    local json_path="$2"
    
    # Validate inputs
    if [ -z "$json_file" ]; then
        echo "[ERR] JSON file path is required" >&2
        return 1
    fi
    
    if [ -z "$json_path" ]; then
        echo "[ERR] JSON path is required" >&2
        return 1
    fi
    
    # Check file exists and is readable
    if ! _check_json_file "$json_file"; then
        return 1
    fi
    
    # Convert dot notation to jq path format
    # Convert "unity.editorPath" to ".unity.editorPath"
    local jq_path
    if [[ "$json_path" == .* ]]; then
        jq_path="$json_path"
    else
        jq_path=".$json_path"
    fi
    
    _get_json_value "$json_file" "$jq_path"
}

# Function to load and validate JSON profile file
# Usage: load_profile_json <json_file>
# Sets global variables based on JSON content
load_profile_json() {
    local json_file="$1"
    
    # Validate inputs
    if [ -z "$json_file" ]; then
        echo "[ERR] JSON file path is required" >&2
        return 1
    fi
    
    # Check file exists and is readable
    if ! _check_json_file "$json_file"; then
        return 1
    fi
    
    # Validate JSON syntax
    if ! _validate_json_syntax "$json_file"; then
        return 1
    fi
    
    # Extract and export values
    # Top-level fields
    if ! _export_json_value "PROFILE_NAME" "$json_file" "profileName"; then
        return 1
    fi
    if ! _export_json_value "PROFILE_PLATFORM" "$json_file" "platform"; then
        return 1
    fi
    if ! _export_json_value "PROFILE_OS" "$json_file" "os"; then
        return 1
    fi
    _export_json_value "PROFILE_BUNDLE_ID" "$json_file" "bundleId" true
    _export_json_value "PROFILE_USE_GIT" "$json_file" "useGit" true
    _export_json_value "PROFILE_INSTALL_GIT_LFS_IF_MISSING" "$json_file" "installGitLfsIfMissing" true
    _export_json_value "PROFILE_GIT_REPOSITORY" "$json_file" "gitRepository" true
    _export_json_value "PROFILE_GIT_BRANCH" "$json_file" "gitBranch" true
    _export_json_value "PROFILE_GIT_BASH_PATH" "$json_file" "gitBashPath" true

    if [ -z "$PROFILE_INSTALL_GIT_LFS_IF_MISSING" ] || [ "$PROFILE_INSTALL_GIT_LFS_IF_MISSING" = "null" ]; then
        export PROFILE_INSTALL_GIT_LFS_IF_MISSING="false"
    fi
    
    # Unity settings (optional here, validated by caller based on selected engine)
    _export_json_value "UNITY_EDITOR_PATH" "$json_file" "unity.editorPath" true
    _export_json_value "UNITY_PROJECT_PATH" "$json_file" "unity.projectPath" true
    _export_json_value "UNITY_BUILD_OUTPUT_PATH" "$json_file" "unity.buildOutputPath" true
    _export_json_value "UNITY_PROJECT_NAME" "$json_file" "unity.projectName" true

    # Unreal settings (optional here, validated by caller based on selected engine)
    _export_json_value "UNREAL_ENGINE_ROOT" "$json_file" "unreal.engineRoot" true
    _export_json_value "UNREAL_PROJECT_PATH" "$json_file" "unreal.projectPath" true
    _export_json_value "UNREAL_BUILD_OUTPUT_PATH" "$json_file" "unreal.buildOutputPath" true
    _export_json_value "UNREAL_PROJECT_NAME" "$json_file" "unreal.projectName" true
    _export_json_value "UNREAL_BUILD_CONFIGURATION" "$json_file" "unreal.buildConfiguration" true
    _export_json_value "UNREAL_TARGET_PLATFORMS" "$json_file" "unreal.targetPlatforms" true
    _export_json_value "UNREAL_ARCHIVE_DIRECTORY" "$json_file" "unreal.archiveDirectory" true
    _export_json_value "UNREAL_PACKAGING_INI_OVERRIDE" "$json_file" "unreal.packagingIniOverride" true
    
    # Steam settings
    _export_json_value "STEAM_APP_ID" "$json_file" "steam.appId" true
    _export_json_value "STEAMCMD_EXE" "$json_file" "steam.steamcmdExe" true
    _export_json_value "STEAMCMD_SH" "$json_file" "steam.steamcmdSh" true
    _export_json_value "STEAM_USE_SENTRY_FILE" "$json_file" "steam.useSentryFile" true
    # Default to false (interactive) if not specified
    if [ -z "$STEAM_USE_SENTRY_FILE" ] || [ "$STEAM_USE_SENTRY_FILE" = "null" ]; then
        export STEAM_USE_SENTRY_FILE="false"
    fi
    
    # Epic settings
    _export_json_value "EPIC_PRODUCT_ID" "$json_file" "epic.productId" true
    _export_json_value "EPIC_ORGANIZATION_ID" "$json_file" "epic.organizationId" true
    _export_json_value "EPIC_ARTIFACT_ID" "$json_file" "epic.artifactId" true
    _export_json_value "EPIC_SANDBOX_ID" "$json_file" "epic.sandboxId" true
    _export_json_value "EPIC_BUILDPATCHTOOL_PATH" "$json_file" "epic.buildPatchToolPath" true
    _export_json_value "EPIC_BUILD_VERSION" "$json_file" "epic.buildVersion" true
    _export_json_value "EPIC_USE_GIT_TAG_FOR_VERSION" "$json_file" "epic.useGitTagForVersion" true
    _export_json_value "EPIC_LABEL" "$json_file" "epic.label" true
    # EPIC_LABEL is optional - do not set a default, allow empty to skip labeling
    
    # macOS settings
    _export_json_value "MACOS_ENABLE_SIGNING" "$json_file" "macos.enableSigning" true
    _export_json_value "MACOS_ENTITLEMENTS_PATH" "$json_file" "macos.entitlementsPath" true
    
    # Output profile info without tags (calling script will add appropriate tags)
    echo "Loaded Build Profile from: $json_file"
    echo "Profile: $PROFILE_NAME"
    echo "Platform: $PROFILE_PLATFORM"
    echo "OS: $PROFILE_OS"
    echo "Bundle ID: $PROFILE_BUNDLE_ID"
    
    return 0
}

# Function to validate JSON structure against expected schema
# Usage: validate_json_structure <json_file>
# Returns 0 if valid, 1 if invalid
validate_json_structure() {
    local json_file="$1"
    
    # Validate inputs
    if [ -z "$json_file" ]; then
        echo "[ERR] JSON file path is required" >&2
        return 1
    fi
    
    # Check file exists and is readable
    if ! _check_json_file "$json_file"; then
        return 1
    fi
    
    # Validate JSON syntax
    if ! _validate_json_syntax "$json_file"; then
        return 1
    fi
    
    # Check for required top-level fields
    local required_fields=("profileName" "platform" "os")
    for field in "${required_fields[@]}"; do
        local value
        value=$(get_json_value "$json_file" "$field")
        if [ -z "$value" ]; then
            echo "[ERR] Required field missing: $field" >&2
            return 1
        fi
    done
    
    # Validate platform value
    local platform
    platform=$(get_json_value "$json_file" "platform")
    if [[ "$platform" != "none" && "$platform" != "steam" && "$platform" != "epic" && "$platform" != "both" ]]; then
        echo "[ERR] Invalid platform value: $platform (must be 'none', 'steam', 'epic', or 'both')" >&2
        return 1
    fi
    
    # Validate OS value
    local os
    os=$(get_json_value "$json_file" "os")
    if [[ "$os" != "windows" && "$os" != "mac" && "$os" != "both" ]]; then
        echo "[ERR] Invalid OS value: $os (must be 'windows', 'mac', or 'both')" >&2
        return 1
    fi

    # Validate installGitLfsIfMissing type when present
    if ! "$JQ_CMD" -e 'if has("installGitLfsIfMissing") then ((.installGitLfsIfMissing | type) == "boolean") else true end' "$json_file" >/dev/null 2>&1; then
        echo "[ERR] Invalid type for installGitLfsIfMissing (must be boolean)" >&2
        return 1
    fi
    
    # Check for required nested objects based on platform.
    # Platform 'none' intentionally skips publish-specific validation.
    if [[ "$platform" == "steam" || "$platform" == "both" ]]; then
        local steam_app_id
        steam_app_id=$(get_json_value "$json_file" "steam.appId")
        if [ -z "$steam_app_id" ]; then
            echo "[ERR] Required field missing: steam.appId" >&2
            return 1
        fi
        
        # Check for steamcmd fields based on OS
        if [[ "$os" == "windows" ]]; then
            local steamcmd_exe
            steamcmd_exe=$(get_json_value "$json_file" "steam.steamcmdExe")
            if [ -z "$steamcmd_exe" ]; then
                echo "[ERR] Required field missing: steam.steamcmdExe (required when os is 'windows')" >&2
                return 1
            fi
        elif [[ "$os" == "mac" ]]; then
            local steamcmd_sh
            steamcmd_sh=$(get_json_value "$json_file" "steam.steamcmdSh")
            if [ -z "$steamcmd_sh" ]; then
                echo "[ERR] Required field missing: steam.steamcmdSh (required when os is 'mac')" >&2
                return 1
            fi
        elif [[ "$os" == "both" ]]; then
            local steamcmd_exe
            steamcmd_exe=$(get_json_value "$json_file" "steam.steamcmdExe")
            if [ -z "$steamcmd_exe" ]; then
                echo "[ERR] Required field missing: steam.steamcmdExe (required when os is 'both')" >&2
                return 1
            fi
            local steamcmd_sh
            steamcmd_sh=$(get_json_value "$json_file" "steam.steamcmdSh")
            if [ -z "$steamcmd_sh" ]; then
                echo "[ERR] Required field missing: steam.steamcmdSh (required when os is 'both')" >&2
                return 1
            fi
        fi
    fi

    if [[ "$platform" == "epic" || "$platform" == "both" ]]; then
        local epic_product_id
        epic_product_id=$(get_json_value "$json_file" "epic.productId")
        if [ -z "$epic_product_id" ]; then
            echo "[ERR] Required field missing: epic.productId" >&2
            return 1
        fi
    fi
    
    # Require at least one engine section (unity or unreal)
    local unity_editor_path
    unity_editor_path=$(get_json_value "$json_file" "unity.editorPath" 2>/dev/null || true)
    local unreal_engine_root
    unreal_engine_root=$(get_json_value "$json_file" "unreal.engineRoot" 2>/dev/null || true)

    if [ -z "$unity_editor_path" ] && [ -z "$unreal_engine_root" ]; then
        echo "[ERR] Required engine section missing: provide either 'unity' or 'unreal'" >&2
        return 1
    fi
    
    # Output validation result without tags (calling script will add appropriate tags)
    echo "JSON structure validation passed"
    return 0
}

