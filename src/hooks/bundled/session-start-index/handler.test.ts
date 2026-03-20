import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInternalHookEvent } from "../../internal-hooks.js";

const mockSync = vi.fn().mockResolvedValue(undefined);
const mockDispose = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn().mockResolvedValue({
  sync: mockSync,
  dispose: mockDispose,
});

vi.mock("../../../memory/index.js", () => ({
  MemoryIndexManager: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock("../../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../routing/session-key.js", () => ({
  resolveAgentIdFromSessionKey: () => "main",
}));

vi.mock("../../config.js", () => ({
  resolveHookConfig: () => undefined,
}));

describe("session-start-index handler", () => {
  beforeEach(() => {
    mockSync.mockClear();
    mockDispose.mockClear();
    mockGet.mockClear();
    mockGet.mockResolvedValue({
      sync: mockSync,
      dispose: mockDispose,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should skip events that are not session:start", async () => {
    const handler = (await import("./handler.js")).default;

    const event = createInternalHookEvent("command", "new", "test-key", {
      sessionId: "sess-123",
      sessionKey: "agent:main:main",
    });
    await handler(event);

    expect(mockSync).not.toHaveBeenCalled();
  });

  it("should run memory sync for session:start events with config", async () => {
    const handler = (await import("./handler.js")).default;

    const event = createInternalHookEvent("session", "start", "agent:main:main", {
      sessionId: "sess-123",
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-workspace",
      cfg: { memory: { enabled: true } },
    });
    await handler(event);

    expect(mockSync).toHaveBeenCalledWith({ reason: "session-start" });
  });

  it("should skip when no config is available", async () => {
    const handler = (await import("./handler.js")).default;

    const event = createInternalHookEvent("session", "start", "agent:main:main", {
      sessionId: "sess-123",
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-workspace",
      cfg: undefined,
    });
    await handler(event);

    expect(mockSync).not.toHaveBeenCalled();
  });

  it("should skip when MemoryIndexManager.get returns null", async () => {
    mockGet.mockResolvedValueOnce(null);
    const handler = (await import("./handler.js")).default;

    const event = createInternalHookEvent("session", "start", "agent:main:main", {
      sessionId: "sess-456",
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-workspace",
      cfg: { memory: { enabled: true } },
    });
    await handler(event);

    expect(mockSync).not.toHaveBeenCalled();
  });
});
