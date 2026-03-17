import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import express, { Request } from "express";
import { WebSocketServer, WebSocket, RawData } from "ws";

type SceneLocationMap = Record<string, boolean>;
type OutfitState = Record<"top" | "bottom" | "dress" | "socks" | "shoes" | "hat", string>;

type ChatRole = "system" | "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface LobsterAction {
  name: string;
  startMs?: number;
  durationMs?: number;
  intensity?: number;
}

interface LlmResult {
  text: string;
  emotion?: string;
  actions?: LobsterAction[];
  subtitleTimeline?: Array<{ text: string; startMs: number; endMs: number }>;
}

interface AdapterConfig {
  host: string;
  port: number;
  verbose: boolean;
  enableUserNameFlow: boolean;
  syntheticChatFallbackMs: number;
  session: {
    persistPath: string;
    historyMaxTurns: number;
  };
  llm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    requestTimeoutMs: number;
    systemPrompt: string;
  };
  aiGfCore: {
    enabled: boolean;
    baseUrl: string;
    token: string;
    timeoutMs: number;
  };
  upstream: {
    enabled: boolean;
    wsUrl: string;
    connectTimeoutMs: number;
    headers: Record<string, string>;
  };
  defaults: {
    userId: string;
    userName: string;
    token: string;
    loverId: string;
    loverName: string;
    loginDays: number;
    favorability: number;
    openingSceneCompleted: boolean;
  };
  scene: {
    playerLocation: string;
    aiLocation: string;
    availableLocations: SceneLocationMap;
    timePeriod?: string;
    aiSceneId?: string;
    isAiPresent?: boolean;
    sceneSliceName?: string;
    sceneDescription?: string;
  };
  outfit: OutfitState;
}

interface SessionState {
  token: string;
  userId: string;
  userName: string;
  userNameReady: boolean;
  loverId: string;
  loverName: string;
  loginDays: number;
  favorability: number;
  openingSceneCompleted: boolean;
  scene: {
    playerLocation: string;
    aiLocation: string;
    availableLocations: SceneLocationMap;
  };
  outfit: OutfitState;
  history: ChatMessage[];
  updatedAt: number;
}

interface DownstreamClient {
  ws: WebSocket;
  session: SessionState;
  upstream: WebSocket | null;
  pendingChatFallback: NodeJS.Timeout | null;
}

const CODE = {
  LOGIN_SUCCESS: 2011,
  NEWGAME_SHOW_NEW_AND_CONTINUE_BUTTONS: 2022,
  NEWGAME_CREATE_SUCCESS: 2023,
  CONTINUE_GAME_SUCCESS: 2025,
  CHAT_SUCCESS: 3001,
  CHAT_FAILURE: 3002,
  REQ_SET_USER_NAME: 3035,
  SET_USER_NAME_SUCCESS: 3036,
  SET_USER_NAME_FAILURE: 3037,
  INITIAL_SCENE_SUCCESS: 3020,
  INITIAL_SCENE_FAILURE: 3021,
  SCENE_CHANGE_SUCCESS: 3022,
  SCENE_CHANGE_FAILURE: 3023,
  SCENE_AUTO_UPDATE_SUCCESS: 3033,
  UPDATE_UNLOCKED_SUCCESS: 3042,
  GET_TRACKED_TASK_SUCCESS: 4050,
  GET_OUTFIT_INFO_SUCCESS: 4096,
  CHANGE_OUTFIT_SUCCESS: 4098,
  AUDIO_STREAM_CHUNK: 4104,
  AUDIO_STREAM_END: 4105,
};

const EVENT = {
  CHAT: "chat",
  AUDIO_STREAM: "audio_stream",
  REQUEST_USER_NAME: "request_user_name",
  SET_USER_NAME: "set_user_name",
  INITIAL_SCENE: "initial_scene",
  SCENE_CHANGE: "scene_change",
  SCENE_AUTO_UPDATE: "scene_auto_update",
  UPDATE_UNLOCKED: "update_unlocked",
  GET_TRACKED_TASK: "get_tracked_task",
  GET_OUTFIT_INFO: "get_outfit_info",
  CHANGE_OUTFIT: "change_outfit",
} as const;

const LOCATION_ALIASES: Record<string, string> = {
  living_room: "game_location_living_room",
  game_location_living_room: "game_location_living_room",
  balcony: "game_location_balcony",
  game_location_balcony: "game_location_balcony",
  gf_bedroom: "game_location_gf_bedroom",
  game_location_gf_bedroom: "game_location_gf_bedroom",
  bathroom: "game_location_bathroom",
  game_location_bathroom: "game_location_bathroom",
  bedroom: "game_location_bedroom",
  game_location_bedroom: "game_location_bedroom",
};

const DEFAULT_AVAILABLE_LOCATIONS: SceneLocationMap = {
  game_location_living_room: true,
  game_location_balcony: true,
  game_location_gf_bedroom: false,
  game_location_bathroom: true,
  game_location_bedroom: true,
};

