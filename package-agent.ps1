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
#   .agents\skills\cadet-agent\SKILL.md (Deep Code / Hermes cross-client base skill)
#   .agents\skills\cadet-agent-reviewer\SKILL.md (Deep Code / Hermes reviewer)
#   .agents\skills\cadet-*\SKILL.md (Deep Code / Hermes per-phase skills)
#   AGENTS.md (create-only: never overwrites an existing consumer AGENTS.md)
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

# Stage the repository Git hook. It lives outside .cadet/ and outside the host
# directories, so no other block here would carry it, and a create-only rule does not
# apply: sync refreshes it so a consumer gets hook fixes.
foreach ($managedPath in $manifest.managedPaths) {
    if ($managedPath -notlike '.githooks/*') { continue }
    $src = Join-Path $scriptDir ($managedPath -replace '/', '\')
    $rel = $managedPath.Substring('.githooks/'.Length) -replace '/', '\'
    $dest = Join-Path $staging (Join-Path '.githooks' $rel)
    $destParent = Split-Path $dest -Parent
    if (-not (Test-Path $destParent)) {
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
    }
    Copy-Item -Path $src -Destination $dest -Force
}

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

# Stage only the managed .agents paths (Deep Code / cross-client skills root)
foreach ($managedPath in $manifest.managedPaths) {
    if ($managedPath -notlike '.agents/*') { continue }
    $src = Join-Path $scriptDir ($managedPath -replace '/', '\')
    $rel = $managedPath.Substring('.agents/'.Length) -replace '/', '\'
    $dest = Join-Path $staging (Join-Path '.agents' $rel)
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

# Stage managed root-level files (e.g. AGENTS.md). These are create-only at
# install time, but they must be present in the package so a fresh install
# creates them (an existing consumer copy is never overwritten).
foreach ($managedPath in $manifest.managedPaths) {
    if ($managedPath -match '/') { continue }   # only top-level files
    $src = Join-Path $scriptDir $managedPath
    if (-not (Test-Path $src)) {
        Write-Error "Managed root file not found: $src"
        exit 1
    }
    Copy-Item -Path $src -Destination (Join-Path $staging $managedPath) -Force
}

# Stage managed paths that live in a SUBDIRECTORY and are create-only at install
# time (`.cadet/harness.json`). The top-level loop above skips anything with a
# slash, and a create-only file that never reaches the package would never be
# created for a new consumer — the failure mode this makes impossible.
foreach ($managedPath in $manifest.managedPaths) {
    if ($managedPath -notmatch '/') { continue }
    if ($manifest.createOnlyPaths -notcontains $managedPath) { continue }
    $src = Join-Path $scriptDir ($managedPath -replace '/', '\')
    if (-not (Test-Path $src)) {
        Write-Error "Create-only path not found: $src"
        exit 1
    }
    $dest = Join-Path $staging ($managedPath -replace '/', '\')
    $destParent = Split-Path $dest -Parent
    if (-not (Test-Path $destParent)) {
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
    }
    Copy-Item -Path $src -Destination $dest -Force
}

# ---------------------------------------------------------------- engine products
# The CLI, the Unity tooling and the Unreal plugin ship at `packages/...` inside
# the zip. components.json maps each one to the path it is installed at
# (`Assets/Covyne/Cadet/`, `Plugins/CadetBuild/`), so the zip layout and the
# install layout stay independent.
foreach ($rel in @("packages\cli", "packages\unity", "packages\unreal")) {
    $src = Join-Path $scriptDir $rel
    if (-not (Test-Path $src)) {
        Write-Error "Package source not found: $src"
        exit 1
    }
    Copy-TreeIntoStaging -SourceRoot $src -StagingRoot $staging -TargetRoot ($rel -replace '\\', '/')
}

$suiteVersion = (Get-Content (Join-Path $scriptDir "package.json") -Raw | ConvertFrom-Json).version

# Each engine package carries the licence and the changelog section for this
# version. Both are written here, at package time, and neither is kept in git:
# there is one root MIT LICENSE and one authoritative CHANGELOG.md (plan 01 §5
# and §6). A copy in the tree would be a second thing to update and a second
# thing to drift.
$rootLicense = Join-Path $scriptDir "LICENSE"
if (-not (Test-Path $rootLicense)) {
    Write-Error "LICENSE not found at: $rootLicense"
    exit 1
}

# The section of the root changelog that belongs to this version: from its
# "## [x.y.z]" heading to the next "## [" line.
$releaseNotes = $null
$changelogLines = (Get-Content (Join-Path $scriptDir "CHANGELOG.md") -Raw) -split "`n"
$sectionStart = -1
for ($i = 0; $i -lt $changelogLines.Count; $i++) {
    if ($changelogLines[$i] -match "^## \[$([regex]::Escape($suiteVersion))\]") { $sectionStart = $i; break }
}
if ($sectionStart -ge 0) {
    $sectionEnd = $changelogLines.Count
    for ($j = $sectionStart + 1; $j -lt $changelogLines.Count; $j++) {
        if ($changelogLines[$j] -match '^## \[') { $sectionEnd = $j; break }
    }
    $releaseNotes = (($changelogLines[$sectionStart..($sectionEnd - 1)]) -join "`n").TrimEnd()
}

foreach ($package in @("unity", "unreal")) {
    $packageStaging = Join-Path $staging (Join-Path "packages" $package)
    if (-not (Test-Path $packageStaging)) { continue }
    Copy-Item -Path $rootLicense -Destination (Join-Path $packageStaging "LICENSE.md") -Force
    if ($releaseNotes) {
        $packageChangelog = @(
            "# Changelog"
            ""
            "This package ships at the suite version. The section below is the root"
            "CHANGELOG.md entry for v$suiteVersion; earlier history is in the repository's"
            "root changelog."
            ""
            $releaseNotes
            ""
        ) -join "`n"
        [System.IO.File]::WriteAllText(
            (Join-Path $packageStaging "CHANGELOG.md"),
            $packageChangelog,
            (New-Object System.Text.UTF8Encoding($false)))
    }
    else {
        Write-Warning "CHANGELOG.md has no section for $suiteVersion; packages/$package ships without one."
    }
}

# Stage components.json with the suite version stamped in. Written without a BOM
# because the installer parses it with JSON.parse.
$componentsSource = Join-Path $scriptDir "components.json"
if (-not (Test-Path $componentsSource)) {
    Write-Error "components.json not found at: $componentsSource"
    exit 1
}
$packageJson = Get-Content (Join-Path $scriptDir "package.json") -Raw | ConvertFrom-Json
$components = Get-Content $componentsSource -Raw | ConvertFrom-Json
$components | Add-Member -NotePropertyName suiteVersion -NotePropertyValue $packageJson.version -Force
$componentsTarget = Join-Path $staging "components.json"
$componentsText = $components | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($componentsTarget, $componentsText, (New-Object System.Text.UTF8Encoding($false)))

# Every zip path the manifest names must exist in the package. A component that
# points at nothing is a packaging error, not a consumer surprise.
foreach ($component in $components.components) {
    foreach ($zipPath in @($component.zipPaths)) {
        $probe = Join-Path $staging (($zipPath.TrimEnd('/')) -replace '/', '\')
        if (-not (Test-Path $probe)) {
            Write-Error "components.json names a path the package does not contain: $zipPath (component $($component.id))"
            exit 1
        }
    }
}

$fileCount = (Get-ChildItem -Path $staging -Recurse -File).Count

# Every shell script must be LF inside the package. Bash cannot run a CRLF copy, and
# install.mjs refuses to finish an install that carries one. The working tree can hold
# CRLF on Windows (core.autocrlf), so the package normalises here instead of trusting
# the checkout. The index marks *.sh eol=lf; this makes the artifact match it.
$shellScripts = Get-ChildItem -Path $staging -Recurse -File -Filter *.sh
foreach ($script in $shellScripts) {
    $bytes = [System.IO.File]::ReadAllBytes($script.FullName)
    if ([Array]::IndexOf($bytes, [byte]13) -lt 0) { continue }
    $text = [System.IO.File]::ReadAllText($script.FullName) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($script.FullName, $text, (New-Object System.Text.UTF8Encoding($false)))
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $outputZip

# ------------------------------------------------ the hand-drop Unreal artifact
# `cadet-agent.zip` is the only install source; the installer reads it by that
# exact name, which is why it is not renamed per version. This second zip exists
# for a team that wants to put Plugins/CadetBuild in by hand: the plugin at the
# zip root, with the CLI in `CLI/` beside it, which is the layout the plugin
# already resolves and the installer's own layout for that project (D6).
$unrealZip = Join-Path $scriptDir ("cadet-unreal-{0}.zip" -f $suiteVersion)
$unrealStage = Join-Path ([System.IO.Path]::GetTempPath()) ("cadet-unreal-" + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $unrealStage -Force | Out-Null
    Copy-Item -Path (Join-Path $staging "packages\unreal\*") -Destination $unrealStage -Recurse -Force
    Copy-Item -Path (Join-Path $staging "packages\cli") -Destination (Join-Path $unrealStage "CLI") -Recurse -Force
    if (-not (Test-Path (Join-Path $unrealStage "CadetBuild.uplugin"))) {
        Write-Error "The Unreal artifact would carry no CadetBuild.uplugin; the plugin must sit at the zip root."
        exit 1
    }
    if (Test-Path $unrealZip) { Remove-Item $unrealZip -Force }
    Compress-Archive -Path (Join-Path $unrealStage "*") -DestinationPath $unrealZip
}
finally {
    Remove-Item $unrealStage -Recurse -Force -ErrorAction SilentlyContinue
}

Remove-Item $staging -Recurse -Force
$zipSize   = [math]::Round((Get-Item $outputZip).Length / 1KB, 1)

Write-Host ""
Write-Host "Packaged $fileCount files -> $(Split-Path $outputZip -Leaf) ($zipSize KB)"
Write-Host "Also wrote $(Split-Path $unrealZip -Leaf) ($([math]::Round((Get-Item $unrealZip).Length / 1KB, 1)) KB) — the plugin at the zip root, for a hand drop into Plugins/CadetBuild."
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
Write-Host "    .agents\skills\cadet-agent\SKILL.md (Deep Code / Hermes cross-client skills root)"
Write-Host "    .agents\skills\cadet-agent-reviewer\SKILL.md"
Write-Host "    .agents\skills\cadet-*\SKILL.md"
Write-Host "    AGENTS.md (only if not already present)"
Write-Host "    .cadet\harness.json (only if not already present)"
if ($outputZip -ne $preferredZip) {
    Write-Host ""
    Write-Host "Note: The primary output zip was in use, so a fallback filename was used for this package."
}
Write-Host ""
