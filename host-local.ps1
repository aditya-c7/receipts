#Requires -Version 5.1
<#
  Host Receipts locally (prod parity): builds the SPA, then serves dist/ +
  the Hono API from ONE origin via `wrangler dev` (see [assets] in
  wrangler.toml), waits for readiness, and opens the browser.
  Usage: double-click host-local.cmd, or: powershell -ExecutionPolicy Bypass -File .\host-local.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$env:USERPROFILE\.npm-global;$env:PATH"
Set-Location $root

Write-Host '[1/3] Building SPA...' -ForegroundColor Cyan
pnpm build | Select-Object -Last 2 | Out-Null
Write-Host '      build ok' -ForegroundColor Green

Write-Host '[2/3] Starting local host (wrangler dev :8787 serves dist + /api)...' -ForegroundColor Cyan
$api = Start-Job -ScriptBlock {
  Set-Location $using:root
  $env:PATH = "$env:USERPROFILE\.npm-global;$env:PATH"
  pnpm wrangler dev --port 8787 2>&1
}

$ready = $false
for ($i = 0; $i -lt 24 -and -not $ready; $i++) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 4
    if ($r.ok) { $ready = $true }
  } catch { }
}
if (-not $ready) {
  Write-Host 'API did not become ready. Recent log:' -ForegroundColor Red
  Receive-Job $api -Keep | Select-Object -Last 15
  throw 'local host failed to start'
}
Write-Host '[3/3] Ready -> http://127.0.0.1:8787' -ForegroundColor Green
Start-Process 'http://127.0.0.1:8787'
Write-Host 'Serving in background job. Stop with: Get-Job | Stop-Job; Get-Job | Remove-Job' -ForegroundColor Yellow