const SYNTH_AUDIO_SAMPLE_RATE = 32000;
const SYNTH_AUDIO_CHANNELS = 1;
const SYNTH_AUDIO_CHUNK_BASE64_SIZE = 26000;

const DEFAULT_SYSTEM_PROMPT = [
  "你是 Lobster 模式下的数字伴侣角色。",
  "输出必须是 JSON，对象字段包含：",
  "text: string（自然中文回复）",
  "emotion: string（如 calm/happy/shy/excited）",
  "actions: 数组，每个元素 {name,startMs,durationMs,intensity}",
  "subtitleTimeline: 数组，每个元素 {text,startMs,endMs}",
  "禁止输出 JSON 以外内容。",
].join("\n");

const DEFAULT_CONFIG: AdapterConfig = {
  host: "0.0.0.0",
  port: 43113,
  verbose: true,
  enableUserNameFlow: false,
  syntheticChatFallbackMs: 1200,
  session: {
    persistPath: "../data/sessions.json",
    historyMaxTurns: 30,
  },
  llm: {
    enabled: false,
    baseUrl: "http://127.0.0.1:3456/v1",
    apiKey: "",
    model: "custom/glm-5",
    temperature: 0.7,
    maxTokens: 512,
    requestTimeoutMs: 20000,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },
  aiGfCore: {
    enabled: true,
    baseUrl: "http://127.0.0.1:18789",
    token: "",
    timeoutMs: 25000,
  },
  upstream: {
    enabled: false,
    wsUrl: "ws://127.0.0.1:43114/ws",
    connectTimeoutMs: 3000,
    headers: {},
  },
  defaults: {
    userId: "lobster_local_user",
    userName: "lobster_local_user",
    token: "lobster-mode-token",
    loverId: "lobster_local_lover",
    loverName: "Lingmeng",
    loginDays: 1,
    favorability: 0,
    openingSceneCompleted: true,
  },
  scene: {
    playerLocation: "game_location_living_room",
    aiLocation: "game_location_living_room",
    availableLocations: { ...DEFAULT_AVAILABLE_LOCATIONS },
    timePeriod: "game_time_period_afternoon",
    aiSceneId: "SC003",
    isAiPresent: true,
    sceneSliceName: "living_room_default",
    sceneDescription: "Player and AI are in the living room.",
  },
  outfit: {
    top: "0",
    bottom: "0",
    dress: "0",
    socks: "0",
    shoes: "0",
    hat: "0",
  },
};

function deepMerge<T extends Record<string, any>>(base: T, extra: Partial<T>): T {
  const output: T = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const cur = (output as any)[k] ?? {};
      (output as any)[k] = deepMerge(cur, v as Record<string, any>);
    } else if (v !== undefined) {
      (output as any)[k] = v;
    }
  }
  return output;
}

function normalizeLocationKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return LOCATION_ALIASES[raw] ?? LOCATION_ALIASES[lower] ?? raw;
}

function normalizeAvailableLocations(input: unknown): SceneLocationMap {
  const normalized: SceneLocationMap = {};
  const assign = (location: string, unlocked: unknown): void => {
    const canonical = normalizeLocationKey(location);
    if (!canonical) return;
    normalized[canonical] = !!unlocked;
  };

  if (Array.isArray(input)) {
    for (const location of input) {
      if (typeof location === "string") assign(location, true);
    }
  } else if (input && typeof input === "object") {
    for (const [location, unlocked] of Object.entries(input as Record<string, unknown>)) {
      assign(location, unlocked);
    }
  }

  if (Object.keys(normalized).length === 0) {
    return { ...DEFAULT_AVAILABLE_LOCATIONS };
  }

  return normalized;
}

function normalizeAdapterConfig(input: AdapterConfig): AdapterConfig {
  const normalizedPlayerLocation = normalizeLocationKey(input.scene.playerLocation) ?? DEFAULT_CONFIG.scene.playerLocation;
  const normalizedAiLocation = normalizeLocationKey(input.scene.aiLocation) ?? normalizedPlayerLocation;
  const normalizedAvailableLocations = normalizeAvailableLocations(input.scene.availableLocations);

  normalizedAvailableLocations[normalizedPlayerLocation] = true;
  normalizedAvailableLocations[normalizedAiLocation] = true;

  return {
    ...input,
    scene: {
      ...input.scene,
      playerLocation: normalizedPlayerLocation,
      aiLocation: normalizedAiLocation,
      availableLocations: normalizedAvailableLocations,
    },
  };
}

