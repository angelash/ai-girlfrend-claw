export type Role = "system" | "user" | "assistant";

export interface RuntimeContextLike {
  logger?: {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
  subagent?: {
    run?: (params: { sessionKey: string; message: string; deliver?: boolean; extraSystemPrompt?: string }) => Promise<{ runId: string }>;
    waitForRun?: (params: { runId: string; timeoutMs?: number }) => Promise<{ status: "ok" | "error" | "timeout"; error?: string }>;
    getSessionMessages?: (params: { sessionKey: string; limit?: number }) => Promise<{ messages: unknown[] }>;
  };
}

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface GfSession {
  token: string;
  userId: string;
  userName: string;
  history: ChatMessage[];
  updatedAt: number;
}

export interface GfReply {
  text: string;
  emotion?: string;
  actions?: Array<{ name: string; startMs?: number; durationMs?: number; intensity?: number }>;
  subtitleTimeline?: Array<{ text: string; startMs: number; endMs: number }>;
}
