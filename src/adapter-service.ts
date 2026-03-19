import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let child: ChildProcess | null = null;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(HERE, "..");
const ADAPTER_DIR = path.join(EXT_ROOT, "vendor", "lobster-adapter");

export function startAdapterService(log?: { info?: (...args: any[]) => void; warn?: (...args: any[]) => void; error?: (...args: any[]) => void }) {
  if (child && !child.killed) return;

  const entry = path.join(ADAPTER_DIR, "dist/server.js");
  if (!fs.existsSync(entry)) {
    log?.error?.("[ai-gf] adapter dist/server.js not found", { entry });
    return;
  }

  child = spawn("node", ["dist/server.js"], {
    cwd: ADAPTER_DIR,
    stdio: "ignore",
    detached: false,
  });

  child.on("exit", (code, signal) => {
    log?.warn?.("[ai-gf] embedded lobster adapter exited", { code, signal });
    child = null;
  });

  log?.info?.("[ai-gf] embedded lobster adapter started", { pid: child.pid, cwd: ADAPTER_DIR });
}

export function stopAdapterService(log?: { info?: (...args: any[]) => void; warn?: (...args: any[]) => void; error?: (...args: any[]) => void }) {
  if (!child) return;
  try {
    child.kill("SIGTERM");
    log?.info?.("[ai-gf] embedded lobster adapter stopped", { pid: child.pid });
  } catch (error) {
    log?.warn?.("[ai-gf] failed to stop embedded lobster adapter", { error: String(error) });
  }
  child = null;
}
