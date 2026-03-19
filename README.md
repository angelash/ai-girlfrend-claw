# AI女友对接（Gateway Plugin）

`ai-girlfriend` 是运行在 OpenClaw Gateway 内的插件，负责把 UE/Lobster 请求路由到 OpenClaw 会话，并返回 UE 可直接消费的结构化结果。

## 当前能力

- Gateway 插件路由：`/api/ai-gf/*`
- 聊天路由：`/api/ai-gf/chat` → OpenClaw runtime session API
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

## Windows 环境补充

- 该插件已改为 runtime session API 路由，不依赖本机 CLI 命令名。
- 建议在 Windows 部署时显式设置会话持久化路径：

```bash
AI_GF_SESSION_PATH=C:\\openclaw\\state\\ai-gf-sessions.json
```

## 发布前自检清单

按顺序执行，全部通过再给 UE 接入：

### 1) 插件已加载

```bash
openclaw status
```

确认插件列表里有 `ai-girlfriend`。

### 2) 插件健康接口正常

```bash
curl -sS http://127.0.0.1:18789/api/ai-gf/health
```

预期：返回 `ok: true`，且包含 `sessionMode` 等字段。

### 3) 内嵌 adapter 进程已启动（43113）

```bash
curl -sS http://127.0.0.1:43113/healthz
```

预期：返回健康状态（HTTP 200）。

### 4) HTTP 聊天链路可用

```bash
curl -sS -X POST http://127.0.0.1:18789/api/ai-gf/chat \
  -H 'Authorization: Bearer ai-gf-main-token' \
  -H 'Content-Type: application/json' \
  -d '{"text":"你好，做个链路自检"}'
```

预期：返回 `ok: true`，`data` 内有 `text/emotion/actions/subtitleTimeline`。

### 5) WebSocket 端点可握手

用任意 WS 客户端连接：

- `ws://127.0.0.1:43113/api/v1/game/ws`

预期：可以建立连接，不出现 404/连接拒绝。

### 6) 常见失败位快速排查

- `43113` 不通：通常是 adapter 没起（先看步骤 1、2）
- WS 404：通常是 URL 写错，不是 `/api/ai-gf/*`
- 聊天 500：优先看 gateway 日志里的 `ai-gf` 路由报错