function loadConfig(): AdapterConfig {
  const fromEnv = process.env.ADAPTER_CONFIG;
  const configPath = fromEnv ? path.resolve(fromEnv) : path.resolve(__dirname, "../adapter.config.json");
  if (!fs.existsSync(configPath)) {
    return normalizeAdapterConfig({ ...DEFAULT_CONFIG });
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as Partial<AdapterConfig>;
    const merged = deepMerge(DEFAULT_CONFIG, parsed);

    if (process.env.LOBSTER_LLM_BASE_URL) merged.llm.baseUrl = process.env.LOBSTER_LLM_BASE_URL;
    if (process.env.LOBSTER_LLM_API_KEY) merged.llm.apiKey = process.env.LOBSTER_LLM_API_KEY;
    if (process.env.LOBSTER_LLM_MODEL) merged.llm.model = process.env.LOBSTER_LLM_MODEL;
    if (process.env.LOBSTER_LLM_ENABLED) merged.llm.enabled = process.env.LOBSTER_LLM_ENABLED === "true";
    if (process.env.LOBSTER_AI_GF_CORE_ENABLED) merged.aiGfCore.enabled = process.env.LOBSTER_AI_GF_CORE_ENABLED === "true";
    if (process.env.LOBSTER_AI_GF_CORE_BASE_URL) merged.aiGfCore.baseUrl = process.env.LOBSTER_AI_GF_CORE_BASE_URL;
    if (process.env.LOBSTER_AI_GF_CORE_TOKEN) merged.aiGfCore.token = process.env.LOBSTER_AI_GF_CORE_TOKEN;

    merged.port = Number.isFinite(Number(merged.port)) ? Number(merged.port) : DEFAULT_CONFIG.port;
    merged.syntheticChatFallbackMs = Number.isFinite(Number(merged.syntheticChatFallbackMs))
      ? Math.max(0, Number(merged.syntheticChatFallbackMs))
      : DEFAULT_CONFIG.syntheticChatFallbackMs;
    merged.llm.requestTimeoutMs = Number.isFinite(Number(merged.llm.requestTimeoutMs))
      ? Math.max(1000, Number(merged.llm.requestTimeoutMs))
      : DEFAULT_CONFIG.llm.requestTimeoutMs;
    return normalizeAdapterConfig(merged);
  } catch (error) {
    console.error("[lobster-adapter] failed to load config, using defaults:", error);
    return normalizeAdapterConfig({ ...DEFAULT_CONFIG });
  }
}

const config = loadConfig();
const app = express();
const server = http.createServer(app);
const wsServer = new WebSocketServer({ server, path: "/api/v1/game/ws" });
const sessions = new Map<string, SessionState>();

function resolvePersistPath(): string {
  return path.resolve(__dirname, config.session.persistPath);
}

function log(...args: any[]): void {
  if (config.verbose) {
    console.log("[lobster-adapter]", ...args);
  }
}

function defaultHistory(): ChatMessage[] {
  return [{ role: "system", content: config.llm.systemPrompt }];
}

