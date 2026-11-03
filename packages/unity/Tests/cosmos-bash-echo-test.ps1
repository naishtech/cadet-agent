$ErrorActionPreference = "Stop"

$cosmosBin = Join-Path $env:APPDATA "CADET\Tools\cosmos-4.0.2~\bin"
$bashPath = Join-Path $cosmosBin "bash"

if (-not (Test-Path -LiteralPath $bashPath)) {
    Write-Error "Cosmos bash not found at: $bashPath"
    exit 1
}

$originalPath = $env:PATH

try {
    # Prepend Cosmos bin so any sibling binaries can resolve.
    $env:PATH = "$cosmosBin;$originalPath"

    $logPath = Join-Path $env:TEMP "cadet-cosmos-bash-window-test.log"
    
    # Write bash script to temp file
    $bashScriptPath = Join-Path $env:TEMP "cadet-cosmos-bash-test.sh"
    @'
#!/bin/bash
echo CADET_COSMOS_BASH_TEST
echo CADET_Cosmos_Bash_Test_From_PowerShell
echo "Hello from cosmos bash!"
'@ | Set-Content -LiteralPath $bashScriptPath -Encoding UTF8

    $runnerPath = Join-Path $env:TEMP "cadet-cosmos-window-runner.ps1"
    $escapedLogPathForPs = $logPath.Replace("'", "''")
    $escapedBashPath = $bashPath.Replace("'", "''")
    $escapedScriptPath = $bashScriptPath.Replace("'", "''")
    $runnerContent = @"
`$logPath = '$escapedLogPathForPs'
`$bashPath = '$escapedBashPath'
`$bashScriptPath = '$escapedScriptPath'

`$started = Get-Date -Format o
"[`$started] START cosmos bash window test" | Out-File -FilePath `$logPath -Encoding utf8 -Append
"bashPath=`$bashPath" | Out-File -FilePath `$logPath -Encoding utf8 -Append
"bashScriptPath=`$bashScriptPath" | Out-File -FilePath `$logPath -Encoding utf8 -Append

Write-Host "========================================="
Write-Host "Running CADET Cosmos Bash Test"
Write-Host "========================================="

try {
    `$outputFile = Join-Path `$env:TEMP "cadet-bash-output.txt"
    `$process = Start-Process -FilePath `$bashPath -ArgumentList `$bashScriptPath -RedirectStandardOutput `$outputFile -PassThru -Wait
    `$lastCode = `$process.ExitCode
    
    # Display output to user and also save to log
    Write-Host ""
    Write-Host "--- Cosmos Bash Output ---"
    if (Test-Path -LiteralPath `$outputFile) {
        `$output = Get-Content -LiteralPath `$outputFile
        `$output  # Display to console
        
        # Also log to file
        "--- EXECUTION RESULT ---" | Out-File -FilePath `$logPath -Encoding utf8 -Append
        "EXIT CODE: `$lastCode" | Out-File -FilePath `$logPath -Encoding utf8 -Append
        "--- OUTPUT ---" | Out-File -FilePath `$logPath -Encoding utf8 -Append
        `$output | Out-File -FilePath `$logPath -Encoding utf8 -Append
        
        Remove-Item -LiteralPath `$outputFile -ErrorAction SilentlyContinue
    }
    Write-Host ""
    Write-Host "========================================="
    Write-Host "Exit code: `$lastCode"
    Write-Host "Log saved to: `$logPath"
    Write-Host "========================================="
}
catch {
    Write-Host "ERROR: `$(`_.Exception.Message)"
    "--- EXCEPTION ---" | Out-File -FilePath `$logPath -Encoding utf8 -Append
    `$_.Exception.Message | Out-File -FilePath `$logPath -Encoding utf8 -Append
}

`$ended = Get-Date -Format o
"[`$ended] END cosmos bash window test" | Out-File -FilePath `$logPath -Encoding utf8 -Append

Write-Host ""
Write-Host "Type 'exit' and press Enter to close this window, or close manually."
"@
    Set-Content -LiteralPath $runnerPath -Value $runnerContent -Encoding UTF8

    # Launch with -NoExit to keep PowerShell window open after script completes
    $process = Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", $runnerPath

    Write-Host "Log file: $logPath"
    Write-Host "Test launched in background window. Check log file for output."
}
finally {
    $env:PATH = $originalPath
}
