import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInternalHookEvent } from "../../internal-hooks.js";

// Mock dependencies
vi.mock("../../../infra/fs-safe.js", () => ({
  writeFileWithinRoot: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: () => "/tmp/test-workspace",
}));

vi.mock("../../../config/paths.js", () => ({
  resolveStateDir: () => "/tmp/test-state",
}));

vi.mock("../../../sessions/input-provenance.js", () => ({
  hasInterSessionUserProvenance: () => false,
}));

vi.mock("../../config.js", () => ({
  resolveHookConfig: () => undefined,
}));

describe("session-memory-autoflush handler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoflush-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should skip events that are not session:end", async () => {
    const { writeFileWithinRoot } = await import("../../../infra/fs-safe.js");
    const handler = (await import("./handler.js")).default;

    const event = createInternalHookEvent("command", "new", "test-key", {
      sessionId: "sess-123",
      reason: "command",
    });
    await handler(event);

    expect(writeFileWithinRoot).not.toHaveBeenCalled();
  });

  it("should skip session:end events with command reason by default", async () => {
    const { writeFileWithinRoot } = await import("../../../infra/fs-safe.js");
    const handler = (await import("./handler.js")).default;

    const event = createInternalHookEvent("session", "end", "test-key", {
      sessionId: "sess-123",
      sessionKey: "agent:main:main",
      workspaceDir: tmpDir,
      reason: "command",
      cfg: undefined,
    });
    await handler(event);

    expect(writeFileWithinRoot).not.toHaveBeenCalled();
  });

  it("should process session:end events with compaction reason", async () => {
    const { writeFileWithinRoot } = await import("../../../infra/fs-safe.js");
    const handler = (await import("./handler.js")).default;

    // Create a mock session file
    const sessionsDir = path.join(tmpDir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionFile = path.join(sessionsDir, "sess-456.jsonl");
    const sessionData = [
      JSON.stringify({
        type: "message",
        message: { role: "user", content: "How do hooks work?" },
      }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: "Hooks are event handlers..." },
      }),
    ].join("\n");
    await fs.writeFile(sessionFile, sessionData);

    const event = createInternalHookEvent("session", "end", "agent:main:main", {
      sessionId: "sess-456",
      sessionKey: "agent:main:main",
      workspaceDir: tmpDir,
      reason: "compaction",
      cfg: undefined,
    });
    await handler(event);

    expect(writeFileWithinRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-autoflush\.md$/),
      }),
    );
  });

  it("should process session:end events with reaper reason", async () => {
    const { writeFileWithinRoot } = await import("../../../infra/fs-safe.js");
    const handler = (await import("./handler.js")).default;

    const event = createInternalHookEvent("session", "end", "agent:main:main", {
      sessionId: "sess-789",
      sessionKey: "agent:main:main",
      workspaceDir: tmpDir,
      reason: "reaper",
      cfg: undefined,
    });
    await handler(event);

    // No session file exists, so no content to flush — writeFileWithinRoot should NOT be called
    expect(writeFileWithinRoot).not.toHaveBeenCalled();
  });
});
