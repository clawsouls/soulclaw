/**
 * Inline SoulScan — fire-and-forget soul scanning after agent turns.
 * Scans workspace directory for soul file integrity.
 * Non-fatal: errors are caught and logged.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanSoul, type ScanResult } from "./engine.ts";
import { formatSummary } from "./report.ts";

const log = {
  debug: (...args: unknown[]) => {
    if (process.env["DEBUG"]) {
      console.debug("[soulscan]", ...args);
    }
  },
  warn: (...args: unknown[]) => console.warn("[soulscan]", ...args),
};

export interface InlineScanOptions {
  /** Workspace directory containing soul files */
  workspaceDir?: string;
  /** Session key for logging context */
  sessionKey?: string;
  /** Minimum score to pass (default: 30) */
  minScore?: number;
  /** Callback when scan detects issues */
  onIssuesDetected?: (result: ScanResult, summary: string) => void;
}

/** Rate-limit: don't scan more than once per 5 minutes per workspace */
const _lastScanTime = new Map<string, number>();
const SCAN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Run SoulScan on the workspace directory after an agent turn.
 * Fire-and-forget — never throws.
 */
export async function maybeInlineScan(options: InlineScanOptions): Promise<void> {
  const { workspaceDir, sessionKey, minScore = 30 } = options;
  if (!workspaceDir) {
    return;
  }

  // Rate-limit scanning
  const now = Date.now();
  const lastScan = _lastScanTime.get(workspaceDir) ?? 0;
  if (now - lastScan < SCAN_INTERVAL_MS) {
    log.debug(`skipping scan — last scan ${Math.round((now - lastScan) / 1000)}s ago`);
    return;
  }

  // Check if workspace has soul files worth scanning
  const hasSoulMd = existsSync(join(workspaceDir, "SOUL.md"));
  const hasSoulJson = existsSync(join(workspaceDir, "soul.json"));
  if (!hasSoulMd && !hasSoulJson) {
    log.debug("no soul files in workspace, skipping scan");
    return;
  }

  _lastScanTime.set(workspaceDir, now);

  try {
    const result = await scanSoul(workspaceDir);
    const summary = formatSummary(result);

    log.debug(
      `scan complete: score=${result.score} grade=${result.grade} issues=${result.issues.length} session=${sessionKey ?? "unknown"}`,
    );

    if (result.score < minScore) {
      log.warn(
        `soul integrity warning: score=${result.score} (min=${minScore}) session=${sessionKey ?? "unknown"}`,
      );
    }

    if (options.onIssuesDetected && result.issues.length > 0) {
      options.onIssuesDetected(result, summary);
    }
  } catch (err) {
    log.debug(`inline scan failed (non-fatal): ${String(err)}`);
  }
}
