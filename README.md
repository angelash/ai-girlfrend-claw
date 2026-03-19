# AI女友对接（Gateway Plugin）

`ai-girlfriend` 是运行在 OpenClaw Gateway 内的插件，负责把 UE/Lobster 请求路由到 OpenClaw 会话，并返回 UE 可直接消费的结构化结果。

## 当前能力

- Gateway 插件路由：`/api/ai-gf/*`
- 聊天路由：`/api/ai-gf/chat` → OpenClaw 会话（`openclaw agent --session-id ... --json`）
- 结构化输出：`text`, `emotion`, `actions`, `subtitleTimeline`
- 内嵌 `vendor/lobster-adapter`（默认兼容 `43113` 入口）
- 支持固定单会话与 token 分流两种会话模式

## HTTP Routes

- `GET /api/ai-gf/health`
- `POST /api/ai-gf/session/login`
- `GET /api/ai-gf/session/info`
- `POST /api/ai-gf/chat`

## Session 模式

- `AI_GF_SESSION_MODE=fixed`（默认）
  - 所有 token 写入同一个会话：`AI_GF_FIXED_SESSION_ID`
  - 默认值：`ai-gf-fixed-session`
- `AI_GF_SESSION_MODE=token`
  - 按 token 分流：`${AI_GF_GATEWAY_SESSION_PREFIX}${token}`

## Environment

- `AI_GF_ROUTE_MODE`：`gateway`
- `AI_GF_SESSION_MODE`：`fixed`（默认） | `token`
- `AI_GF_FIXED_SESSION_ID`：默认 `ai-gf-fixed-session`
- `AI_GF_GATEWAY_SESSION_PREFIX`：默认 `voice-bridge-session-ai-gf-`
- `AI_GF_AGENT_TIMEOUT_MS`：默认 `30000`
- `AI_GF_SESSION_PATH`：默认 `./state/ai-gf-sessions.json`（建议按部署环境配置）
- `AI_GF_SYSTEM_PROMPT`

## UE 客户端建议配置

- `adapterBaseUrl = http://127.0.0.1:43113`
- `localWsUrl = ws://127.0.0.1:43113/api/v1/game/ws`
- `fallbackWsUrl = ws://127.0.0.1:43113/api/v1/game/ws`
- `pseudoSession.token = ai-gf-main-token`
