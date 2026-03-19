#!/usr/bin/env bash
set -euo pipefail

GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:18789}"
ADAPTER_BASE_URL="${ADAPTER_BASE_URL:-http://127.0.0.1:43113}"
TOKEN="${TOKEN:-ai-gf-main-token}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "== [1/3] Build lobster-adapter =="
cd "$ROOT_DIR/vendor/lobster-adapter"
npm ci
npm run build


echo "== [2/3] Restart OpenClaw gateway =="
openclaw gateway restart


echo "== [3/3] Run self-check =="
"$SCRIPT_DIR/selfcheck-linux.sh" "$GATEWAY_BASE_URL" "$ADAPTER_BASE_URL" "$TOKEN"

echo "Bootstrap finished."
