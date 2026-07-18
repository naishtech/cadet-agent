# publish-npm.ps1
# Publishes cadet-agent to npm using a token stored in ~/.npm_token.
# The .npm_token file should contain ONLY the npm granular access token
# (created at https://www.npmjs.com/settings/<user>/tokens with
#  "Publish" permission and "Bypass 2FA" enabled).

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$tokenPath = Join-Path $HOME ".npm_token"

# ── Validate token file ──────────────────────────────────────────────────

if (-not (Test-Path $tokenPath)) {
  Write-Error @"
No token file found at: $tokenPath

Create it with your npm granular access token:
  1. Go to https://www.npmjs.com/settings/<your-username>/tokens
  2. Generate a Granular Access Token with "Publish" permission
  3. Enable "Bypass 2FA" on the token
  4. Save the token to ~/.npm_token (just the token, no newlines)
"@
  exit 1
}

$token = (Get-Content $tokenPath -Raw).Trim()

if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Error "Token file is empty: $tokenPath"
  exit 1
}

# ── Ensure bin scripts use LF (Windows git may convert to CRLF) ─────────

Push-Location $scriptDir

try {
  $binFiles = @("bin/cli.mjs", "src/cli.mjs", "src/install.mjs")
  foreach ($file in $binFiles) {
    if (Test-Path $file) {
      $content = (Get-Content $file -Raw) -replace "`r`n", "`n"
      [System.IO.File]::WriteAllText((Join-Path $scriptDir $file), $content, [System.Text.UTF8Encoding]::new($false))
    }
  }
  Write-Host "✓ Ensured LF line endings for .mjs files" -ForegroundColor Green
}
catch {
  Write-Error "Failed to normalize line endings: $_"
  exit 1
}

# ── Publish ──────────────────────────────────────────────────────────────

Write-Host "📦 Publishing cadet-agent to npm..." -ForegroundColor Cyan

try {
  # Authenticate
  npm config set "//registry.npmjs.org/:_authToken=$token" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to set auth token" }

  $user = npm whoami 2>&1
  Write-Host "   Authenticated as $user" -ForegroundColor Gray

  # Publish
  npm publish 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm publish failed (exit $LASTEXITCODE)" }

  Write-Host "`n✅ cadet-agent published successfully!" -ForegroundColor Green
}
catch {
  Write-Error "Publish failed: $_"
  exit 1
}

Pop-Location
