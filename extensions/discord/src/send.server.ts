// Discord plugin module implements server management REST actions.
import { resolveDiscordRest } from "./send.shared.js";
import type { DiscordReactOpts } from "./send.types.js";

function body(values: Record<string, unknown>) {
  return { body: values };
}

export async function fetchGuildSettingsDiscord(guildId: string, opts: DiscordReactOpts) {
  return await resolveDiscordRest(opts).get(`/guilds/${guildId}`);
}

export async function editGuildSettingsDiscord(
  guildId: string,
  values: Record<string, unknown>,
  opts: DiscordReactOpts,
) {
  return await resolveDiscordRest(opts).patch(`/guilds/${guildId}`, body(values));
}

export async function listGuildRolesDiscord(guildId: string, opts: DiscordReactOpts) {
  return await resolveDiscordRest(opts).get(`/guilds/${guildId}/roles`);
}

export async function createGuildRoleDiscord(
  guildId: string,
  values: Record<string, unknown>,
  opts: DiscordReactOpts,
) {
  return await resolveDiscordRest(opts).post(`/guilds/${guildId}/roles`, body(values));
}

export async function editGuildRoleDiscord(
  guildId: string,
  roleId: string,
  values: Record<string, unknown>,
  opts: DiscordReactOpts,
) {
  return await resolveDiscordRest(opts).patch(`/guilds/${guildId}/roles/${roleId}`, body(values));
}

export async function deleteGuildRoleDiscord(
  guildId: string,
  roleId: string,
  opts: DiscordReactOpts,
) {
  await resolveDiscordRest(opts).delete(`/guilds/${guildId}/roles/${roleId}`);
  return { ok: true, guildId, roleId };
}

export async function listAutoModerationRulesDiscord(guildId: string, opts: DiscordReactOpts) {
  return await resolveDiscordRest(opts).get(`/guilds/${guildId}/auto-moderation/rules`);
}

export async function createAutoModerationRuleDiscord(
  guildId: string,
  values: Record<string, unknown>,
  opts: DiscordReactOpts,
) {
  return await resolveDiscordRest(opts).post(
    `/guilds/${guildId}/auto-moderation/rules`,
    body(values),
  );
}

export async function editAutoModerationRuleDiscord(
  guildId: string,
  ruleId: string,
  values: Record<string, unknown>,
  opts: DiscordReactOpts,
) {
  return await resolveDiscordRest(opts).patch(
    `/guilds/${guildId}/auto-moderation/rules/${ruleId}`,
    body(values),
  );
}

export async function deleteAutoModerationRuleDiscord(
  guildId: string,
  ruleId: string,
  opts: DiscordReactOpts,
) {
  await resolveDiscordRest(opts).delete(`/guilds/${guildId}/auto-moderation/rules/${ruleId}`);
  return { ok: true, guildId, ruleId };
}

export async function listChannelWebhooksDiscord(channelId: string, opts: DiscordReactOpts) {
  return await resolveDiscordRest(opts).get(`/channels/${channelId}/webhooks`);
}

export async function createChannelWebhookDiscord(
  channelId: string,
  values: Record<string, unknown>,
  opts: DiscordReactOpts,
) {
  return await resolveDiscordRest(opts).post(`/channels/${channelId}/webhooks`, body(values));
}

export async function editWebhookDiscord(
  webhookId: string,
  values: Record<string, unknown>,
  opts: DiscordReactOpts,
) {
  return await resolveDiscordRest(opts).patch(`/webhooks/${webhookId}`, body(values));
}

export async function deleteWebhookDiscord(webhookId: string, opts: DiscordReactOpts) {
  await resolveDiscordRest(opts).delete(`/webhooks/${webhookId}`);
  return { ok: true, webhookId };
}