function sanitizeHistory(history: any): ChatMessage[] {
  if (!Array.isArray(history)) return defaultHistory();
  const cleaned = history
    .filter((x) => x && (x.role === "system" || x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .map((x) => ({ role: x.role as ChatRole, content: x.content }));
  return cleaned.length > 0 ? cleaned : defaultHistory();
}

function createSession(token?: string): SessionState {
  const resolvedToken = token?.trim() || crypto.randomUUID();
  const playerLocation = normalizeLocationKey(config.scene.playerLocation) ?? DEFAULT_CONFIG.scene.playerLocation;
  const aiLocation = normalizeLocationKey(config.scene.aiLocation) ?? playerLocation;
  const availableLocations = normalizeAvailableLocations(config.scene.availableLocations);
  availableLocations[playerLocation] = true;
  availableLocations[aiLocation] = true;
  return {
    token: resolvedToken,
    userId: config.defaults.userId,
    userName: config.defaults.userName,
    userNameReady: !config.enableUserNameFlow,
    loverId: config.defaults.loverId,
    loverName: config.defaults.loverName,
    loginDays: config.defaults.loginDays,
    favorability: config.defaults.favorability,
    openingSceneCompleted: config.defaults.openingSceneCompleted,
    scene: {
      playerLocation,
      aiLocation,
      availableLocations,
    },
    outfit: { ...config.outfit },
    history: defaultHistory(),
    updatedAt: Date.now(),
  };
}

function serializeSessions(): Record<string, SessionState> {
  const output: Record<string, SessionState> = {};
  for (const [token, session] of sessions.entries()) output[token] = session;
  return output;
}

function loadSessionsFromDisk(): void {
  const persistPath = resolvePersistPath();
  if (!fs.existsSync(persistPath)) return;
  try {
    const raw = fs.readFileSync(persistPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, SessionState>;
    Object.entries(parsed).forEach(([token, value]) => {
      const candidatePlayer = (value as any)?.scene?.playerLocation;
      const candidateAi = (value as any)?.scene?.aiLocation;
      const candidateAvailable = (value as any)?.scene?.availableLocations;
      const normalizedPlayer = normalizeLocationKey(candidatePlayer) ?? normalizeLocationKey(config.scene.playerLocation) ?? DEFAULT_CONFIG.scene.playerLocation;
      const normalizedAi = normalizeLocationKey(candidateAi) ?? normalizedPlayer;
      const normalizedAvailable = normalizeAvailableLocations(candidateAvailable);
      normalizedAvailable[normalizedPlayer] = true;
      normalizedAvailable[normalizedAi] = true;

      sessions.set(token, {
        ...createSession(token),
        ...value,
        scene: {
          playerLocation: normalizedPlayer,
          aiLocation: normalizedAi,
          availableLocations: normalizedAvailable,
        },
        history: sanitizeHistory((value as any).history),
        updatedAt: Number((value as any).updatedAt) || Date.now(),
      });
    });
    log(`loaded ${sessions.size} sessions from disk`);
  } catch (error) {
    console.error("[lobster-adapter] failed to load sessions:", error);
  }
}

function saveSessionsToDisk(): void {
  const persistPath = resolvePersistPath();
  try {
    fs.mkdirSync(path.dirname(persistPath), { recursive: true });
    fs.writeFileSync(persistPath, JSON.stringify(serializeSessions(), null, 2), "utf8");
  } catch (error) {
    console.error("[lobster-adapter] failed to save sessions:", error);
  }
}

function touchSession(session: SessionState): void {
  session.updatedAt = Date.now();
  sessions.set(session.token, session);
  saveSessionsToDisk();
}

function trimHistory(session: SessionState): void {
  const maxMessages = Math.max(4, config.session.historyMaxTurns * 2 + 1);
  const system = session.history.find((x) => x.role === "system") ?? { role: "system" as const, content: config.llm.systemPrompt };
  const nonSystem = session.history.filter((x) => x.role !== "system");
  const trimmed = nonSystem.slice(-Math.max(0, maxMessages - 1));
  session.history = [system, ...trimmed];
}

function getOrCreateSession(token?: string): SessionState {
  const resolvedToken = token?.trim() || config.defaults.token;
  const existed = sessions.get(resolvedToken);
  if (existed) return existed;
  const created = createSession(resolvedToken);
  sessions.set(created.token, created);
  saveSessionsToDisk();
  return created;
}

function getTokenFromHeaders(headers: Request["headers"] | http.IncomingHttpHeaders): string | undefined {
  const raw = headers.authorization;
  if (!raw) return undefined;
  const parts = raw.split(" ");
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return raw;
}

function sendJson(ws: WebSocket, payload: any): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function sendEnvelope(ws: WebSocket, code: number, event: string, eventData: any, msg = "ok"): void {
  sendJson(ws, { code, msg, data: { event, event_data: eventData } });
}

function buildSceneInfo(session: SessionState): { scene_info: any; available_locations: SceneLocationMap; days: number } {
  const availableLocations = normalizeAvailableLocations(session.scene.availableLocations);
  const playerLocation = normalizeLocationKey(session.scene.playerLocation) ?? config.scene.playerLocation;
  const aiLocation = normalizeLocationKey(session.scene.aiLocation) ?? playerLocation;
  availableLocations[playerLocation] = true;
  availableLocations[aiLocation] = true;

  return {
    scene_info: {
      time_period: config.scene.timePeriod ?? "game_time_period_afternoon",
      ai_location: aiLocation,
      ai_scene_id: config.scene.aiSceneId ?? "SC003",
      player_location: playerLocation,
      is_ai_present: config.scene.isAiPresent ?? true,
      scene_slice_name: config.scene.sceneSliceName ?? "living_room_default",
      scene_description: config.scene.sceneDescription ?? "Player and AI are in the living room.",
      available_locations: availableLocations,
    },
    available_locations: availableLocations,
    days: session.loginDays,
  };
}

function sendInitialScene(client: DownstreamClient): void {
  sendEnvelope(client.ws, CODE.INITIAL_SCENE_SUCCESS, EVENT.INITIAL_SCENE, buildSceneInfo(client.session), "获取初始化信息成功");
}

function sendSceneAutoUpdate(client: DownstreamClient): void {
  sendEnvelope(client.ws, CODE.SCENE_AUTO_UPDATE_SUCCESS, EVENT.SCENE_AUTO_UPDATE, buildSceneInfo(client.session), "场景自动更新");
}

function sendUpdateUnlocked(client: DownstreamClient): void {
  sendEnvelope(client.ws, CODE.UPDATE_UNLOCKED_SUCCESS, EVENT.UPDATE_UNLOCKED, normalizeAvailableLocations(client.session.scene.availableLocations), "更新解锁状态成功");
}

function sendOutfitInfo(client: DownstreamClient): void {
  sendEnvelope(client.ws, CODE.GET_OUTFIT_INFO_SUCCESS, EVENT.GET_OUTFIT_INFO, { ...client.session.outfit, hairstyle: "hair_01" }, "获取服装信息成功");
}

function sendTrackedTask(client: DownstreamClient): void {
  sendEnvelope(client.ws, CODE.GET_TRACKED_TASK_SUCCESS, EVENT.GET_TRACKED_TASK, {}, "当前没有追踪的任务");
}

function splitBase64(input: string, chunkSize: number): string[] {
  const output: string[] = [];
  for (let i = 0; i < input.length; i += chunkSize) output.push(input.slice(i, i + chunkSize));
  return output.length > 0 ? output : [input];
}

function generateSyntheticPcmBase64(durationSeconds: number): string {
  const safeDurationSeconds = Math.max(1, Math.min(8, Number.isFinite(durationSeconds) ? durationSeconds : 1));
  const totalSamples = Math.floor(SYNTH_AUDIO_SAMPLE_RATE * safeDurationSeconds);
  const bytes = Buffer.alloc(totalSamples * 2);
  const amplitude = 0.07;
  const freq = 220;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SYNTH_AUDIO_SAMPLE_RATE;
    const envelope = Math.min(1, i / (SYNTH_AUDIO_SAMPLE_RATE * 0.06)) * Math.min(1, (totalSamples - i) / (SYNTH_AUDIO_SAMPLE_RATE * 0.08));
    const sample = Math.sin(2 * Math.PI * freq * t) * amplitude * envelope;
    const int16 = Math.max(-1, Math.min(1, sample)) * 32767;
    bytes.writeInt16LE(int16 | 0, i * 2);
  }

  return bytes.toString("base64");
}

function estimateSyntheticAudioSeconds(text: string): number {
  const charCount = (text || "").trim().length;
  const estimate = Math.max(1.2, charCount * 0.11);
  return Math.min(8, estimate);
}

function sendAudioStream(client: DownstreamClient, traceId: string, base64Audio: string): void {
  const chunks = splitBase64(base64Audio, SYNTH_AUDIO_CHUNK_BASE64_SIZE);
  chunks.forEach((chunk, index) => {
    setTimeout(() => {
      sendEnvelope(client.ws, CODE.AUDIO_STREAM_CHUNK, EVENT.AUDIO_STREAM, {
        audio_trace_id: traceId,
        audio_chunk: chunk,
        chunk_num: index + 1,
      }, "音频流");
    }, index * 85);
  });

  setTimeout(() => {
    sendEnvelope(client.ws, CODE.AUDIO_STREAM_END, EVENT.AUDIO_STREAM, {
      audio_trace_id: traceId,
      audio_stream_end: true,
    }, "音频流结束");
  }, chunks.length * 85 + 60);
}

function clearPendingFallback(client: DownstreamClient): void {
  if (client.pendingChatFallback) {
    clearTimeout(client.pendingChatFallback);
    client.pendingChatFallback = null;
  }
}

function normalizeActionTime(actions?: LobsterAction[]): number[] {
  if (!actions) return [];
  return actions.map((x) => {
    if (!Number.isFinite(x.startMs)) return 0;
    return Math.max(0, Math.floor(Number(x.startMs) / 1000));
  });
}

function toCompatActions(actions?: LobsterAction[]): Array<{ id: number; action: string; group_name: string; is_interact: boolean }> {
  if (!Array.isArray(actions)) return [];
  return actions.map((item, index) => ({
    id: index + 1,
    action: typeof item.name === "string" && item.name.trim() ? item.name : "IDLE_STD_011_1_body",
    group_name: typeof item.name === "string" && item.name.trim() ? item.name : "auto_generated",
    is_interact: false,
  }));
}

function sendChatEnvelope(client: DownstreamClient, result: LlmResult, msg = "获取消息成功"): void {
  const traceId = crypto.randomUUID();
  const action = toCompatActions(result.actions);
  const audioLength = estimateSyntheticAudioSeconds(result.text);
  const audioBase64 = generateSyntheticPcmBase64(audioLength);
  sendEnvelope(client.ws, CODE.CHAT_SUCCESS, EVENT.CHAT, {
    text: result.text,
    emotion: result.emotion ?? "calm",
    action,
    action_time: normalizeActionTime(result.actions),
    subtitle_timeline: result.subtitleTimeline ?? [],
    audio_trace_id: traceId,
    audio_length: Number(audioLength.toFixed(2)),
  }, msg);
  sendAudioStream(client, traceId, audioBase64);
}

function sendSyntheticChat(client: DownstreamClient, _userText: string): void {
  const replyText = "抱歉，我刚刚走神了，请再说一次。";
  sendChatEnvelope(client, {
    text: replyText,
    emotion: "calm",
    actions: [{ name: "IDLE_STD_011_1_body", startMs: 0, durationMs: 1200, intensity: 0.3 }],
    subtitleTimeline: [{ text: replyText, startMs: 0, endMs: 1800 }],
  }, "chat synthetic fallback");
}

function normalizeSceneEventData(event: string, eventData: any): any {
  if (!eventData || typeof eventData !== "object") return eventData;

  if (event === EVENT.UPDATE_UNLOCKED) {
    return normalizeAvailableLocations(eventData);
  }

  if (event !== EVENT.INITIAL_SCENE && event !== EVENT.SCENE_CHANGE && event !== EVENT.SCENE_AUTO_UPDATE) {
    return eventData;
  }

  const cloned = JSON.parse(JSON.stringify(eventData));
  const sceneInfo = cloned.scene_info && typeof cloned.scene_info === "object" ? cloned.scene_info : {};
  const normalizedAvailable = normalizeAvailableLocations(cloned.available_locations ?? sceneInfo.available_locations);
  const normalizedPlayer = normalizeLocationKey(sceneInfo.player_location ?? cloned.player_location);
  const normalizedAi = normalizeLocationKey(sceneInfo.ai_location ?? cloned.ai_location);

  if (normalizedPlayer) {
    cloned.player_location = normalizedPlayer;
    sceneInfo.player_location = normalizedPlayer;
    normalizedAvailable[normalizedPlayer] = true;
  }
  if (normalizedAi) {
    cloned.ai_location = normalizedAi;
    sceneInfo.ai_location = normalizedAi;
    normalizedAvailable[normalizedAi] = true;
  }

  sceneInfo.available_locations = normalizedAvailable;
  cloned.available_locations = normalizedAvailable;
  cloned.scene_info = sceneInfo;
  return cloned;
}

function normalizeUpstreamPayload(payload: any): any | null {
  if (!payload || typeof payload !== "object") return null;
  const cloned = JSON.parse(JSON.stringify(payload));
  if (cloned.code === 5001) cloned.code = CODE.AUDIO_STREAM_CHUNK;
  if (cloned.code === 5002) cloned.code = CODE.AUDIO_STREAM_END;

  if (cloned.data?.event) {
    cloned.data.event_data = normalizeSceneEventData(cloned.data.event, cloned.data.event_data);
    return cloned;
  }

  if (cloned.event) {
    const normalizedEventData = normalizeSceneEventData(cloned.event, cloned.event_data ?? cloned.data ?? {});
    return {
      code: cloned.code ?? CODE.CHAT_SUCCESS,
      msg: cloned.msg ?? "upstream",
      data: {
        event: cloned.event,
        event_data: normalizedEventData,
      },
    };
  }
  return null;
}

function openUpstream(client: DownstreamClient): void {
  if (!config.upstream.enabled || !config.upstream.wsUrl) return;

  try {
    const upstream = new WebSocket(config.upstream.wsUrl, {
      headers: config.upstream.headers,
      handshakeTimeout: config.upstream.connectTimeoutMs,
    });
    client.upstream = upstream;

    upstream.on("open", () => log("upstream connected"));
    upstream.on("message", (raw: RawData) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString();
        const parsed = JSON.parse(text);
        const normalized = normalizeUpstreamPayload(parsed);
        if (!normalized) return;
        if (normalized.data?.event === EVENT.CHAT && normalized.code === CODE.CHAT_SUCCESS) {
          clearPendingFallback(client);
        }
        sendJson(client.ws, normalized);
      } catch (error) {
        log("upstream message parse failed:", error);
      }
    });
    upstream.on("close", () => {
      log("upstream closed");
      client.upstream = null;
    });
    upstream.on("error", (error) => log("upstream error:", error));
  } catch (error) {
    log("upstream connect failed:", error);
  }
}

