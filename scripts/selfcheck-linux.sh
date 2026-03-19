#!/usr/bin/env bash
set -euo pipefail

GATEWAY_BASE_URL="${1:-http://127.0.0.1:18789}"
ADAPTER_BASE_URL="${2:-http://127.0.0.1:43113}"
TOKEN="${3:-ai-gf-main-token}"

fail=0
ok(){ echo "[OK] $*"; }
err(){ echo "[FAIL] $*"; fail=1; }

step(){ echo; echo "== $* =="; }

step "1) Plugin health"
if out=$(curl -fsS "$GATEWAY_BASE_URL/api/ai-gf/health"); then
  echo "$out" | grep -q '"ok":true' && ok "plugin health ok" || err "plugin health returned unexpected body"
else
  err "plugin health request failed"
fi

step "2) Adapter healthz"
if curl -fsS "$ADAPTER_BASE_URL/healthz" >/dev/null; then ok "adapter healthz ok"; else err "adapter healthz failed"; fi

step "3) Chat API sanity"
if out=$(curl --max-time 45 -fsS -X POST "$GATEWAY_BASE_URL/api/ai-gf/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"你好，做个Linux链路自检"}'); then
  echo "$out" | grep -q '"ok":true' && ok "chat api ok" || err "chat api response invalid"
else
  err "chat api request failed"
fi

step "4) WebSocket handshake"
if command -v node >/dev/null 2>&1; then
  if node -e '
const url = process.argv[1];
const ws = new WebSocket(url);
const t = setTimeout(() => { console.error("timeout"); process.exit(2); }, 10000);
ws.addEventListener("open", () => { clearTimeout(t); ws.close(); process.exit(0); });
ws.addEventListener("error", (e) => { clearTimeout(t); console.error(e?.message || "ws error"); process.exit(1); });
' "ws://127.0.0.1:43113/api/v1/game/ws"; then
    ok "websocket handshake ok"
  else
    err "websocket handshake failed"
  fi
else
  err "node not found"
fi

if [[ $fail -ne 0 ]]; then
  echo; echo "Self-check finished with failures."
  exit 1
fi

echo; echo "Self-check finished: all checks passed."
