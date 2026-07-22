/**
 * Inline Swarm Sync — fire-and-forget memory sync after agent turns.
 * Syncs workspace memory files to swarm repository when configured.
 * Non-fatal: errors are caught and logged.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { syncCycle, type SyncResult } from "./auto-sync.js";
import { resolveSwarmConfig, type SwarmConfig } from "./config.js";

const log = {
  debug: (...args: unknown[]) => {
    if (process.env["DEBUG"]) {
      console.debug("[swarm]", ...args);
    }
  },
  warn: (...args: unknown[]) => console.warn("[swarm]", ...args),
};

export interface InlineSyncOptions {
  /** Workspace directory */
  workspaceDir?: string;
  /** Session key for logging */
  sessionKey?: string;
  /** Partial swarm config overrides */
  swarmConfig?: Partial<SwarmConfig>;
  /** Callback on sync completion */
  onSyncComplete?: (result: SyncResult) => void;
}

/** Rate-limit: don't sync more than once per 10 minutes */
const _lastSyncTime = new Map<string, number>();
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Run swarm memory sync after an agent turn.
 * Fire-and-forget — never throws.
 */
export async function maybeSwarmSync(options: InlineSyncOptions): Promise<void> {
  const { workspaceDir, sessionKey } = options;
  if (!workspaceDir) {
    return;
  }

  // Check if swarm is configured
  const config = resolveSwarmConfig(options.swarmConfig);
  if (!config.swarmDir || !existsSync(config.swarmDir)) {
    log.debug("swarm directory not configured or missing, skipping sync");
    return;
  }

  // Check if swarm repo is initialized (has .git)
  if (!existsSync(join(config.swarmDir, ".git"))) {
    log.debug("swarm directory not a git repo, skipping sync");
    return;
  }

  // Rate-limit syncing
  const now = Date.now();
  const cacheKey = config.swarmDir;
  const lastSync = _lastSyncTime.get(cacheKey) ?? 0;
  if (now - lastSync < SYNC_INTERVAL_MS) {
    log.debug(`skipping sync — last sync ${Math.round((now - lastSync) / 1000)}s ago`);
    return;
  }

  _lastSyncTime.set(cacheKey, now);

  try {
    const result = await syncCycle(options.swarmConfig);

    log.debug(
      `swarm sync: action=${result.action} success=${result.success} session=${sessionKey ?? "unknown"}`,
    );

    if (result.conflicts && result.conflicts.length > 0) {
      log.warn(
        `swarm sync conflicts: ${result.conflicts.join(", ")} session=${sessionKey ?? "unknown"}`,
      );
    }

    if (options.onSyncComplete) {
      options.onSyncComplete(result);
    }
  } catch (err) {
    log.debug(`swarm sync failed (non-fatal): ${String(err)}`);
  }
}
