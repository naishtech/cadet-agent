$env:PATH = "$env:APPDATA\CADET\Tools\cosmos-4.0.2~\bin;$env:PATH"
$env:COSMOS_BIN_DIR = "$env:APPDATA\CADET\Tools\cosmos-4.0.2~\bin"
Start-Process -FilePath "$env:COSMOS_BIN_DIR\bash" -ArgumentList "$PSScriptRoot\..\Covyne\Cadet\CLI\build.sh", "--help" -NoNewWindow -Wait
