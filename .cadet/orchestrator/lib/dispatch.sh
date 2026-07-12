#!/usr/bin/env bash
# dispatch.sh — Phase 2: Skill Dispatch
# Dispatches skills individually or in sequence.

# Known skill names
_VALID_SKILLS=("requirements" "architecture" "tdd" "debugging" "codereview" "orchestrator")

_is_known_skill() {
    local skill="$1"
    for s in "${_VALID_SKILLS[@]}"; do
        if [ "$s" = "$skill" ]; then
            return 0
        fi
    done
    return 1
}

orchestrator_dispatch() {
    local skill="$1"

    if ! _is_known_skill "$skill"; then
        echo "ERROR: unknown skill '${skill}'" >&2
        orchestrator_state_append "invocation_log" "{\"skill\":\"${skill}\",\"success\":false,\"summary\":\"unknown skill\"}"
        return 1
    fi

    echo "dispatched ${skill}"
    orchestrator_state_append "invocation_log" "{\"skill\":\"${skill}\",\"success\":true,\"summary\":\"dispatched ${skill}\"}"
    return 0
}

orchestrator_dispatch_sequence() {
    local failed=0
    for skill in "$@"; do
        if ! orchestrator_dispatch "$skill"; then
            failed=1
            break
        fi
    done
    return $failed
}
