import {
  normalizeOptionalString,
  normalizeOptionalThreadValue,
} from "../../shared/string-coerce.js";
import type { ChatType } from "../chat-type.js";
import {
  channelRoutesMatchExact,
  channelRoutesShareConversation,
  normalizeChannelRouteRef,
} from "../route/ref.js";
import { getLoadedChannelPluginForRead } from "./registry-loaded-read.js";

export type ParsedChannelExplicitTarget = {
  to: string;
  threadId?: string | number;
  chatType?: ChatType;
};

export type ComparableChannelTarget = {
  rawTo: string;
  to: string;
  threadId?: string | number;
  chatType?: ChatType;
};

export function parseExplicitTargetForLoadedChannel(
  channel: string,
  rawTarget: string,
): ParsedChannelExplicitTarget | null {
  const resolvedChannel = normalizeOptionalString(channel);
  if (!resolvedChannel) {
    return null;
  }
  return (
    getLoadedChannelPluginForRead(resolvedChannel)?.messaging?.parseExplicitTarget?.({
      raw: rawTarget,
    }) ?? null
  );
}

export function resolveComparableTargetForLoadedChannel(params: {
  channel: string;
  rawTarget?: string | null;
  fallbackThreadId?: string | number | null;
}): ComparableChannelTarget | null {
  const rawTo = normalizeOptionalString(params.rawTarget);
  if (!rawTo) {
    return null;
  }
  const parsed = parseExplicitTargetForLoadedChannel(params.channel, rawTo);
  const fallbackThreadId = normalizeOptionalThreadValue(params.fallbackThreadId);
  return {
    rawTo,
    to: parsed?.to ?? rawTo,
    threadId: normalizeOptionalThreadValue(parsed?.threadId ?? fallbackThreadId),
    chatType: parsed?.chatType,
  };
}

export function comparableChannelTargetsMatch(params: {
  left?: ComparableChannelTarget | null;
  right?: ComparableChannelTarget | null;
}): boolean {
  return channelRoutesMatchExact({
    left: targetToRoute(params.left),
    right: targetToRoute(params.right),
  });
}

export function comparableChannelTargetsShareRoute(params: {
  left?: ComparableChannelTarget | null;
  right?: ComparableChannelTarget | null;
}): boolean {
  return channelRoutesShareConversation({
    left: targetToRoute(params.left),
    right: targetToRoute(params.right),
  });
}

function targetToRoute(target?: ComparableChannelTarget | null) {
  return target
    ? normalizeChannelRouteRef({
        to: target.to,
        rawTo: target.rawTo,
        threadId: target.threadId,
        chatType: target.chatType,
      })
    : undefined;
}
