/**
 * Persona Drift Notifier — sends alerts via gateway session messaging.
 * Integrates with Telegram and other configured channels.
 */

import type { DriftResult } from "./drift-detector.js";
import type { EnforcementAction } from "./enforcer.js";

const log = {
  debug: (...args: unknown[]) => {
    if (process.env["DEBUG"]) {
      console.debug("[persona-notify]", ...args);
    }
  },
  warn: (...args: unknown[]) => console.warn("[persona-notify]", ...args),
};

export interface DriftNotification {
  score: number;
  method: string;
  action: string;
  sessionKey?: string;
  timestamp: number;
  details?: string;
}

/**
 * Send drift alert via gateway RPC.
 * Uses the gateway's message sending capability to notify configured channels.
 */
export async function notifyDrift(
  result: DriftResult,
  action: EnforcementAction,
  sessionKey?: string,
): Promise<void> {
  if (action.type === "none") {
    return;
  }

  const emoji = action.type === "severe-warning" ? "🚨" : "⚠️";
  const severity = action.type === "severe-warning" ? "SEVERE" : "WARNING";
  const message =
    `${emoji} **Persona Drift ${severity}**\n` +
    `Score: ${result.score.toFixed(3)} (method: ${result.method})\n` +
    `Session: ${sessionKey ?? "unknown"}\n` +
    `Action: ${action.type}\n` +
    (result.details ? `Details: ${result.details}\n` : "") +
    `Time: ${new Date(result.timestamp).toISOString()}`;

  // Try gateway RPC notification
  try {
    const port = process.env["OPENCLAW_GATEWAY_PORT"] ?? "18789";
    const url = `http://127.0.0.1:${port}/api/v1/notify`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        level: action.type === "severe-warning" ? "error" : "warn",
        source: "persona-drift",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      log.debug(`drift notification sent: ${severity} score=${result.score.toFixed(3)}`);
    } else {
      log.debug(`gateway notification returned ${response.status}, falling back to log`);
      // Fallback: just log it prominently
      console.warn(message);
    }
  } catch {
    // Gateway not available — log as fallback
    console.warn(message);
  }
}
