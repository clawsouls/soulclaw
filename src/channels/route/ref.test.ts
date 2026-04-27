import { describe, expect, it } from "vitest";
import {
  channelRouteKey,
  channelRoutesMatchExact,
  channelRoutesShareConversation,
  normalizeChannelRouteRef,
  stringifyRouteThreadId,
} from "./ref.js";

describe("channel route refs", () => {
  it("normalizes target, account, and thread fields", () => {
    expect(
      normalizeChannelRouteRef({
        channel: " Slack ",
        accountId: " Work ",
        rawTo: " channel:C1 ",
        to: " C1 ",
        threadId: " 171234.567 ",
      }),
    ).toEqual({
      channel: "slack",
      accountId: "work",
      target: {
        rawTo: "channel:C1",
        to: "C1",
      },
      thread: {
        id: "171234.567",
      },
    });
  });

  it("normalizes numeric thread ids for route keys", () => {
    const route = normalizeChannelRouteRef({
      channel: "telegram",
      to: "-100123",
      threadId: 42.9,
    });

    expect(stringifyRouteThreadId(route?.thread?.id)).toBe("42");
    expect(channelRouteKey(route)).toBe("telegram|-100123||42");
  });

  it("matches exact routes when numeric and string thread ids are equivalent", () => {
    expect(
      channelRoutesMatchExact({
        left: normalizeChannelRouteRef({
          channel: "telegram",
          to: "-100123",
          threadId: 42,
        }),
        right: normalizeChannelRouteRef({
          channel: "telegram",
          to: "-100123",
          threadId: "42",
        }),
      }),
    ).toBe(true);
  });

  it("shares conversation when one side is the parent route", () => {
    expect(
      channelRoutesShareConversation({
        left: normalizeChannelRouteRef({
          channel: "slack",
          to: "channel:C1",
          threadId: "171234.567",
        }),
        right: normalizeChannelRouteRef({
          channel: "slack",
          to: "channel:C1",
        }),
      }),
    ).toBe(true);
  });

  it("does not share different child threads", () => {
    expect(
      channelRoutesShareConversation({
        left: normalizeChannelRouteRef({
          channel: "matrix",
          to: "room:!abc:example.org",
          threadId: "$root-1",
        }),
        right: normalizeChannelRouteRef({
          channel: "matrix",
          to: "room:!abc:example.org",
          threadId: "$root-2",
        }),
      }),
    ).toBe(false);
  });
});
