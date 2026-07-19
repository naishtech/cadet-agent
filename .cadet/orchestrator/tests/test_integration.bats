#!/usr/bin/env bats

# Integration tests — end-to-end orchestrator workflow

setup() {
    TEST_DIR="$(mktemp -d)"
    export ORCHESTRATOR_STATE_DIR="$TEST_DIR"
    ORCHESTRATOR_STATE="$TEST_DIR/state.json"

    # Source all libs
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    source "${BATS_TEST_DIRNAME}/../lib/context.sh"
    source "${BATS_TEST_DIRNAME}/../lib/classify.sh"
    source "${BATS_TEST_DIRNAME}/../lib/dispatch.sh"
    source "${BATS_TEST_DIRNAME}/../lib/track.sh"
    source "${BATS_TEST_DIRNAME}/../lib/validate.sh"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "full large-change workflow completes end-to-end" {
    # Phase 0: Context resolution
    mkdir -p "$TEST_DIR/.cadet/agent/core/Guidance"
    touch "$TEST_DIR/.cadet/agent/core/Guidance/ArchitecturePatterns.md"
    orchestrator_context_resolve "$TEST_DIR" > /dev/null
    [ "$(orchestrator_state_get 'phase')" = "context_resolution" ]

    # Phase 1: Classification
    orchestrator_classify "large" > /dev/null
    [ "$(orchestrator_state_get 'path')" = "large" ]

    # Phase 2: Skill dispatch sequence
    orchestrator_dispatch_sequence "requirements" "architecture" "tdd" > /dev/null
    [ "$(jq -r '.invocation_log | length' "$ORCHESTRATOR_STATE")" = "3" ]

    # Phase 3: Implementation tracking
    orchestrator_begin_epic "EPIC-1" 3
    orchestrator_complete_task "EPIC-1" "TASK-1"
    orchestrator_complete_task "EPIC-1" "TASK-2"
    orchestrator_complete_task "EPIC-1" "TASK-3"
    [ "$(orchestrator_requires_resync)" = "true" ]

    orchestrator_mark_epic_complete "EPIC-1"
    [ "$(orchestrator_state_get 'phase')" = "validation" ]

    # Phase 4: Validation
    run orchestrator_validate_gates "large"
    [ "$status" -eq 0 ]
    [ "$(orchestrator_state_get 'phase')" = "closed" ]
}

@test "full small-change workflow completes end-to-end" {
    orchestrator_context_resolve "/ws" > /dev/null
    orchestrator_classify "small" > /dev/null
    [ "$(orchestrator_state_get 'path')" = "small" ]

    orchestrator_dispatch "tdd" > /dev/null
    orchestrator_begin_epic "BUG-1" 1
    orchestrator_complete_task "BUG-1" "FIX-1"
    orchestrator_mark_epic_complete "BUG-1"

    run orchestrator_validate_gates "small"
    [ "$status" -eq 0 ]
    [ "$(orchestrator_state_get 'phase')" = "closed" ]
}

@test "full no-test workflow completes end-to-end" {
    orchestrator_context_resolve "/ws" > /dev/null
    orchestrator_classify "no_test_required" > /dev/null
    [ "$(orchestrator_state_get 'path')" = "no_test_required" ]

    run orchestrator_validate_gates "no_test_required"
    [ "$status" -eq 0 ]
    [ "$(orchestrator_state_get 'phase')" = "closed" ]
}
