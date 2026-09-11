#!/usr/bin/env bash
# Git Guard Hook — Cadet Agent
# PreToolUse hook that enforces the rule:
#   "Never run git commit, git push, or gh pr merge without explicit user approval."
#
# Default behavior (ask-on-recognized-write):
#   - recognized git write -> permissionDecision "ask"
#   - malformed JSON or unrecognized tool input for a shell tool -> permissionDecision "deny"
#     with a structured hook-error diagnostic
#   - non-relevant tool or no payload -> exit 0 (no decision)
#
# Compatibility mode "fail-open" is opt-in via .cadet/harness.json -> { "hook": { "mode": "fail-open" } }
# or CADET_GIT_GUARD_MODE=fail-open. It is visible (a diagnostic is emitted) and logged to stderr.
#
# Canonical decision logic lives in src/harness/hook.mjs; this script mirrors it.
#
# Contract:
#   stdin:  {"toolName":"...", "toolInput":"..."}
#   stdout: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask|deny","permissionDecisionReason":"..."}}
#   exit 0  (success — decision is in stdout, not exit code)

set -uo pipefail

MODE="ask-on-recognized-write"
# Read the repository-level hook mode if a policy file exists (best-effort, no jq required).
if [[ -f ".cadet/harness.json" ]] && command -v jq &>/dev/null; then
  policy_mode=$(jq -r '.hook.mode // empty' .cadet/harness.json 2>/dev/null || echo "")
  if [[ "$policy_mode" == "fail-open" ]]; then MODE="fail-open"; fi
fi
if [[ "${CADET_GIT_GUARD_MODE:-}" == "fail-open" ]]; then MODE="fail-open"; fi

emit_deny() {
  local reason="$1"
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "PreToolUse",\n    "permissionDecision": "deny",\n    "permissionDecisionReason": "%s"\n  }\n}\n' "$reason"
}

emit_ask() {
  local reason="$1"
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "PreToolUse",\n    "permissionDecision": "ask",\n    "permissionDecisionReason": "%s"\n  }\n}\n' "$reason"
}

fail_closed() {
  # $1 = diagnostic message
  echo "git-guard: $1" >&2
  if [[ "$MODE" == "fail-open" ]]; then
    echo "git-guard: fail-open compatibility mode active — allowing the call" >&2
    exit 0
  fi
  emit_deny "git-guard blocked the tool call: $1"
  exit 0
}

# ---------------------------------------------------------------------------
# Read stdin payload
# ---------------------------------------------------------------------------
payload="$(cat)"
if [[ -z "${payload//[[:space:]]/}" ]]; then
  # No payload — nothing to guard.
  exit 0
fi

# ---------------------------------------------------------------------------
# Extract tool name — jq first, grep fallback
# ---------------------------------------------------------------------------
tool_name=""
if command -v jq &>/dev/null; then
  tool_name=$(printf '%s' "$payload" | jq -r '.toolName // .tool_name // .tool // empty' 2>/dev/null)
  jq_status=$?
  if [[ $jq_status -ne 0 ]]; then
    fail_closed "malformed JSON payload"
  fi
else
  tool_name=$(printf '%s' "$payload" | grep -oE '"(toolName|tool_name|tool)"\s*:\s*"[^"]*"' | head -1 | sed 's/.*:\s*"//;s/"$//')
  # If we cannot find a tool name AND the payload does not look like JSON, it is malformed.
  if [[ -z "$tool_name" && ! "$payload" =~ ^[[:space:]]*\{ ]]; then
    fail_closed "malformed JSON payload"
  fi
fi

# ---------------------------------------------------------------------------
# We only care about terminal/shell tool invocations
# ---------------------------------------------------------------------------
case "$tool_name" in
  run_in_terminal|execute|bash|shell) ;;
  *) exit 0 ;;
esac

# ---------------------------------------------------------------------------
# Extract tool input / command text
# ---------------------------------------------------------------------------
tool_input=""
if command -v jq &>/dev/null; then
  tool_input=$(printf '%s' "$payload" | jq -r 'if (.toolInput // .toolArgs // .command) | type == "string" then (.toolInput // .toolArgs // .command) else ((.toolInput // .toolArgs // .command) | tostring) end' 2>/dev/null)
fi
if [[ -z "$tool_input" ]]; then
  tool_input=$(printf '%s' "$payload" | grep -oE '"(toolInput|toolArgs|command)"\s*:\s*"[^"]*"' | head -1 | sed 's/.*:\s*"//;s/"$//')
fi

if [[ -z "$tool_input" ]]; then
  fail_closed "unrecognized input for tool '$tool_name'"
fi

# Normalize for obfuscation tolerance (quotes, backslashes, ${...}, $(...), whitespace).
normalized=$(printf '%s' "$tool_input" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -d '"'"'"'`' \
  | sed -E 's/\\([a-z])/\1/g; s/\$\{[^}]*\}/ /g; s/\$\([^)]*\)/ /g' \
  | tr -s '[:space:]' ' ')

# ---------------------------------------------------------------------------
# Check for git write operations
# ---------------------------------------------------------------------------
detected=""
if printf '%s' "$normalized" | grep -qE '(^|[^a-z])git[^;&|]*[^a-z]commit([^a-z]|$)'; then
  detected="git commit"
elif printf '%s' "$normalized" | grep -qE '(^|[^a-z])git[^;&|]*[^a-z]push([^a-z]|$)'; then
  detected="git push"
elif printf '%s' "$normalized" | grep -qE '(^|[^a-z])gh[^;&|]*[^a-z]pr[^;&|]*[^a-z]merge([^a-z]|$)'; then
  detected="gh pr merge"
fi

if [[ -z "$detected" ]]; then
  exit 0
fi

emit_ask "$detected requires explicit user approval per Cadet policy. Review the proposed changes before approving."
exit 0
