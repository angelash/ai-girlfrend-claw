#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
if [ ! -d node_modules ]; then
  echo "[lobster-adapter] installing dependencies..."
  npm install
fi
if [ -f dist/server.js ]; then
  node dist/server.js
else
  npm run dev
fi
