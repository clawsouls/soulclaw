import { describe, expect, it } from "vitest";
import { MAX_SAFE_TIMEOUT_DELAY_MS, resolveSafeTimeoutDelayMs } from "./timeouts.js";

describe("resolveSafeTimeoutDelayMs", () => {
  it("clamps to Node's signed-32-bit timer ceiling", () => {
    expect(resolveSafeTimeoutDelayMs(3_000_000_000)).toBe(MAX_SAFE_TIMEOUT_DELAY_MS);
  });

  it("falls back to the minimum for non-finite delays", () => {
    expect(resolveSafeTimeoutDelayMs(Number.NaN)).toBe(1);
    expect(resolveSafeTimeoutDelayMs(Number.POSITIVE_INFINITY, { minMs: 250 })).toBe(250);
  });

  it("preserves callers that intentionally allow zero-delay timers", () => {
    expect(resolveSafeTimeoutDelayMs(Number.NaN, { minMs: 0 })).toBe(0);
    expect(resolveSafeTimeoutDelayMs(-5, { minMs: 0 })).toBe(0);
  });
});
