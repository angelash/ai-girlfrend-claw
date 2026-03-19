param(
  [string]$GatewayBaseUrl = "http://127.0.0.1:18789",
  [string]$AdapterBaseUrl = "http://127.0.0.1:43113",
  [string]$Token = "ai-gf-main-token"
)

$ErrorActionPreference = "Stop"

Write-Host "== [1/3] Build lobster-adapter ==" -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot "..\vendor\lobster-adapter")
try {
  npm ci
  npm run build
} finally {
  Pop-Location
}

Write-Host "== [2/3] Restart OpenClaw gateway ==" -ForegroundColor Cyan
openclaw gateway restart

Write-Host "== [3/3] Run self-check ==" -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "windows-selfcheck.ps1") `
  -GatewayBaseUrl $GatewayBaseUrl `
  -AdapterBaseUrl $AdapterBaseUrl `
  -Token $Token

Write-Host "Bootstrap finished." -ForegroundColor Green
