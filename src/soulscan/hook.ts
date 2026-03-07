/**
 * SoulScan Hook — Auto-scan trigger for soul file changes.
 * Provides integration points for OpenClaw's hook/event system.
 */

import { scanSoul, type ScanResult } from "./engine.ts";
import { formatSummary } from "./report.ts";

// ─── Types ───────────────────────────────────────────────

export interface ScanHookOptions {
  /** Minimum score to allow soul application (default: 30) */
  minScore?: number;
  /** Callback when scan completes */
  onScanComplete?: (result: ScanResult, soulDir: string) => void;
  /** Callback when a soul is blocked */
  onBlocked?: (result: ScanResult, soulDir: string) => void;
}

export interface ScanGateResult {
  allowed: boolean;
  result: ScanResult;
  summary: string;
}

// ─── Hook ────────────────────────────────────────────────

const DEFAULT_MIN_SCORE = 30;

/**
 * Gate function: scan a soul directory and decide whether to allow application.
 * Use this as the integration point when a soul is about to be applied.
 *
 * @returns ScanGateResult with allowed=false if score < minScore
 */
export async function scanGate(
  soulDir: string,
  options?: ScanHookOptions,
): Promise<ScanGateResult> {
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
  const result = await scanSoul(soulDir);
  const allowed = result.score >= minScore;
  const summary = formatSummary(result);

  if (options?.onScanComplete) {
    options.onScanComplete(result, soulDir);
  }

  if (!allowed && options?.onBlocked) {
    options.onBlocked(result, soulDir);
  }

  return { allowed, result, summary };
}

/**
 * Quick check: returns true if the soul passes the minimum score threshold.
 */
export async function isSoulSafe(soulDir: string, minScore?: number): Promise<boolean> {
  const result = await scanSoul(soulDir);
  return result.score >= (minScore ?? DEFAULT_MIN_SCORE);
}
