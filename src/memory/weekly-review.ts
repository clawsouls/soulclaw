/**
 * Soul Memory — Weekly Review
 *
 * Runs promotion-detector automatically on Fridays (configurable).
 * Injects results into the heartbeat prompt so the agent can present
 * findings to the user without any manual CLI invocation.
 *
 * Default: enabled, runs on Fridays, scans last 7 days.
 * Users get this out-of-the-box with `npm i -g soulclaw`.
 */

import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { formatPromotionReport, scanForPromotionCandidates } from "./promotion-detector.js";

const log = createSubsystemLogger("weekly-review");

/** Day of week: 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday */
const DEFAULT_REVIEW_DAY = 5; // Friday

/** Track whether we've already run today (per workspace) to avoid repeats */
const ranToday = new Map<string, string>(); // workspace -> dateString

export interface WeeklyReviewOptions {
  /** Day of week to run (0-6, default: 5 = Friday) */
  reviewDay?: number;
  /** Number of days to look back (default: 7) */
  daysBack?: number;
  /** Minimum confidence threshold (default: 0.4) */
  minConfidence?: number;
  /** Disable weekly review entirely */
  disabled?: boolean;
}

/**
 * Build WeeklyReviewOptions from openclaw.json config.
 * Config path: agents.defaults.weeklyReview
 */
export function resolveWeeklyReviewOptions(cfg?: {
  agents?: { defaults?: { weeklyReview?: WeeklyReviewOptions } };
}): WeeklyReviewOptions {
  return cfg?.agents?.defaults?.weeklyReview ?? {};
}

/**
 * Check if today is review day and return promotion report if so.
 * Returns null if not review day, already ran today, or no candidates found.
 */
export async function maybeRunWeeklyReview(
  workspaceDir: string,
  options?: WeeklyReviewOptions,
): Promise<string | null> {
  if (options?.disabled) {
    return null;
  }

  const reviewDay = options?.reviewDay ?? DEFAULT_REVIEW_DAY;
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // Check if today is the review day
  if (now.getDay() !== reviewDay) {
    return null;
  }

  // Check if we already ran today for this workspace
  if (ranToday.get(workspaceDir) === today) {
    return null;
  }

  const memoryDir = path.join(workspaceDir, "memory");

  try {
    const candidates = await scanForPromotionCandidates(memoryDir, {
      daysBack: options?.daysBack ?? 7,
      minConfidence: options?.minConfidence ?? 0.4,
    });

    // Mark as ran today regardless of results
    ranToday.set(workspaceDir, today);

    if (candidates.length === 0) {
      log.info("Weekly review: no promotion candidates found");
      return null;
    }

    log.info(`Weekly review: ${candidates.length} promotion candidates found`);

    const report = formatPromotionReport(candidates);
    return [
      `\n## 📋 Weekly Soul Memory Review`,
      ``,
      `It's review day! The promotion detector found items in Working Memory (T2) that may belong in Core Memory (T1).`,
      `Review the candidates below and promote important ones to MEMORY.md or a topic file in memory/.`,
      ``,
      report,
    ].join("\n");
  } catch (err) {
    log.debug(`Weekly review failed (non-fatal): ${String(err)}`);
    return null;
  }
}
