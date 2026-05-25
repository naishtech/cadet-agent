# package-agent.ps1
# Packages the Cadet-Agent bootstrap snapshot into a zip archive.
# Extract the zip at any Unity project root and files will land at:
#   .github\prompts\unity\Agent\
#   .github\prompts\cadet.prompt.md
# The packaged Agent folder includes FrameworkManifest.json, which points to the
# canonical source-of-truth repo for later Cadet framework sync.

$ErrorActionPreference = "Stop"

$scriptDir   = $PSScriptRoot
$agentSource = Join-Path $scriptDir ".github\prompts\unity\Agent"
$outputZip   = Join-Path $scriptDir "cadet-agent.zip"
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

if (-not (Test-Path $agentSource)) {
    Write-Error "Agent folder not found at: $agentSource"
    exit 1
}

# Remove existing zip so Compress-Archive doesn't append, or fall back if the
# preferred output is locked by another process.
$outputZip = Resolve-OutputZipPath -PreferredPath $outputZip

# Collect all files under the Agent folder, preserving relative paths
$agentFiles  = Get-ChildItem -Path $agentSource -Recurse -File
$promptFile  = Join-Path $scriptDir ".github\prompts\cadet.prompt.md"

if (-not (Test-Path $promptFile)) {
    Write-Error "cadet.prompt.md not found at: $promptFile"
    exit 1
}

# Build a temp staging directory that mirrors the desired extraction layout
$staging    = Join-Path ([System.IO.Path]::GetTempPath()) "cadet-agent-staging"
$targetBase = Join-Path $staging ".github\prompts\unity\Agent"

if (Test-Path $staging) {
    Remove-Item $staging -Recurse -Force
}

foreach ($file in $agentFiles) {
    $relative = $file.FullName.Substring($agentSource.Length).TrimStart('\','/')
    $destPath = Join-Path $targetBase $relative
    $destDir  = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -Path $file.FullName -Destination $destPath
}

# Stage cadet.prompt.md at .github\prompts\cadet.prompt.md
$promptDest = Join-Path $staging ".github\prompts"
if (-not (Test-Path $promptDest)) {
    New-Item -ItemType Directory -Path $promptDest -Force | Out-Null
}
Copy-Item -Path $promptFile -Destination (Join-Path $promptDest "cadet.prompt.md")

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $outputZip

Remove-Item $staging -Recurse -Force

$fileCount = $agentFiles.Count + 1   # +1 for cadet.prompt.md
$zipSize   = [math]::Round((Get-Item $outputZip).Length / 1KB, 1)

Write-Host ""
Write-Host "Packaged $fileCount files -> $(Split-Path $outputZip -Leaf) ($zipSize KB)"
Write-Host ""
Write-Host "To install in another project:"
Write-Host "  1. Copy $(Split-Path $outputZip -Leaf) to the target project root"
Write-Host "  2. Expand-Archive .\$(Split-Path $outputZip -Leaf) -DestinationPath . -Force"
Write-Host "  Files will extract to:"
Write-Host "    .github\prompts\unity\Agent\"
Write-Host "    .github\prompts\cadet.prompt.md"
if ($outputZip -ne $preferredZip) {
    Write-Host ""
    Write-Host "Note: The primary output zip was in use, so a fallback filename was used for this package."
}
Write-Host ""
