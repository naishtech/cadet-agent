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

param()

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Read stdin payload
# ---------------------------------------------------------------------------
$rawStdin = $input | Out-String
if ([string]::IsNullOrWhiteSpace($rawStdin)) {
    exit 0
}

try {
    $payload = $rawStdin | ConvertFrom-Json
}
catch {
    # Fail open — malformed input should never block legitimate work
    exit 0
}

# ---------------------------------------------------------------------------
# Extract tool name
# ---------------------------------------------------------------------------
$toolName = if ($payload.toolName) { $payload.toolName } else { "" }

# We only care about terminal/shell tool invocations
$relevantTools = @("run_in_terminal", "execute", "bash", "shell")
if ($relevantTools -notcontains $toolName) {
    exit 0
}

# ---------------------------------------------------------------------------
# Extract tool input / command text
# ---------------------------------------------------------------------------
$toolInput = @(
    $payload.toolInput,
    $payload.toolArgs,
    $payload.command
) | Where-Object { $_ -is [string] -and $_ } | Select-Object -First 1

if (-not $toolInput) {
    exit 0
}

$toolInputLower = $toolInput.ToLowerInvariant()

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
$detected = $null
if ($toolInputLower -match 'git\s+commit') {
    $detected = "git commit"
}
elseif ($toolInputLower -match 'git\s+push') {
    $detected = "git push"
}
elseif ($toolInputLower -match 'gh\s+pr\s+merge') {
    $detected = "gh pr merge"
}

if (-not $detected) {
    exit 0
}

# ---------------------------------------------------------------------------
# Output: ask the user for approval
# ---------------------------------------------------------------------------
$output = @{
    hookSpecificOutput = @{
        hookEventName                = "PreToolUse"
        permissionDecision           = "ask"
        permissionDecisionReason     = "$detected requires explicit user approval per Cadet policy. Review the proposed changes before approving."
    }
} | ConvertTo-Json -Compress

Write-Output $output
exit 0
