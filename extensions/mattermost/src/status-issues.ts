// Mattermost plugin module implements status issue collection.
import type {
  ChannelAccountSnapshot,
  ChannelStatusIssue,
} from "openclaw/plugin-sdk/channel-contract";
import {
  coerceStatusIssueAccountId,
  readStatusIssueFields,
} from "openclaw/plugin-sdk/extension-shared";

const MATTERMOST_STATUS_FIELDS = [
  "accountId",
  "enabled",
  "configured",
  "dmPolicy",
  "allowFrom",
] as const;

function hasWildcardAllowFrom(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => String(entry).trim() === "*");
}

export function collectMattermostStatusIssues(
  accounts: ChannelAccountSnapshot[],
): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];
  for (const entry of accounts) {
    const account = readStatusIssueFields(entry, MATTERMOST_STATUS_FIELDS);
    if (!account) {
      continue;
    }
    const accountId = coerceStatusIssueAccountId(account.accountId) ?? "default";
    const enabled = account.enabled !== false;
    const configured = account.configured === true;
    if (!enabled || !configured) {
      continue;
    }

    if (account.dmPolicy === "open" && !hasWildcardAllowFrom(account.allowFrom)) {
      issues.push({
        channel: "mattermost",
        accountId,
        kind: "config",
        message:
          'Mattermost dmPolicy is "open" but allowFrom does not include "*"; public DMs will be dropped.',
        fix: 'Add "*" to channels.mattermost.allowFrom (or the account-specific allowFrom) or set dmPolicy to "pairing"/"allowlist".',
      });
    }
  }
  return issues;
}
