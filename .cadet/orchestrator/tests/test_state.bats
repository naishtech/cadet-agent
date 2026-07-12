#!/usr/bin/env bats

# Tests for state.sh — JSON state file management

setup() {
    TEST_DIR="$(mktemp -d)"
    export ORCHESTRATOR_STATE_DIR="$TEST_DIR"
    ORCHESTRATOR_STATE="$TEST_DIR/state.json"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "state_init creates a valid state.json with defaults" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    run orchestrator_state_init "/ws"

    [ "$status" -eq 0 ]
    [ -f "$ORCHESTRATOR_STATE" ]

    # Check default phase
    [ "$(jq -r '.phase' "$ORCHESTRATOR_STATE")" = "context_resolution" ]

    # Check workspace root is stored
    [ "$(jq -r '.context.workspace_root' "$ORCHESTRATOR_STATE")" = "/ws" ]

    # Check default tier
    [ "$(jq -r '.context.tier' "$ORCHESTRATOR_STATE")" = "guided" ]

    # Check no active policy
    [ "$(jq -r '.context.policy' "$ORCHESTRATOR_STATE")" = "null" ]
}

@test "state_get retrieves a top-level key" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    orchestrator_state_init "/ws"

    run orchestrator_state_get "phase"

    [ "$status" -eq 0 ]
    [ "$output" = "context_resolution" ]
}

@test "state_get retrieves a nested key" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    orchestrator_state_init "/ws"

    run orchestrator_state_get "context.tier"

    [ "$status" -eq 0 ]
    [ "$output" = "guided" ]
}

@test "state_set updates an existing key" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    orchestrator_state_init "/ws"

    orchestrator_state_set "phase" "requirements"
    run orchestrator_state_get "phase"

    [ "$status" -eq 0 ]
    [ "$output" = "requirements" ]
}

@test "state_set updates a nested key" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    orchestrator_state_init "/ws"

    orchestrator_state_set "context.tier" "advanced"
    run orchestrator_state_get "context.tier"

    [ "$status" -eq 0 ]
    [ "$output" = "advanced" ]
}

@test "state_set path stores workflow classification" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    orchestrator_state_init "/ws"

    orchestrator_state_set "path" "large"
    run orchestrator_state_get "path"

    [ "$status" -eq 0 ]
    [ "$output" = "large" ]
}

@test "state_append adds to an array" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    orchestrator_state_init "/ws"

    orchestrator_state_append "invocation_log" '{"skill":"requirements","success":true,"summary":"done"}'
    run jq -r '.invocation_log | length' "$ORCHESTRATOR_STATE"

    [ "$status" -eq 0 ]
    [ "$output" = "1" ]
}

@test "state_get fails gracefully for missing file" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"

    run orchestrator_state_get "phase"

    [ "$status" -eq 1 ]
}

@test "state_init is idempotent — does not overwrite existing state" {
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    orchestrator_state_init "/ws"
    orchestrator_state_set "phase" "implementation"
    orchestrator_state_init "/ws"

    run orchestrator_state_get "phase"

    [ "$status" -eq 0 ]
    [ "$output" = "implementation" ]
}
