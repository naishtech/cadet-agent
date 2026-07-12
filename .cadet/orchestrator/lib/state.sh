#!/usr/bin/env bash
# state.sh — JSON state file management for Cadet Orchestrator
# Requires: jq

# Resolve state file path; defaults to ORCHESTRATOR_STATE or $ORCHESTRATOR_STATE_DIR/state.json
_resolve_state_file() {
    if [ -n "${ORCHESTRATOR_STATE:-}" ]; then
        echo "$ORCHESTRATOR_STATE"
    elif [ -n "${ORCHESTRATOR_STATE_DIR:-}" ]; then
        echo "${ORCHESTRATOR_STATE_DIR}/state.json"
    else
        echo ".cadet/orchestrator/state.json"
    fi
}

# Convert a path for use with Windows-native tools like jq.
# On MSYS2/Git Bash, converts Unix paths to Windows; no-op otherwise.
_winpath() {
    if command -v cygpath > /dev/null 2>&1; then
        cygpath -w "$1"
    else
        echo "$1"
    fi
}

# Initialize a fresh state file. Idempotent — does not overwrite existing state.
orchestrator_state_init() {
    local workspace_root="${1:-$(pwd)}"
    local state_file win_state
    state_file="$(_resolve_state_file)"

    if [ -f "$state_file" ]; then
        return 0
    fi

    mkdir -p "$(dirname "$state_file")"
    win_state="$(_winpath "$state_file")"

    MSYS2_ARG_CONV_EXCL='*' jq -n \
        --arg ws "$workspace_root" \
        '{
            context: {
                tier: "guided",
                mode: "implementation_first",
                policy: null,
                guidance: [],
                standards: [],
                planning_dir: ".cadet/agent/project-plans",
                workspace_root: $ws
            },
            path: null,
            phase: "context_resolution",
            artifacts: {},
            active_epic: null,
            active_task: null,
            invocation_log: [],
            deviations: [],
            epic_task_count: 0,
            task_completion_count: 0
        }' > "$win_state"
}

# Get a value from state. Supports dot-notation for nested keys.
orchestrator_state_get() {
    local key="$1"
    local state_file
    state_file="$(_resolve_state_file)"

    if [ ! -f "$state_file" ]; then
        echo "ERROR: state file not found at $state_file" >&2
        return 1
    fi

    jq -r ".${key}" "$(_winpath "$state_file")"
}

# Set a value in state. Supports dot-notation for nested keys.
orchestrator_state_set() {
    local key="$1"
    local value="$2"
    local state_file win_state tmp tmp_win
    state_file="$(_resolve_state_file)"

    if [ ! -f "$state_file" ]; then
        echo "ERROR: state file not found at $state_file" >&2
        return 1
    fi

    win_state="$(_winpath "$state_file")"
    tmp="$(mktemp)"
    tmp_win="$(_winpath "$tmp")"

    if echo "$value" | jq -e . > /dev/null 2>&1; then
        jq ".${key} = ${value}" "$win_state" > "$tmp_win"
    else
        jq ".${key} = \"${value}\"" "$win_state" > "$tmp_win"
    fi
    mv "$tmp" "$state_file"
}

# Append a JSON value to an array in state.
orchestrator_state_append() {
    local array_key="$1"
    local value="$2"
    local state_file win_state tmp tmp_win
    state_file="$(_resolve_state_file)"

    if [ ! -f "$state_file" ]; then
        echo "ERROR: state file not found at $state_file" >&2
        return 1
    fi

    win_state="$(_winpath "$state_file")"
    tmp="$(mktemp)"
    tmp_win="$(_winpath "$tmp")"

    jq ".${array_key} += [${value}]" "$win_state" > "$tmp_win"
    mv "$tmp" "$state_file"
}
