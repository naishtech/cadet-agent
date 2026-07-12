#!/usr/bin/env bats

# Tests for context.sh — Phase 0: context resolution

setup() {
    TEST_DIR="$(mktemp -d)"
    export ORCHESTRATOR_STATE_DIR="$TEST_DIR"
    ORCHESTRATOR_STATE="$TEST_DIR/state.json"
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    source "${BATS_TEST_DIRNAME}/../lib/context.sh"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "context_resolve initializes state with workspace root" {
    run orchestrator_context_resolve "/test/workspace"

    [ "$status" -eq 0 ]
    [ "$(orchestrator_state_get 'context.workspace_root')" = "/test/workspace" ]
    [ "$(orchestrator_state_get 'phase')" = "context_resolution" ]
}

@test "context_resolve sets default tier to guided" {
    orchestrator_context_resolve "/ws"

    run orchestrator_state_get "context.tier"

    [ "$output" = "guided" ]
}

@test "context_resolve sets default mode to implementation_first" {
    orchestrator_context_resolve "/ws"

    run orchestrator_state_get "context.mode"

    [ "$output" = "implementation_first" ]
}

@test "context_resolve detects active policy when single policy exists" {
    # Create a mock policy file
    mkdir -p "$TEST_DIR/.cadet/agent/policies"
    echo "# Test Policy" > "$TEST_DIR/.cadet/agent/policies/TestPolicy.md"

    # Use the test dir as workspace root
    orchestrator_context_resolve "$TEST_DIR"

    run orchestrator_state_get "context.policy"

    [ "$output" = ".cadet/agent/policies/TestPolicy.md" ]
}

@test "context_resolve leaves policy null when no policies exist" {
    orchestrator_context_resolve "/ws"

    run orchestrator_state_get "context.policy"

    [ "$output" = "null" ]
}

@test "context_resolve sets guidance from agent/core/Guidance when available" {
    mkdir -p "$TEST_DIR/.cadet/agent/core/Guidance"
    touch "$TEST_DIR/.cadet/agent/core/Guidance/ArchitecturePatterns.md"
    touch "$TEST_DIR/.cadet/agent/core/Guidance/UnityPatterns.md"

    orchestrator_context_resolve "$TEST_DIR"

    run jq -r '.context.guidance | length' "$ORCHESTRATOR_STATE"
    [ "$output" -ge 1 ]
}

@test "context_resolve sets standards from agent/core/Standards when available" {
    mkdir -p "$TEST_DIR/.cadet/agent/core/Standards"
    touch "$TEST_DIR/.cadet/agent/core/Standards/Testing.md"
    touch "$TEST_DIR/.cadet/agent/core/Standards/SOLID.md"

    orchestrator_context_resolve "$TEST_DIR"

    run jq -r '.context.standards | length' "$ORCHESTRATOR_STATE"
    [ "$output" -ge 1 ]
}

@test "context_resolve emits rule_trace to stdout" {
    mkdir -p "$TEST_DIR/.cadet/agent/core/Guidance"
    touch "$TEST_DIR/.cadet/agent/core/Guidance/ArchitecturePatterns.md"

    run orchestrator_context_resolve "$TEST_DIR"

    [ "$status" -eq 0 ]
    [[ "$output" == *"[RuleTrace]"* ]]
    [[ "$output" == *"Tier=guided"* ]]
}
