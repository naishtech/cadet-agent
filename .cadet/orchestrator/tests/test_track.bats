#!/usr/bin/env bats

# Tests for track.sh — Phase 3: implementation tracking

setup() {
    TEST_DIR="$(mktemp -d)"
    export ORCHESTRATOR_STATE_DIR="$TEST_DIR"
    ORCHESTRATOR_STATE="$TEST_DIR/state.json"
    source "${BATS_TEST_DIRNAME}/../lib/state.sh"
    source "${BATS_TEST_DIRNAME}/../lib/track.sh"
    orchestrator_state_init "/ws"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "begin_epic sets active epic and phase to implementation" {
    run orchestrator_begin_epic "EPIC-1" 10

    [ "$status" -eq 0 ]
    [ "$(orchestrator_state_get 'active_epic')" = "EPIC-1" ]
    [ "$(orchestrator_state_get 'phase')" = "implementation" ]
}

@test "begin_epic stores expected task count" {
    orchestrator_begin_epic "EPIC-1" 7

    run jq -r '.epic_task_count' "$ORCHESTRATOR_STATE"
    [ "$output" = "7" ]
}

@test "complete_task updates active task" {
    orchestrator_begin_epic "EPIC-1" 3

    run orchestrator_complete_task "EPIC-1" "TASK-1"

    [ "$status" -eq 0 ]
    [ "$(orchestrator_state_get 'active_task')" = "TASK-1" ]
}

@test "complete_task increments completion counter" {
    orchestrator_begin_epic "EPIC-1" 5
    orchestrator_complete_task "EPIC-1" "TASK-1"

    run jq -r '.task_completion_count' "$ORCHESTRATOR_STATE"
    [ "$output" = "1" ]

    orchestrator_complete_task "EPIC-1" "TASK-2"

    run jq -r '.task_completion_count' "$ORCHESTRATOR_STATE"
    [ "$output" = "2" ]
}

@test "mark_epic_complete moves phase to validation and clears active" {
    orchestrator_begin_epic "EPIC-1" 2
    orchestrator_complete_task "EPIC-1" "TASK-1"
    orchestrator_complete_task "EPIC-1" "TASK-2"

    run orchestrator_mark_epic_complete "EPIC-1"

    [ "$status" -eq 0 ]
    [ "$(orchestrator_state_get 'phase')" = "validation" ]
    [ "$(orchestrator_state_get 'active_epic')" = "null" ]
}

@test "requires_resync returns true after task completion" {
    orchestrator_begin_epic "EPIC-1" 3
    orchestrator_complete_task "EPIC-1" "TASK-1"

    run orchestrator_requires_resync

    [ "$status" -eq 0 ]
    [ "$output" = "true" ]
}

@test "requires_resync returns false when no tasks completed" {
    orchestrator_begin_epic "EPIC-1" 3

    run orchestrator_requires_resync

    [ "$status" -eq 0 ]
    [ "$output" = "false" ]
}
