#!/usr/bin/env bash
# classify.sh — Phase 1: Change Classification
# Accepts an explicit path: large, small, or no_test_required.
# The LLM determines the path by asking the user; the orchestrator validates it.

orchestrator_classify() {
    local path="$1"

    case "$path" in
        large|small|no_test_required)
            orchestrator_state_set "path" "$path"
            echo "$path"
            return 0
            ;;
        *)
            echo "ERROR: invalid path '${path}'. Use: large, small, or no_test_required" >&2
            return 1
            ;;
    esac
}
