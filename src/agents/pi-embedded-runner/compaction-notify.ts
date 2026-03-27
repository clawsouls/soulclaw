/**
 * Compaction notification — sends a message to the active channel
 * after session compaction completes.
 *
 * Config: agents.defaults.compaction.notify (boolean, default: true)
 * Users can opt out via config or onboarding.
 */

import type { OpenClawConfig } from "../../config/config.js";
import { enqueueDelivery } from "../../infra/outbound/delivery-queue.js";

interface CompactionInfo {
  sessionKey: string;
  compactedCount: number;
  messageCount: number;
  phase?: "before" | "after";
}

interface NotifyContext {
  config?: OpenClawConfig;
  channel?: string;
  chatId: string;
  sessionFile?: string;
  log: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Send a compaction notification to the user's active channel.
 * Non-blocking, best-effort — failures are logged but never thrown.
 */
export async function notifyCompaction(info: CompactionInfo, ctx: NotifyContext): Promise<void> {
  try {
    ctx.log.info("[compaction-notify] notifyCompaction called", {
      phase: info.phase,
      sessionKey: info.sessionKey,
      messageCount: info.messageCount,
      hasSessionFile: !!ctx.sessionFile,
      channel: ctx.channel,
    });

    // Check config: compaction.notify (default: true)
    const notify = (ctx.config as Record<string, unknown> | undefined)?.agents
      ? getNotifySetting(ctx.config)
      : true;

    if (!notify) {
      ctx.log.info("[compaction-notify] notify disabled in config, skipping");
      return;
    }

    // Determine channel
    const channel = ctx.channel || detectActiveChannel(ctx.config);
    if (!channel) {
      ctx.log.info("[compaction-notify] No active channel detected, skipping notification");
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleString("en-US", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const text =
      info.phase === "before"
        ? `📦 Compaction starting — ${info.messageCount} messages will be summarized (${timeStr})`
        : `📦 Compaction complete — ${info.compactedCount} messages compacted (${info.messageCount} remaining) at ${timeStr}`;

    // Resolve the chat target from session key, config, or session file
    const to = resolveNotifyTarget(info.sessionKey, ctx.config, channel, ctx.sessionFile);
    ctx.log.info("[compaction-notify] resolveNotifyTarget result", {
      to: to ?? "undefined",
      sessionKey: info.sessionKey,
      sessionFile: ctx.sessionFile ?? "undefined",
    });
    if (!to) {
      ctx.log.info("[compaction-notify] No notification target resolved, skipping");
      return;
    }

    await enqueueDelivery({
      channel,
      to,
      payloads: [{ text }],
      bestEffort: true,
      silent: true,
    });

    ctx.log.info(`[compaction-notify] Notification enqueued to ${channel}:${to}`);
  } catch (err) {
    ctx.log.warn("[compaction-notify] Failed to send notification", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function getNotifySetting(config?: OpenClawConfig): boolean {
  if (!config) {
    return true;
  }
  // Navigate: agents.defaults.compaction.notify
  const agents = (config as Record<string, unknown>).agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const compaction = defaults?.compaction as Record<string, unknown> | undefined;
  const notify = compaction?.notify;
  // Default: true
  return notify !== false;
}

function detectActiveChannel(config?: OpenClawConfig): string | undefined {
  if (!config) {
    return undefined;
  }
  const channels = (config as Record<string, unknown>).channels as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!channels) {
    return undefined;
  }

  // Check known channels in priority order
  const knownChannels = [
    "telegram",
    "discord",
    "signal",
    "slack",
    "whatsapp",
    "imessage",
    "googlechat",
  ];
  for (const ch of knownChannels) {
    if (channels[ch]?.enabled !== false && channels[ch]?.botToken) {
      return ch;
    }
  }
  return undefined;
}

function resolveNotifyTarget(
  sessionKey: string,
  config?: OpenClawConfig,
  channel?: string,
  sessionFile?: string,
): string | undefined {
  // Extract chat ID from session key if possible
  // Session key format: "agent:main:telegram:12345678" or similar
  const parts = sessionKey.split(":");
  if (parts.length >= 4) {
    return parts[3]; // chat ID
  }

  // Fallback: try to get from config
  if (config && channel) {
    const channels = (config as Record<string, unknown>).channels as
      | Record<string, Record<string, unknown>>
      | undefined;
    const channelConfig = channels?.[channel];
    const configChatId = (channelConfig?.notifyChatId || channelConfig?.chatId) as
      | string
      | undefined;
    if (configChatId) {
      return configChatId;
    }
  }

  // Last resort: read session file to find chat ID from recent user message
  if (sessionFile && channel) {
    return extractChatIdFromSession(sessionFile, channel);
  }

  return undefined;
}

function extractChatIdFromSession(sessionFile: string, _channel: string): string | undefined {
  try {
    const { existsSync, readFileSync } = require("fs") as typeof import("fs");
    if (!existsSync(sessionFile)) {
      return undefined;
    }

    const content = readFileSync(sessionFile, "utf-8");
    const lines = content.trim().split("\n");

    // Scan from end for most recent user message with sender_id in inbound metadata
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      // Fast pre-check before JSON parse
      if (!line.includes("sender_id") && !line.includes("chat_id")) {
        continue;
      }

      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message") {
          continue;
        }

        // Session JSONL stores messages as { type: "message", message: { role, content } }
        const msg = entry.message;
        if (!msg || msg.role !== "user") {
          continue;
        }

        // The inbound metadata is embedded in message content text as JSON blocks
        const contentArr = Array.isArray(msg.content) ? msg.content : [];
        for (const part of contentArr) {
          if (part.type !== "text" || typeof part.text !== "string") {
            continue;
          }

          // Extract sender_id from "Conversation info" or "Sender" metadata blocks
          const senderMatch = part.text.match(/"sender_id"\s*:\s*"(\d+)"/);
          if (senderMatch) {
            return senderMatch[1];
          }

          // Also try chat_id pattern
          const chatMatch = part.text.match(/"chat_id"\s*:\s*"([^"]+)"/);
          if (chatMatch) {
            return chatMatch[1];
          }
        }
      } catch {
        // Invalid JSON line, skip
      }
    }
  } catch {
    // Silent fail - notification is best effort
  }

  return undefined;
}
