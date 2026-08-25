[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string[]]$ChangedPath
)

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')) -replace '\\', '/'

$normalized = @($ChangedPath | ForEach-Object {
  $path = $_.Trim() -replace '\\', '/'
  if (-not $path) { return }

  if ([IO.Path]::IsPathRooted($path)) {
    if ($path.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $path = $path.Substring($projectRoot.Length).TrimStart('/')
    } else {
      $path = "__external__/$path"
    }
  } else {
    $path = $path -replace '^\./+', ''
  }

  $path
} | Where-Object { $_ } | Sort-Object -Unique)

$excludedPatterns = @(
  '^data(?:/|$)',
  '^uploads(?:/|$)',
  '^public/qrcodes(?:/|$)',
  '^frontend/dist(?:/|$)',
  '^node_modules(?:/|$)',
  '^__external__/',
  '(^|/)\.\.(?:/|$)',
  '(^|/)\.env(?:\.|$)',
  '(^|/)[^/]+\.(?:pem|key|p12|pfx)$'
)

$excluded = @($normalized | Where-Object {
  $path = $_
  $excludedPatterns | Where-Object { $path -match $_ } | Select-Object -First 1
})
$safe = @($normalized | Where-Object { $_ -notin $excluded })

$frontendChanged = [bool]($safe | Where-Object {
  $_ -match '^frontend/(src/|index\.html$)' -or
  $_ -eq 'vite.config.js' -or
  ($_ -match '^public/' -and $_ -notmatch '^public/qrcodes/')
})
$serverChanged = $safe -contains 'server.js'
$packageChanged = [bool]($safe | Where-Object { $_ -in @('package.json', 'package-lock.json') })
$deployConfigChanged = [bool]($safe | Where-Object {
  $_ -match '^deploy/' -or $_ -eq 'DEPLOY.md'
})
$runtimeChanged = $frontendChanged -or $serverChanged -or $packageChanged

[pscustomobject]@{
  safePaths = $safe
  excludedPaths = $excluded
  frontendChanged = $frontendChanged
  serverChanged = $serverChanged
  packageChanged = $packageChanged
  dependencyAuditRequired = $serverChanged
  npmCiRequired = $packageChanged
  buildRequired = ($frontendChanged -or $packageChanged)
  restartRequired = ($serverChanged -or $packageChanged)
  systemConfigReviewRequired = $deployConfigChanged
  runtimeDeploymentRequired = $runtimeChanged
} | ConvertTo-Json -Depth 4