function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function parseLlmContent(raw: string): LlmResult | null {
  const trimmed = raw.trim();
  const direct = safeJsonParse<any>(trimmed, null);
  if (direct && typeof direct.text === "string") return direct as LlmResult;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const maybe = safeJsonParse<any>(trimmed.slice(start, end + 1), null);
    if (maybe && typeof maybe.text === "string") return maybe as LlmResult;
  }
  return null;
}

async function generateAiGfCoreReply(session: SessionState, userText: string): Promise<LlmResult> {
  if (!config.aiGfCore.enabled) throw new Error("ai-gf-core disabled");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, config.aiGfCore.timeoutMs));
  try {
    const token = session.token;
    const base = config.aiGfCore.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };
    if (config.aiGfCore.token) {
      headers["x-gateway-token"] = config.aiGfCore.token;
    }

    const res = await fetch(`${base}/api/ai-gf/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: userText }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`ai-gf-core http ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const payload = data?.data ?? {};
    return {
      text: typeof payload.text === "string" ? payload.text : "……我在呢。",
      emotion: typeof payload.emotion === "string" ? payload.emotion : "calm",
      actions: Array.isArray(payload.actions) ? payload.actions : [],
      subtitleTimeline: Array.isArray(payload.subtitleTimeline) ? payload.subtitleTimeline : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function generateLlmReply(session: SessionState, userText: string): Promise<LlmResult> {
  if (!config.llm.enabled) throw new Error("llm disabled");

  session.history.push({ role: "user", content: userText });
  trimHistory(session);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.requestTimeoutMs);
  try {
    const res = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: config.llm.temperature,
        max_tokens: config.llm.maxTokens,
        response_format: { type: "json_object" },
        messages: session.history,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`llm http ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("llm returned empty content");

    const parsed = parseLlmContent(content);
    if (!parsed) throw new Error("llm content is not valid lobster JSON");

    const result: LlmResult = {
      text: parsed.text,
      emotion: parsed.emotion ?? "calm",
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      subtitleTimeline: Array.isArray(parsed.subtitleTimeline) ? parsed.subtitleTimeline : [],
    };

    session.history.push({ role: "assistant", content: JSON.stringify(result) });
    trimHistory(session);
    touchSession(session);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function handleChat(client: DownstreamClient, data: any): Promise<void> {
  if (config.enableUserNameFlow && !client.session.userNameReady) {
    sendEnvelope(client.ws, CODE.REQ_SET_USER_NAME, EVENT.REQUEST_USER_NAME, {
      question: "Please input your name",
      audio: "",
      action: [],
    }, "need user name");
    return;
  }

  const userText = typeof data?.text === "string" ? data.text : "";

  if (client.upstream && client.upstream.readyState === WebSocket.OPEN) {
    clearPendingFallback(client);
    client.upstream.send(JSON.stringify({ event: EVENT.CHAT, data }));
    if (config.syntheticChatFallbackMs > 0) {
      client.pendingChatFallback = setTimeout(() => {
        sendSyntheticChat(client, userText);
        client.pendingChatFallback = null;
      }, config.syntheticChatFallbackMs);
    }
    return;
  }

  if (config.aiGfCore.enabled) {
    try {
      const result = await generateAiGfCoreReply(client.session, userText);
      sendChatEnvelope(client, result, "chat ai-gf-core");
      return;
    } catch (error) {
      log("ai-gf-core failed, try llm/synthetic:", error);
    }
  }

  if (config.llm.enabled) {
    try {
      const result = await generateLlmReply(client.session, userText);
      sendChatEnvelope(client, result, "chat llm");
      return;
    } catch (error) {
      log("llm failed, fallback synthetic:", error);
    }
  }

  sendSyntheticChat(client, userText);
}

function handleSceneChange(client: DownstreamClient, data: any): void {
  const location = normalizeLocationKey(data?.location);
  if (!location || !client.session.scene.availableLocations[location]) {
    sendEnvelope(client.ws, CODE.SCENE_CHANGE_FAILURE, EVENT.SCENE_CHANGE, { error: "invalid location" }, "scene change failed");
    return;
  }

  client.session.scene.playerLocation = location;
  client.session.scene.availableLocations[location] = true;
  touchSession(client.session);

  const sceneInfo = buildSceneInfo(client.session);
  const payload = {
    player_location: sceneInfo.scene_info.player_location,
    ai_location: sceneInfo.scene_info.ai_location,
    available_locations: sceneInfo.available_locations,
    scene_info: sceneInfo.scene_info,
    days: client.session.loginDays,
  };

  sendEnvelope(client.ws, CODE.SCENE_CHANGE_SUCCESS, EVENT.SCENE_CHANGE, payload, "场景切换成功");
  sendSceneAutoUpdate(client);
  sendUpdateUnlocked(client);
}

function handleChangeOutfit(client: DownstreamClient, data: any): void {
  const next = { ...client.session.outfit };
  const keys: Array<keyof OutfitState> = ["top", "bottom", "dress", "socks", "shoes", "hat"];
  keys.forEach((k) => {
    if (data?.[k] !== undefined && data?.[k] !== null) next[k] = String(data[k]);
  });
  client.session.outfit = next;
  touchSession(client.session);

  sendEnvelope(client.ws, CODE.CHANGE_OUTFIT_SUCCESS, EVENT.CHANGE_OUTFIT, {
    success: true,
    ...client.session.outfit,
  }, "change outfit success");
  sendOutfitInfo(client);
}

function handleSetUserName(client: DownstreamClient, data: any): void {
  if (!config.enableUserNameFlow) {
    sendEnvelope(client.ws, CODE.SET_USER_NAME_FAILURE, EVENT.SET_USER_NAME, { error: "user name flow disabled" }, "set user name disabled");
    return;
  }

  const userName = typeof data?.user_name === "string" ? data.user_name.trim() : "";
  if (!userName) {
    sendEnvelope(client.ws, CODE.SET_USER_NAME_FAILURE, EVENT.SET_USER_NAME, { error: "user_name is required" }, "set user name failed");
    return;
  }

  client.session.userName = userName;
  client.session.userNameReady = true;
  touchSession(client.session);
  sendEnvelope(client.ws, CODE.SET_USER_NAME_SUCCESS, EVENT.SET_USER_NAME, { user_name: userName }, "set user name success");
}

async function handleDownstreamMessage(client: DownstreamClient, rawText: string): Promise<void> {
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    sendEnvelope(client.ws, CODE.CHAT_FAILURE, "unknown", { error: "invalid json" }, "invalid json");
    return;
  }

  const event = parsed?.event;
  const data = parsed?.data ?? {};

  switch (event) {
    case EVENT.CHAT:
      await handleChat(client, data);
      return;
    case EVENT.GET_OUTFIT_INFO:
      sendOutfitInfo(client);
      return;
    case EVENT.CHANGE_OUTFIT:
      handleChangeOutfit(client, data);
      return;
    case EVENT.GET_TRACKED_TASK:
      sendTrackedTask(client);
      return;
    case EVENT.SCENE_CHANGE:
      handleSceneChange(client, data);
      return;
    case EVENT.SET_USER_NAME:
      handleSetUserName(client, data);
      return;
    default:
      sendEnvelope(client.ws, CODE.CHAT_FAILURE, event || "unknown", { error: `unsupported event: ${event}` }, "unsupported event");
  }
}

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), sessions: sessions.size, llmEnabled: config.llm.enabled });
});

app.post("/api/v1/auth/login", (req, res) => {
  const steamId = typeof req.body?.steam_id === "string" ? req.body.steam_id.trim() : "";
  const token = crypto.randomUUID();
  const session = createSession(token);
  if (steamId) {
    session.userName = steamId;
    session.userId = steamId;
    session.userNameReady = true;
  }
  sessions.set(token, session);
  saveSessionsToDisk();

  res.json({
    code: CODE.LOGIN_SUCCESS,
    msg: "登录成功",
    data: {
      user: {
        username: session.userName,
        uid: session.userId,
      },
      token,
      token_type: "bearer",
    },
  });
});

app.get("/api/v1/index/info", (req, res) => {
  const session = getOrCreateSession(getTokenFromHeaders(req.headers));
  res.json({
    code: CODE.NEWGAME_SHOW_NEW_AND_CONTINUE_BUTTONS,
    msg: "显示新游戏和继续游戏",
    data: {
      show_continue: true,
      days: session.loginDays,
      lover: {
        lover_name: session.loverName,
        lover_id: session.loverId,
      },
    },
  });
});

app.get("/api/v1/index/continue-game", (req, res) => {
  const session = getOrCreateSession(getTokenFromHeaders(req.headers));
  res.json({
    code: CODE.CONTINUE_GAME_SUCCESS,
    msg: "继续游戏成功",
    data: {
      lover_id: session.loverId,
      favorability: session.favorability,
      opening_scene_completed: session.openingSceneCompleted,
      lover_name: session.loverName,
    },
  });
});

app.post("/api/v1/index/new-game", (req, res) => {
  const session = getOrCreateSession(getTokenFromHeaders(req.headers));
  const displayName = typeof req.body?.user_display_name === "string" ? req.body.user_display_name.trim() : "";
  if (displayName) {
    session.userName = displayName;
    session.userNameReady = true;
  }
  session.openingSceneCompleted = true;
  touchSession(session);

  res.json({
    code: CODE.NEWGAME_CREATE_SUCCESS,
    msg: "创建新游戏成功",
    data: {
      lover_id: session.loverId,
      favorability: session.favorability,
      opening_scene_completed: session.openingSceneCompleted,
      lover_name: session.loverName,
    },
  });
});

wsServer.on("connection", (ws, req) => {
  const session = getOrCreateSession(getTokenFromHeaders(req.headers));
  const client: DownstreamClient = { ws, session, upstream: null, pendingChatFallback: null };

  log(`downstream connected token=${session.token}`);
  openUpstream(client);

  setTimeout(() => {
    sendUpdateUnlocked(client);
    sendInitialScene(client);
  }, 80);

  ws.on("message", (raw: RawData) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    void handleDownstreamMessage(client, text);
  });

  ws.on("close", () => {
    clearPendingFallback(client);
    if (client.upstream) {
      try {
        client.upstream.close();
      } catch {
        // noop
      }
    }
    touchSession(client.session);
    log(`downstream closed token=${session.token}`);
  });

  ws.on("error", (error) => log("downstream error:", error));
});

loadSessionsFromDisk();

server.listen(config.port, config.host, () => {
  console.log(`[lobster-adapter] listening on ${config.host}:${config.port}`);
  console.log(`[lobster-adapter] ws: ws://${config.host}:${config.port}/api/v1/game/ws`);
  console.log(`[lobster-adapter] http: http://${config.host}:${config.port}/api/v1`);
  console.log(`[lobster-adapter] llm enabled: ${config.llm.enabled ? "yes" : "no"}`);
  console.log(`[lobster-adapter] session persist: ${resolvePersistPath()}`);
});

process.on("SIGINT", () => {
  saveSessionsToDisk();
  process.exit(0);
});
process.on("SIGTERM", () => {
  saveSessionsToDisk();
  process.exit(0);
});
