# package-agent.ps1
# Packages the Cadet-Agent universal bootstrap package into a zip archive.
# Extract the zip at any Unity project root and files will land at:
#   .cadet\agent\core\
#   .github\agents\cadet.agent.md (Copilot agent mode)
#   .github\agents\cadet-agent-reviewer.agent.md (Copilot reviewer agent)
#   .github\prompts\cadet-*.prompt.md (Copilot slash-command skills)
#   .cursor\rules\cadet-agent.md
#   .cursor\rules\cadet-agent-reviewer.md (Cursor reviewer rule)
#   .continue\rules\cadet-agent.md
#   .continue\rules\cadet-agent-reviewer.md (Continue reviewer rule)
#   .continue\config.yaml (Continue custom slash commands)
#   .claude\skills\cadet-agent\SKILL.md (Claude Code base skill)
#   .claude\skills\cadet-agent-reviewer\SKILL.md (Claude Code reviewer)
#   .claude\skills\cadet-*\SKILL.md (Claude Code per-phase skills)
# The core folder contains cadet-agent.md (condensed agent instructions),
# FrameworkManifest.json, and the runtime templates under .cadet/agent/core/templates.
# Full rationale, guidance, standards, and templates are in the docs/ directory
# (GitHub Pages).

$ErrorActionPreference = "Stop"

$scriptDir    = $PSScriptRoot
$coreSource   = Join-Path $scriptDir ".cadet\agent\core"
$githubSource = Join-Path $scriptDir ".github"
$promptsSource  = Join-Path $githubSource "prompts"
$cursorSource = Join-Path $scriptDir ".cursor"
$continueSource = Join-Path $scriptDir ".continue"
$claudeSource  = Join-Path $scriptDir ".claude"
$outputZip    = Join-Path $scriptDir "cadet-agent.zip"
$preferredZip = $outputZip

function Resolve-OutputZipPath {
    param(
        [string]$PreferredPath
    )

    if (-not (Test-Path $PreferredPath)) {
        return $PreferredPath
    }

    try {
        Remove-Item $PreferredPath -Force
        return $PreferredPath
    }
    catch {
        $directory = Split-Path $PreferredPath -Parent
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($PreferredPath)
        $extension = [System.IO.Path]::GetExtension($PreferredPath)
        $fallbackPath = Join-Path $directory ("{0}-updated{1}" -f $baseName, $extension)

        if (Test-Path $fallbackPath) {
            Remove-Item $fallbackPath -Force -ErrorAction SilentlyContinue
        }

        Write-Warning "Primary output zip is locked or unavailable: $PreferredPath"
        Write-Warning "Writing updated package to fallback path: $fallbackPath"
        return $fallbackPath
    }
}

if (-not (Test-Path $coreSource)) {
    Write-Error "Core framework folder not found at: $coreSource"
    exit 1
}

foreach ($path in @($githubSource, $promptsSource, $cursorSource, $continueSource, $claudeSource)) {
    if (-not (Test-Path $path)) {
        Write-Error "Adapter source not found at: $path"
        exit 1
    }
}

# Validate that cadet-agent.md exists — it is the condensed agent instruction file
$condensedAgent = Join-Path $coreSource "cadet-agent.md"
if (-not (Test-Path $condensedAgent)) {
    Write-Error "cadet-agent.md not found at: $condensedAgent"
    exit 1
}

