import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  TopicMap,
  TopicSnapshot,
  extractFromCompactionSummary,
  sanitizeTopicName,
  shouldSkipSession,
  buildInjectionText,
  stripInjectedContext,
} from "./topic-snapshot.js";

describe("topic-snapshot", () => {
  describe("sanitizeTopicName", () => {
    it("should sanitize topic names", () => {
      expect(sanitizeTopicName("My Topic!")).toBe("my-topic");
      expect(sanitizeTopicName("agent:main:telegram:123")).toBe("agent-main-telegram-123");
      expect(sanitizeTopicName("Too-Many---Dashes")).toBe("too-many-dashes");
      expect(sanitizeTopicName("-Leading-Trailing-")).toBe("leading-trailing");
    });
  });

  describe("shouldSkipSession", () => {
    it("should skip system sessions", () => {
      expect(shouldSkipSession("heartbeat")).toBe(true);
      expect(shouldSkipSession("agent:main:cron")).toBe(true);
      expect(shouldSkipSession("memory-test")).toBe(true);
      expect(shouldSkipSession("healthcheck-run")).toBe(true);
      expect(shouldSkipSession("agent:main:telegram:123")).toBe(false);
    });
  });

  describe("extractFromCompactionSummary", () => {
    it("should extract decisions and status from summary", () => {
      const summary = `# Summary

## Decisions
- 2026-03-22: Implemented topic snapshot feature
- 2026-03-22: Used hook system for integration

## Open TODOs
- Test the implementation
- Write documentation

## Other Section
- This should be ignored
`;
      const result = extractFromCompactionSummary(summary);
      expect(result.decisions).toEqual([
        "- 2026-03-22: Implemented topic snapshot feature",
        "- 2026-03-22: Used hook system for integration",
      ]);
      expect(result.status).toContain("Test the implementation");
    });

    it("should handle missing sections", () => {
      const summary = "Just a summary with no structured sections.";
      const result = extractFromCompactionSummary(summary);
      expect(result.decisions).toEqual([]);
      expect(result.status).toBe("");
    });
  });

  describe("injection", () => {
    it("should build and strip injection text", () => {
      const data = {
        name: "test-topic",
        meta: { created: "2026-03-22", updated: "2026-03-22", session: "test:session" },
        status: "Testing topic snapshots",
        decisions: ["- 2026-03-22: Created test"],
        history: ["- 2026-03-22: Started testing"],
      };

      const injection = buildInjectionText(data);
      expect(injection).toContain("Topic Context (auto-injected by SoulClaw)");
      expect(injection).toContain("# test-topic");
      expect(injection).toContain("Testing topic snapshots");

      const text = `Some prompt text\n${injection}\nMore text`;
      const stripped = stripInjectedContext(text);
      expect(stripped).toBe("Some prompt text\n\nMore text");
    });
  });

  describe("TopicMap", () => {
    it("should load, save, and bind topics", async () => {
      const tmpDir = await fs.mkdtemp(path.join(tmpdir(), "topic-test-"));
      const map = new TopicMap(tmpDir);

      // Initially empty
      await map.load();
      expect(map.getTopicForSession("test:session")).toBeUndefined();

      // Bind and save
      map.bindSession("test:session", "my-topic");
      await map.save();

      // Load in new instance
      const map2 = new TopicMap(tmpDir);
      await map2.load();
      expect(map2.getTopicForSession("test:session")).toBe("my-topic");

      // Auto-bind
      const autoTopic = map2.autoBindSession("test:session:auto");
      expect(autoTopic).toBe("test-session-auto");
      expect(map2.getTopicForSession("test:session:auto")).toBe("test-session-auto");

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });

  describe("TopicSnapshot", () => {
    it("should save and load topic data", async () => {
      const tmpDir = await fs.mkdtemp(path.join(tmpdir(), "topic-test-"));
      const topicName = "test-topic";

      // Save data
      await TopicSnapshot.appendHistory(tmpDir, topicName, "test event", "test:session");

      // Load data
      const data = await TopicSnapshot.load(tmpDir, topicName);
      expect(data).toBeDefined();
      expect(data?.name).toBe(topicName);
      expect(data?.history).toHaveLength(1);
      expect(data?.history[0]).toContain("test event");

      // Update from summary
      const summary = `## Decisions\n- 2026-03-22: Made a decision\n\n## Open TODOs\n- Complete the task`;
      await TopicSnapshot.updateFromSummary(tmpDir, topicName, summary, "test:session");

      const updated = await TopicSnapshot.load(tmpDir, topicName);
      expect(updated?.decisions).toHaveLength(1);
      expect(updated?.decisions[0]).toContain("Made a decision");
      expect(updated?.status).toContain("Complete the task");

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
