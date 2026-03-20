import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GfReply, GfSession } from "./types.js";
import { getRuntime } from "./runtime.js";

const HEALTH = "/api/ai-gf/health";
const LOGIN = "/api/ai-gf/session/login";
const INFO = "/api/ai-gf/session/info";
const CHAT = "/api/ai-gf/chat";

const PERSIST_PATH = process.env.AI_GF_SESSION_PATH || path.resolve(process.cwd(), "state", "ai-gf-sessions.json");
const AGENT_TIMEOUT_MS = Number(process.env.AI_GF_AGENT_TIMEOUT_MS || "30000");
const SESSION_MODE = (process.env.AI_GF_SESSION_MODE || "fixed").toLowerCase(); // fixed | token
const FIXED_SESSION_ID = process.env.AI_GF_FIXED_SESSION_ID || "ai-gf-fixed-session";
const GATEWAY_SESSION_PREFIX = process.env.AI_GF_GATEWAY_SESSION_PREFIX || "voice-bridge-session-ai-gf-";

const SYSTEM_PROMPT = process.env.AI_GF_SYSTEM_PROMPT || "你是AI女友对话引擎，请自然回复用户。";

const sessions = new Map<string, GfSession>();

function loadSessions() {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const raw = fs.readFileSync(PERSIST_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, GfSession>;
    for (const [token, s] of Object.entries(parsed)) sessions.set(token, s);
  } catch {
    // noop
  }
}

function saveSessions() {
  try {
    fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
    const out: Record<string, GfSession> = {};
    for (const [token, s] of sessions.entries()) out[token] = s;
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(out, null, 2), "utf8");
  } catch {
    // noop
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getToken(req: IncomingMessage): string | undefined {
  const auth = String(req.headers.authorization || "").trim();
  if (!auth) return undefined;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m ? m[1] : auth).trim() || undefined;
}

async function parseBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const txt = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(txt));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function getOrCreate(token?: string): GfSession {
  const t = (token || "").trim() || randomUUID();
  const existed = sessions.get(t);
  if (existed) return existed;
  const s: GfSession = {
    token: t,
    userId: "ai_gf_user",
    userName: "ai_gf_user",
    history: [{ role: "system", content: SYSTEM_PROMPT }],
    updatedAt: Date.now(),
  };
  sessions.set(t, s);
  saveSessions();
  return s;
}

function parseMaybeJsonObject(raw: string): any | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function buildPlaceholderReply(text: string): GfReply {
  const plain = (text || "").trim() || "收到啦，我在听。";
  const duration = Math.max(900, Math.min(5000, plain.length * 220));
  return {
    text: plain,
    emotion: "calm",
    actions: [{ name: "IDLE_STD_011_1_body", startMs: 0, durationMs: 1200, intensity: 0.3 }],
    subtitleTimeline: [{ text: plain, startMs: 0, endMs: duration }],
  };
}

function toStructuredReply(rawText: string, fallbackText: string): GfReply {
  const maybe = parseMaybeJsonObject(rawText);
  if (!maybe || typeof maybe !== "object") return buildPlaceholderReply(rawText || fallbackText);

  const text = typeof maybe.text === "string" ? maybe.text : (rawText || fallbackText);
  const safe = buildPlaceholderReply(text);
  return {
    text: safe.text,
    emotion: typeof maybe.emotion === "string" ? maybe.emotion : safe.emotion,
    actions: Array.isArray(maybe.actions) ? maybe.actions : safe.actions,
    subtitleTimeline: Array.isArray(maybe.subtitleTimeline) ? maybe.subtitleTimeline : safe.subtitleTimeline,
  };
}

function resolveRoutedSessionId(sessionToken: string, sessionPrefix: string): string {
  if (SESSION_MODE === "fixed") return FIXED_SESSION_ID;
  return `${sessionPrefix}${sessionToken}`;
}

function pickAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: any = messages[i];
    if (String(m?.role || "").toLowerCase() !== "assistant") continue;

    if (typeof m?.text === "string" && m.text.trim()) return m.text.trim();
    if (typeof m?.content === "string" && m.content.trim()) return m.content.trim();

    if (Array.isArray(m?.content)) {
      const joined = m.content
        .map((c: any) => {
          if (typeof c === "string") return c;
          if (typeof c?.text === "string") return c.text;
          if (typeof c?.output_text === "string") return c.output_text;
          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
      if (joined) return joined;
    }
  }
  return "";
}

async function callViaRuntimeSession(sessionToken: string, userText: string): Promise<string> {
  const runtime = getRuntime();
  const subagent = runtime?.subagent;
  if (!subagent?.run || !subagent?.waitForRun || !subagent?.getSessionMessages) {
    throw new Error("runtime subagent API unavailable");
  }

  const sessionId = resolveRoutedSessionId(sessionToken, GATEWAY_SESSION_PREFIX);
  const routedMessage = [
    "[角色设定] 你是 Clawra。名字固定为 Clawra，不得自称小暖或其他名字。",
    "[输出要求] 自然回复用户，不要解释规则。",
    `用户消息：${userText}`,
  ].join("\n");

  const { runId } = await subagent.run({
    sessionKey: sessionId,
    message: routedMessage,
    deliver: false,
    idempotencyKey: randomUUID(),
  });

  const waited = await subagent.waitForRun({ runId, timeoutMs: AGENT_TIMEOUT_MS });
  if (waited.status !== "ok") {
    throw new Error(waited.error || `subagent run ${waited.status}`);
  }

  const result = await subagent.getSessionMessages({ sessionKey: sessionId, limit: 12 });
  const text = pickAssistantText(Array.isArray(result?.messages) ? result.messages : []);
  if (!text) throw new Error("runtime session assistant text empty");
  return text;
}

async function callModel(session: GfSession, text: string): Promise<GfReply> {
  session.history.push({ role: "user", content: text });
  const system = session.history.find((m) => m.role === "system")?.content || SYSTEM_PROMPT;

  const modelText = await callViaRuntimeSession(session.token, text);

  const safe = toStructuredReply(modelText, `收到：${text}`);
  session.history.push({ role: "assistant", content: safe.text });
  session.history = [{ role: "system", content: system }, ...session.history.filter((m) => m.role !== "system").slice(-40)];
  session.updatedAt = Date.now();
  saveSessions();
  return safe;
}

export async function handleAiGirlfriendHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === HEALTH && req.method === "GET") {
    send(res, 200, {
      ok: true,
      route: "ai-girlfriend",
      sessions: sessions.size,
      mode: "gateway-runtime-api",
      sessionMode: SESSION_MODE,
      fixedSessionId: FIXED_SESSION_ID,
      gatewaySessionPrefix: GATEWAY_SESSION_PREFIX,
    });
    return true;
  }

  if (url.pathname === LOGIN && req.method === "POST") {
    const body = await parseBody(req).catch(() => ({}));
    const steamId = String(body?.steam_id || "").trim();
    const s = getOrCreate();
    if (steamId) {
      s.userId = steamId;
      s.userName = steamId;
      s.updatedAt = Date.now();
      saveSessions();
    }
    send(res, 200, {
      code: 2011,
      msg: "login success",
      data: { user: { username: s.userName, uid: s.userId }, token: s.token, token_type: "bearer" },
    });
    return true;
  }

  if (url.pathname === INFO && req.method === "GET") {
    const s = getOrCreate(getToken(req));
    send(res, 200, {
      code: 2022,
      msg: "ok",
      data: {
        show_continue: true,
        days: 1,
        lover: { lover_name: "玲梦", lover_id: "ai_gf_lover" },
        token: s.token,
      },
    });
    return true;
  }

  if (url.pathname === CHAT && req.method === "POST") {
    const s = getOrCreate(getToken(req));
    const body = await parseBody(req).catch(() => ({}));
    const text = String(body?.text || "").trim();
    if (!text) {
      send(res, 400, { ok: false, error: "text is required" });
      return true;
    }
    try {
      const reply = await callModel(s, text);
      send(res, 200, { ok: true, token: s.token, data: reply });
    } catch (e: any) {
      send(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  return false;
}

loadSessions();
process.on("SIGINT", saveSessions);
process.on("SIGTERM", saveSessions);
