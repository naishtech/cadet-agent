#!/usr/bin/env bats

# Tests for dispatch.sh — Phase 2: skill dispatch

setup() {
    TEST_DIR="$(mktemp -d)"
    export ORCHESTRATOR_STATE_DIR="$TEST_DIR"
    ORCHESTRATOR_STATE="$TEST_DIR/state.json"
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    source "${BATS_TEST_DIRNAME}/../lib/dispatch.sh"
    orchestrator_state_init "/ws"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "dispatch returns success for known skill" {
    run orchestrator_dispatch "requirements"

    [ "$status" -eq 0 ]
    [[ "$output" == *"dispatched"* ]]
}

@test "dispatch logs invocation to state" {
    orchestrator_dispatch "architecture" > /dev/null

    run jq -r '.invocation_log | length' "$ORCHESTRATOR_STATE"

    [ "$output" = "1" ]
}

@test "dispatch logs skill name correctly" {
    orchestrator_dispatch "tdd" > /dev/null

    run jq -r '.invocation_log[0].skill' "$ORCHESTRATOR_STATE"

    [ "$output" = "tdd" ]
}

@test "dispatch_sequence invokes all skills in order" {
    run orchestrator_dispatch_sequence "requirements" "architecture"

    [ "$status" -eq 0 ]
    run jq -r '.invocation_log | length' "$ORCHESTRATOR_STATE"
    [ "$output" = "2" ]

    run jq -r '.invocation_log[0].skill' "$ORCHESTRATOR_STATE"
    [ "$output" = "requirements" ]

    run jq -r '.invocation_log[1].skill' "$ORCHESTRATOR_STATE"
    [ "$output" = "architecture" ]
}

@test "dispatch_sequence stops on first failure" {
    # Simulate failure by dispatching an unknown skill
    run orchestrator_dispatch_sequence "requirements" "unknown_skill" "architecture"

    [ "$status" -eq 1 ]
    run jq -r '.invocation_log | length' "$ORCHESTRATOR_STATE"
    [ "$output" = "2" ]
}

@test "dispatch fails gracefully for unknown skill" {
    run orchestrator_dispatch "nonexistent_skill"

    [ "$status" -eq 1 ]
    [[ "$output" == *"unknown"* ]]
}
