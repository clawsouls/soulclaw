const MODELS_JSON_STATE_KEY = Symbol.for("openclaw.modelsJsonState");

type ModelsJsonState = {
  writeLocks: Map<string, Promise<void>>;
  readyCache: Map<
    string,
    Promise<{ fingerprint: string; result: { agentDir: string; wrote: boolean } }>
  >;
  /**
   * Cross-config noop cache: when planOpenClawModelsJson returns "noop" (no write
   * needed), the result is valid for all callers regardless of config differences,
   * as long as models.json has not changed (same mtime). This avoids redundant
   * planOpenClawModelsJson runs when multiple agents with slightly different configs
   * (e.g. main agent vs subagent) call ensureOpenClawModelsJson concurrently.
   */
  noopCache: Map<string, { mtime: number | null; result: { agentDir: string; wrote: boolean } }>;
};

export const MODELS_JSON_STATE = (() => {
  const globalState = globalThis as typeof globalThis & {
    [MODELS_JSON_STATE_KEY]?: ModelsJsonState;
  };
  if (!globalState[MODELS_JSON_STATE_KEY]) {
    globalState[MODELS_JSON_STATE_KEY] = {
      writeLocks: new Map<string, Promise<void>>(),
      readyCache: new Map<
        string,
        Promise<{ fingerprint: string; result: { agentDir: string; wrote: boolean } }>
      >(),
      noopCache: new Map(),
    };
  }
  // Schema migration: add noopCache if missing (e.g. after in-process restart with old state)
  if (!globalState[MODELS_JSON_STATE_KEY].noopCache) {
    globalState[MODELS_JSON_STATE_KEY].noopCache = new Map();
  }
  return globalState[MODELS_JSON_STATE_KEY];
})();

export function resetModelsJsonReadyCacheForTest(): void {
  MODELS_JSON_STATE.writeLocks.clear();
  MODELS_JSON_STATE.readyCache.clear();
  MODELS_JSON_STATE.noopCache.clear();
}
