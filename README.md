# AI女友对接（Gateway Integrated Core）

`ai-girlfriend` 是 UE/Lobster 协议到 OpenClaw 会话路由的适配层。

当前实现（2026-03-18）：
- ✅ Chat **默认走 OpenClaw 会话路由**（不再直连 `/v1/chat/completions`）
- ✅ 返回由插件组装为 UE 结构：`text`, `emotion`, `actions`, `subtitleTimeline`
- ✅ 内嵌 `vendor/lobster-adapter` 服务（默认提供 `43113` 兼容入口）
- ✅ 支持固定单会话模式，便于统一查看历史

## HTTP Routes

- `GET /api/ai-gf/health`
- `POST /api/ai-gf/session/login`
- `GET /api/ai-gf/session/info`
- `POST /api/ai-gf/chat`

## 会话路由策略

`/api/ai-gf/chat` 的主路径：
1. 接收 UE 文本请求
2. 路由到 OpenClaw 会话（通过 `openclaw agent --session-id ... --json`）
3. 取返回文本并组装 UE 所需结构字段

> 说明：当前版本已移除 ai-gf 内部的 `/v1/chat/completions` 直连兜底链路。

## Session 模式

- `AI_GF_SESSION_MODE=fixed`（默认）
  - 所有 token 写入同一个会话：`AI_GF_FIXED_SESSION_ID`
  - 默认值：`ai-gf-fixed-session`
- `AI_GF_SESSION_MODE=token`
  - 按 token 分流：`${prefix}${token}`

## Environment

- `AI_GF_ROUTE_MODE`：`gateway`（默认） | `legacy`
- `AI_GF_SESSION_MODE`：`fixed`（默认） | `token`
- `AI_GF_FIXED_SESSION_ID`：默认 `ai-gf-fixed-session`
- `AI_GF_GATEWAY_SESSION_PREFIX`：默认 `voice-bridge-session-ai-gf-`
- `AI_GF_LEGACY_SESSION_PREFIX`：默认 `ai-gf-clawra-`
- `AI_GF_AGENT_TIMEOUT_MS`：默认 `30000`
- `AI_GF_SESSION_PATH`：默认 `/home/shash/clawd/state/ai-gf-sessions.json`
- `AI_GF_SYSTEM_PROMPT`

## UE 客户端建议配置

- `adapterBaseUrl = http://127.0.0.1:43113`
- `localWsUrl = ws://127.0.0.1:43113/api/v1/game/ws`
- `fallbackWsUrl = ws://127.0.0.1:43113/api/v1/game/ws`
- `pseudoSession.token = ai-gf-main-token`
