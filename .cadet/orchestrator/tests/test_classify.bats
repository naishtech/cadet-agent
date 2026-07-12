#!/usr/bin/env bats

# Tests for classify.sh — Phase 1: change classification

setup() {
    TEST_DIR="$(mktemp -d)"
    export ORCHESTRATOR_STATE_DIR="$TEST_DIR"
    ORCHESTRATOR_STATE="$TEST_DIR/state.json"
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    source "${BATS_TEST_DIRNAME}/../lib/classify.sh"
    orchestrator_state_init "/ws"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "classify returns 'large' for system-level changes" {
    run orchestrator_classify "add a new multiplayer matchmaking system with ELO ranking"

    [ "$status" -eq 0 ]
    [ "$output" = "large" ]
}

@test "classify returns 'small' for bug fixes" {
    run orchestrator_classify "fix the jump button not working on mobile"

    [ "$status" -eq 0 ]
    [ "$output" = "small" ]
}

@test "classify returns 'no_test_required' for documentation changes" {
    run orchestrator_classify "update the README with new setup instructions"

    [ "$status" -eq 0 ]
    [ "$output" = "no_test_required" ]
}

@test "classify detects refactor as large" {
    run orchestrator_classify "refactor the entire save system"

    [ "$status" -eq 0 ]
    [ "$output" = "large" ]
}

@test "classify detects networking as large" {
    run orchestrator_classify "implement networking for multiplayer"

    [ "$status" -eq 0 ]
    [ "$output" = "large" ]
}

@test "classify default is small for generic requests" {
    run orchestrator_classify "add a health bar to the player HUD"

    [ "$status" -eq 0 ]
    [ "$output" = "small" ]
}

@test "classify writes path to state" {
    orchestrator_state_init "/ws"
    orchestrator_classify "add multiplayer matchmaking" > /dev/null

    run orchestrator_state_get "path"

    [ "$output" = "large" ]
}
