#!/usr/bin/env bash
# classify.sh — Phase 1: Change Classification
# Routes work as large, small, or no_test_required.

orchestrator_classify() {
    local description="$1"
    local desc
    desc=$(echo "$description" | tr '[:upper:]' '[:lower:]')

    # Keywords that suggest documentation/config-only changes
    local no_test_kw=("readme" "documentation" "comment" "changelog" "license" "setup instructions")
    for kw in "${no_test_kw[@]}"; do
        if [[ "$desc" == *"$kw"* ]]; then
            orchestrator_state_set "path" "no_test_required"
            echo "no_test_required"
            return 0
        fi
    done

    # Keywords that suggest a large, multi-component change
    local large_kw=("system" "matchmaking" "multiplayer" "networking" "refactor" "rewrite" "redesign" "architecture" "pipeline" "framework" "engine" "save system" "inventory system" "combat system" "dialogue system")
    for kw in "${large_kw[@]}"; do
        if [[ "$desc" == *"$kw"* ]]; then
            orchestrator_state_set "path" "large"
            echo "large"
            return 0
        fi
    done

    # "fix" or "bug" suggests a small change
    if [[ "$desc" == *"fix"* ]] || [[ "$desc" == *"bug"* ]]; then
        orchestrator_state_set "path" "small"
        echo "small"
        return 0
    fi

    # Default to small
    orchestrator_state_set "path" "small"
    echo "small"
}
