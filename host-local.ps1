#Requires -Version 5.1
<#
  Host Receipts locally (prod parity): builds the SPA, then serves dist/ +
  the Hono API from ONE origin via `wrangler dev` (see [assets] in
  wrangler.toml), waits for readiness, and opens the browser.
  The server runs in its OWN window ("Receipts server") so closing THIS
  window does not kill it. Stop it by closing the server window (Ctrl+C).
  Usage: double-click host-local.cmd, or: powershell -ExecutionPolicy Bypass -File .\host-local.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$env:USERPROFILE\.npm-global;$env:PATH"
Set-Location $root

Write-Host '[1/3] Building SPA...' -ForegroundColor Cyan
pnpm build | Select-Object -Last 2 | Out-Null
Write-Host '      build ok' -ForegroundColor Green

Write-Host '[2/3] Starting local host (own window, wrangler dev 127.0.0.1:8787)...' -ForegroundColor Cyan
$serverCmd = "cd '$root'; `$env:PATH=`"$env:USERPROFILE\.npm-global;`$env:PATH`"; pnpm wrangler dev --port 8787 --ip 127.0.0.1"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $serverCmd | Out-Null

$ready = $false
for ($i = 0; $i -lt 24 -and -not $ready; $i++) {
  Start-Sleep -Seconds 5
  try {
    # Bypass any system proxy for loopback (a proxy in the chain is the most
    # common cause of ERR_CONNECTION_REFUSED on 127.0.0.1).
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 4 -NoProxy
    if ($r.ok) { $ready = $true }
  } catch { }
}
if (-not $ready) {
  Write-Host 'Server did not become ready. Check the "Receipts server" window for errors' -ForegroundColor Red
  Write-Host '(common: port 8787 already in use by an earlier run — close that window first).' -ForegroundColor Red
  throw 'local host failed to start'
}
Write-Host '[3/3] Ready -> http://127.0.0.1:8787' -ForegroundColor Green
Write-Host 'Keep the "Receipts server" window OPEN while you use the app.' -ForegroundColor Yellow
Write-Host 'If the browser says "refused to connect": the server window was closed,' -ForegroundColor Yellow
Write-Host 'or your browser sends 127.0.0.1 through a proxy — bypass proxy for 127.0.0.1.' -ForegroundColor Yellow
Start-Process 'http://127.0.0.1:8787'
