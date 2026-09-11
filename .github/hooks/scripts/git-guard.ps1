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
# or CADET_GIT_GUARD_MODE=fail-open. It is visible (a diagnostic is emitted to stderr).
#
# Canonical decision logic lives in src/harness/hook.mjs; this script mirrors it.
#
# Contract:
#   stdin:  {"toolName":"...", "toolInput":"..."}
#   stdout: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask|deny","permissionDecisionReason":"..."}}
#   exit 0  (success — decision is in stdout, not exit code)

param()

$ErrorActionPreference = "Stop"

function Get-GuardMode {
    $mode = "ask-on-recognized-write"
    if ($env:CADET_GIT_GUARD_MODE -eq "fail-open") { return "fail-open" }
    $policyPath = Join-Path (Get-Location) ".cadet/harness.json"
    if (Test-Path $policyPath) {
        try {
            $policy = Get-Content -Raw -Path $policyPath | ConvertFrom-Json
            if ($policy.hook -and $policy.hook.mode -eq "fail-open") { $mode = "fail-open" }
        } catch { }
    }
    return $mode
}

function Write-GitGuardDecision($permissionDecision, $reason) {
    $output = @{
        hookSpecificOutput = @{
            hookEventName            = "PreToolUse"
            permissionDecision       = $permissionDecision
            permissionDecisionReason = $reason
        }
    } | ConvertTo-Json -Compress
    Write-Output $output
}

function Exit-FailClosed($diagnostic) {
    Write-Error "git-guard: $diagnostic" -ErrorAction Continue
    if ((Get-GuardMode) -eq "fail-open") {
        Write-Error "git-guard: fail-open compatibility mode active — allowing the call" -ErrorAction Continue
        exit 0
    }
    Write-GitGuardDecision "deny" "git-guard blocked the tool call: $diagnostic"
    exit 0
}

$rawStdin = $input | Out-String
if ([string]::IsNullOrWhiteSpace($rawStdin)) {
    exit 0
}

try {
    $payload = $rawStdin | ConvertFrom-Json
}
catch {
    Exit-FailClosed "malformed JSON payload"
}

# ---------------------------------------------------------------------------
# Extract tool name
# ---------------------------------------------------------------------------
$toolName = ""
if ($payload.toolName) { $toolName = $payload.toolName }
elseif ($payload.tool_name) { $toolName = $payload.tool_name }
elseif ($payload.tool) { $toolName = $payload.tool }

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
) | Where-Object { $_ -ne $null -and "$_" -ne "" } | Select-Object -First 1

if (-not $toolInput) {
    Exit-FailClosed "unrecognized input for tool '$toolName'"
}

if ($toolInput -isnot [string]) {
    $toolInput = $toolInput | ConvertTo-Json -Compress
}

# Normalize for obfuscation tolerance.
$normalized = $toolInput.ToLowerInvariant()
$normalized = $normalized -replace '["`'']', ''
$normalized = $normalized -replace '\\([a-z])', '$1'
$normalized = $normalized -replace '\$\{[^}]*\}', ' '
$normalized = $normalized -replace '\$\([^)]*\)', ' '
$normalized = $normalized -replace '\s+', ' '

# ---------------------------------------------------------------------------
# Check for git write operations
# ---------------------------------------------------------------------------
$detected = $null
if ($normalized -match '(^|[^a-z])git[^;&|]*[^a-z]commit([^a-z]|$)') {
    $detected = "git commit"
}
elseif ($normalized -match '(^|[^a-z])git[^;&|]*[^a-z]push([^a-z]|$)') {
    $detected = "git push"
}
elseif ($normalized -match '(^|[^a-z])gh[^;&|]*[^a-z]pr[^;&|]*[^a-z]merge([^a-z]|$)') {
    $detected = "gh pr merge"
}

if (-not $detected) {
    exit 0
}

Write-GitGuardDecision "ask" "$detected requires explicit user approval per Cadet policy. Review the proposed changes before approving."
exit 0
