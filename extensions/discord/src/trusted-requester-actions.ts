// Discord guild-admin actions need a Discord sender identity for permission checks.
import type { ChannelMessageActionName } from "openclaw/plugin-sdk/channel-contract";

const trustedRequesterGuildAdminActions = new Set<string>([
  "emoji-upload",
  "sticker-upload",
  "role-add",
  "role-remove",
  "role-create",
  "role-edit",
  "role-delete",
  "server-edit",
  "automod-create",
  "automod-edit",
  "automod-delete",
  "webhook-create",
  "webhook-edit",
  "webhook-delete",
  "channel-create",
  "channel-edit",
  "channel-delete",
  "channel-move",
  "category-create",
  "category-edit",
  "category-delete",
  "event-create",
  "timeout",
  "kick",
  "ban",
]);

export function isTrustedRequesterGuildAdminAction(action: ChannelMessageActionName): boolean {
  return trustedRequesterGuildAdminActions.has(action);
}
