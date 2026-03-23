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
    // Check config: compaction.notify (default: true)
    const notify = (ctx.config as Record<string, unknown> | undefined)?.agents
      ? getNotifySetting(ctx.config)
      : true;

    if (!notify) {
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

    // Resolve the chat target from session key or config
    const to = resolveNotifyTarget(info.sessionKey, ctx.config, channel);
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
): string | undefined {
  // Extract chat ID from session key if possible
  // Session key format: "agent:main:telegram:12345678" or similar
  const parts = sessionKey.split(":");
  if (parts.length >= 4) {
    return parts[3]; // chat ID
  }

  // Fallback: try to get from config
  if (!config || !channel) {
    return undefined;
  }
  const channels = (config as Record<string, unknown>).channels as
    | Record<string, Record<string, unknown>>
    | undefined;
  const channelConfig = channels?.[channel];
  // Some channels have a default chat/notify target
  return (channelConfig?.notifyChatId || channelConfig?.chatId) as string | undefined;
}
