[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$previewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previewServer = Join-Path $previewRoot 'server.js'
$previewPidFile = Join-Path $previewRoot 'data\local-preview\process.json'
if (-not (Test-Path -LiteralPath $previewPidFile)) { Write-Output 'No recorded local preview.'; exit 0 }
$previous = Get-Content -LiteralPath $previewPidFile -Raw | ConvertFrom-Json
$previewProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.processId)" -ErrorAction SilentlyContinue
if ($previewProcess) {
  if (-not $previewProcess.CommandLine.Contains($previewServer)) { throw 'Recorded PID belongs to another process; refusing to stop it.' }
  Stop-Process -Id $previous.processId
}
Remove-Item -LiteralPath $previewPidFile
Write-Output 'Local preview stopped. Data and uploaded photos have been preserved.'
