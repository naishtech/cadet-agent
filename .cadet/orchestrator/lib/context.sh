#!/usr/bin/env bash
# context.sh — Phase 0: Context Resolution
# Resolves learner tier, operating mode, active policy, guidance, and standards.

orchestrator_context_resolve() {
    local workspace_root="${1:-$(pwd)}"
    orchestrator_state_init "$workspace_root"

    # Detect active policy
    local policy_dir="$workspace_root/.cadet/agent/policies"
    if [ -d "$policy_dir" ]; then
        local policy_files
        policy_files=$(find "$policy_dir" -maxdepth 1 -name "*.md" -not -name "*Template*" -not -name "*Example*" 2>/dev/null)
        local count
        count=$(echo "$policy_files" | grep -c "." 2>/dev/null || echo "0")
        if [ "$count" -eq 1 ] && [ -n "$policy_files" ]; then
            local rel_policy="${policy_files#$workspace_root/}"
            orchestrator_state_set "context.policy" "$rel_policy"
        fi
    fi

    # Detect guidance documents
    local guidance_dir="$workspace_root/.cadet/agent/core/Guidance"
    if [ -d "$guidance_dir" ]; then
        local guidance_list
        guidance_list=$(find "$guidance_dir" -maxdepth 1 -name "*.md" -exec basename {} .md \; 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0))')
        if [ -n "$guidance_list" ] && [ "$guidance_list" != "[]" ]; then
            orchestrator_state_set "context.guidance" "$guidance_list"
        fi
    fi

    # Detect standards
    local standards_dir="$workspace_root/.cadet/agent/core/Standards"
    if [ -d "$standards_dir" ]; then
        local standards_list
        standards_list=$(find "$standards_dir" -maxdepth 1 -name "*.md" -exec basename {} .md \; 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0))')
        if [ -n "$standards_list" ] && [ "$standards_list" != "[]" ]; then
            orchestrator_state_set "context.standards" "$standards_list"
        fi
    fi

    # Emit rule trace
    local tier mode policy guidance standards
    tier=$(orchestrator_state_get "context.tier")
    mode=$(orchestrator_state_get "context.mode")
    policy=$(orchestrator_state_get "context.policy")
    guidance=$(orchestrator_state_get "context.guidance" | jq -r 'join(", ")')
    standards=$(orchestrator_state_get "context.standards" | jq -r 'join(", ")')

    echo "[RuleTrace] Tier=${tier}, Mode=${mode}, Policy=${policy:-none}, Guidance=[${guidance:-}], Standards=[${standards:-}]"
}
