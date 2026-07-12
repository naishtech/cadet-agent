#!/usr/bin/env bats

# Tests for validate.sh — Phase 4: validation gates

setup() {
    TEST_DIR="$(mktemp -d)"
    export ORCHESTRATOR_STATE_DIR="$TEST_DIR"
    ORCHESTRATOR_STATE="$TEST_DIR/state.json"
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    source "${BATS_TEST_DIRNAME}/../lib/validate.sh"
    orchestrator_state_init "/ws"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "validate_gates for large path returns expected gates" {
    run orchestrator_validate_gates "large"

    [ "$status" -eq 0 ]
    [[ "$output" == *"acceptance_criteria"* ]]
    [[ "$output" == *"red_green_tdd"* ]]
    [[ "$output" == *"artifact_synchronization"* ]]
    [[ "$output" == *"integration_behavior"* ]]
    [[ "$output" == *"security_review"* ]]
}

@test "validate_gates for small path returns expected gates" {
    run orchestrator_validate_gates "small"

    [ "$status" -eq 0 ]
    [[ "$output" == *"failing_test_first"* ]]
    [[ "$output" == *"passing_test_after"* ]]
    [[ "$output" == *"no_regression"* ]]
}

@test "validate_gates for no_test_required path returns manual verification" {
    run orchestrator_validate_gates "no_test_required"

    [ "$status" -eq 0 ]
    [[ "$output" == *"manual_verification"* ]]
}

@test "validate_gates sets phase to closed" {
    orchestrator_validate_gates "small" > /dev/null

    run orchestrator_state_get "phase"

    [ "$output" = "closed" ]
}

@test "validate_gates fails for unknown path" {
    run orchestrator_validate_gates "unknown"

    [ "$status" -eq 1 ]
}
