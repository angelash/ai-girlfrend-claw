import type { RuntimeContextLike } from "./types.js";

let runtimeRef: RuntimeContextLike | null = null;

export function setRuntime(runtime: RuntimeContextLike) {
  runtimeRef = runtime;
}

export function getRuntime(): RuntimeContextLike {
  if (!runtimeRef) throw new Error("ai-girlfriend runtime not initialized");
  return runtimeRef;
}
