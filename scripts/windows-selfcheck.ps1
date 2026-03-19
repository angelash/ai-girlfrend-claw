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

Step "1) OpenClaw CLI availability"
try {
  $null = Get-Command openclaw -ErrorAction Stop
  Ok "openclaw command found"
} catch {
  Fail "openclaw command not found in PATH"
}

Step "2) Plugin health"
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

Step "3) Adapter healthz"
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

Step "4) Chat API sanity"
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

Step "5) WebSocket handshake"
try {
  Add-Type -AssemblyName System.Net.WebSockets
  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $cts = [System.Threading.CancellationTokenSource]::new()
  $cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))
  $uri = [Uri]::new("ws://127.0.0.1:43113/api/v1/game/ws")
  $task = $ws.ConnectAsync($uri, $cts.Token)
  $task.GetAwaiter().GetResult()

  if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
    Ok "websocket handshake ok ($uri)"
  } else {
    Fail "websocket state=$($ws.State)"
  }

  $ws.Dispose()
  $cts.Dispose()
} catch {
  Fail "websocket handshake failed: $($_.Exception.Message)"
}

if ($failed) {
  Write-Host "`nSelf-check finished with failures." -ForegroundColor Red
  exit 1
}

Write-Host "`nSelf-check finished: all checks passed." -ForegroundColor Green
exit 0
