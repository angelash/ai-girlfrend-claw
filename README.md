# AI女友对接（Gateway Integrated Core）

这是一版“像 Feishu 一样集成到 OpenClaw 生命周期”的 AI 女友核心插件：

- 会话在插件侧维护并持久化（默认 `state/ai-gf-sessions.json`）
- 调用 OpenClaw 兼容的 `/v1/chat/completions`
- 输出结构化字段：`text`, `emotion`, `actions`, `subtitleTimeline`

## Routes

- `GET /api/ai-gf/health`
- `POST /api/ai-gf/session/login`
- `GET /api/ai-gf/session/info`
- `POST /api/ai-gf/chat`

## Environment

- `AI_GF_GATEWAY_URL` (default `http://127.0.0.1:18789`)
- `AI_GF_GATEWAY_TOKEN` (optional)
- `AI_GF_MODEL` (default `custom/glm-5`)
- `AI_GF_TIMEOUT_MS` (default `25000`)
- `AI_GF_SESSION_PATH` (default `/home/shash/clawd/state/ai-gf-sessions.json`)
- `AI_GF_SYSTEM_PROMPT`

## 关于 WebSocket

本插件是“集成核心层”。如果网关插件接口暂不直接提供 WS upgrade，建议保留现有 lobster-adapter 作为 **纯传输壳**，其业务逻辑迁移到本插件。
