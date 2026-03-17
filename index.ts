import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { setRuntime } from "./src/runtime.js";
import { handleAiGirlfriendHttpRequest } from "./src/http.js";
import { startAdapterService, stopAdapterService } from "./src/adapter-service.js";

const ROUTES = [
  "/api/ai-gf/health",
  "/api/ai-gf/session/login",
  "/api/ai-gf/session/info",
  "/api/ai-gf/chat",
] as const;

const plugin = {
  id: "ai-girlfriend",
  name: "AI女友对接",
  description: "Gateway-integrated core for AI girlfriend workflow",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setRuntime(api.runtime as any);
    const apiAny = api as any;

    api.registerService({
      id: "ai-gf-embedded-lobster-adapter",
      start: async () => startAdapterService(api.logger as any),
      stop: async () => stopAdapterService(api.logger as any),
    });

    if (typeof apiAny.registerHttpRoute === "function") {
      for (const path of ROUTES) {
        apiAny.registerHttpRoute({ path, auth: "plugin", match: "exact", handler: handleAiGirlfriendHttpRequest });
      }
      return;
    }
    if (typeof apiAny.registerHttpHandler === "function") {
      apiAny.registerHttpHandler(handleAiGirlfriendHttpRequest);
    }
  },
};

export default plugin;
