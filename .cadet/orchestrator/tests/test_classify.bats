#!/usr/bin/env bats

# Tests for classify.sh — Phase 1: explicit path classification

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

@test "classify accepts 'large'" {
    run orchestrator_classify "large"

    [ "$status" -eq 0 ]
    [ "$output" = "large" ]
}

@test "classify accepts 'small'" {
    run orchestrator_classify "small"

    [ "$status" -eq 0 ]
    [ "$output" = "small" ]
}

@test "classify accepts 'no_test_required'" {
    run orchestrator_classify "no_test_required"

    [ "$status" -eq 0 ]
    [ "$output" = "no_test_required" ]
}

@test "classify rejects invalid path" {
    run orchestrator_classify "bogus"

    [ "$status" -eq 1 ]
    [[ "$output" == *"ERROR"* ]]
    [[ "$output" == *"invalid path"* ]]
}

@test "classify rejects empty path" {
    run orchestrator_classify ""

    [ "$status" -eq 1 ]
}

@test "classify writes path to state for 'large'" {
    orchestrator_classify "large" > /dev/null

    [ "$(orchestrator_state_get 'path')" = "large" ]
}

@test "classify writes path to state for 'small'" {
    orchestrator_classify "small" > /dev/null

    [ "$(orchestrator_state_get 'path')" = "small" ]
}

@test "classify writes path to state for 'no_test_required'" {
    orchestrator_classify "no_test_required" > /dev/null

    [ "$(orchestrator_state_get 'path')" = "no_test_required" ]
}

@test "classify does not modify state on invalid path" {
    orchestrator_classify "large" > /dev/null
    run orchestrator_classify "invalid"

    [ "$status" -eq 1 ]
    # State should still be 'large' — not overwritten on error
    [ "$(orchestrator_state_get 'path')" = "large" ]
}
