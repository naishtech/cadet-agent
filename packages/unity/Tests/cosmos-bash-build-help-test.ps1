$ErrorActionPreference = "Stop"

$cosmosBin = Join-Path $env:APPDATA "CADET\Tools\cosmos-4.0.2~\bin"
$bashPath = Join-Path $cosmosBin "bash"

if (-not (Test-Path -LiteralPath $bashPath)) {
    Write-Error "Cosmos bash not found at: $bashPath"
    exit 1
}

$buildShPath = Join-Path (Split-Path $PSScriptRoot -Parent) "Covyne\Cadet\CLI\build.sh"

if (-not (Test-Path -LiteralPath $buildShPath)) {
    Write-Error "build.sh not found at: $buildShPath"
    exit 1
}

$originalPath = $env:PATH

try {
    $env:PATH = "$cosmosBin;$originalPath"
    $env:COSMOS_BIN_DIR = $cosmosBin

    $process = Start-Process -FilePath $bashPath -ArgumentList $buildShPath, '--help' -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        Write-Host "ERROR: build.sh exited with code $($process.ExitCode)"
    }
}
finally {
    $env:PATH = $originalPath
    $env:COSMOS_BIN_DIR = $null
}
