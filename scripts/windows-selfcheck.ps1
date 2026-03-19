param(
  [string]$GatewayBaseUrl = "http://127.0.0.1:18789",
  [string]$AdapterBaseUrl = "http://127.0.0.1:43113",
  [string]$Token = "ai-gf-main-token",
  [int]$TimeoutSec = 10
)

$ErrorActionPreference = "Stop"
$failed = $false

function Step($msg) { Write-Host "`n== $msg ==" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:failed = $true }

Step "1) Plugin health"
try {
  $healthUrl = "$GatewayBaseUrl/api/ai-gf/health"
  $r = Invoke-RestMethod -Uri $healthUrl -TimeoutSec $TimeoutSec
  if ($r.ok -eq $true) {
    Ok "plugin health ok ($healthUrl)"
  } else {
    Fail "plugin health returned ok=false"
  }
} catch {
  Fail "plugin health request failed: $($_.Exception.Message)"
}

Step "2) Adapter healthz"
try {
  $adapterHealth = "$AdapterBaseUrl/healthz"
  $r2 = Invoke-WebRequest -Uri $adapterHealth -TimeoutSec $TimeoutSec
  if ($r2.StatusCode -eq 200) {
    Ok "adapter healthz ok ($adapterHealth)"
  } else {
    Fail "adapter healthz status=$($r2.StatusCode)"
  }
} catch {
  Fail "adapter healthz request failed: $($_.Exception.Message)"
}

Step "3) Chat API sanity"
try {
  $chatUrl = "$GatewayBaseUrl/api/ai-gf/chat"
  $body = @{ text = "你好，做个Windows链路自检" } | ConvertTo-Json -Compress
  $headers = @{ Authorization = "Bearer $Token" }
  $r3 = Invoke-RestMethod -Uri $chatUrl -Method Post -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec $TimeoutSec

  if ($r3.ok -eq $true -and $r3.data -and $r3.data.text) {
    Ok "chat api ok"
  } else {
    Fail "chat api response invalid"
  }
} catch {
  Fail "chat api request failed: $($_.Exception.Message)"
}

Step "4) WebSocket endpoint check"
$wsUrl = "ws://127.0.0.1:43113/api/v1/game/ws"
try {
  # In some Windows/PowerShell environments, WebSocket assemblies are unavailable.
  # Fallback to endpoint reachability via HTTP probe.
  $probeUrl = "$AdapterBaseUrl/api/v1/game/ws"
  $probe = Invoke-WebRequest -Uri $probeUrl -TimeoutSec $TimeoutSec -ErrorAction Stop
  Ok "ws endpoint reachable ($probeUrl), status=$($probe.StatusCode)"
} catch {
  $msg = $_.Exception.Message
  if ($msg -match "404") {
    Fail "ws endpoint returned 404 (path mismatch?): $wsUrl"
  } elseif ($msg -match "426|400") {
    Ok "ws endpoint reachable before upgrade ($wsUrl)"
  } else {
    Fail "ws endpoint check failed: $msg"
  }
}

if ($failed) {
  Write-Host "`nSelf-check finished with failures." -ForegroundColor Red
  exit 1
}

Write-Host "`nSelf-check finished: all checks passed." -ForegroundColor Green
exit 0
