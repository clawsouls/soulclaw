/**
 * Session start index hook handler
 *
 * Runs incremental memory index when a new agent session starts,
 * ensuring recent memory files are searchable immediately.
 */

import type { OpenClawConfig } from "../../../config/config.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";
import { isSessionStartEvent } from "../../internal-hooks.js";

const log = createSubsystemLogger("hooks/session-start-index");

const DEFAULT_TIMEOUT_MS = 5_000;

const handler: HookHandler = async (event) => {
  if (!isSessionStartEvent(event)) {
    return;
  }

  const { sessionId, sessionKey, cfg } = event.context;
  const typedCfg = cfg;

  const hookConfig = resolveHookConfig(typedCfg, "session-start-index");
  const timeoutMs =
    typeof hookConfig?.timeoutMs === "number" && hookConfig.timeoutMs > 0
      ? hookConfig.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), timeoutMs),
  );

  const indexPromise = (async () => {
    try {
      if (!typedCfg) {
        log.debug("No config available, skipping memory index", { sessionId });
        return;
      }

      const agentId = event.context.agentId ?? resolveAgentIdFromSessionKey(sessionKey) ?? "main";

      // Import memory manager dynamically to avoid circular deps
      const { MemoryIndexManager } = await import("../../../memory/index.js");
      const manager = await MemoryIndexManager.get({
        cfg: typedCfg,
        agentId,
      });

      if (!manager) {
        log.debug("Memory search not configured, skipping index", { sessionId });
        return;
      }

      const started = Date.now();
      await manager.sync({ reason: "session-start" });
      const elapsed = Date.now() - started;

      log.debug("Incremental memory index completed", {
        sessionId,
        elapsedMs: elapsed,
      });

      await manager.close();
    } catch (err) {
      // Never block session start — log and continue
      log.debug("Memory index failed (non-blocking)", {
        errorMessage: err instanceof Error ? err.message : String(err),
        sessionId,
      });
    }
  })();

  const result = await Promise.race([indexPromise, timeoutPromise]);
  if (result === "timeout") {
    log.debug("Memory index timed out, continuing session start", {
      sessionId,
      timeoutMs,
    });
  }
};

export default handler;
