import type { ChannelApprovalNativeTarget } from "../channels/plugins/approval-native.types.js";
import { channelRouteIdentityKey } from "../channels/route/ref.js";

export function buildChannelApprovalNativeTargetKey(target: ChannelApprovalNativeTarget): string {
  return channelRouteIdentityKey({
    to: target.to,
    threadId: target.threadId,
  });
}
