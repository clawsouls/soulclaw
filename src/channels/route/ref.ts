import { normalizeOptionalAccountId } from "../../routing/account-id.js";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
  normalizeOptionalThreadValue,
} from "../../shared/string-coerce.js";
import type { ChatType } from "../chat-type.js";

export type ChannelRouteThreadKind = "topic" | "thread" | "reply";

export type ChannelRouteThreadSource = "explicit" | "target" | "session" | "turn";

export type ChannelRouteRef = {
  channel?: string;
  accountId?: string;
  target?: {
    to: string;
    rawTo?: string;
    chatType?: ChatType;
  };
  thread?: {
    id: string | number;
    kind?: ChannelRouteThreadKind;
    source?: ChannelRouteThreadSource;
  };
};

export type ChannelRouteRefInput = {
  channel?: unknown;
  accountId?: unknown;
  to?: unknown;
  rawTo?: unknown;
  chatType?: ChatType;
  threadId?: unknown;
  threadKind?: ChannelRouteThreadKind;
  threadSource?: ChannelRouteThreadSource;
};

export function normalizeRouteThreadId(value: unknown): string | number | undefined {
  return normalizeOptionalThreadValue(value);
}

export function stringifyRouteThreadId(value: unknown): string | undefined {
  const normalized = normalizeRouteThreadId(value);
  return normalized == null ? undefined : String(normalized);
}

export function normalizeChannelRouteRef(
  input?: ChannelRouteRefInput,
): ChannelRouteRef | undefined {
  if (!input) {
    return undefined;
  }
  const channel = normalizeLowercaseStringOrEmpty(input.channel);
  const accountId =
    typeof input.accountId === "string" ? normalizeOptionalAccountId(input.accountId) : undefined;
  const to = normalizeOptionalString(input.to);
  const rawTo = normalizeOptionalString(input.rawTo);
  const threadId = normalizeRouteThreadId(input.threadId);
  if (!channel && !to && !accountId && threadId == null) {
    return undefined;
  }
  return {
    ...(channel ? { channel } : {}),
    ...(accountId ? { accountId } : {}),
    ...(to
      ? {
          target: {
            to,
            ...(rawTo && rawTo !== to ? { rawTo } : {}),
            ...(input.chatType ? { chatType: input.chatType } : {}),
          },
        }
      : {}),
    ...(threadId != null
      ? {
          thread: {
            id: threadId,
            ...(input.threadKind ? { kind: input.threadKind } : {}),
            ...(input.threadSource ? { source: input.threadSource } : {}),
          },
        }
      : {}),
  };
}

export function channelRouteTarget(route?: ChannelRouteRef): string | undefined {
  return route?.target?.to;
}

export function channelRouteThreadId(route?: ChannelRouteRef): string | number | undefined {
  return route?.thread?.id;
}

function threadIdsEqual(left?: string | number, right?: string | number): boolean {
  const normalizedLeft = stringifyRouteThreadId(left);
  const normalizedRight = stringifyRouteThreadId(right);
  return normalizedLeft === normalizedRight;
}

function accountsCompatible(left?: string, right?: string): boolean {
  return !left || !right || left === right;
}

export function channelRoutesMatchExact(params: {
  left?: ChannelRouteRef | null;
  right?: ChannelRouteRef | null;
}): boolean {
  const { left, right } = params;
  if (!left || !right) {
    return false;
  }
  return (
    left.channel === right.channel &&
    left.accountId === right.accountId &&
    channelRouteTarget(left) === channelRouteTarget(right) &&
    threadIdsEqual(channelRouteThreadId(left), channelRouteThreadId(right))
  );
}

export function channelRoutesShareConversation(params: {
  left?: ChannelRouteRef | null;
  right?: ChannelRouteRef | null;
}): boolean {
  const { left, right } = params;
  if (!left || !right) {
    return false;
  }
  if (left.channel && right.channel && left.channel !== right.channel) {
    return false;
  }
  if (!accountsCompatible(left.accountId, right.accountId)) {
    return false;
  }
  if (channelRouteTarget(left) !== channelRouteTarget(right)) {
    return false;
  }
  const leftThreadId = channelRouteThreadId(left);
  const rightThreadId = channelRouteThreadId(right);
  if (leftThreadId == null || rightThreadId == null) {
    return true;
  }
  return threadIdsEqual(leftThreadId, rightThreadId);
}

export function channelRouteKey(route?: ChannelRouteRef): string | undefined {
  const normalized = normalizeChannelRouteRef({
    channel: route?.channel,
    accountId: route?.accountId,
    to: route?.target?.to,
    threadId: route?.thread?.id,
  });
  if (!normalized?.channel || !normalized.target?.to) {
    return undefined;
  }
  return [
    normalized.channel,
    normalized.target.to,
    normalized.accountId ?? "",
    stringifyRouteThreadId(normalized.thread?.id) ?? "",
  ].join("|");
}
