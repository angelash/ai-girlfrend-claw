# Lobster Adapter (P0)

This adapter provides HTTP + WebSocket compatibility for the Aurora frontend in Lobster mode, with optional OpenAI-compatible LLM integration and persistent per-token session memory.

## Quick Start

1. Edit `adapter.config.json` if needed.
2. Run:
   - Windows: `start.bat`
   - Linux/macOS: `chmod +x start.sh && ./start.sh`

Default endpoints:
- HTTP base: `http://127.0.0.1:43113/api/v1`
- WebSocket: `ws://127.0.0.1:43113/api/v1/game/ws`
- Health check: `http://127.0.0.1:43113/healthz`

## Implemented Compatibility

HTTP:
- `POST /api/v1/auth/login`
- `GET /api/v1/index/info`
- `GET /api/v1/index/continue-game`
- `POST /api/v1/index/new-game`

WebSocket events:
- `chat` + `audio_stream` (codes `3001`, `4104`, `4105`)
- `initial_scene` (`3020`)
- `scene_change` (`3022`), plus auto update (`3033`)
- `update_unlocked` (`3042`)
- `get_outfit_info` (`4096`)
- `change_outfit` (`4098`)
- `get_tracked_task` (`4050`)
- `request_user_name`/`set_user_name` (gated by `enableUserNameFlow`)

## Config Notes

`adapter.config.json` supports:
- `enableUserNameFlow`: enable/disable username handshake.
- `session.persistPath/historyMaxTurns`: persist session state + chat history per token.
- `llm.*`: OpenAI-compatible chat-completions endpoint (for independent model session memory + structured outputs).
- `upstream.enabled/wsUrl`: optional upstream WebSocket bridge.
- `syntheticChatFallbackMs`: fallback chat response timeout when upstream is enabled.
- `scene.*`: scene defaults used by `initial_scene/scene_change/scene_auto_update`.
  Use canonical keys (`game_location_living_room` etc.). The adapter also auto-accepts short aliases (`living_room` etc.) and normalizes them.

Reply priority is:
1. Upstream WebSocket (`upstream.enabled=true`)
2. LLM adapter mode (`llm.enabled=true`)
3. Synthetic fallback (always available)

When LLM mode is enabled, the adapter asks the model to return structured JSON fields (`text`, `emotion`, `actions`, `subtitleTimeline`) and maps those to Lobster chat payloads.