# Validate that every managed path listed in FrameworkManifest.json exists in
# the local source tree before staging begins. A missing file would otherwise
# produce a silently incomplete package.
$manifestPath = Join-Path $coreSource "FrameworkManifest.json"
if (-not (Test-Path $manifestPath)) {
    Write-Error "FrameworkManifest.json not found at: $manifestPath"
    exit 1
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$missingPaths = @()
foreach ($managedPath in $manifest.managedPaths) {
    $localPath = Join-Path $scriptDir ($managedPath -replace '/', '\')
    if (-not (Test-Path $localPath)) {
        $missingPaths += $managedPath
    }
}

if ($missingPaths.Count -gt 0) {
    Write-Error "Manifest validation failed. The following managed paths are missing from the local source tree:`n  $($missingPaths -join "`n  ")`nUpdate FrameworkManifest.json or restore the missing files before packaging."
    exit 1
}

function Copy-TreeIntoStaging {
    param(
        [string]$SourceRoot,
        [string]$StagingRoot,
        [string]$TargetRoot
    )

    $sourceFiles = Get-ChildItem -Path $SourceRoot -Recurse -File
    foreach ($file in $sourceFiles) {
        $relative = $file.FullName.Substring($SourceRoot.Length).TrimStart('\','/')
        $destPath = if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
            Join-Path $StagingRoot $relative
        }
        else {
            Join-Path $StagingRoot (Join-Path $TargetRoot $relative)
        }
        $destDir = Split-Path $destPath -Parent
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -Path $file.FullName -Destination $destPath
    }
}

# Remove existing zip so Compress-Archive doesn't append, or fall back if the
# preferred output is locked by another process.
$outputZip = Resolve-OutputZipPath -PreferredPath $outputZip

# Build a temp staging directory that mirrors the desired extraction layout
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "cadet-agent-staging"

if (Test-Path $staging) {
    Remove-Item $staging -Recurse -Force
}

Copy-TreeIntoStaging -SourceRoot $coreSource -StagingRoot $staging -TargetRoot ".cadet\agent\core"

# Only copy managed .github files — exclude CI workflows from the consumer package
Copy-TreeIntoStaging -SourceRoot (Join-Path $githubSource "agents")   -StagingRoot $staging -TargetRoot ".github\agents"
Copy-TreeIntoStaging -SourceRoot (Join-Path $githubSource "hooks")    -StagingRoot $staging -TargetRoot ".github\hooks"
Copy-TreeIntoStaging -SourceRoot $promptsSource                        -StagingRoot $staging -TargetRoot ".github\prompts"

Copy-TreeIntoStaging -SourceRoot $cursorSource -StagingRoot $staging -TargetRoot ".cursor"
Copy-TreeIntoStaging -SourceRoot $continueSource -StagingRoot $staging -TargetRoot ".continue"

# Stage only the managed .claude paths (from FrameworkManifest.json) so
# orphaned files cannot leak into the package.
foreach ($managedPath in $manifest.managedPaths) {
    if ($managedPath -notlike '.claude/*') { continue }
    $src = Join-Path $scriptDir ($managedPath -replace '/', '\')
    $rel = $managedPath.Substring('.claude/'.Length) -replace '/', '\'
    $dest = Join-Path $staging (Join-Path '.claude' $rel)
    $destParent = Split-Path $dest -Parent
    if (-not (Test-Path $destParent)) {
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
    }
    if ((Get-Item $src).PSIsContainer) {
        Copy-Item -Path $src -Destination $destParent -Recurse -Force
    }
    else {
        Copy-Item -Path $src -Destination $dest -Force
    }
}

$fileCount = (Get-ChildItem -Path $staging -Recurse -File).Count

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $outputZip

Remove-Item $staging -Recurse -Force
$zipSize   = [math]::Round((Get-Item $outputZip).Length / 1KB, 1)

Write-Host ""
Write-Host "Packaged $fileCount files -> $(Split-Path $outputZip -Leaf) ($zipSize KB)"
Write-Host ""
Write-Host "To install in another project:"
Write-Host "  1. Copy $(Split-Path $outputZip -Leaf) to the target project root"
Write-Host "  2. Expand-Archive .\$(Split-Path $outputZip -Leaf) -DestinationPath . -Force"
Write-Host "  Files will extract to:"
Write-Host "    .cadet\agent\core\"
Write-Host "    .github\agents\cadet.agent.md"
Write-Host "    .github\agents\cadet-agent-reviewer.agent.md"
Write-Host "    .github\hooks\git-guard.json"
Write-Host "    .github\hooks\scripts\git-guard.sh"
Write-Host "    .github\hooks\scripts\git-guard.ps1"
Write-Host "    .github\prompts\cadet-*.prompt.md"
Write-Host "    .cursor\rules\cadet-agent.md"
Write-Host "    .cursor\rules\cadet-agent-reviewer.md"
Write-Host "    .continue\rules\cadet-agent.md"
Write-Host "    .continue\rules\cadet-agent-reviewer.md"
Write-Host "    .continue\config.yaml"
Write-Host "    .claude\skills\cadet-agent\SKILL.md"
Write-Host "    .claude\skills\cadet-agent-reviewer\SKILL.md"
Write-Host "    .claude\skills\cadet-*\SKILL.md"
if ($outputZip -ne $preferredZip) {
    Write-Host ""
    Write-Host "Note: The primary output zip was in use, so a fallback filename was used for this package."
}
Write-Host ""
