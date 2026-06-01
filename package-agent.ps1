# package-agent.ps1
# Packages the Cadet-Agent universal bootstrap package into a zip archive.
# Extract the zip at any Unity project root and files will land at:
#   agent\core\
#   AGENTS.md
#   .github\copilot-instructions.md
#   .github\prompts\cadet.prompt.md
#   .cursor\rules\cadet-agent.mdc
#   .continue\rules\cadet-agent.md
# The packaged core folder includes FrameworkManifest.json, which points to the
# canonical source-of-truth repo for later Cadet framework sync.

$ErrorActionPreference = "Stop"

$scriptDir    = $PSScriptRoot
$coreSource   = Join-Path $scriptDir "agent\core"
$sharedSource = Join-Path $scriptDir "AGENTS.md"
$githubSource = Join-Path $scriptDir ".github"
$cursorSource = Join-Path $scriptDir ".cursor"
$continueSource = Join-Path $scriptDir ".continue"
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

foreach ($path in @($sharedSource, $githubSource, $cursorSource, $continueSource)) {
    if (-not (Test-Path $path)) {
        Write-Error "Adapter source not found at: $path"
        exit 1
    }
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

function Copy-FileIntoStaging {
    param(
        [string]$SourceFile,
        [string]$StagingRoot,
        [string]$TargetPath
    )

    $destPath = Join-Path $StagingRoot $TargetPath
    $destDir = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -Path $SourceFile -Destination $destPath
}

# Remove existing zip so Compress-Archive doesn't append, or fall back if the
# preferred output is locked by another process.
$outputZip = Resolve-OutputZipPath -PreferredPath $outputZip

# Build a temp staging directory that mirrors the desired extraction layout
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "cadet-agent-staging"

if (Test-Path $staging) {
    Remove-Item $staging -Recurse -Force
}

Copy-TreeIntoStaging -SourceRoot $coreSource -StagingRoot $staging -TargetRoot "agent\core"
Copy-FileIntoStaging -SourceFile $sharedSource -StagingRoot $staging -TargetPath "AGENTS.md"
Copy-TreeIntoStaging -SourceRoot $githubSource -StagingRoot $staging -TargetRoot ".github"
Copy-TreeIntoStaging -SourceRoot $cursorSource -StagingRoot $staging -TargetRoot ".cursor"
Copy-TreeIntoStaging -SourceRoot $continueSource -StagingRoot $staging -TargetRoot ".continue"

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $outputZip

Remove-Item $staging -Recurse -Force

$fileCount = (Get-ChildItem -Path $coreSource -Recurse -File).Count +
    (Get-ChildItem -Path $githubSource -Recurse -File).Count +
    (Get-ChildItem -Path $cursorSource -Recurse -File).Count +
    (Get-ChildItem -Path $continueSource -Recurse -File).Count + 1
$zipSize   = [math]::Round((Get-Item $outputZip).Length / 1KB, 1)

Write-Host ""
Write-Host "Packaged $fileCount files -> $(Split-Path $outputZip -Leaf) ($zipSize KB)"
Write-Host ""
Write-Host "To install in another project:"
Write-Host "  1. Copy $(Split-Path $outputZip -Leaf) to the target project root"
Write-Host "  2. Expand-Archive .\$(Split-Path $outputZip -Leaf) -DestinationPath . -Force"
Write-Host "  Files will extract to:"
Write-Host "    agent\core\"
Write-Host "    AGENTS.md"
Write-Host "    .github\copilot-instructions.md"
Write-Host "    .github\prompts\cadet.prompt.md"
Write-Host "    .cursor\rules\cadet-agent.mdc"
Write-Host "    .continue\rules\cadet-agent.md"
if ($outputZip -ne $preferredZip) {
    Write-Host ""
    Write-Host "Note: The primary output zip was in use, so a fallback filename was used for this package."
}
Write-Host ""
