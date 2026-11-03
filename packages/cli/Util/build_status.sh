#!/bin/bash

CADET_STATUS_FILE=""
CADET_STATUS_JOB_GUID=""
CADET_STATUS_LAUNCH_TOKEN=""
CADET_STATUS_PROFILE_NAME=""

cadet_status_is_enabled() {
    [ -n "$CADET_STATUS_FILE" ] && [ -n "$CADET_STATUS_JOB_GUID" ] && [ -n "$CADET_STATUS_LAUNCH_TOKEN" ]
}

cadet_status_timestamp() {
    if command -v date.ape >/dev/null 2>&1; then
        date.ape -u +"%Y-%m-%dT%H:%M:%S.0000000Z"
    else
        date -u +"%Y-%m-%dT%H:%M:%S.0000000Z"
    fi
}

cadet_status_mkdir_p() {
    if command -v mkdir.ape >/dev/null 2>&1; then
        mkdir.ape -p "$1"
    else
        mkdir -p "$1"
    fi
}

cadet_status_mv() {
    if command -v mv.ape >/dev/null 2>&1; then
        mv.ape -f "$1" "$2"
    else
        mv -f "$1" "$2"
    fi
}

cadet_status_atomic_write() {
    local temp_file="$1"
    local target_file="$2"
    cadet_status_mv "$temp_file" "$target_file"
}

cadet_status_write_from_filter() {
    local filter="$1"
    shift

    if ! cadet_status_is_enabled; then
        return 0
    fi

    local status_dir
    status_dir="$(dirname "$CADET_STATUS_FILE")"
    cadet_status_mkdir_p "$status_dir" || return 1

    local temp_file="$CADET_STATUS_FILE.tmp"
    "$JQ_CMD" "$filter" "$@" "$CADET_STATUS_FILE" > "$temp_file" || return 1
    cadet_status_atomic_write "$temp_file" "$CADET_STATUS_FILE"
}

cadet_status_refresh_summary_filter='def labels($value): [.operations[] | select(.status == $value) | .label];
def segment($title; $items): if ($items | length) == 0 then empty else "\($title): \($items | join(", "))" end;
.summary = [
    segment("Running"; labels("running")),
    segment("Skipped"; labels("skipped")),
    segment("Completed"; labels("completed"))
] |
.currentOperation = ([.operations[] | select(.status == "running") | .id] | first // null)'

cadet_status_init() {
    local status_file="$1"
    local job_guid="$2"
    local launch_token="$3"
    local profile_name="$4"

    if [ -z "$status_file" ] || [ -z "$job_guid" ] || [ -z "$launch_token" ]; then
        CADET_STATUS_FILE=""
        CADET_STATUS_JOB_GUID=""
        CADET_STATUS_LAUNCH_TOKEN=""
        CADET_STATUS_PROFILE_NAME=""
        return 0
    fi

    CADET_STATUS_FILE="$status_file"
    CADET_STATUS_JOB_GUID="$job_guid"
    CADET_STATUS_LAUNCH_TOKEN="$launch_token"
    CADET_STATUS_PROFILE_NAME="$profile_name"

    local status_dir
    status_dir="$(dirname "$CADET_STATUS_FILE")"
    cadet_status_mkdir_p "$status_dir" || return 1

    local now
    now="$(cadet_status_timestamp)"
    local temp_file="$CADET_STATUS_FILE.tmp"

    "$JQ_CMD" -n \
        --arg jobGuid "$CADET_STATUS_JOB_GUID" \
        --arg launchToken "$CADET_STATUS_LAUNCH_TOKEN" \
        --arg profileName "$CADET_STATUS_PROFILE_NAME" \
        --arg now "$now" \
        '{
            schemaVersion: 1,
            jobGuid: $jobGuid,
            launchToken: $launchToken,
            profileName: $profileName,
            startedAtUtc: $now,
            updatedAtUtc: $now,
            terminalAtUtc: null,
            overallStatus: "running",
            currentOperation: null,
            currentMessage: "",
            exitCode: 0,
            operations: [
                { id: "git_sync", label: "Git Sync", status: "pending", startedAtUtc: null, completedAtUtc: null, message: "" },
                { id: "unity_build", label: "Unity Build", status: "pending", startedAtUtc: null, completedAtUtc: null, message: "" },
                { id: "mac_sign_notarize", label: "macOS Sign + Notarize", status: "pending", startedAtUtc: null, completedAtUtc: null, message: "" },
                { id: "steam_publish", label: "Publish Steam", status: "pending", startedAtUtc: null, completedAtUtc: null, message: "" },
                { id: "epic_publish", label: "Publish Epic", status: "pending", startedAtUtc: null, completedAtUtc: null, message: "" }
            ],
            summary: []
        }' > "$temp_file" || return 1

    cadet_status_atomic_write "$temp_file" "$CADET_STATUS_FILE"
}

cadet_status_mark_operation() {
    local operation_id="$1"
    local new_status="$2"
    local message="$3"

    if ! cadet_status_is_enabled; then
        return 0
    fi

    local now
    now="$(cadet_status_timestamp)"

    cadet_status_write_from_filter '
        def labels($value): [.operations[] | select(.status == $value) | .label];
        def segment($title; $items): if ($items | length) == 0 then empty else "\($title): \($items | join(", "))" end;
        .updatedAtUtc = $now |
        .currentMessage = $message |
        .operations = (.operations | map(
            if .id == $operationId then
                .status = $status |
                .message = $message |
                .startedAtUtc = (if $status == "running" and (.startedAtUtc == null or .startedAtUtc == "") then $now else .startedAtUtc end) |
                .completedAtUtc = (if ($status == "completed" or $status == "failed" or $status == "cancelled" or $status == "skipped") then $now else .completedAtUtc end)
            else . end)) |
        .summary = [
            segment("Running"; labels("running")),
            segment("Skipped"; labels("skipped")),
            segment("Completed"; labels("completed"))
        ] |
        .currentOperation = ([.operations[] | select(.status == "running") | .id] | first // null)
    ' \
        --arg operationId "$operation_id" \
        --arg status "$new_status" \
        --arg message "$message" \
        --arg now "$now"
}

cadet_status_mark_running() {
    cadet_status_mark_operation "$1" "running" "$2"
}

cadet_status_mark_completed() {
    cadet_status_mark_operation "$1" "completed" "$2"
}

cadet_status_mark_failed() {
    cadet_status_mark_operation "$1" "failed" "$2"
}

cadet_status_mark_cancelled() {
    cadet_status_mark_operation "$1" "cancelled" "$2"
}

cadet_status_mark_skipped() {
    cadet_status_mark_operation "$1" "skipped" "$2"
}

cadet_status_finalize() {
    local overall_status="$1"
    local message="$2"
    local exit_code="$3"

    if ! cadet_status_is_enabled; then
        return 0
    fi

    local now
    now="$(cadet_status_timestamp)"

    cadet_status_write_from_filter '
        .overallStatus = $overallStatus |
        .currentMessage = $message |
        .updatedAtUtc = $now |
        .terminalAtUtc = $now |
        .exitCode = ($exitCode | tonumber) |
        .currentOperation = ([.operations[] | select(.status == "running") | .id] | first // null)
    ' \
        --arg overallStatus "$overall_status" \
        --arg message "$message" \
        --arg now "$now" \
        --arg exitCode "$exit_code"
}