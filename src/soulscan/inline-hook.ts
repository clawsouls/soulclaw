/**
 * Inline SoulScan hook — runs SoulScan on workspace soul files after agent turn.
 * Fire-and-forget pattern matching dag-hook.ts / passive-memory.js.
 *
 * Gated: only runs when workspace has SOUL.md or soul.json.
 * Non-fatal: catches all errors, logs debug, returns empty on failure.
 */

import { existsSync } from "fs";
import { join } from "path";
import { scanSoul, type ScanResult } from "./engine.js";
import { formatSummary } from "./report.js";

const log = {
  debug: (...args: unknown[]) => {
    if (process.env["DEBUG"]?.includes("soulscan")) {
      console.log("[soulscan-inline]", ...args);
    }
  },
};

export interface InlineScanOptions {
  workspaceDir: string;
  sessionKey?: string;
  /** Minimum score threshold — below this triggers a warning (default: 30) */
  minScore?: number;
  /** Callback when scan completes with warnings */
  onWarning?: (summary: string, result: ScanResult) => void;
}

/**
 * Run SoulScan on workspace soul files.
 * Returns scan result or null if skipped/failed.
 */
export async function maybeInlineScan(options: InlineScanOptions): Promise<ScanResult | null> {
  try {
    const { workspaceDir } = options;
    if (!workspaceDir) {
      return null;
    }

    // Check if workspace has scannable soul files
    const hasSoulMd = existsSync(join(workspaceDir, "SOUL.md"));
    const hasSoulJson = existsSync(join(workspaceDir, "soul.json"));
    if (!hasSoulMd && !hasSoulJson) {
      log.debug("no SOUL.md or soul.json found, skipping scan");
      return null;
    }

    const result = await scanSoul(workspaceDir);
    const summary = formatSummary(result);
    const minScore = options.minScore ?? 30;

    log.debug(
      `scan complete: score=${result.score} warnings=${result.warnings.length} ` +
        `criticals=${result.criticals.length} session=${options.sessionKey ?? "?"}`,
    );

    if (result.score < minScore && options.onWarning) {
      options.onWarning(summary, result);
    }

    return result;
  } catch (err) {
    log.debug(`inline scan failed (non-fatal): ${String(err)}`);
    return null;
  }
}
