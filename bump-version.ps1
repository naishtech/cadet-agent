# bump-version.ps1
# Bumps the Cadet-Agent version, updates every file that carries the version
# string, commits with the repo's conventional message, creates the vX.Y.Z tag,
# and pushes both the branch and the tag.
#
# Pushing the tag is what publishes: .github/workflows/release.yml runs on
# 'v*.*.*' tags, builds cadet-agent.zip via package-agent.ps1, and creates the
# GitHub release. Nothing is published if the tag is not pushed.
#
# Usage:
#   ./bump-version.ps1                 # prompts for the bump kind
#   ./bump-version.ps1 -Bump minor     # patch | minor | major
#   ./bump-version.ps1 -Version 0.24.0 # explicit target version
#   ./bump-version.ps1 -Bump patch -NoPush
#   ./bump-version.ps1 -Bump minor -DryRun
#
# Version bump policy (see CHANGELOG.md):
#   patch  wording/doc-only corrections that do not change agent behavior
#   minor  new skill/standard/template/guidance or a structural reorg (no break)
#   major  breaking change to managed paths or a routing change

[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Bump,

  [string]$Version,

  [switch]$NoPush,

  [switch]$DryRun,

  [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot

# Files that carry the version string and are updated on every bump.
$packageJson = Join-Path $scriptDir "package.json"
$manifestJson = Join-Path $scriptDir ".cadet\agent\core\FrameworkManifest.json"
$adaptersMd = Join-Path $scriptDir "ADAPTERS.md"
$changelogMd = Join-Path $scriptDir "CHANGELOG.md"

# ── Helpers ─────────────────────────────────────────────────────────────────

function Write-Step([string]$Message) {
  Write-Host "`n$Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "  ✓ $Message" -ForegroundColor Green
}

function Write-Info([string]$Message) {
  Write-Host "  $Message" -ForegroundColor Gray
}

function Fail([string]$Message) {
  Write-Host "`n❌ $Message" -ForegroundColor Red
  exit 1
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    Fail "git $($Args -join ' ') failed (exit $LASTEXITCODE)"
  }
}

function Get-JsonVersion([string]$Path) {
  $json = Get-Content $Path -Raw | ConvertFrom-Json
  return $json.version
}

# Split "X.Y.Z" (ignoring any pre-release/build suffix) into its numeric parts.
function Parse-Semver([string]$Value) {
  $clean = $Value.Trim()
  if ($clean.StartsWith('v')) { $clean = $clean.Substring(1) }
  $match = [regex]::Match($clean, '^(\d+)\.(\d+)\.(\d+)')
  if (-not $match.Success) { return $null }
  return [pscustomobject]@{
    Major = [int]$match.Groups[1].Value
    Minor = [int]$match.Groups[2].Value
    Patch = [int]$match.Groups[3].Value
  }
}

function Compare-Semver($A, $B) {
  if ($A.Major -ne $B.Major) { return $A.Major - $B.Major }
  if ($A.Minor -ne $B.Minor) { return $A.Minor - $B.Minor }
  return $A.Patch - $B.Patch
}

# Write a file as UTF-8 without a BOM and with LF line endings, matching the
# .mjs/.json/.md files in this repo (git normalizes on commit anyway).
function Set-TextFile([string]$Path, [string]$Text) {
  $normalized = $Text -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($Path, $normalized, [System.Text.UTF8Encoding]::new($false))
}

# ── Preflight ───────────────────────────────────────────────────────────────

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git was not found on PATH."
}

