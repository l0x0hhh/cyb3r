[CmdletBinding()]
param([int]$Port = 3100)
$ErrorActionPreference = 'Stop'
$previewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previewData = Join-Path $previewRoot 'data\local-preview'
$previewPidFile = Join-Path $previewData 'process.json'
$previewServer = Join-Path $previewRoot 'server.js'
$previewNode = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $previewRoot 'frontend\dist\index.html'))) {
  throw 'Build the frontend first: node node_modules/vite/bin/vite.js build'
}
if (Test-Path -LiteralPath $previewPidFile) {
  $previous = Get-Content -LiteralPath $previewPidFile -Raw | ConvertFrom-Json
  $previewProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.processId)" -ErrorAction SilentlyContinue
  if ($previewProcess -and $previewProcess.CommandLine.Contains($previewServer)) {
    Write-Output "Preview already running: http://127.0.0.1:$($previous.port)/materials"
    exit 0
  }
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already in use. Choose another port." }
New-Item -ItemType Directory -Path $previewData -Force | Out-Null
$previewKeys = @('NODE_ENV','HOST','PORT','APP_BASE_URL','DATA_DIR','UPLOAD_DIR','QR_DIR','MATERIALS_DEMO','MATERIALS_PORTAL')
$previewOldEnvironment = @{}
foreach ($previewKey in $previewKeys) { $previewOldEnvironment[$previewKey] = [Environment]::GetEnvironmentVariable($previewKey,'Process') }
try {
  $env:NODE_ENV = 'development'
  $env:HOST = '127.0.0.1'
  $env:PORT = [string]$Port
  $env:APP_BASE_URL = "http://127.0.0.1:$Port"
  $env:DATA_DIR = $previewData
  $env:UPLOAD_DIR = Join-Path $previewData 'uploads'
  $env:QR_DIR = Join-Path $previewData 'qrcodes'
  $env:MATERIALS_DEMO = 'true'
  $env:MATERIALS_PORTAL = 'true'
  $previewChild = Start-Process -FilePath $previewNode -ArgumentList @('"' + $previewServer + '"') -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $previewData 'server.log') -RedirectStandardError (Join-Path $previewData 'server-error.log') -PassThru
  @{processId=$previewChild.Id;port=$Port;startedAt=[DateTimeOffset]::Now.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $previewPidFile -Encoding utf8
} finally {
  foreach ($previewKey in $previewKeys) { [Environment]::SetEnvironmentVariable($previewKey,$previewOldEnvironment[$previewKey],'Process') }
}
for ($previewAttempt = 0; $previewAttempt -lt 30; $previewAttempt++) {
  Start-Sleep -Milliseconds 200
  try {
    $previewResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/v2/catalog" -TimeoutSec 2
    if ($previewResponse.StatusCode -eq 200) {
      Write-Output "User portal: http://127.0.0.1:$Port/materials"
      Write-Output "Unified admin: http://127.0.0.1:$Port/admin?tab=materials-inventory"
      Write-Output "Runtime data: $previewData"
      exit 0
    }
  } catch { if ($previewChild.HasExited) { throw "Preview exited. Check logs in $previewData" } }
}
throw "Preview did not become ready. Check logs in $previewData"
