#!/usr/bin/env bash
set -euo pipefail

GATEWAY_BASE_URL="${1:-http://127.0.0.1:18789}"
ADAPTER_BASE_URL="${2:-http://127.0.0.1:43113}"
TOKEN="${3:-ai-gf-main-token}"

fail=0
ok(){ echo "[OK] $*"; }
err(){ echo "[FAIL] $*"; fail=1; }

step(){ echo; echo "== $* =="; }

step "1) OpenClaw CLI availability"
if command -v openclaw >/dev/null 2>&1; then ok "openclaw command found"; else err "openclaw command not found"; fi

step "2) Plugin health"
if out=$(curl -fsS "$GATEWAY_BASE_URL/api/ai-gf/health"); then
  echo "$out" | grep -q '"ok":true' && ok "plugin health ok" || err "plugin health returned unexpected body"
else
  err "plugin health request failed"
fi

step "3) Adapter healthz"
if curl -fsS "$ADAPTER_BASE_URL/healthz" >/dev/null; then ok "adapter healthz ok"; else err "adapter healthz failed"; fi

step "4) Chat API sanity"
if out=$(curl -fsS -X POST "$GATEWAY_BASE_URL/api/ai-gf/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"你好，做个Linux链路自检"}'); then
  echo "$out" | grep -q '"ok":true' && ok "chat api ok" || err "chat api response invalid"
else
  err "chat api request failed"
fi

step "4) WebSocket endpoint reachability"
if command -v curl >/dev/null 2>&1; then
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$ADAPTER_BASE_URL/api/v1/game/ws" || true)
  if [[ "$code" == "400" || "$code" == "426" || "$code" == "404" ]]; then
    # HTTP not equal to ws handshake, but endpoint reached; 404 may be route mismatch.
    [[ "$code" == "404" ]] && err "ws endpoint returned 404 (path mismatch?)" || ok "ws endpoint reachable (http status $code before upgrade)"
  else
    ok "ws endpoint probe returned status $code"
  fi
else
  err "curl not found"
fi

if [[ $fail -ne 0 ]]; then
  echo; echo "Self-check finished with failures."
  exit 1
fi

echo; echo "Self-check finished: all checks passed."
