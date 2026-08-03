#!/usr/bin/env bash
# Git Guard Hook — Cadet Agent
# PreToolUse hook that enforces the rule:
#   "Never run git commit, git push, or gh pr merge without explicit user approval."
#
# Returns permissionDecision "ask" via stdout JSON when a git write operation
# is detected. The VS Code Copilot runtime will prompt the user to approve.
# On any error or unrecognized input, fails open (exit 0, no output).
#
# Contract:
#   stdin:  {"toolName":"...", "toolInput":"..."}
#   stdout: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"..."}}
#   exit 0  (success — decision is in stdout, not exit code)

set -euo pipefail

# ---------------------------------------------------------------------------
# Read stdin payload
# ---------------------------------------------------------------------------
payload="$(cat)"

# ---------------------------------------------------------------------------
# Extract tool name — try jq first, grep fallback
# ---------------------------------------------------------------------------
tool_name=""
if command -v jq &>/dev/null; then
  tool_name=$(printf '%s' "$payload" | jq -r '.toolName // empty' 2>/dev/null || echo "")
fi
if [[ -z "$tool_name" ]]; then
  tool_name=$(printf '%s' "$payload" | grep -oE '"toolName"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"toolName"\s*:\s*"//;s/"//')
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
  tool_input=$(printf '%s' "$payload" | jq -r '.toolInput // .toolArgs // .command // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]')
fi
if [[ -z "$tool_input" ]]; then
  tool_input=$(printf '%s' "$payload" | grep -oE '"(toolInput|toolArgs|command)"\s*:\s*"[^"]*"' | head -1 | sed 's/.*:\s*"//;s/"//' | tr '[:upper:]' '[:lower:]')
fi

if [[ -z "$tool_input" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Check for git write operations
#
# Patterns:
#   git commit          — with any flags (-m, --amend, -a, etc.)
#   git push            — with any remote/branch/flags
#   gh pr merge         — with any flags (--squash, --merge, --rebase)
#
# Intentionally excluded (read-only):
#   git fetch, git pull, git status, git log, git diff, git branch
#   gh pr create, gh pr view, gh pr status, gh issue *
# ---------------------------------------------------------------------------
GIT_COMMIT_PATTERN='git[[:space:]]+commit'
GIT_PUSH_PATTERN='git[[:space:]]+push'
GH_PR_MERGE_PATTERN='gh[[:space:]]+pr[[:space:]]+merge'

detected=""
if printf '%s' "$tool_input" | grep -qE "$GIT_COMMIT_PATTERN"; then
  detected="git commit"
elif printf '%s' "$tool_input" | grep -qE "$GIT_PUSH_PATTERN"; then
  detected="git push"
elif printf '%s' "$tool_input" | grep -qE "$GH_PR_MERGE_PATTERN"; then
  detected="gh pr merge"
fi

if [[ -z "$detected" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Output: ask the user for approval
# ---------------------------------------------------------------------------
cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "$detected requires explicit user approval per Cadet policy. Review the proposed changes before approving."
  }
}
JSON

exit 0