Push-Location $scriptDir
try {
  # Must be inside a work tree.
  $null = & git rev-parse --is-inside-work-tree 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Not inside a git working tree: $scriptDir" }

  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    Fail "Could not determine the current branch."
  }

  foreach ($path in @($packageJson, $manifestJson, $adaptersMd, $changelogMd)) {
    if (-not (Test-Path $path)) { Fail "Expected file not found: $path" }
  }

  # Require a clean working tree so the release commit is exactly the version
  # change and nothing unrelated slips into a tag. Untracked files are allowed:
  # `git add` targets the version files explicitly, so they cannot be swept in.
  $dirtyLines = @(& git status --porcelain | Where-Object { $_ -notmatch '^\?\?' })
  if ($dirtyLines.Count -gt 0 -and -not $Force) {
    Write-Host "`n⚠️  Working tree has uncommitted changes:" -ForegroundColor Yellow
    $dirtyLines | ForEach-Object { Write-Host "  $_" }
    Fail "Commit or stash your changes first, or pass -Force to bump anyway."
  }

  $currentRaw = Get-JsonVersion $packageJson
  $current = Parse-Semver $currentRaw
  if (-not $current) { Fail "package.json has an unrecognized version: '$currentRaw'" }

  # ── Determine the target version ──────────────────────────────────────────

  Write-Step "Current version: $currentRaw"

  $target = $null
  if ($Version) {
    $target = Parse-Semver $Version
    if (-not $target) { Fail "-Version '$Version' is not a valid X.Y.Z version." }
    $targetRaw = "{0}.{1}.{2}" -f $target.Major, $target.Minor, $target.Patch
  }
  else {
    $kind = $Bump
    if (-not $kind) {
      Write-Host ""
      Write-Host "  Select the version bump kind:"
      Write-Host "    1) patch  - doc/wording fixes, no behavior change"
      Write-Host "    2) minor  - new skill/template/guidance, no breaking change"
      Write-Host "    3) major  - breaking change to managed paths or routing"
      Write-Host ""
      $choice = Read-Host "  Enter 1, 2, or 3 (default: 2 minor)"
      switch ($choice) {
        "1" { $kind = "patch" }
        "3" { $kind = "major" }
        { $_ -in @("", "2") } { $kind = "minor" }
        default { Fail "Unrecognized selection: '$choice'" }
      }
    }

    switch ($kind) {
      "patch" { $target = [pscustomobject]@{ Major = $current.Major; Minor = $current.Minor; Patch = $current.Patch + 1 } }
      "minor" { $target = [pscustomobject]@{ Major = $current.Major; Minor = $current.Minor + 1; Patch = 0 } }
      "major" { $target = [pscustomobject]@{ Major = $current.Major + 1; Minor = 0; Patch = 0 } }
    }
    $targetRaw = "{0}.{1}.{2}" -f $target.Major, $target.Minor, $target.Patch
  }

  if ((Compare-Semver $target $current) -le 0 -and -not $Force) {
    Fail "Target version $targetRaw is not greater than the current $currentRaw (use -Force to override)."
  }

  $tagName = "v$targetRaw"
  $commitMessage = "chore: bump version to $targetRaw"
  $today = (Get-Date).ToString("yyyy-MM-dd")

  # Refuse to reuse an existing tag.
  $existingTag = (& git tag -l $tagName)
  if (-not [string]::IsNullOrWhiteSpace($existingTag) -and -not $Force) {
    Fail "Tag $tagName already exists. Choose a different version."
  }

  Write-Host ""
  Write-Info "Branch:  $branch"
  Write-Info "Bump:    $currentRaw -> $targetRaw"
  Write-Info "Commit:  $commitMessage"
  Write-Info "Tag:     $tagName"
  Write-Info "Push:    $(if ($NoPush) { 'no (--NoPush)' } else { "yes ($branch + tag)" })"

  if ($DryRun) {
    Write-Host "`n🧪 Dry run — no files changed, nothing committed or pushed." -ForegroundColor Yellow
    exit 0
  }

  # ── Update version-bearing files ──────────────────────────────────────────

  Write-Step "Updating version files"

  # package.json — only the top-level "version" line.
  $pkgText = Get-Content $packageJson -Raw
  $pkgText = [regex]::Replace($pkgText, '("version"\s*:\s*")[^"]*(")', "`${1}$targetRaw`${2}", 1)
  Set-TextFile $packageJson $pkgText
  Write-Ok "package.json -> $targetRaw"

  # FrameworkManifest.json — frameworkVersion.
  $manifestText = Get-Content $manifestJson -Raw
  $manifestText = [regex]::Replace($manifestText, '("frameworkVersion"\s*:\s*")[^"]*(")', "`${1}$targetRaw`${2}", 1)
  Set-TextFile $manifestJson $manifestText
  Write-Ok ".cadet/agent/core/FrameworkManifest.json -> $targetRaw"

  # ADAPTERS.md — "Framework version: X.Y.Z", and refresh the Updated date.
  $adaptersText = Get-Content $adaptersMd -Raw
  $adaptersText = [regex]::Replace($adaptersText, '(Framework version:\s*)\d+\.\d+\.\d+', "`${1}$targetRaw", 1)
  $adaptersText = [regex]::Replace($adaptersText, '(Updated:\s*)\d{4}-\d{2}-\d{2}', "`${1}$today", 1)
  Set-TextFile $adaptersMd $adaptersText
  Write-Ok "ADAPTERS.md -> $targetRaw (Updated: $today)"

  # CHANGELOG.md — promote [Unreleased] to the new version, then open a fresh
  # [Unreleased] section (Keep a Changelog). If there is no [Unreleased] block,
  # insert a new versioned section after the policy separator.
  $changelogText = Get-Content $changelogMd -Raw
  if ($changelogText -match '(?m)^## \[Unreleased\]\s*$') {
    $replacement = "## [Unreleased]`n`n## [$targetRaw] — $today`n"
    $changelogText = [regex]::Replace(
      $changelogText,
      '(?m)^## \[Unreleased\]\s*$',
      $replacement,
      1
    )
    Write-Ok "CHANGELOG.md -> promoted [Unreleased] to [$targetRaw] — $today"
  }
  else {
    # Insert a new versioned section right after the first '---' separator that
    # follows the header block, skipping any blank lines that trail it.
    $newLines = @("", "## [$targetRaw] — $today", "", "### Added", "", "- ", "")
    $inserted = $false
    $lines = $changelogText -split "`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i].Trim() -eq '---') {
        $j = $i + 1
        while ($j -lt $lines.Count -and $lines[$j].Trim() -eq '') { $j++ }
        $before = $lines[0..$i]
        $after = @()
        if ($j -lt $lines.Count) { $after = $lines[$j..($lines.Count - 1)] }
        $lines = @($before) + @($newLines) + @($after)
        $inserted = $true
        break
      }
    }
    if (-not $inserted) { Fail "Could not find a place to insert the new CHANGELOG section." }
    $changelogText = ($lines -join "`n")
    Write-Ok "CHANGELOG.md -> new section [$targetRaw] — $today (no [Unreleased] block found)"
  }
  Set-TextFile $changelogMd $changelogText

  # Verify the writes landed before we commit anything.
  $checkVersion = Get-JsonVersion $packageJson
  if ($checkVersion -ne $targetRaw) {
    Fail "package.json still reports $checkVersion after the bump; aborting before commit."
  }

  # ── Commit ────────────────────────────────────────────────────────────────

  Write-Step "Committing"
  Invoke-Git add -- $packageJson $manifestJson $adaptersMd $changelogMd
  Invoke-Git commit -m $commitMessage
  Write-Ok $commitMessage

  # ── Tag ───────────────────────────────────────────────────────────────────

  Write-Step "Tagging"
  if (-not [string]::IsNullOrWhiteSpace($existingTag) -and $Force) {
    Invoke-Git tag -f $tagName
    Write-Ok "$tagName (forced)"
  }
  else {
    Invoke-Git tag $tagName
    Write-Ok $tagName
  }

  # ── Push ──────────────────────────────────────────────────────────────────

  if ($NoPush) {
    Write-Host "`n✅ Bumped to $targetRaw, committed, and tagged $tagName (not pushed)." -ForegroundColor Green
    Write-Host "   Publish when ready:  git push origin $branch; git push origin $tagName" -ForegroundColor Gray
    exit 0
  }

  Write-Step "Pushing"
  Invoke-Git push origin $branch
  Write-Ok "pushed $branch"
  Invoke-Git push origin $tagName
  Write-Ok "pushed $tagName"

  Write-Host "`n✅ Released $targetRaw." -ForegroundColor Green
  Write-Host "   The Release workflow builds cadet-agent.zip and creates the GitHub release" -ForegroundColor Gray
  Write-Host "   from tag $tagName." -ForegroundColor Gray
}
finally {
  Pop-Location
}
